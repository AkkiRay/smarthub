/**
 * @fileoverview
 * Shelly Gen2+: HTTP RPC (`/rpc/<Method>`) + mDNS `_shelly._tcp`.
 * Bug fix: для Bulb/RGBW/Duo нужен Light.* RPC — Switch.* отдаёт 404; компонент выбирается по type.
 */

import axios, { type AxiosInstance } from 'axios';
import { Bonjour } from 'bonjour-service';
import type {
  Capability,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import {
  CAPABILITY,
  DEVICE_TYPE,
  INSTANCE,
  RANGE,
  capBrightness,
  capColor,
  capOnOff,
} from '@smarthome/shared';
import { rgbIntToTuple, tupleToRgbInt } from '../_shared/color.js';
import { BaseDriver } from '../_shared/base-driver.js';

const SHELLY_HTTP_TIMEOUT_MS = 2500;
const SHELLY_DISCOVER_TIMEOUT_MS = 4000;
const SHELLY_KELVIN: { min: number; max: number } = { min: 2700, max: 6500 };

interface ShellyMeta extends Record<string, unknown> {
  model?: string;
  gen?: string | number;
  component?: 'light' | 'switch';
  /** RGBW лампа поддерживает оба режима — флаг для UI tabs. */
  hasWhiteMode?: boolean;
}

export class ShellyDriver extends BaseDriver {
  readonly id = 'shelly' as const;
  readonly displayName = 'Shelly';

  private readonly http: AxiosInstance = axios.create({ timeout: SHELLY_HTTP_TIMEOUT_MS });

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    const bonjour = new Bonjour();
    const found = new Map<string, DiscoveredDevice>();
    const browser = bonjour.find({ type: 'shelly' });

    browser.on('up', (svc) => {
      const host = svc.referer?.address ?? svc.host;
      if (!host) return;
      const model = String(svc.txt?.app ?? '');
      const isLight = isLightModel(model);
      found.set(svc.name, {
        driver: 'shelly',
        externalId: svc.name,
        type: isLight ? DEVICE_TYPE.LIGHT : DEVICE_TYPE.SOCKET,
        name: svc.txt?.name ?? svc.name,
        address: `${host}:${svc.port ?? 80}`,
        meta: {
          model,
          gen: svc.txt?.gen ?? '2',
          component: isLight ? 'light' : 'switch',
        } satisfies ShellyMeta,
      });
    });

    return await new Promise((resolve) => {
      const finish = (): void => {
        try {
          browser.stop();
          bonjour.destroy();
        } catch {
          /* ignore */
        }
        resolve(Array.from(found.values()));
      };
      const timer = setTimeout(finish, SHELLY_DISCOVER_TIMEOUT_MS);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        finish();
      });
    });
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    try {
      const info = await this.http.get(`http://${candidate.address}/rpc/Shelly.GetDeviceInfo`);
      const data = info.data as { id: string; model: string; gen: number; name?: string };
      const model = data.model ?? (candidate.meta as ShellyMeta).model ?? '';
      const isLight = isLightModel(model);
      const type: DeviceType = isLight ? DEVICE_TYPE.LIGHT : DEVICE_TYPE.SOCKET;
      const component: ShellyMeta['component'] = isLight ? 'light' : 'switch';

      const now = new Date().toISOString();
      const meta: ShellyMeta = {
        model,
        gen: data.gen ?? 2,
        component,
        hasWhiteMode: isLight,
      };

      // Сразу читаем status, чтобы UI после pair'а показал актуальную яркость/цвет.
      let initialStatus: ShellyLightStatus | ShellySwitchStatus | null = null;
      try {
        const url = isLight
          ? `http://${candidate.address}/rpc/Light.GetStatus?id=0`
          : `http://${candidate.address}/rpc/Switch.GetStatus?id=0`;
        const r = await this.http.get(url);
        initialStatus = r.data as ShellyLightStatus | ShellySwitchStatus;
      } catch {
        /* status-read не должен валить probe */
      }

      return {
        id: '',
        externalId: data.id,
        driver: 'shelly',
        type,
        name: data.name ?? candidate.name,
        address: candidate.address,
        hidden: false,
        status: 'online',
        meta,
        capabilities: buildShellyCaps(type, initialStatus),
        properties: [],
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      };
    } catch (e) {
      this.logWarn('probe failed', e);
      return null;
    }
  }

  async readState(device: Device): Promise<Device> {
    const isLight = device.type === DEVICE_TYPE.LIGHT;
    const url = isLight
      ? `http://${device.address}/rpc/Light.GetStatus?id=0`
      : `http://${device.address}/rpc/Switch.GetStatus?id=0`;
    try {
      const { data } = await this.http.get(url);
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildShellyCaps(device.type, data as ShellyLightStatus | ShellySwitchStatus),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const isLight = device.type === DEVICE_TYPE.LIGHT;

    try {
      if (command.capability === CAPABILITY.ON_OFF) {
        const path = isLight ? 'Light.Set' : 'Switch.Set';
        await this.http.get(`http://${device.address}/rpc/${path}`, {
          params: { id: 0, on: Boolean(command.value) },
        });
      } else if (
        isLight &&
        command.capability === CAPABILITY.RANGE &&
        command.instance === INSTANCE.BRIGHTNESS
      ) {
        const v = clamp(Math.round(Number(command.value)), RANGE.PERCENT.min, RANGE.PERCENT.max);
        await this.http.get(`http://${device.address}/rpc/Light.Set`, {
          params: { id: 0, brightness: v },
        });
      } else if (
        isLight &&
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.RGB
      ) {
        const rgb = clamp(Number(command.value), 0, 0xffffff);
        const tuple = rgbIntToTuple(rgb);
        // Light.Set ждёт rgb как [r,g,b]; сериализуем JSON-строкой — query params не несут вложенных структур.
        await this.http.get(`http://${device.address}/rpc/Light.Set`, {
          params: { id: 0, rgb: JSON.stringify(tuple) },
        });
      } else if (
        isLight &&
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.TEMPERATURE_K
      ) {
        const k = clamp(Number(command.value), SHELLY_KELVIN.min, SHELLY_KELVIN.max);
        await this.http.get(`http://${device.address}/rpc/Light.Set`, {
          params: { id: 0, temp: k },
        });
      } else {
        return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
      }
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }
}

interface ShellyLightStatus {
  output?: boolean;
  brightness?: number;
  rgb?: [number, number, number];
  temp?: number;
  mode?: 'color' | 'white';
}

interface ShellySwitchStatus {
  output?: boolean;
}

function isLightModel(model: string): boolean {
  return /bulb|rgbw|dimmer|duo|vintage|lightstrip/i.test(model);
}

function buildShellyCaps(
  type: DeviceType,
  status: ShellyLightStatus | ShellySwitchStatus | null,
): Capability[] {
  const caps: Capability[] = [capOnOff(Boolean(status?.output))];
  if (type !== DEVICE_TYPE.LIGHT) return caps;

  const light = (status ?? {}) as ShellyLightStatus;
  caps.push(capBrightness(typeof light.brightness === 'number' ? light.brightness : 100));

  // RGBW: выставляем оба параметра, текущий mode определяет, какой instance читать.
  const [r, g, b] = light.rgb ?? [0xff, 0xff, 0xff];
  const rgbInt = tupleToRgbInt(r, g, b);
  const ct = typeof light.temp === 'number' ? light.temp : 4000;
  const isWhiteMode = light.mode === 'white';
  caps.push(
    capColor(isWhiteMode ? { kind: 'temperature_k', value: ct } : { kind: 'rgb', value: rgbInt }, {
      rgb: true,
      temperatureK: SHELLY_KELVIN,
    }),
  );
  return caps;
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
