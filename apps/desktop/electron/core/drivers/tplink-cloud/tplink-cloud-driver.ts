/**
 * @fileoverview
 * TP-Link Kasa Cloud (wap.tplinkcloud.com): закрывает обе линейки Kasa+Tapo через единый passthrough.
 * Auth: POST /?method=login → token; затем POST passthrough на конкретное устройство:
 *   /?token=<token> — { method: "passthrough", params: { deviceId, requestData: encrypt(json) } }
 *
 * Security note: TP-Link cloud API дизайн-вынуждает token в query (`?token=`) — нет
 * header-альтернативы. Митигация: запросы идут поверх HTTPS direct (без прокси),
 * axios серилизует token через `params` (не string concat), а в error-handler'е
 * URL прогоняется через {@link redactToken} перед логированием.
 */

import type { AxiosRequestConfig } from 'axios';
import { randomUUID } from 'node:crypto';
import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DiscoveredDevice,
} from '@smarthome/shared';
import { CAPABILITY, DEVICE_TYPE, INSTANCE } from '@smarthome/shared';
import { capBrightness, capOnOff } from '@smarthome/shared';
import { BaseCloudDriver } from '../_shared/base-cloud-driver.js';

interface TpCloudCreds {
  email: string;
  password: string;
}

interface TpCloudDevice {
  deviceId: string;
  alias: string;
  deviceType: string;
  deviceModel: string;
  status: number;
  appServerUrl?: string;
}

/** Срезает значение `?token=...` в URL/строке для безопасного логирования. */
function redactToken(value: unknown): string {
  if (typeof value !== 'string') return String(value);
  return value.replace(/([?&])token=[^&\s]+/gi, '$1token=***');
}

export class TPLinkCloudDriver extends BaseCloudDriver {
  readonly id = 'tplink-cloud' as const;
  readonly displayName = 'TP-Link Cloud (Kasa+Tapo)';

  private token = '';
  private readonly termId = randomUUID();

  constructor(private readonly creds: TpCloudCreds) {
    super({ baseURL: 'https://wap.tplinkcloud.com', timeoutMs: 6000 });
  }

  protected applyAuth(config: AxiosRequestConfig): AxiosRequestConfig {
    if (!this.token) return config;
    // Token через axios `params` — axios сам сделает URL-encode и не дублирует
    // ?token= если запрос ушёл с уже set'ом url'ом. Это безопаснее чем `url = '/?token=' + this.token`,
    // которое не escape'ит токен и ломается на спецсимволах.
    config.params = { ...(config.params ?? {}), token: this.token };
    return config;
  }

  protected async refreshToken(): Promise<void> {
    await this.login();
  }

  async discover(): Promise<DiscoveredDevice[]> {
    try {
      await this.ensureLogin();
      const r = await this.request<{ result: { deviceList: TpCloudDevice[] } }>({
        method: 'POST',
        url: '/',
        data: { method: 'getDeviceList' },
      });
      return (r.result.deviceList ?? []).map((d) => ({
        driver: 'tplink-cloud' as const,
        externalId: d.deviceId,
        type: d.deviceType.includes('BULB') ? DEVICE_TYPE.LIGHT : DEVICE_TYPE.SOCKET,
        name: d.alias || d.deviceModel,
        address: d.appServerUrl ?? 'cloud',
        meta: {
          model: d.deviceModel,
          deviceType: d.deviceType,
          serverUrl: d.appServerUrl,
        },
      }));
    } catch (e) {
      this.logWarn(`discovery failed: ${redactToken((e as Error).message)}`);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as { deviceType: string };
    const isLight = meta.deviceType.includes('BULB');
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'tplink-cloud',
      type: candidate.type,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      status: 'online',
      meta: candidate.meta,
      capabilities: isLight ? [capOnOff(false), capBrightness(100)] : [capOnOff(false)],
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const isBulb = (device.meta as { deviceType?: string }).deviceType?.includes('BULB');
      const data = await this.passthrough(
        device,
        isBulb
          ? { 'smartlife.iot.smartbulb.lightingservice': { get_light_state: {} } }
          : { system: { get_sysinfo: {} } },
      );
      const sys = (data as { system?: { get_sysinfo?: { relay_state?: number } } }).system
        ?.get_sysinfo;
      const ls = (
        data as {
          'smartlife.iot.smartbulb.lightingservice'?: {
            get_light_state?: { on_off?: number; brightness?: number };
          };
        }
      )['smartlife.iot.smartbulb.lightingservice']?.get_light_state;
      const on = isBulb ? ls?.on_off === 1 : sys?.relay_state === 1;
      const bright = ls?.brightness ?? 100;
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: device.capabilities.map((c) => {
          if (c.type === CAPABILITY.ON_OFF) return capOnOff(on);
          if (c.type === CAPABILITY.RANGE) return capBrightness(bright);
          return c;
        }),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const isBulb = (device.meta as { deviceType?: string }).deviceType?.includes('BULB');
    let payload: unknown;

    if (command.capability === CAPABILITY.ON_OFF) {
      payload = isBulb
        ? {
            'smartlife.iot.smartbulb.lightingservice': {
              transition_light_state: { on_off: command.value ? 1 : 0, transition_period: 400 },
            },
          }
        : { system: { set_relay_state: { state: command.value ? 1 : 0 } } };
    } else if (
      command.capability === CAPABILITY.RANGE &&
      command.instance === INSTANCE.BRIGHTNESS &&
      isBulb
    ) {
      payload = {
        'smartlife.iot.smartbulb.lightingservice': {
          transition_light_state: {
            on_off: 1,
            brightness: Math.max(1, Math.min(100, Number(command.value))),
            transition_period: 400,
          },
        },
      };
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      await this.passthrough(device, payload);
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  private async passthrough(device: Device, requestData: unknown): Promise<unknown> {
    await this.ensureLogin();
    const meta = device.meta as { serverUrl?: string };
    // serverUrl приходит из getDeviceList — это региональный shard ('https://eu-wap.tplinkcloud.com').
    // Идём через `request()` чтобы получить single-flight refresh-on-401, а не this.http.post напрямую,
    // который bypass'ит весь refresh-flow → caller получит 401 без retry.
    const r = await this.request<{ result: { responseData: string } }>({
      method: 'POST',
      // axios `params` добавит ?token=... и не дублирует если url уже его содержит.
      url: meta.serverUrl ?? '/',
      data: {
        method: 'passthrough',
        params: { deviceId: device.externalId, requestData: JSON.stringify(requestData) },
      },
    });
    if (typeof r.result.responseData !== 'string') {
      throw new Error('tplink-cloud: passthrough returned non-string responseData');
    }
    try {
      return JSON.parse(r.result.responseData);
    } catch (e) {
      // Cloud вернул broken JSON — не маскируем под DEVICE_UNREACHABLE.
      throw new Error(`tplink-cloud: malformed responseData (${(e as Error).message})`);
    }
  }

  private async ensureLogin(): Promise<void> {
    if (!this.token) await this.login();
  }

  private async login(): Promise<void> {
    const r = await this.http.post<{ result: { token: string } }>('/', {
      method: 'login',
      params: {
        appType: 'Kasa_Android',
        cloudUserName: this.creds.email,
        cloudPassword: this.creds.password,
        terminalUUID: this.termId,
      },
    });
    this.token = r.data.result.token;
  }
}
