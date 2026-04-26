// Mi Home Cloud / Xiaomi Cloud: REST API через api.io.mi.com/app.
// Login flow: serviceLogin → captcha → SHA1(password) → location → ssecurity + serviceToken.
// Reverse-engineered протокол, нет публичного SDK; здесь упрощённый flow без 2FA-handler'а.
//
// Server-region URL префикс: 'cn'/'de'/'i2' (India)/'ru'/'sg'/'us'.
//   ru.api.io.mi.com — для российских аккаунтов (если устройства куплены в РФ).
//
// После login API:
//   POST /home/device_list           → список устройств
//   POST /home/rpc/<device_id>       → JSON-RPC method calls (как miIO local)

import axios, { type AxiosRequestConfig } from 'axios';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import { CAPABILITY, DEVICE_TYPE, INSTANCE } from '@smarthome/shared';
import { capOnOff } from '@smarthome/shared';
import { BaseCloudDriver } from '../_shared/base-cloud-driver.js';

interface MiHomeCloudCreds {
  username: string;
  password: string;
  region?: 'cn' | 'de' | 'i2' | 'ru' | 'sg' | 'us';
}

interface MiSession {
  userId: string;
  ssecurity: string;
  serviceToken: string;
}

interface MiCloudDevice {
  did: string;
  token: string;
  name: string;
  model: string;
  isOnline: boolean;
  localip: string;
}

export class MiHomeCloudDriver extends BaseCloudDriver {
  readonly id = 'mihome-cloud' as const;
  readonly displayName = 'Mi Home Cloud';

  private session: MiSession | null = null;
  private readonly region: string;

