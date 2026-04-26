// Rubetek (Россия): cloud REST API на api.rubetek.com.
// Auth: POST /login → bearer token + refresh; список устройств: GET /api/houses/<id>/devices.
// Документация публичного третьесторонним API нет, эндпоинты основаны на reverse-engineering приложения.

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

interface RubetekCreds {
  email: string;
  password: string;
  houseId?: string;
}

interface RubetekDevice {
  id: string;
  name: string;
  type: string;
  category?: string;
  state?: Record<string, unknown>;
  online?: boolean;
}

export class RubetekDriver extends BaseCloudDriver {
  readonly id = 'rubetek' as const;
  readonly displayName = 'Rubetek';

  private accessToken = '';
  private refreshTokenValue = '';

  constructor(private readonly creds: RubetekCreds) {
    super({ baseURL: 'https://api.rubetek.com', timeoutMs: 7000 });
  }

  protected applyAuth(config: AxiosRequestConfig): AxiosRequestConfig {
    config.headers = {
      ...(config.headers as Record<string, unknown>),
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      'Content-Type': 'application/json',
    };
    return config;
  }

  protected async refreshToken(): Promise<void> {
    if (!this.refreshTokenValue) {
      await this.login();
      return;
    }
    const r = await this.http.post<{ access_token: string; refresh_token: string }>(
      '/api/refresh',
      { refresh_token: this.refreshTokenValue },
    );
    this.accessToken = r.data.access_token;
    this.refreshTokenValue = r.data.refresh_token;
  }

  async discover(): Promise<DiscoveredDevice[]> {
    try {
      await this.ensureLogin();
      const housePath = this.creds.houseId
        ? `/api/houses/${this.creds.houseId}/devices`
        : '/api/devices';
      const r = await this.request<{ devices: RubetekDevice[] }>({
        method: 'GET',
        url: housePath,
      });
      return (r.devices ?? []).map((d) => ({
        driver: 'rubetek' as const,
        externalId: d.id,
        type: mapType(d.type, d.category),
        name: d.name,
        address: 'cloud',
        meta: { type: d.type, category: d.category, lastState: d.state ?? {}, online: d.online },
      }));
    } catch (e) {
      this.logWarn('discovery failed', e);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as { lastState?: Record<string, unknown> };
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'rubetek',
      type: candidate.type,
      name: candidate.name,
      address: 'cloud',
      hidden: false,
      status: 'online',
      meta: candidate.meta,
      capabilities: buildCaps(candidate.type, meta.lastState ?? {}),
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      await this.ensureLogin();
      const r = await this.request<{ state: Record<string, unknown>; online: boolean }>({
        method: 'GET',
        url: `/api/devices/${device.externalId}/state`,
      });
      return {
        ...device,
        status: r.online === false ? 'unreachable' : 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildCaps(device.type, r.state ?? {}),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    let body: Record<string, unknown> | null = null;
    if (command.capability === CAPABILITY.ON_OFF) {
      body = { state: { on: Boolean(command.value) } };
    } else if (
      command.capability === CAPABILITY.RANGE &&
      command.instance === INSTANCE.BRIGHTNESS
    ) {
      body = { state: { brightness: Math.max(1, Math.min(100, Number(command.value))) } };
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.RGB
    ) {
      body = { state: { color: Number(command.value) } };
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      await this.ensureLogin();
      await this.request({
        method: 'POST',
        url: `/api/devices/${device.externalId}/command`,
        data: body,
      });
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  private async ensureLogin(): Promise<void> {
    if (!this.accessToken) await this.login();
  }

  private async login(): Promise<void> {
    const r = await this.http.post<{ access_token: string; refresh_token: string }>('/api/login', {
      email: this.creds.email,
      password: this.creds.password,
    });
    this.accessToken = r.data.access_token;
    this.refreshTokenValue = r.data.refresh_token;
  }
}

function mapType(t: string, category?: string): DeviceType {
  const all = `${t} ${category ?? ''}`.toLowerCase();
  if (all.includes('light') || all.includes('bulb') || all.includes('lamp'))
    return DEVICE_TYPE.LIGHT;
  if (all.includes('socket') || all.includes('plug')) return DEVICE_TYPE.SOCKET;
  if (all.includes('switch')) return DEVICE_TYPE.SWITCH;
  if (all.includes('sensor') || all.includes('motion') || all.includes('leak'))
    return DEVICE_TYPE.SENSOR;
  if (all.includes('thermostat') || all.includes('climate')) return DEVICE_TYPE.THERMOSTAT;
  if (all.includes('camera')) return DEVICE_TYPE.CAMERA;
  if (all.includes('lock')) return DEVICE_TYPE.LOCK;
  return DEVICE_TYPE.OTHER;
}

function buildCaps(type: DeviceType, state: Record<string, unknown>): Capability[] {
  const caps: Capability[] = [capOnOff(Boolean(state['on']))];
  if (type === DEVICE_TYPE.LIGHT && typeof state['brightness'] === 'number') {
    caps.push(capBrightness(state['brightness']));
  }
  return caps;
}
