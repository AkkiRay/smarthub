/**
 * @fileoverview
 * TP-Link Tapo (P100/P110/L510/L530/L630): локальный KLAP/passthrough HTTP.
 * На firmware <1.1.0 работает «secure-passthrough» (RSA-1024 handshake → AES-128-CBC).
 * На новых прошивках (>=1.1.0) — KLAP v2: SHA256-handshake без RSA.
 * Здесь реализован legacy secure-passthrough; KLAP помечен TODO — для полной поддержки
 * нужно тестировать на конкретных моделях. Если local не работает — UI должен предложить
 * TP-Link Cloud (`tplink-cloud`), который покрывает обе линейки одним API.
 */

import axios, { type AxiosInstance } from 'axios';
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  generateKeyPairSync,
  privateDecrypt,
  createHash,
} from 'node:crypto';
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
import { hsvToRgbInt, rgbIntToHsv } from '../_shared/color.js';
import { BaseDriver } from '../_shared/base-driver.js';

const TAPO_HTTP_TIMEOUT_MS = 5000;
const TAPO_KELVIN: { min: number; max: number } = { min: 2500, max: 6500 };

interface TapoCreds {
  email: string;
  password: string;
  /** Опционально: список host'ов, если discovery недоступно (Tapo в LAN не отвечает на broadcast). */
  hosts?: string[];
}

interface TapoSession {
  cipher: TapoCipher;
  token: string;
}

interface TapoCipher {
  key: Buffer;
  iv: Buffer;
}

interface TapoDeviceInfo {
  device_id: string;
  fw_ver: string;
  hw_ver: string;
  type: string;
  model: string;
  mac: string;
  hw_id: string;
  fw_id: string;
  oem_id: string;
  device_on?: boolean;
  brightness?: number;
  hue?: number;
  saturation?: number;
  color_temp?: number;
  nickname: string;
  region: string;
}

interface TapoMeta extends Record<string, unknown> {
  model: string;
  isBulb: boolean;
  isColor: boolean;
  isVariableTemp: boolean;
  isDimmable: boolean;
}

export class TPLinkTapoDriver extends BaseDriver {
  readonly id = 'tplink-tapo' as const;
  readonly displayName = 'TP-Link Tapo';

  private readonly http: AxiosInstance = axios.create({ timeout: TAPO_HTTP_TIMEOUT_MS });
  private sessions = new Map<string, TapoSession>();

  constructor(private readonly creds: TapoCreds) {
    super();
  }

