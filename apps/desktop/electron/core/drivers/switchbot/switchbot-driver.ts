// SwitchBot Cloud API v1.1: token + secret HMAC-SHA256.
// GET /v1.1/devices, POST /v1.1/devices/<id>/commands.
// SwitchBot Mini Bot, Plug Mini, Curtain, Bulbs, Hub Mini.

import { createHmac, randomUUID } from 'node:crypto';
import type { AxiosRequestConfig } from 'axios';
import type {
  Capability,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import { CAPABILITY, DEVICE_TYPE, INSTANCE } from '@smarthome/shared';
import { capBrightness, capOnOff } from '@smarthome/shared';
import { BaseCloudDriver } from '../_shared/base-cloud-driver.js';
import { rgbIntToTuple } from '../_shared/color.js';

interface SwitchBotDevice {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  hubDeviceId?: string;
}

export class SwitchBotDriver extends BaseCloudDriver {
  readonly id = 'switchbot' as const;
  readonly displayName = 'SwitchBot';

  constructor(
    private readonly token: string,
    private readonly secret: string,
  ) {
    super({ baseURL: 'https://api.switch-bot.com', timeoutMs: 6000 });
  }

  protected applyAuth(config: AxiosRequestConfig): AxiosRequestConfig {
    const t = String(Date.now());
    const nonce = randomUUID();
    const sign = createHmac('sha256', this.secret)
      .update(this.token + t + nonce)
      .digest('base64');
    config.headers = {
      ...(config.headers as Record<string, unknown>),
      Authorization: this.token,
      sign,
      t,
      nonce,
    };
    return config;
  }

  protected async refreshToken(): Promise<void> {
    throw new Error('SwitchBot: token не refreshable, обновите вручную');
  }

  async discover(): Promise<DiscoveredDevice[]> {
    try {
      const r = await this.request<{ body: { deviceList: SwitchBotDevice[] } }>({
        method: 'GET',
        url: '/v1.1/devices',
      });
      return r.body.deviceList.map((d) => ({
        driver: 'switchbot' as const,
        externalId: d.deviceId,
        type: mapType(d.deviceType),
        name: d.deviceName || d.deviceType,
        address: 'cloud',
        meta: { deviceType: d.deviceType, hubId: d.hubDeviceId },
      }));
    } catch (e) {
      this.logWarn('discovery failed', e);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as { deviceType: string };
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'switchbot',
      type: candidate.type,
      name: candidate.name,
      address: 'cloud',
      hidden: false,
      status: 'online',
      meta: candidate.meta,
      capabilities: defaultCaps(meta.deviceType),
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const r = await this.request<{
        body: { power?: 'on' | 'off'; brightness?: number; color?: string };
      }>({ method: 'GET', url: `/v1.1/devices/${device.externalId}/status` });
      const isOn = r.body.power === 'on';
      const caps = device.capabilities.map((c) => {
        if (c.type === CAPABILITY.ON_OFF) return capOnOff(isOn);
        if (c.type === CAPABILITY.RANGE && r.body.brightness !== undefined) {
          return capBrightness(r.body.brightness);
        }
        return c;
      });
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: caps,
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const meta = device.meta as { deviceType: string };
    let body: { command: string; parameter?: string | number; commandType?: string } | null = null;

    if (command.capability === CAPABILITY.ON_OFF) {
      const dt = meta.deviceType.toLowerCase();
      if (dt.includes('bot')) {
        body = { command: command.value ? 'press' : 'press' };
      } else {
        body = { command: command.value ? 'turnOn' : 'turnOff' };
      }
    } else if (
      command.capability === CAPABILITY.RANGE &&
      command.instance === INSTANCE.BRIGHTNESS
    ) {
      body = {
        command: 'setBrightness',
        parameter: Math.max(1, Math.min(100, Number(command.value))),
      };
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.RGB
    ) {
      const [r, g, b] = rgbIntToTuple(Number(command.value));
      body = { command: 'setColor', parameter: `${r}:${g}:${b}` };
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      await this.request({
        method: 'POST',
        url: `/v1.1/devices/${device.externalId}/commands`,
        data: { ...body, commandType: 'command' },
      });
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }
}

function mapType(t: string): DeviceType {
  const lower = t.toLowerCase();
  if (lower.includes('bot') || lower.includes('plug')) return DEVICE_TYPE.SOCKET;
  if (lower.includes('bulb') || lower.includes('strip') || lower.includes('lamp'))
    return DEVICE_TYPE.LIGHT;
  if (lower.includes('meter')) return DEVICE_TYPE.SENSOR;
  if (lower.includes('curtain') || lower.includes('blind')) return DEVICE_TYPE.CURTAIN;
  if (lower.includes('humidifier')) return DEVICE_TYPE.HUMIDIFIER;
  if (lower.includes('lock')) return DEVICE_TYPE.LOCK;
  return DEVICE_TYPE.OTHER;
}

function defaultCaps(deviceType: string): Capability[] {
  const caps: Capability[] = [capOnOff(false)];
  const lower = deviceType.toLowerCase();
  if (lower.includes('bulb') || lower.includes('strip')) {
    caps.push(capBrightness(100));
  }
  return caps;
}
