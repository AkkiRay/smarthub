// SaluteHome: облако SberDevices. Авторизация Sber ID OAuth, REST API на
// https://gateway.iot.sberdevices.ru/v1 (унифицированный шлюз с sber-home).
// Отличие от sber-home: SaluteHome объединяет ассистента «Салют» (умные колонки)
// с устройствами smart-home и поддерживает quasar.server_action — сценарии и фразы.
//
// API в большой степени идентичен sber-home, но endpoint для quasar-команд:
//   POST /quasar/v1/devices/<id>/server_action  { params: { type: ..., ... } }

import axios, { type AxiosRequestConfig } from 'axios';
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

interface SaluteCreds {
  accessToken: string;
  refreshToken?: string;
  /** 'IOT' (умный дом) или 'COMPANION' (Салют-ассистенты). Default 'IOT'. */
  scope?: 'IOT' | 'COMPANION';
}

interface SaluteDevice {
  id: string;
  name: string;
  category: string;
  online: boolean;
  has_quasar?: boolean;
  state?: Array<{ key: string; value?: string | number | boolean }>;
}

export class SaluteHomeDriver extends BaseCloudDriver {
  readonly id = 'salute-home' as const;
  readonly displayName = 'SaluteHome';

  constructor(private readonly creds: SaluteCreds) {
    super({
      baseURL: 'https://gateway.iot.sberdevices.ru',
      timeoutMs: 7000,
    });
  }

  protected applyAuth(config: AxiosRequestConfig): AxiosRequestConfig {
    config.headers = {
      ...(config.headers as Record<string, unknown>),
      Authorization: `Bearer ${this.creds.accessToken}`,
      'X-AUTH-jwt': this.creds.accessToken,
    };
    return config;
  }

  protected async refreshToken(): Promise<void> {
    if (!this.creds.refreshToken) throw new Error('SaluteHome: no refresh_token');
    const r = await axios.post<{ access_token: string; refresh_token?: string }>(
      'https://salute.online.sberbank.ru/api/v1/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.creds.refreshToken,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 },
    );
    this.creds.accessToken = r.data.access_token;
    if (r.data.refresh_token) this.creds.refreshToken = r.data.refresh_token;
  }

  async discover(_signal: AbortSignal): Promise<DiscoveredDevice[]> {
    try {
      const data = await this.request<{ result: { devices?: SaluteDevice[] } }>({
        method: 'GET',
        url: '/v1/devices',
      });
      return (data.result.devices ?? []).map((d) => ({
        driver: 'salute-home' as const,
        externalId: d.id,
        type: mapCategory(d.category),
        name: d.name,
        address: 'cloud',
        meta: { category: d.category, lastState: d.state ?? [], hasQuasar: d.has_quasar },
      }));
    } catch (e) {
      this.logWarn('discovery failed', e);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as { category: string; lastState?: SaluteDevice['state'] };
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'salute-home',
      type: candidate.type,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      meta: candidate.meta,
      status: 'online',
      capabilities: buildCaps(candidate.type, meta.lastState ?? []),
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const data = await this.request<{ result: { device: SaluteDevice } }>({
        method: 'GET',
        url: `/v1/devices/${device.externalId}`,
      });
      const d = data.result.device;
      return {
        ...device,
        status: d.online ? 'online' : 'unreachable',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildCaps(device.type, d.state ?? []),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    try {
      if (command.capability === CAPABILITY.SERVER_ACTION) {
        // Свободная фраза для Салюта.
        await this.request({
          method: 'POST',
          url: `/quasar/v1/devices/${device.externalId}/server_action`,
          data: { params: { type: 'PHRASE', value: String(command.value) } },
        });
        return this.ok(device, command.capability, command.instance);
      }
      const action = canonical(command);
      if (!action) return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
      await this.request({
        method: 'POST',
        url: `/v1/devices/${device.externalId}/state`,
        data: { commands: [{ action }] },
      });
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }
}

function mapCategory(c: string): DeviceType {
  switch (c) {
    case 'light':
      return DEVICE_TYPE.LIGHT;
    case 'socket':
      return DEVICE_TYPE.SOCKET;
    case 'switch':
      return DEVICE_TYPE.SWITCH;
    case 'sensor':
    case 'climate_sensor':
      return DEVICE_TYPE.SENSOR;
    case 'thermostat':
      return DEVICE_TYPE.THERMOSTAT;
    case 'tv':
    case 'media':
      return DEVICE_TYPE.TV;
    case 'curtain':
      return DEVICE_TYPE.CURTAIN;
    case 'kettle':
      return DEVICE_TYPE.COOKING_KETTLE;
    case 'humidifier':
      return DEVICE_TYPE.HUMIDIFIER;
    case 'vacuum':
      return DEVICE_TYPE.VACUUM;
    case 'speaker':
    case 'companion':
      return DEVICE_TYPE.MEDIA;
    default:
      return DEVICE_TYPE.OTHER;
  }
}

function buildCaps(type: DeviceType, state: NonNullable<SaluteDevice['state']>): Capability[] {
  const caps: Capability[] = [];
  const get = (k: string) => state.find((s) => s.key === k)?.value;

  if (type !== DEVICE_TYPE.SENSOR || get('on_off') !== undefined) {
    caps.push(capOnOff(Boolean(get('on_off'))));
  }
  if (type === DEVICE_TYPE.LIGHT) {
    const b = Number(get('brightness') ?? 0);
    if (Number.isFinite(b) && b > 0) {
      caps.push(capBrightness(Math.max(1, Math.round(b))));
    }
  }
  // Quasar action capability — для прямой передачи фразы Салюту.
  if (type === DEVICE_TYPE.MEDIA || type.startsWith(DEVICE_TYPE.MEDIA)) {
    caps.push({
      type: CAPABILITY.SERVER_ACTION,
      retrievable: false,
      reportable: false,
    });
  }
  return caps;
}

function canonical(command: DeviceCommand): { type: string; value?: unknown } | null {
  if (command.capability === CAPABILITY.ON_OFF) {
    return { type: 'ON_OFF', value: Boolean(command.value) };
  }
  if (command.capability === CAPABILITY.RANGE && command.instance === INSTANCE.BRIGHTNESS) {
    return { type: 'BRIGHTNESS', value: Number(command.value) };
  }
  if (command.capability === CAPABILITY.COLOR_SETTING && command.instance === INSTANCE.RGB) {
    return { type: 'COLOUR_RGB', value: Number(command.value) };
  }
  if (
    command.capability === CAPABILITY.COLOR_SETTING &&
    command.instance === INSTANCE.TEMPERATURE_K
  ) {
    return { type: 'COLOUR_TEMPERATURE', value: Number(command.value) };
  }
  return null;
}