  async discover(_signal: AbortSignal): Promise<DiscoveredDevice[]> {
    // Tapo не отвечает на UDP broadcast — discovery делается через cloud OR явный список IP.
    const hosts = this.creds.hosts ?? [];
    const found: DiscoveredDevice[] = [];

    for (const host of hosts) {
      try {
        const info = await this.getDeviceInfo(host);
        const meta = inferMeta(info);
        found.push({
          driver: 'tplink-tapo',
          externalId: info.device_id,
          type: meta.isBulb ? DEVICE_TYPE.LIGHT : DEVICE_TYPE.SOCKET,
          name: decodeBase64(info.nickname) || info.model,
          address: host,
          meta,
        });
      } catch (e) {
        this.logWarn(`probe ${host} failed`, e);
      }
    }
    return found;
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    try {
      const info = await this.getDeviceInfo(candidate.address);
      const meta = inferMeta(info);
      const type: DeviceType = meta.isBulb ? DEVICE_TYPE.LIGHT : DEVICE_TYPE.SOCKET;
      const now = new Date().toISOString();
      return {
        id: '',
        externalId: info.device_id,
        driver: 'tplink-tapo',
        type,
        name: decodeBase64(info.nickname) || candidate.name,
        address: candidate.address,
        hidden: false,
        meta,
        status: 'online',
        capabilities: buildTapoCaps(type, meta, info),
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
    try {
      const info = await this.getDeviceInfo(device.address);
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildTapoCaps(device.type, device.meta as TapoMeta, info),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const meta = device.meta as TapoMeta;

    try {
      const params: Record<string, unknown> = {};
      if (command.capability === CAPABILITY.ON_OFF) {
        params['device_on'] = Boolean(command.value);
      } else if (
        command.capability === CAPABILITY.RANGE &&
        command.instance === INSTANCE.BRIGHTNESS
      ) {
        params['device_on'] = true;
        params['brightness'] = clamp(Number(command.value), RANGE.PERCENT.min, RANGE.PERCENT.max);
      } else if (
        meta.isColor &&
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.RGB
      ) {
        const hsv = rgbIntToHsv(Number(command.value));
        params['device_on'] = true;
        params['hue'] = Math.round(hsv.h);
        params['saturation'] = Math.round(hsv.s * 100);
        params['color_temp'] = 0;
      } else if (
        meta.isVariableTemp &&
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.TEMPERATURE_K
      ) {
        params['device_on'] = true;
        params['color_temp'] = clamp(Number(command.value), TAPO_KELVIN.min, TAPO_KELVIN.max);
        params['saturation'] = 0;
      } else {
        return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
      }
      await this.secureRequest(device.address, 'set_device_info', params);
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  override async shutdown(): Promise<void> {
    this.sessions.clear();
  }

  private async getDeviceInfo(host: string): Promise<TapoDeviceInfo> {
    const r = await this.secureRequest<{ result: TapoDeviceInfo }>(host, 'get_device_info', {});
    return r.result;
  }

  // Secure passthrough: RSA-keypair → handshake (получаем session key) → login → encrypted requests.
  // Сессия кешируется per-host; при ошибке -1501 (token expired) выбрасываем кеш и retry.
  private async secureRequest<T = { result: unknown }>(
    host: string,
    method: string,
    params: object,
  ): Promise<T> {
    let session = this.sessions.get(host);
    if (!session) {
      session = await this.handshakeAndLogin(host);
      this.sessions.set(host, session);
    }
    try {
      return await this.invokeWithSession<T>(host, session, method, params);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('-1501') || msg.includes('-1012') || msg.includes('expired')) {
        this.sessions.delete(host);
        const fresh = await this.handshakeAndLogin(host);
        this.sessions.set(host, fresh);
        return await this.invokeWithSession<T>(host, fresh, method, params);
      }
      throw e;
    }
  }

  private async handshakeAndLogin(host: string): Promise<TapoSession> {
    const url = `http://${host}:80/app`;
    // 1) Generate RSA key для handshake.
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 1024,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const handshake = await this.http.post(url, {
      method: 'handshake',
      params: { key: publicKey },
      requestTimeMils: Date.now(),
    });
    const enc = handshake.data?.result?.key as string | undefined;
    const cookie = handshake.headers['set-cookie']?.[0]?.split(';')[0];
    if (!enc || !cookie) throw new Error('Tapo handshake failed');

    // RSA-decrypt → 32 bytes: 16 key + 16 iv.
    const decoded = privateDecrypt(
      { key: createPrivateKey(privateKey), padding: 1 /* PKCS1 v1.5 */ },
      Buffer.from(enc, 'base64'),
    );
    const cipher: TapoCipher = { key: decoded.subarray(0, 16), iv: decoded.subarray(16, 32) };

    // 2) Login encrypted с email/password.
    const loginPayload = {
      method: 'login_device',
      params: {
        username: Buffer.from(createHash('sha1').update(this.creds.email).digest('hex')).toString(
          'base64',
        ),
        password: Buffer.from(this.creds.password).toString('base64'),
      },
      requestTimeMils: Date.now(),
    };
    const encryptedLogin = encryptAes(JSON.stringify(loginPayload), cipher);
    const loginResp = await this.http.post(
      url,
      { method: 'securePassthrough', params: { request: encryptedLogin } },
      { headers: { Cookie: cookie } },
    );
    const decryptedLogin = JSON.parse(decryptAes(loginResp.data.result.response, cipher)) as {
      result?: { token: string };
      error_code?: number;
    };
    if (!decryptedLogin.result?.token) {
      throw new Error(`Tapo login failed: ${decryptedLogin.error_code}`);
    }
    void publicKey; // already serialized into handshake
    return { cipher, token: decryptedLogin.result.token };
  }

  private async invokeWithSession<T>(
    host: string,
    session: TapoSession,
    method: string,
    params: object,
  ): Promise<T> {
    const payload = JSON.stringify({ method, params, requestTimeMils: Date.now() });
    const encrypted = encryptAes(payload, session.cipher);
    const r = await this.http.post(
      `http://${host}:80/app?token=${session.token}`,
      { method: 'securePassthrough', params: { request: encrypted } },
      { headers: { Cookie: `TP_SESSIONID=${session.token}` } },
    );
    const dec = JSON.parse(decryptAes(r.data.result.response, session.cipher)) as {
      result?: T;
      error_code?: number;
      msg?: string;
    };
    if (dec.error_code && dec.error_code !== 0) {
      throw new Error(`Tapo error ${dec.error_code}: ${dec.msg ?? 'unknown'}`);
    }
    return dec.result as T;
  }
}

function buildTapoCaps(type: DeviceType, meta: TapoMeta, info: TapoDeviceInfo): Capability[] {
  const caps: Capability[] = [capOnOff(Boolean(info.device_on))];
  if (type !== DEVICE_TYPE.LIGHT) return caps;

  if (meta.isDimmable) {
    caps.push(capBrightness(Math.max(1, info.brightness ?? 100)));
  }

  if (meta.isColor || meta.isVariableTemp) {
    const k = info.color_temp && info.color_temp > 0 ? info.color_temp : 4000;
    const rgb = meta.isColor
      ? hsvToRgbInt(info.hue ?? 0, (info.saturation ?? 0) / 100, (info.brightness ?? 100) / 100)
      : 0xffffff;
    const isTempMode = Boolean(info.color_temp && info.color_temp > 0);
    caps.push(
      capColor(isTempMode ? { kind: 'temperature_k', value: k } : { kind: 'rgb', value: rgb }, {
        rgb: meta.isColor,
        temperatureK: meta.isVariableTemp ? TAPO_KELVIN : undefined,
      }),
    );
  }
  return caps;
}

function inferMeta(info: TapoDeviceInfo): TapoMeta {
  const m = info.model.toUpperCase();
  const isBulb = m.startsWith('L') || /BULB|STRIP/.test(info.type);
  const isColor = /^L5[0-9]0|^L6/.test(m);
  const isVariableTemp = isColor || /^L5[1-2]0/.test(m);
  return { model: info.model, isBulb, isColor, isVariableTemp, isDimmable: isBulb };
}

function decodeBase64(s: string): string {
  try {
    return Buffer.from(s, 'base64').toString('utf8');
  } catch {
    return s;
  }
}

function encryptAes(text: string, c: TapoCipher): string {
  const cipher = createCipheriv('aes-128-cbc', c.key, c.iv);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}
function decryptAes(b64: string, c: TapoCipher): string {
  const decipher = createDecipheriv('aes-128-cbc', c.key, c.iv);
  return Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
