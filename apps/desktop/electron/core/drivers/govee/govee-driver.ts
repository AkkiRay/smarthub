// Govee Public REST API (developer.govee.com): API key через мобильное приложение.
// GET /v1/devices, PUT /v1/devices/control, GET /v1/devices/state.
// Token-based — refresh не нужен, только rate-limit (60 req/min).

import type { AxiosRequestConfig } from 'axios';
import type {
  Capability,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import { CAPABILITY, DEVICE_TYPE, INSTANCE, RANGE, UNIT } from '@smarthome/shared';
import { BaseCloudDriver } from '../_shared/base-cloud-driver.js';
import { rgbIntToTuple, tupleToRgbInt } from '../_shared/color.js';

interface GoveeDevice {
  device: string;
  model: string;
  deviceName: string;
  controllable: boolean;
  retrievable: boolean;
  supportCmds: string[];
  properties?: { colorTem?: { range: { min: number; max: number } } };
}

interface GoveeState {
  data: {
    properties: Array<
      | { online: boolean }
      | { powerState: 'on' | 'off' }
      | { brightness: number }
      | { color: { r: number; g: number; b: number } }
      | { colorTem: number }
    >;
  };
}

export class GoveeDriver extends BaseCloudDriver {
  readonly id = 'govee' as const;
  readonly displayName = 'Govee';

  constructor(private readonly apiKey: string) {
    super({
      baseURL: 'https://developer-api.govee.com',
      timeoutMs: 6000,
      defaultHeaders: { 'Govee-API-Key': apiKey, 'Content-Type': 'application/json' },
    });
  }

  protected applyAuth(config: AxiosRequestConfig): AxiosRequestConfig {
    return config; // header задан в defaultHeaders
  }

  protected async refreshToken(): Promise<void> {
    throw new Error('Govee API key — не refreshable; проверьте корректность ключа.');
  }

  async discover(): Promise<DiscoveredDevice[]> {
    try {
      const r = await this.request<{ data: { devices: GoveeDevice[] } }>({
        method: 'GET',
        url: '/v1/devices',
      });
      return r.data.devices.map((d) => ({
        driver: 'govee' as const,
        externalId: d.device,
        type: DEVICE_TYPE.LIGHT as DeviceType,
        name: d.deviceName || d.model,
        address: 'cloud',
        meta: { model: d.model, supportCmds: d.supportCmds, properties: d.properties },
      }));
    } catch (e) {
      this.logWarn('discovery failed', e);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as { supportCmds?: string[] };
    const cmds = new Set(meta.supportCmds ?? []);
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'govee',
      type: DEVICE_TYPE.LIGHT,
      name: candidate.name,
      address: 'cloud',
      hidden: false,
      status: 'online',
      meta: candidate.meta,
      capabilities: defaultCaps(cmds),
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const meta = device.meta as { model?: string };
      const r = await this.request<GoveeState>({
        method: 'GET',
        url: '/v1/devices/state',
        params: { device: device.externalId, model: meta.model },
      });
      let on = false;
      let brightness = 100;
      let rgb = 0xffffff;
      let ct = 4000;
      for (const p of r.data.properties) {
        if ('powerState' in p) on = p.powerState === 'on';
        else if ('brightness' in p) brightness = p.brightness;
        else if ('color' in p) rgb = tupleToRgbInt(p.color.r, p.color.g, p.color.b);
        else if ('colorTem' in p) ct = p.colorTem;
      }
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: device.capabilities.map((c) => {
          if (c.type === CAPABILITY.ON_OFF)
            return { ...c, state: { instance: INSTANCE.ON, value: on } };
          if (c.type === CAPABILITY.RANGE)
            return { ...c, state: { instance: INSTANCE.BRIGHTNESS, value: brightness } };
          if (c.type === CAPABILITY.COLOR_SETTING) {
            return ct > 0 && c.state?.instance === INSTANCE.TEMPERATURE_K
              ? { ...c, state: { instance: INSTANCE.TEMPERATURE_K, value: ct } }
              : { ...c, state: { instance: INSTANCE.RGB, value: rgb } };
          }
          return c;
        }),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const meta = device.meta as { model?: string };
    let payload: { name: string; value: unknown } | null = null;
    if (command.capability === CAPABILITY.ON_OFF) {
      payload = { name: 'turn', value: command.value ? 'on' : 'off' };
    } else if (
      command.capability === CAPABILITY.RANGE &&
      command.instance === INSTANCE.BRIGHTNESS
    ) {
      payload = { name: 'brightness', value: Math.max(1, Math.min(100, Number(command.value))) };
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.RGB
    ) {
      const [r, g, b] = rgbIntToTuple(Number(command.value));
      payload = { name: 'color', value: { r, g, b } };
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.TEMPERATURE_K
    ) {
      payload = {
        name: 'colorTem',
        value: Math.max(2000, Math.min(9000, Number(command.value))),
      };
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      await this.request({
        method: 'PUT',
        url: '/v1/devices/control',
        data: { device: device.externalId, model: meta.model, cmd: payload },
      });
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }
}

function defaultCaps(cmds: Set<string>): Capability[] {
  const caps: Capability[] = [{ type: CAPABILITY.ON_OFF, retrievable: true, reportable: false }];
  if (cmds.has('brightness')) {
    caps.push({
      type: CAPABILITY.RANGE,
      retrievable: true,
      reportable: false,
      parameters: { instance: INSTANCE.BRIGHTNESS, unit: UNIT.PERCENT, range: RANGE.PERCENT },
    });
  }
  if (cmds.has('color') || cmds.has('colorTem')) {
    caps.push({
      type: CAPABILITY.COLOR_SETTING,
      retrievable: true,
      reportable: false,
      parameters: {
        color_model: 'rgb',
        ...(cmds.has('colorTem') ? { temperature_k: RANGE.KELVIN_WIDE } : {}),
      },
    });
  }
  return caps;
}
