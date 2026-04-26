/**
 * @fileoverview
 * LIFX HTTP API: api.lifx.com/v1, Bearer token (генерится в cloud.lifx.com).
 */

import type { AxiosRequestConfig } from 'axios';
import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DiscoveredDevice,
} from '@smarthome/shared';
import { CAPABILITY, DEVICE_TYPE, INSTANCE, RANGE } from '@smarthome/shared';
import { capBrightness, capColor, capOnOff } from '@smarthome/shared';
import { BaseCloudDriver } from '../_shared/base-cloud-driver.js';
import { hsvToRgbInt, rgbIntToHsv } from '../_shared/color.js';

interface LifxCloudLight {
  id: string;
  label: string;
  power: 'on' | 'off';
  brightness: number;
  color: { hue: number; saturation: number; kelvin: number };
  product?: { capabilities?: { has_color?: boolean; has_variable_color_temp?: boolean } };
  connected: boolean;
}

export class LifxCloudDriver extends BaseCloudDriver {
  readonly id = 'lifx-cloud' as const;
  readonly displayName = 'LIFX Cloud';

  constructor(private readonly token: string) {
    super({
      baseURL: 'https://api.lifx.com/v1',
      timeoutMs: 6000,
      defaultHeaders: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  }

  protected applyAuth(config: AxiosRequestConfig): AxiosRequestConfig {
    return config; // bearer уже в defaultHeaders
  }

  protected async refreshToken(): Promise<void> {
    throw new Error('LIFX Cloud: token не refreshable, обновите вручную');
  }

  async discover(): Promise<DiscoveredDevice[]> {
    try {
      const r = await this.request<LifxCloudLight[]>({ method: 'GET', url: '/lights/all' });
      return r.map((l) => ({
        driver: 'lifx-cloud' as const,
        externalId: l.id,
        type: DEVICE_TYPE.LIGHT,
        name: l.label,
        address: 'cloud',
        meta: { product: l.product, raw: l },
      }));
    } catch (e) {
      this.logWarn('discovery failed', e);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as {
      product?: LifxCloudLight['product'];
      raw?: LifxCloudLight;
    };
    const now = new Date().toISOString();
    const hasColor = meta.product?.capabilities?.has_color !== false;
    const hasTemp = meta.product?.capabilities?.has_variable_color_temp !== false;
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'lifx-cloud',
      type: DEVICE_TYPE.LIGHT,
      name: candidate.name,
      address: 'cloud',
      hidden: false,
      status: meta.raw?.connected === false ? 'unreachable' : 'online',
      meta: candidate.meta,
      capabilities: [
        capOnOff(meta.raw?.power === 'on'),
        capBrightness(Math.max(1, Math.round((meta.raw?.brightness ?? 1) * 100))),
        capColor(
          {
            kind: 'rgb',
            value: hsvToRgbInt(meta.raw?.color.hue ?? 0, meta.raw?.color.saturation ?? 0, 1),
          },
          {
            rgb: hasColor,
            ...(hasTemp ? { temperatureK: RANGE.KELVIN_WIDE } : {}),
          },
        ),
      ],
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const r = await this.request<LifxCloudLight[]>({
        method: 'GET',
        url: `/lights/id:${device.externalId}`,
      });
      const l = r[0];
      if (!l) return { ...device, status: 'unreachable' };
      return {
        ...device,
        status: l.connected ? 'online' : 'unreachable',
        lastSeenAt: new Date().toISOString(),
        capabilities: device.capabilities.map((c) => {
          if (c.type === CAPABILITY.ON_OFF) return capOnOff(l.power === 'on');
          if (c.type === CAPABILITY.RANGE) {
            return capBrightness(Math.max(1, Math.round(l.brightness * 100)));
          }
          if (c.type === CAPABILITY.COLOR_SETTING) {
            return capColor(
              {
                kind: l.color.saturation < 0.05 ? 'temperature_k' : 'rgb',
                value:
                  l.color.saturation < 0.05
                    ? l.color.kelvin
                    : hsvToRgbInt(l.color.hue, l.color.saturation, l.brightness),
              },
              { rgb: true, temperatureK: RANGE.KELVIN_WIDE },
            );
          }
          return c;
        }),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const states: Record<string, unknown> = {};
    if (command.capability === CAPABILITY.ON_OFF) {
      states['power'] = command.value ? 'on' : 'off';
    } else if (
      command.capability === CAPABILITY.RANGE &&
      command.instance === INSTANCE.BRIGHTNESS
    ) {
      states['brightness'] = Math.max(0.01, Math.min(1, Number(command.value) / 100));
      states['power'] = 'on';
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.RGB
    ) {
      const hsv = rgbIntToHsv(Number(command.value));
      states['color'] = `hue:${Math.round(hsv.h)} saturation:${hsv.s.toFixed(2)}`;
      states['power'] = 'on';
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.TEMPERATURE_K
    ) {
      states['color'] = `kelvin:${Math.max(2500, Math.min(9000, Number(command.value)))}`;
      states['power'] = 'on';
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      await this.request({
        method: 'PUT',
        url: `/lights/id:${device.externalId}/state`,
        data: states,
      });
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }
}
