/**
 * @fileoverview Shelly Gen2+ driver. Discovery через mDNS `_shelly._tcp`,
 * control через HTTP RPC POST /rpc (JSON-RPC 2.0). Bulb/RGBW/Duo используют
 * `Light.*` RPC, остальные — `Switch.*`.
 *
 * Auth: при auth_en=true firmware возвращает 401 + JSON challenge для digest
 * (RFC 7616). Драйвер выполняет digest-handshake с password из creds; user
 * хардкод "admin" (Shelly Gen2 не позволяет менять).
 */

import axios, { type AxiosInstance } from 'axios';
import { createHash, randomBytes } from 'node:crypto';
import type {
  Capability,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import { browseMdns } from '../_shared/mdns-browse.js';
import {
  CAPABILITY,
  DEVICE_TYPE,
  INSTANCE,
  RANGE,
  capBrightness,
  capColor,
  capOnOff,
} from '@smarthome/shared';
import { rgbIntToTuple, tupleToRgbInt } from '../_shared/color.js';
import { BaseDriver } from '../_shared/base-driver.js';

const SHELLY_HTTP_TIMEOUT_MS = 2500;
const SHELLY_DISCOVER_TIMEOUT_MS = 4000;
const SHELLY_KELVIN: { min: number; max: number } = { min: 2700, max: 6500 };

interface ShellyMeta extends Record<string, unknown> {
  model?: string;
  gen?: string | number;
  component?: 'light' | 'switch';
  /** true для RGBW: лампа поддерживает оба режима (color / white). */
  hasWhiteMode?: boolean;
}

interface ShellyCreds {
  /** Опциональный password для devices с auth_en=true (Gen2+). */
  password?: string;
}

interface ShellyAuthChallenge {
  realm: string;
  nonce: number;
  algorithm: 'SHA-256';
}

export class ShellyDriver extends BaseDriver {
  readonly id = 'shelly' as const;
  readonly displayName = 'Shelly';

  private readonly http: AxiosInstance = axios.create({
    timeout: SHELLY_HTTP_TIMEOUT_MS,
    validateStatus: () => true, // 401 нужен для digest-handshake'а
  });
  private nextRpcId = 1;

  constructor(private readonly creds: ShellyCreds = {}) {
    super();
  }

  /**
   * Универсальный JSON-RPC 2.0 POST /rpc вызов с автоматическим digest-auth
   * при 401. POST + body предпочтительнее GET с query-params (рекомендация
   * Shelly), потому что rgb-tuple не сериализуется в query без JSON.stringify.
   */
  private async rpc<T = unknown>(
    address: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const url = `http://${address}/rpc`;
    const id = this.nextRpcId++;
    // params: {} обязателен в Gen3 firmware (некоторые билды 2025 отбрасывают
    // запрос как malformed JSON-RPC если поле отсутствует). Gen2 принимает оба.
    const body: Record<string, unknown> = { id, method, params: params ?? {} };
    const r = await this.http.post(url, body);
    if (r.status === 401 && this.creds.password) {
      const challenge = parseAuthChallenge(r.data);
      if (!challenge) throw new Error(`Shelly auth: malformed 401 response`);
      const auth = buildDigestAuth(challenge, method, this.creds.password);
      const r2 = await this.http.post(url, { ...body, auth });
      return readRpcResult<T>(r2);
    }
    return readRpcResult<T>(r);
  }

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    const services = await browseMdns({
      type: 'shelly',
      timeoutMs: SHELLY_DISCOVER_TIMEOUT_MS,
      signal,
    });
    const found = new Map<string, DiscoveredDevice>();
    for (const svc of services) {
      const model = String(svc.txt['app'] ?? '');
      const isLight = isLightModel(model);
      found.set(svc.name, {
        driver: 'shelly',
        externalId: svc.name,
        type: isLight ? DEVICE_TYPE.LIGHT : DEVICE_TYPE.SOCKET,
        name: svc.txt['name'] ?? svc.name,
        address: `${svc.host}:${svc.port ?? 80}`,
        meta: {
          model,
          gen: svc.txt['gen'] ?? '2',
          component: isLight ? 'light' : 'switch',
        } satisfies ShellyMeta,
      });
    }
    return Array.from(found.values());
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    try {
      const data = await this.rpc<{
        id: string;
        model: string;
        gen: number;
        name?: string;
        auth_en?: boolean;
      }>(candidate.address, 'Shelly.GetDeviceInfo');
      const model = data.model ?? (candidate.meta as ShellyMeta).model ?? '';
      const isLight = isLightModel(model);
      const type: DeviceType = isLight ? DEVICE_TYPE.LIGHT : DEVICE_TYPE.SOCKET;
      const component: ShellyMeta['component'] = isLight ? 'light' : 'switch';

      // auth_en=true (включена защита паролем) + у нас нет creds.password = pairing
      // не пройдёт. Логируем actionable warning сразу при probe, а не на каждом
      // execute с generic DEVICE_UNREACHABLE.
      if (data.auth_en && !this.creds.password) {
        this.logWarn(
          `device ${data.id} (${model}) защищён паролем (auth_en), но в creds его нет — добавьте Shelly password в настройках интеграции`,
        );
      }

      const now = new Date().toISOString();
      const meta: ShellyMeta = {
        model,
        gen: data.gen ?? 2,
        component,
        hasWhiteMode: isLight,
      };

      // Initial status fetch: brightness / color / output для capabilities.
      let initialStatus: ShellyLightStatus | ShellySwitchStatus | null = null;
      try {
        initialStatus = await this.rpc<ShellyLightStatus | ShellySwitchStatus>(
          candidate.address,
          isLight ? 'Light.GetStatus' : 'Switch.GetStatus',
          { id: 0 },
        );
      } catch {
        /* status read опционально, probe валидно без него */
      }

      return {
        id: '',
        externalId: data.id,
        driver: 'shelly',
        type,
        name: data.name ?? candidate.name,
        address: candidate.address,
        hidden: false,
        status: 'online',
        meta,
        capabilities: buildShellyCaps(type, initialStatus),
        properties: [],
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      };
    } catch (e) {
      this.logWarn('probe failed', e);
      return null;
    }
  }

  async readState(device: Device): Promise<Device> {
    const isLight = device.type === DEVICE_TYPE.LIGHT;
    try {
      const data = await this.rpc<ShellyLightStatus | ShellySwitchStatus>(
        device.address,
        isLight ? 'Light.GetStatus' : 'Switch.GetStatus',
        { id: 0 },
      );
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildShellyCaps(device.type, data),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const isLight = device.type === DEVICE_TYPE.LIGHT;

    try {
      if (command.capability === CAPABILITY.ON_OFF) {
        await this.rpc(device.address, isLight ? 'Light.Set' : 'Switch.Set', {
          id: 0,
          on: Boolean(command.value),
        });
      } else if (
        isLight &&
        command.capability === CAPABILITY.RANGE &&
        command.instance === INSTANCE.BRIGHTNESS
      ) {
        const v = clamp(Math.round(Number(command.value)), RANGE.PERCENT.min, RANGE.PERCENT.max);
        await this.rpc(device.address, 'Light.Set', { id: 0, brightness: v });
      } else if (
        isLight &&
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.RGB
      ) {
        const rgb = clamp(Number(command.value), 0, 0xffffff);
        const tuple = rgbIntToTuple(rgb);
        // POST /rpc + body — массив сериализуется как JSON, без хака query-params.
        await this.rpc(device.address, 'Light.Set', { id: 0, rgb: tuple });
      } else if (
        isLight &&
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.TEMPERATURE_K
      ) {
        const k = clamp(Number(command.value), SHELLY_KELVIN.min, SHELLY_KELVIN.max);
        await this.rpc(device.address, 'Light.Set', { id: 0, temp: k });
      } else {
        return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
      }
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      const msg = (e as Error).message;
      const code = /HTTP 401|auth/i.test(msg) ? 'AUTH_REQUIRED' : 'DEVICE_UNREACHABLE';
      return this.err(device, command, code, msg);
    }
  }
}

/**
 * Парсит challenge из 401-ответа Shelly Gen2.
 *
 * Формат ответа:
 *   {"id":1,"src":"shelly...","error":{"code":401,"message":"{\"auth_type\":\"digest\",\"nonce\":...,\"realm\":\"...\",\"algorithm\":\"SHA-256\"}"}}
 *
 * `error.message` — JSON-строка внутри JSON.
 */
function parseAuthChallenge(data: unknown): ShellyAuthChallenge | null {
  if (!data || typeof data !== 'object') return null;
  const err = (data as { error?: { message?: string } }).error;
  if (!err?.message) return null;
  try {
    const inner = JSON.parse(err.message) as {
      auth_type?: string;
      nonce?: number;
      realm?: string;
      algorithm?: string;
    };
    if (inner.auth_type !== 'digest') return null;
    if (typeof inner.nonce !== 'number' || !inner.realm) return null;
    return {
      realm: inner.realm,
      nonce: inner.nonce,
      algorithm: 'SHA-256',
    };
  } catch {
    return null;
  }
}

/**
 * Строит digest-auth блок для следующего RPC-запроса (Shelly Gen2 RFC-7616-style).
 *
 * HA1 = SHA-256("admin:realm:password")
 * HA2 = SHA-256("dummy_method:dummy_uri")  // Shelly игнорирует, но требует поле
 * cnonce = random uint32
 * response = SHA-256("HA1:nonce:nc:cnonce:auth:HA2")  где nc=00000001
 */
function buildDigestAuth(
  challenge: ShellyAuthChallenge,
  _method: string,
  password: string,
): {
  realm: string;
  username: string;
  nonce: number;
  cnonce: number;
  response: string;
  algorithm: 'SHA-256';
} {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const username = 'admin';
  const ha1 = sha(`${username}:${challenge.realm}:${password}`);
  // dummy method/uri — Shelly не валидирует, но поля required по спеке.
  const ha2 = sha('dummy_method:dummy_uri');
  const cnonce = randomBytes(4).readUInt32BE(0);
  const response = sha(`${ha1}:${challenge.nonce}:1:${cnonce}:auth:${ha2}`);
  return {
    realm: challenge.realm,
    username,
    nonce: challenge.nonce,
    cnonce,
    response,
    algorithm: 'SHA-256',
  };
}

function readRpcResult<T>(r: { status: number; data: unknown }): T {
  if (r.status >= 400) {
    const err = (r.data as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(`Shelly RPC HTTP ${r.status}${err ? ': ' + err : ''}`);
  }
  const body = r.data as { result?: T; error?: { message?: string } };
  if (body?.error) throw new Error(`Shelly RPC error: ${body.error.message ?? 'unknown'}`);
  return (body?.result ?? (r.data as T)) as T;
}

interface ShellyLightStatus {
  output?: boolean;
  brightness?: number;
  rgb?: [number, number, number];
  temp?: number;
  mode?: 'color' | 'white';
}

interface ShellySwitchStatus {
  output?: boolean;
}

function isLightModel(model: string): boolean {
  return /bulb|rgbw|dimmer|duo|vintage|lightstrip/i.test(model);
}

function buildShellyCaps(
  type: DeviceType,
  status: ShellyLightStatus | ShellySwitchStatus | null,
): Capability[] {
  const caps: Capability[] = [capOnOff(Boolean(status?.output))];
  if (type !== DEVICE_TYPE.LIGHT) return caps;

  const light = (status ?? {}) as ShellyLightStatus;
  caps.push(capBrightness(typeof light.brightness === 'number' ? light.brightness : 100));

  // RGBW: оба instance активны одновременно, текущий `mode` определяет какой читать.
  const [r, g, b] = light.rgb ?? [0xff, 0xff, 0xff];
  const rgbInt = tupleToRgbInt(r, g, b);
  const ct = typeof light.temp === 'number' ? light.temp : 4000;
  const isWhiteMode = light.mode === 'white';
  caps.push(
    capColor(isWhiteMode ? { kind: 'temperature_k', value: ct } : { kind: 'rgb', value: rgbInt }, {
      rgb: true,
      temperatureK: SHELLY_KELVIN,
    }),
  );
  return caps;
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
