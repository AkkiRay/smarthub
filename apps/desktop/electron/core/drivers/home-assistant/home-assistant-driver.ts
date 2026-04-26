/**
 * @fileoverview
 * Home Assistant Bridge: REST API /api/states + /api/services/<domain>/<service>.
 * Long-lived access token из HA Profile → создаётся в UI → даёт полный доступ к entities.
 * HA умеет всё что у пользователя в HA — десятки интеграций сразу. Для real-time можно подключить
 * WebSocket /api/websocket, но REST polling-достаточно для большинства случаев.
 */

import type { AxiosRequestConfig } from 'axios';
import type {
  Capability,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import { CAPABILITY, DEVICE_TYPE, INSTANCE, RANGE } from '@smarthome/shared';
import { capBrightness, capColor, capOnOff } from '@smarthome/shared';
import { BaseCloudDriver } from '../_shared/base-cloud-driver.js';
import { rgbIntToTuple, tupleToRgbInt } from '../_shared/color.js';

interface HAEntity {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    brightness?: number;
    rgb_color?: [number, number, number];
    color_temp_kelvin?: number;
    supported_color_modes?: string[];
    device_class?: string;
    unit_of_measurement?: string;
  };
}

interface HACreds {
  url: string;
  token: string;
}

export class HomeAssistantDriver extends BaseCloudDriver {
  readonly id = 'home-assistant' as const;
  readonly displayName = 'Home Assistant';

  constructor(creds: HACreds) {
    super({
      baseURL: creds.url.replace(/\/$/, ''),
      timeoutMs: 6000,
      defaultHeaders: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
    });
  }

  protected applyAuth(config: AxiosRequestConfig): AxiosRequestConfig {
    return config; // bearer задан в defaultHeaders
  }

  protected async refreshToken(): Promise<void> {
    throw new Error('Home Assistant: long-lived token не refresh-able');
  }

  async discover(): Promise<DiscoveredDevice[]> {
    try {
      const states = await this.request<HAEntity[]>({ method: 'GET', url: '/api/states' });
      return states
        .filter((e) => isInteresting(e.entity_id))
        .map((e) => ({
          driver: 'home-assistant' as const,
          externalId: e.entity_id,
          type: domainToType(e.entity_id, e.attributes),
          name: e.attributes.friendly_name ?? e.entity_id,
          address: 'cloud',
          meta: { domain: e.entity_id.split('.')[0], lastState: e.state, attrs: e.attributes },
        }));
    } catch (e) {
      this.logWarn('discovery failed', e);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as { lastState: string; attrs: HAEntity['attributes'] };
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'home-assistant',
      type: candidate.type,
      name: candidate.name,
      address: 'cloud',
      hidden: false,
      status: 'online',
      meta: candidate.meta,
      capabilities: buildHACaps(candidate.type, meta.lastState, meta.attrs),
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const e = await this.request<HAEntity>({
        method: 'GET',
        url: `/api/states/${device.externalId}`,
      });
      return {
        ...device,
        status: e.state === 'unavailable' ? 'unreachable' : 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildHACaps(device.type, e.state, e.attributes),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const domain = device.externalId.split('.')[0];
    if (!domain) return this.err(device, command, 'INVALID_ENTITY_ID');

    let service = '';
    const data: Record<string, unknown> = { entity_id: device.externalId };
    if (command.capability === CAPABILITY.ON_OFF) {
      service = command.value ? 'turn_on' : 'turn_off';
    } else if (
      command.capability === CAPABILITY.RANGE &&
      command.instance === INSTANCE.BRIGHTNESS
    ) {
      service = 'turn_on';
      data['brightness_pct'] = Math.max(1, Math.min(100, Number(command.value)));
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.RGB
    ) {
      service = 'turn_on';
      data['rgb_color'] = rgbIntToTuple(Number(command.value));
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.TEMPERATURE_K
    ) {
      service = 'turn_on';
      data['kelvin'] = Math.max(2000, Math.min(6500, Number(command.value)));
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      await this.request({ method: 'POST', url: `/api/services/${domain}/${service}`, data });
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }
}

function isInteresting(entityId: string): boolean {
  const domain = entityId.split('.')[0];
  return [
    'light',
    'switch',
    'fan',
    'climate',
    'sensor',
    'binary_sensor',
    'cover',
    'lock',
    'media_player',
    'vacuum',
    'camera',
  ].includes(domain ?? '');
}

function domainToType(entityId: string, _attrs: HAEntity['attributes']): DeviceType {
  const domain = entityId.split('.')[0];
  switch (domain) {
    case 'light':
      return DEVICE_TYPE.LIGHT;
    case 'switch':
      return DEVICE_TYPE.SOCKET;
    case 'fan':
      return DEVICE_TYPE.FAN;
    case 'climate':
      return DEVICE_TYPE.THERMOSTAT;
    case 'sensor':
    case 'binary_sensor':
      return DEVICE_TYPE.SENSOR;
    case 'cover':
      return DEVICE_TYPE.CURTAIN;
    case 'lock':
      return DEVICE_TYPE.LOCK;
    case 'media_player':
      return DEVICE_TYPE.MEDIA;
    case 'vacuum':
      return DEVICE_TYPE.VACUUM;
    case 'camera':
      return DEVICE_TYPE.CAMERA;
    default:
      return DEVICE_TYPE.OTHER;
  }
}

function buildHACaps(type: DeviceType, state: string, attrs: HAEntity['attributes']): Capability[] {
  const isOn = state === 'on' || state === 'open' || state === 'unlocked';
  const caps: Capability[] = [capOnOff(isOn)];
  if (type === DEVICE_TYPE.LIGHT) {
    if (typeof attrs.brightness === 'number') {
      caps.push(capBrightness(Math.max(1, Math.round((attrs.brightness / 255) * 100))));
    }
    const supported = new Set(attrs.supported_color_modes ?? []);
    const hasColor = supported.has('rgb') || supported.has('hs') || supported.has('xy');
    const hasTemp = supported.has('color_temp');
    if (hasColor || hasTemp) {
      const rgb = attrs.rgb_color
        ? tupleToRgbInt(attrs.rgb_color[0], attrs.rgb_color[1], attrs.rgb_color[2])
        : 0xffffff;
      const k = attrs.color_temp_kelvin ?? 4000;
      caps.push(
        capColor(
          k && !attrs.rgb_color ? { kind: 'temperature_k', value: k } : { kind: 'rgb', value: rgb },
          { rgb: hasColor, ...(hasTemp ? { temperatureK: RANGE.KELVIN_DEFAULT } : {}) },
        ),
      );
    }
  }
  return caps;
}