  constructor(private readonly creds: MiHomeCloudCreds) {
    super({
      baseURL: `https://${creds.region ?? 'cn'}.api.io.mi.com/app`,
      timeoutMs: 8000,
      defaultHeaders: {
        'User-Agent': 'Android-7.1.1-1.0.0-ONEPLUS A3010-136-AndroidApp',
        'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    this.region = creds.region ?? 'cn';
  }

  protected applyAuth(config: AxiosRequestConfig): AxiosRequestConfig {
    if (this.session) {
      config.headers = {
        ...(config.headers as Record<string, unknown>),
        Cookie: `userId=${this.session.userId}; serviceToken=${this.session.serviceToken}; locale=en_US;`,
      };
    }
    return config;
  }

  protected async refreshToken(): Promise<void> {
    // Mi Cloud не имеет refresh_token grant — пере-логинимся username/password.
    this.session = null;
    await this.ensureSession();
  }

  async discover(_signal: AbortSignal): Promise<DiscoveredDevice[]> {
    try {
      const result = await this.callApi<{ result: { list: MiCloudDevice[] } }>(
        '/home/device_list',
        {
          getVirtualModel: false,
          getHuamiDevices: 0,
        },
      );
      return result.result.list.map((d) => ({
        driver: 'mihome-cloud' as const,
        externalId: d.did,
        type: inferType(d.model),
        name: d.name,
        address: d.localip || 'cloud',
        meta: { token: d.token, model: d.model, isOnline: d.isOnline, did: d.did },
      }));
    } catch (e) {
      this.logWarn('discovery failed', e);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'mihome-cloud',
      type: candidate.type,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      meta: candidate.meta,
      status: 'online',
      capabilities: [capOnOff(false)],
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const meta = device.meta as { did: string; model: string };
      const r = await this.callApi<{ result: unknown[] }>(`/home/rpc/${meta.did}`, {
        method: 'get_prop',
        params: ['power', 'bright', 'rgb', 'ct'],
      });
      const arr = Array.isArray(r.result) ? r.result : [];
      const [power, bright, rgb] = arr as [string, number, number];
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: device.capabilities.map((c) => {
          if (c.type === CAPABILITY.ON_OFF) {
            return { ...c, state: { instance: INSTANCE.ON, value: power === 'on' } };
          }
          if (c.type === CAPABILITY.RANGE && c.state?.instance === INSTANCE.BRIGHTNESS) {
            return { ...c, state: { instance: INSTANCE.BRIGHTNESS, value: bright || 100 } };
          }
          if (c.type === CAPABILITY.COLOR_SETTING) {
            return { ...c, state: { instance: INSTANCE.RGB, value: rgb || 0xffffff } };
          }
          return c;
        }),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const meta = device.meta as { did: string };
    let payload: { method: string; params: unknown[] } | null = null;

    if (command.capability === CAPABILITY.ON_OFF) {
      payload = { method: 'set_power', params: [command.value ? 'on' : 'off'] };
    } else if (
      command.capability === CAPABILITY.RANGE &&
      command.instance === INSTANCE.BRIGHTNESS
    ) {
      payload = {
        method: 'set_bright',
        params: [Math.max(1, Math.min(100, Number(command.value)))],
      };
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.RGB
    ) {
      payload = { method: 'set_rgb', params: [Number(command.value)] };
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.TEMPERATURE_K
    ) {
      payload = {
        method: 'set_ct_abx',
        params: [Math.max(1700, Math.min(6500, Number(command.value)))],
      };
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      await this.callApi(`/home/rpc/${meta.did}`, payload);
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  override async shutdown(): Promise<void> {
    this.session = null;
  }

  // Mi Cloud signing: nonce(16 bytes) + sign(HMAC-SHA256 of method+'&'+url+'&'+ssecurity+'&'+nonce)
  // Body содержит data, signed_nonce, signature (Base64 RC4 of payload). Здесь — упрощённая
  // версия без RC4 (POST plain JSON), которая работает на части регионов; для cn-региона иногда
  // требуется encrypt-mode — добавим, если пользователь зарегистрирует в этом регионе.
  private async callApi<T = unknown>(path: string, body: object): Promise<T> {
    const session = await this.ensureSession();

    const nonce = randomBytes(8).toString('base64');
    const signedNonce = signNonce(session.ssecurity, nonce);
    const params = { data: JSON.stringify(body) };
    const signature = generateSignature(path, signedNonce, nonce, params);

    return this.request<T>({
      method: 'POST',
      url: path,
      data: new URLSearchParams({
        ...params,
        signature,
        _nonce: nonce,
        signed_nonce: signedNonce,
      }).toString(),
    });
  }

  private async ensureSession(): Promise<MiSession> {
    if (this.session) return this.session;
    // Step 1: получить _sign из serviceLogin redirect.
    const step1 = await axios.get<string>(
      'https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true',
      { responseType: 'text', maxRedirects: 0, validateStatus: () => true, timeout: 8000 },
    );
    const json1 = parseMiJson<{ _sign: string }>(step1.data);
    if (!json1?._sign) throw new Error('Mi Cloud: serviceLogin failed (no _sign)');

    // Step 2: serviceLoginAuth2 — login сам.
    const passHash = createHash('md5').update(this.creds.password).digest('hex').toUpperCase();
    const form = new URLSearchParams({
      sid: 'xiaomiio',
      hash: passHash,
      callback: 'https://sts.api.io.mi.com/sts',
      qs: '%3Fsid%3Dxiaomiio%26_json%3Dtrue',
      user: this.creds.username,
      _sign: json1._sign,
      _json: 'true',
    });
    const step2 = await axios.post<string>(
      'https://account.xiaomi.com/pass/serviceLoginAuth2',
      form.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        responseType: 'text',
        timeout: 8000,
      },
    );
    const json2 = parseMiJson<{
      ssecurity?: string;
      userId?: number;
      location?: string;
      code?: number;
      desc?: string;
    }>(step2.data);
    if (!json2?.ssecurity || !json2.location || !json2.userId) {
      throw new Error(`Mi Cloud login failed: ${json2?.desc ?? 'unknown'}`);
    }

    // Step 3: получить serviceToken из location URL.
    const step3 = await axios.get<string>(json2.location, {
      responseType: 'text',
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 8000,
    });
    const cookies = step3.headers['set-cookie'] ?? [];
    const serviceToken = extractCookie(cookies, 'serviceToken');
    if (!serviceToken) throw new Error('Mi Cloud: no serviceToken cookie');

    this.session = {
      userId: String(json2.userId),
      ssecurity: json2.ssecurity,
      serviceToken,
    };
    return this.session;
  }
}

// Mi Cloud отдаёт JSON префиксом `&&&START&&&` для anti-XSS.
function parseMiJson<T>(text: string): T | null {
  try {
    return JSON.parse(text.replace(/^&&&START&&&/, '')) as T;
  } catch {
    return null;
  }
}

function extractCookie(cookies: string[], name: string): string | null {
  for (const c of cookies) {
    const m = new RegExp(`${name}=([^;]+)`).exec(c);
    if (m) return m[1] ?? null;
  }
  return null;
}

function signNonce(ssecurity: string, nonce: string): string {
  const hash = createHash('sha256');
  hash.update(Buffer.from(ssecurity, 'base64'));
  hash.update(Buffer.from(nonce, 'base64'));
  return hash.digest('base64');
}

function generateSignature(
  path: string,
  signedNonce: string,
  nonce: string,
  params: Record<string, string>,
): string {
  const exp = [path, signedNonce, nonce];
  for (const [k, v] of Object.entries(params).sort()) exp.push(`${k}=${v}`);
  return createHmac('sha256', Buffer.from(signedNonce, 'base64'))
    .update(exp.join('&'))
    .digest('base64');
}

function inferType(model: string): DeviceType {
  const m = model.toLowerCase();
  if (m.includes('vacuum') || m.includes('roborock')) return DEVICE_TYPE.VACUUM;
  if (m.includes('humidifier')) return DEVICE_TYPE.HUMIDIFIER;
  if (m.includes('purifier')) return DEVICE_TYPE.PURIFIER;
  if (m.includes('fan')) return DEVICE_TYPE.FAN;
  if (m.includes('plug')) return DEVICE_TYPE.SOCKET;
  if (m.includes('light') || m.includes('bulb') || m.includes('lamp') || m.includes('yeelink')) {
    return DEVICE_TYPE.LIGHT;
  }
  if (m.includes('sensor') || m.includes('aqara')) return DEVICE_TYPE.SENSOR;
  if (m.includes('curtain')) return DEVICE_TYPE.CURTAIN;
  return DEVICE_TYPE.OTHER;
}
