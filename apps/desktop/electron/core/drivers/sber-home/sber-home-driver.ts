/**
 * @fileoverview
 * Sber Дом (приложение «Сбер Дом», экосистема Sber Smart Home).
 * API: https://gateway.iot.sberdevices.ru/gateway/v1
 *   - аутентификация через OAuth-токен Sber ID;
 *   - GET /house_info → дом, комнаты, devices;
 *   - POST /devices/<id>/state — отправка управляющих action'ов.
 * Из-за того, что у Sber нет публичного «третьесторонних разработчиков» SDK, маршруты могут
 * меняться — здесь fallback на refresh-token и явный лог при HTTP 401/403.
 *
 * Тип action'ов в Sber:
 *   { commands: [{ action: { type: "QUASAR_SERVER_ACTION", params: {...} } }] }  — для квазара
 *   { commands: [{ action: { type: "ON", value: true } }] }                        — для on_off
 *   { commands: [{ action: { type: "BRIGHTNESS", value: 75 } }] }                  — для range
 *   { commands: [{ action: { type: "COLOUR_RGB", value: 0xFFAA00 } }] }            — для rgb
 */

import axios, { type AxiosRequestConfig } from 'axios';
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

interface SberCreds {
  accessToken: string;
  refreshToken?: string;
  /** ID конкретного дома, если у пользователя несколько. */
  houseId?: string;
}

interface SberDevice {
  id: string;
  name: string;
  category: string; // 'light' | 'socket' | 'switch' | 'sensor' | 'tv' | 'thermostat' | ...
  room_id?: string;
  online: boolean;
  state: SberStateField[];
}

interface SberStateField {
  key: string; // 'on_off' | 'brightness' | 'colour' | 'temperature' | ...
  bool_value?: boolean;
  integer_value?: number;
  string_value?: string;
}

export class SberHomeDriver extends BaseCloudDriver {
  readonly id = 'sber-home' as const;
  readonly displayName = 'Сбер Дом';

