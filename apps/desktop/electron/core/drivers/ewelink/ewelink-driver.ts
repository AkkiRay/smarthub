/**
 * @fileoverview
 * eWeLink (Sonoff cloud): REST API на eu-apia.coolkit.cc / cn-apia.coolkit.cn.
 * Auth: HMAC-SHA256(payload, appSecret) → /v2/user/login → bearerToken + refreshToken.
 * Список устройств: GET /v2/device/thing.
 */

import { createHmac } from 'node:crypto';
import type { AxiosRequestConfig } from 'axios';
import type {
  Capability,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import { BaseCloudDriver } from '../_shared/base-cloud-driver.js';

interface EWeLinkCreds {
  email: string;
  password: string;
  appId: string;
  appSecret: string;
  region?: 'eu' | 'us' | 'cn' | 'as';
}

interface EWeLinkDevice {
  itemData: {
    deviceid: string;
    name: string;
    online: boolean;
    productModel: string;
    extra: { uiid?: number };
    params: {
      switch?: 'on' | 'off';
      switches?: Array<{ outlet: number; switch: 'on' | 'off' }>;
      brightness?: number;
      colorR?: number;
      colorG?: number;
      colorB?: number;
      ltype?: string;
      currentTemperature?: string | number;
      currentHumidity?: string | number;
    };
  };
}

export class EWeLinkDriver extends BaseCloudDriver {
  readonly id = 'ewelink' as const;
  readonly displayName = 'eWeLink (Sonoff)';

  private accessToken = '';
  private refreshTokenValue = '';

  constructor(private readonly creds: EWeLinkCreds) {
    super({
      baseURL: `https://${creds.region ?? 'eu'}-apia.coolkit.${creds.region === 'cn' ? 'cn' : 'cc'}`,
      timeoutMs: 7000,
      defaultHeaders: { 'X-CK-Appid': creds.appId, 'Content-Type': 'application/json' },
    });
  }

  async discover(): Promise<DiscoveredDevice[]> {
    try {
      await this.ensureLogin();
      const data = await this.request<{ data: { thingList: EWeLinkDevice[] } }>({
        method: 'GET',
        url: '/v2/device/thing',
        params: { num: 0 },
      });
      return data.data.thingList.map((t) => {
        const d = t.itemData;
        return {
          driver: 'ewelink' as const,
          externalId: d.deviceid,
          type: inferEwelinkType(d.extra?.uiid ?? 0, d.params),
          name: d.name,
          address: 'cloud',
          meta: { uiid: d.extra?.uiid, model: d.productModel, params: d.params },
        };
      });
    } catch (e) {
      this.logWarn('discovery failed', e);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as { params?: EWeLinkDevice['itemData']['params'] };
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'ewelink',
      type: candidate.type,
      name: candidate.name,
      address: 'cloud',
      hidden: false,
      meta: candidate.meta,
      status: 'online',
      capabilities: buildEWLinkCaps(candidate.type, meta.params ?? {}),
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      await this.ensureLogin();
      const data = await this.request<{ data: { params: EWeLinkDevice['itemData']['params'] } }>({
        method: 'POST',
        url: '/v2/device/thing/status',
        data: {
          type: 1,
          id: device.externalId,
          params: ['switch', 'brightness', 'colorR', 'colorG', 'colorB'],
        },
      });
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildEWLinkCaps(device.type, data.data.params),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const params: Record<string, unknown> = {};
    if (command.capability === 'devices.capabilities.on_off') {
      params['switch'] = command.value ? 'on' : 'off';
    } else if (
      command.capability === 'devices.capabilities.range' &&
      command.instance === 'brightness'
    ) {
      params['brightness'] = Math.max(1, Math.min(100, Number(command.value)));
    } else if (
      command.capability === 'devices.capabilities.color_setting' &&
      command.instance === 'rgb'
    ) {
      const rgb = Number(command.value);
      params['colorR'] = (rgb >> 16) & 0xff;
      params['colorG'] = (rgb >> 8) & 0xff;
      params['colorB'] = rgb & 0xff;
      params['ltype'] = 'color';
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      await this.ensureLogin();
      await this.request({
        method: 'POST',
        url: '/v2/device/thing/status',
        data: { type: 1, id: device.externalId, params },
      });
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  protected applyAuth(config: AxiosRequestConfig): AxiosRequestConfig {
    config.headers = {
      ...(config.headers as Record<string, unknown>),
      Authorization: `Bearer ${this.accessToken}`,
    };
    return config;
  }

  protected async refreshToken(): Promise<void> {
    if (!this.refreshTokenValue) {
      // Без refresh_token — логинимся заново.
      await this.login();
      return;
    }
    const r = await this.http.post<{ data: { at: string; rt: string } }>(
      '/v2/user/refresh',
      { rt: this.refreshTokenValue },
      { headers: this.signedHeaders({ rt: this.refreshTokenValue }) },
    );
    this.accessToken = r.data.data.at;
    this.refreshTokenValue = r.data.data.rt;
  }

  private async ensureLogin(): Promise<void> {
    if (!this.accessToken) await this.login();
  }

  private async login(): Promise<void> {
    const body = { email: this.creds.email, password: this.creds.password, countryCode: '+0' };
    const r = await this.http.post<{ data: { at: string; rt: string } }>('/v2/user/login', body, {
      headers: this.signedHeaders(body),
    });
    this.accessToken = r.data.data.at;
    this.refreshTokenValue = r.data.data.rt;
  }

  private signedHeaders(body: object): Record<string, string> {
    const sign = createHmac('sha256', this.creds.appSecret)
      .update(JSON.stringify(body))
      .digest('base64');
    return {
      Authorization: `Sign ${sign}`,
      'X-CK-Appid': this.creds.appId,
      'Content-Type': 'application/json',
    };
  }
}

function inferEwelinkType(uiid: number, params: EWeLinkDevice['itemData']['params']): DeviceType {
  // https://coolkit-technologies.github.io/eWeLink-API/#/en/UIIDProtocol
  if ([1, 6, 14, 24, 27, 32].includes(uiid)) return 'devices.types.socket';
  if ([22, 36, 44, 57, 59].includes(uiid)) return 'devices.types.light';
  if ([15, 18, 102].includes(uiid)) return 'devices.types.sensor';
  if (params.brightness !== undefined || params.colorR !== undefined) return 'devices.types.light';
  return 'devices.types.socket';
}

function buildEWLinkCaps(
  type: DeviceType,
  params: EWeLinkDevice['itemData']['params'],
): Capability[] {
  const caps: Capability[] = [
    {
      type: 'devices.capabilities.on_off',
      retrievable: true,
      reportable: true,
      state: { instance: 'on', value: params.switch === 'on' },
    },
  ];
  if (type === 'devices.types.light') {
    if (typeof params.brightness === 'number') {
      caps.push({
        type: 'devices.capabilities.range',
        retrievable: true,
        reportable: true,
        parameters: {
          instance: 'brightness',
          unit: 'unit.percent',
          range: { min: 1, max: 100, precision: 1 },
        },
        state: { instance: 'brightness', value: Math.max(1, params.brightness) },
      });
    }
    if (params.colorR !== undefined) {
      const rgb =
        ((params.colorR ?? 255) << 16) | ((params.colorG ?? 255) << 8) | (params.colorB ?? 255);
      caps.push({
        type: 'devices.capabilities.color_setting',
        retrievable: true,
        reportable: true,
        parameters: { color_model: 'rgb' },
        state: { instance: 'rgb', value: rgb },
      });
    }
  }
  return caps;
}
