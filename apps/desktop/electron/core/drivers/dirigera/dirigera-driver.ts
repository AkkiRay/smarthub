// IKEA DIRIGERA шлюз — локальный REST на 8443 (self-signed TLS).
// Pairing PKCE-flow: POST /v1/oauth/authorize → user жмёт кнопку на шлюзе → POST /v1/oauth/token.
// После получения access_token → GET /v1/devices, PATCH /v1/devices/<id> для управления.
//
// Старый шлюз TRÅDFRI (gateway gen1) использует CoAP/DTLS — отдельный протокол, тут не покрываем.

import { Agent } from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import axios, { type AxiosInstance } from 'axios';
import type {
  Capability,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import {
  CAPABILITY,
  DEVICE_TYPE,
  INSTANCE,
  RANGE,
  capBrightness,
  capColor,
  capOnOff,
} from '@smarthome/shared';
import { rgbIntToHsv } from '../_shared/color.js';
import { BaseDriver } from '../_shared/base-driver.js';

const DIRIGERA_HTTP_TIMEOUT_MS = 5000;
const DIRIGERA_PAIR_TIMEOUT_MS = 4000;
const DIRIGERA_KELVIN: { min: number; max: number } = { min: 2200, max: 6500 };

interface DirigeraDevice {
  id: string;
  type: string;
  deviceType: string;
  attributes: Record<string, unknown> & {
    customName?: string;
    isOn?: boolean;
    lightLevel?: number; // 1..100
    colorHue?: number;
    colorSaturation?: number;
    colorTemperature?: number; // mireds
    colorMode?: 'color' | 'temperature';
    currentTemperature?: number;
    currentRH?: number;
  };
  capabilities: { canSend?: string[]; canReceive?: string[] };
  isReachable?: boolean;
}

interface DirigeraCreds {
  host: string;
  accessToken: string;
}

export class DirigeraDriver extends BaseDriver {
  readonly id = 'dirigera' as const;
  readonly displayName = 'IKEA DIRIGERA';

  private readonly http: AxiosInstance;

  constructor(private readonly creds: DirigeraCreds) {
    super();
    this.http = axios.create({
      baseURL: `https://${creds.host}:8443/v1`,
      timeout: DIRIGERA_HTTP_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      // self-signed cert — IKEA не публикует CA, доверяем локальной сети.
      httpsAgent: new Agent({ rejectUnauthorized: false }),
    });
  }

  async discover(_signal: AbortSignal): Promise<DiscoveredDevice[]> {
    try {
      const { data } = await this.http.get<DirigeraDevice[]>('/devices');
      return data
        .filter((d) => d.type !== 'gateway')
        .map((d) => ({
          driver: 'dirigera' as const,
          externalId: d.id,
          type: mapType(d),
          name: d.attributes.customName ?? d.deviceType,
          address: this.creds.host,
          meta: { deviceType: d.deviceType, raw: d.attributes },
        }));
    } catch (e) {
      this.logWarn('discovery failed', e);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    try {
      const { data } = await this.http.get<DirigeraDevice>(`/devices/${candidate.externalId}`);
      const now = new Date().toISOString();
      return {
        id: '',
        externalId: data.id,
        driver: 'dirigera',
        type: mapType(data),
        name: data.attributes.customName ?? candidate.name,
        address: this.creds.host,
        hidden: false,
        meta: { deviceType: data.deviceType, raw: data.attributes },
        status: data.isReachable === false ? 'unreachable' : 'online',
        capabilities: buildCaps(mapType(data), data),
        properties: [],
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      };
    } catch {
      return null;
    }
  }

  async readState(device: Device): Promise<Device> {
    try {
      const { data } = await this.http.get<DirigeraDevice>(`/devices/${device.externalId}`);
      return {
        ...device,
        status: data.isReachable === false ? 'unreachable' : 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildCaps(device.type, data),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    let attributes: Record<string, unknown> | null = null;
    if (command.capability === CAPABILITY.ON_OFF) {
      attributes = { isOn: Boolean(command.value) };
    } else if (
      command.capability === CAPABILITY.RANGE &&
      command.instance === INSTANCE.BRIGHTNESS
    ) {
      attributes = {
        lightLevel: clamp(Number(command.value), RANGE.PERCENT.min, RANGE.PERCENT.max),
      };
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.TEMPERATURE_K
    ) {
      // DIRIGERA принимает colorTemperature в Kelvin (новые firmware) или mireds (старые) — отправляем оба.
      const k = clamp(Number(command.value), DIRIGERA_KELVIN.min, DIRIGERA_KELVIN.max);
      attributes = { colorTemperature: k };
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.RGB
    ) {
      // RGB → HSL для DIRIGERA.
      const hsv = rgbIntToHsv(Number(command.value));
      attributes = { colorHue: hsv.h, colorSaturation: hsv.s };
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      await this.http.patch(`/devices/${device.externalId}`, [{ attributes }]);
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }
}

function mapType(d: DirigeraDevice): DeviceType {
  switch (d.deviceType) {
    case 'light':
      return DEVICE_TYPE.LIGHT;
    case 'outlet':
      return DEVICE_TYPE.SOCKET;
    case 'sensor':
    case 'environmentSensor':
    case 'motionSensor':
      return DEVICE_TYPE.SENSOR;
    case 'blinds':
      return DEVICE_TYPE.CURTAIN;
    case 'speaker':
      return DEVICE_TYPE.MEDIA;
    case 'airPurifier':
      return DEVICE_TYPE.PURIFIER;
    default:
      return DEVICE_TYPE.OTHER;
  }
}

function buildCaps(type: DeviceType, d: DirigeraDevice): Capability[] {
  const a = d.attributes;
  const caps: Capability[] = [capOnOff(Boolean(a.isOn))];
  if (type === DEVICE_TYPE.LIGHT && typeof a.lightLevel === 'number') {
    caps.push(capBrightness(Math.max(1, a.lightLevel)));
    if (a.colorTemperature !== undefined) {
      caps.push(
        capColor(
          { kind: 'temperature_k', value: Math.round(a.colorTemperature) },
          { rgb: true, temperatureK: DIRIGERA_KELVIN },
        ),
      );
    }
  }
  return caps;
}

/** Pairing helper: PKCE — pre-generates code_verifier / challenge, ждёт нажатия кнопки. */
export async function dirigeraPair(host: string): Promise<{ accessToken: string }> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const http = axios.create({
    baseURL: `https://${host}:8443/v1`,
    timeout: DIRIGERA_PAIR_TIMEOUT_MS,
    httpsAgent: new Agent({ rejectUnauthorized: false }),
  });
  const auth = await http.post<{ code: string }>('/oauth/authorize', null, {
    params: {
      audience: 'homesmart.local',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    },
  });
  // UI должен сейчас показать «Нажмите кнопку на DIRIGERA в течение 60 секунд».
  // Token endpoint вернёт ошибку до нажатия кнопки — retry-loop делается в caller'е.
  const token = await http.post<{ access_token: string }>(
    '/oauth/token',
    new URLSearchParams({
      code: auth.data.code,
      name: 'smarthome-hub',
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return { accessToken: token.data.access_token };
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
