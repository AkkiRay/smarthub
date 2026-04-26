/**
 * @fileoverview
 * Aqara Cloud (open API) — региональный endpoint, OAuth code+secret.
 * /v3.0/open/auth.refresh — refresh token; /v3.0/open/resource/query — list devices;
 * /v3.0/open/resource/value/update — write attribute.
 */

import type { AxiosRequestConfig } from 'axios';
import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DiscoveredDevice,
} from '@smarthome/shared';
import { CAPABILITY, DEVICE_TYPE, INSTANCE } from '@smarthome/shared';
import { capBrightness, capOnOff } from '@smarthome/shared';
import { BaseCloudDriver } from '../_shared/base-cloud-driver.js';

interface AqaraCreds {
  appId: string;
  appKey: string;
  keyId: string;
  accessToken: string;
  refreshToken?: string;
  region?: 'cn' | 'usa' | 'eu' | 'sg' | 'kr' | 'ru';
}

interface AqaraResource {
  did: string;
  resourceId: string;
  value: string;
}

interface AqaraDevice {
  did: string;
  parentDid?: string;
  positionId?: string;
  createTime: number;
  updateTime: number;
  modelType: number;
  state: number;
  firmwareVersion: string;
  deviceName: string;
  timeZone: string;
  model: string;
}

const REGION_HOSTS: Record<NonNullable<AqaraCreds['region']>, string> = {
  cn: 'open-cn.aqara.com',
  usa: 'open-usa.aqara.com',
  eu: 'open-ger.aqara.com',
  sg: 'open-sg.aqara.com',
  kr: 'open-kr.aqara.com',
  ru: 'open-ru.aqara.com',
};

export class AqaraCloudDriver extends BaseCloudDriver {
  readonly id = 'aqara-cloud' as const;
  readonly displayName = 'Aqara Cloud';

  constructor(private readonly creds: AqaraCreds) {
    super({
      baseURL: `https://${REGION_HOSTS[creds.region ?? 'eu']}`,
      timeoutMs: 7000,
    });
  }

  protected applyAuth(config: AxiosRequestConfig): AxiosRequestConfig {
    config.headers = {
      ...(config.headers as Record<string, unknown>),
      Accesstoken: this.creds.accessToken,
      Appid: this.creds.appId,
      Keyid: this.creds.keyId,
      Time: String(Date.now()),
      'Content-Type': 'application/json',
    };
    return config;
  }

  protected async refreshToken(): Promise<void> {
    if (!this.creds.refreshToken) throw new Error('Aqara: no refresh_token');
    const r = await this.http.post<{ result: { accessToken: string; refreshToken: string } }>(
      '/v3.0/open/access_token',
      {
        intent: 'config.auth.refreshToken',
        data: { refreshToken: this.creds.refreshToken },
      },
      { headers: { Appid: this.creds.appId, Keyid: this.creds.keyId } },
    );
    this.creds.accessToken = r.data.result.accessToken;
    this.creds.refreshToken = r.data.result.refreshToken;
  }

  async discover(): Promise<DiscoveredDevice[]> {
    try {
      const r = await this.request<{ result: { data: AqaraDevice[] } }>({
        method: 'POST',
        url: '/v3.0/open/api',
        data: { intent: 'query.device.info', data: { pageNum: 1, pageSize: 50 } },
      });
      return (r.result.data ?? []).map((d) => ({
        driver: 'aqara-cloud' as const,
        externalId: d.did,
        type: inferAqaraType(d.model),
        name: d.deviceName,
        address: 'cloud',
        meta: { model: d.model, modelType: d.modelType, state: d.state },
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
      driver: 'aqara-cloud',
      type: candidate.type,
      name: candidate.name,
      address: 'cloud',
      hidden: false,
      status: 'online',
      meta: candidate.meta,
      capabilities: [capOnOff(false), capBrightness(100)],
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const r = await this.request<{ result: AqaraResource[] }>({
        method: 'POST',
        url: '/v3.0/open/api',
        data: {
          intent: 'query.resource.value',
          data: { resources: [{ subjectId: device.externalId }] },
        },
      });
      const map = new Map(r.result.map((x) => [x.resourceId, x.value]));
      const isOn = map.get('4.1.85') === '1' || map.get('on_off') === '1';
      const brightness = Number(map.get('1.7.85') ?? map.get('brightness') ?? 100);
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: device.capabilities.map((c) => {
          if (c.type === CAPABILITY.ON_OFF) return capOnOff(isOn);
          if (c.type === CAPABILITY.RANGE) return capBrightness(brightness);
          return c;
        }),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const resources: Array<{ resourceId: string; value: string }> = [];
    if (command.capability === CAPABILITY.ON_OFF) {
      resources.push({ resourceId: '4.1.85', value: command.value ? '1' : '0' });
    } else if (
      command.capability === CAPABILITY.RANGE &&
      command.instance === INSTANCE.BRIGHTNESS
    ) {
      resources.push({ resourceId: '1.7.85', value: String(Number(command.value)) });
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      await this.request({
        method: 'POST',
        url: '/v3.0/open/api',
        data: {
          intent: 'write.resource.device',
          data: [{ subjectId: device.externalId, resources }],
        },
      });
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }
}

function inferAqaraType(model: string) {
  const m = model.toLowerCase();
  if (m.includes('plug') || m.includes('outlet')) return DEVICE_TYPE.SOCKET;
  if (m.includes('light') || m.includes('bulb') || m.includes('lamp') || m.includes('led')) {
    return DEVICE_TYPE.LIGHT;
  }
  if (m.includes('curtain') || m.includes('blind')) return DEVICE_TYPE.CURTAIN;
  if (m.includes('lock')) return DEVICE_TYPE.LOCK;
  if (m.includes('camera')) return DEVICE_TYPE.CAMERA;
  if (m.includes('sensor') || m.includes('motion') || m.includes('door') || m.includes('weather')) {
    return DEVICE_TYPE.SENSOR;
  }
  return DEVICE_TYPE.OTHER;
}