  constructor(private readonly creds: SberCreds) {
    super({
      baseURL: 'https://gateway.iot.sberdevices.ru/gateway/v1',
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
    if (!this.creds.refreshToken) throw new Error('Sber: no refresh_token');
    let r;
    try {
      r = await axios.post<{
        access_token: string;
        refresh_token?: string;
        error?: string;
        error_description?: string;
      }>(
        'https://salute.online.sberbank.ru/api/v1/oauth/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.creds.refreshToken,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 },
      );
    } catch (e) {
      // Normalize: без этого юзер видит generic «Request failed with status code 400».
      const ax = e as {
        response?: { status?: number; data?: { error?: string; error_description?: string } };
      };
      const code = ax.response?.status;
      const detail = ax.response?.data?.error_description ?? ax.response?.data?.error;
      throw new Error(
        `Sber refresh failed (HTTP ${code ?? '?'}): ${detail ?? (e as Error).message}`,
      );
    }
    if (r.data.error) {
      throw new Error(`Sber refresh declined: ${r.data.error_description ?? r.data.error}`);
    }
    if (!r.data.access_token) {
      throw new Error('Sber refresh: cloud вернул пустой access_token');
    }
    this.creds.accessToken = r.data.access_token;
    if (r.data.refresh_token) this.creds.refreshToken = r.data.refresh_token;
  }

  async discover(_signal: AbortSignal): Promise<DiscoveredDevice[]> {
    try {
      const data = await this.request<{
        result: { houses?: Array<{ id: string; rooms?: Array<{ devices?: SberDevice[] }> }> };
      }>({ method: 'GET', url: '/house_info' });
      const out: DiscoveredDevice[] = [];
      const houses = data.result.houses ?? [];
      for (const h of houses) {
        if (this.creds.houseId && h.id !== this.creds.houseId) continue;
        for (const r of h.rooms ?? []) {
          for (const d of r.devices ?? []) {
            out.push({
              driver: 'sber-home' as const,
              externalId: d.id,
              type: mapSberCategory(d.category),
              name: d.name,
              address: 'cloud',
              meta: { category: d.category, lastState: d.state, online: d.online, houseId: h.id },
            });
          }
        }
      }
      return out;
    } catch (e) {
      this.logWarn('discovery failed', e);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as { category: string; lastState?: SberStateField[] };
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'sber-home',
      type: candidate.type,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      meta: candidate.meta,
      status: 'online',
      capabilities: buildSberCaps(candidate.type, meta.lastState ?? []),
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const data = await this.request<{ result: { device: SberDevice } }>({
        method: 'GET',
        url: `/devices/${device.externalId}`,
      });
      return {
        ...device,
        status: data.result.device.online ? 'online' : 'unreachable',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildSberCaps(device.type, data.result.device.state ?? []),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const action = canonicalToSber(command);
    if (!action) return this.err(device, command, 'UNSUPPORTED_CAPABILITY');

    try {
      await this.request({
        method: 'POST',
        url: `/devices/${device.externalId}/state`,
        data: { commands: [{ action }] },
      });
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }
}

function mapSberCategory(c: string): DeviceType {
  switch (c) {
    case 'light':
      return DEVICE_TYPE.LIGHT;
    case 'socket':
      return DEVICE_TYPE.SOCKET;
    case 'switch':
      return DEVICE_TYPE.SWITCH;
    case 'thermostat':
      return DEVICE_TYPE.THERMOSTAT;
    case 'sensor':
    case 'climate_sensor':
      return DEVICE_TYPE.SENSOR;
    case 'tv':
      return DEVICE_TYPE.TV;
    case 'curtain':
    case 'blinds':
      return DEVICE_TYPE.CURTAIN;
    case 'vacuum':
      return DEVICE_TYPE.VACUUM;
    case 'humidifier':
      return DEVICE_TYPE.HUMIDIFIER;
    case 'kettle':
      return DEVICE_TYPE.COOKING_KETTLE;
    default:
      return DEVICE_TYPE.OTHER;
  }
}

function findStateBool(state: SberStateField[], key: string): boolean | undefined {
  return state.find((s) => s.key === key)?.bool_value;
}
function findStateInt(state: SberStateField[], key: string): number | undefined {
  return state.find((s) => s.key === key)?.integer_value;
}

function buildSberCaps(type: DeviceType, state: SberStateField[]): Capability[] {
  const caps: Capability[] = [];
  const onOff = findStateBool(state, 'on_off');
  if (onOff !== undefined || type !== DEVICE_TYPE.SENSOR) {
    caps.push(capOnOff(Boolean(onOff)));
  }
  if (type === DEVICE_TYPE.LIGHT) {
    const bright = findStateInt(state, 'brightness');
    if (bright !== undefined) {
      caps.push(capBrightness(Math.max(1, bright), RANGE.PERCENT));
    }
    const colour = findStateInt(state, 'colour') ?? findStateInt(state, 'colour_rgb');
    const ct = findStateInt(state, 'temperature_k') ?? findStateInt(state, 'colour_temperature');
    if (colour !== undefined || ct !== undefined) {
      caps.push(
        capColor(
          ct !== undefined
            ? { kind: 'temperature_k', value: ct }
            : { kind: 'rgb', value: colour ?? 0xffffff },
          { rgb: true, ...(ct !== undefined ? { temperatureK: { min: 2700, max: 6500 } } : {}) },
        ),
      );
    }
  }
  return caps;
}

function canonicalToSber(command: DeviceCommand): { type: string; value?: unknown } | null {
  if (command.capability === CAPABILITY.ON_OFF) {
    return { type: 'ON_OFF', value: Boolean(command.value) };
  }
  if (command.capability === CAPABILITY.RANGE && command.instance === INSTANCE.BRIGHTNESS) {
    return { type: 'BRIGHTNESS', value: Number(command.value) };
  }
  if (command.capability === CAPABILITY.COLOR_SETTING) {
    if (command.instance === INSTANCE.RGB)
      return { type: 'COLOUR_RGB', value: Number(command.value) };
    if (command.instance === INSTANCE.TEMPERATURE_K) {
      return { type: 'COLOUR_TEMPERATURE', value: Number(command.value) };
    }
  }
  if (command.capability === CAPABILITY.MODE) {
    return { type: 'MODE', value: command.value };
  }
  return null;
}
