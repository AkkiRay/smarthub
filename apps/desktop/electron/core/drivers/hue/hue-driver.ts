// Philips Hue Bridge — локальный REST API.
// Discovery: discovery.meethue.com (cloud) → IP моста + N-UPnP. У нас два слоя:
//   1) cloud-discovery (быстро, без user-action) — пишет в {creds.bridges} список IP.
//   2) опционально SSDP (если интернет недоступен).
// Для управления: pre-Hue-v2 /api/<username>/lights/<id>, Hue v2 (CLIP-v2) — /clip/v2/resource/light/<uuid>.
// Используем v1, потому что username-based auth работает на всех мостах (gen1+).
//
// Pairing: пользователь жмёт кнопку на bridge → POST /api → возвращается username (40 hex).
// Без нажатия кнопки получаем `link button not pressed` — UI должен попросить нажать и retry.

import axios, { type AxiosInstance } from 'axios';
import type {
  Capability,
  Device,
  DeviceCommand,
  DeviceCommandResult,
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
import { kelvinToMired, miredToKelvin, rgbIntToXy, xyToRgbInt } from '../_shared/color.js';
import { BaseDriver } from '../_shared/base-driver.js';

const HUE_HTTP_TIMEOUT_MS = 4000;
const HUE_KELVIN: { min: number; max: number } = { min: 2000, max: 6500 };
const HUE_BRIGHTNESS_MAX = 254;

interface HueBridge {
  bridgeId: string;
  internalipaddress: string;
  username: string;
}

interface HueLight {
  state: {
    on?: boolean;
    bri?: number;
    hue?: number;
    sat?: number;
    xy?: [number, number];
    ct?: number;
    colormode?: 'hs' | 'xy' | 'ct';
    reachable?: boolean;
  };
  type: string;
  name: string;
  modelid: string;
  uniqueid: string;
}

interface HueMeta extends Record<string, unknown> {
  bridgeId: string;
  bridgeIp: string;
  username: string;
  lightId: string;
  hasColor: boolean;
  hasTemp: boolean;
}

export class HueDriver extends BaseDriver {
  readonly id = 'hue' as const;
  readonly displayName = 'Philips Hue';

  private readonly http: AxiosInstance = axios.create({ timeout: HUE_HTTP_TIMEOUT_MS });

  constructor(private readonly bridges: HueBridge[]) {
    super();
  }

  async discover(_signal: AbortSignal): Promise<DiscoveredDevice[]> {
    const out: DiscoveredDevice[] = [];
    for (const b of this.bridges) {
      try {
        const { data } = await this.http.get<Record<string, HueLight>>(
          `http://${b.internalipaddress}/api/${b.username}/lights`,
        );
        if (Array.isArray(data)) continue; // ошибка возвращается массивом
        for (const [id, light] of Object.entries(data)) {
          const hasColor = /xy/.test(light.state.colormode ?? '') || light.state.xy !== undefined;
          const hasTemp = light.state.ct !== undefined;
          out.push({
            driver: 'hue',
            externalId: `${b.bridgeId}:${id}`,
            type: DEVICE_TYPE.LIGHT,
            name: light.name,
            address: b.internalipaddress,
            meta: {
              bridgeId: b.bridgeId,
              bridgeIp: b.internalipaddress,
              username: b.username,
              lightId: id,
              hasColor,
              hasTemp,
            } satisfies HueMeta,
          });
        }
      } catch (e) {
        this.logWarn(`bridge ${b.internalipaddress} list failed`, e);
      }
    }
    return out;
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as HueMeta;
    const now = new Date().toISOString();
    let initial: HueLight | null = null;
    try {
      const { data } = await this.http.get<HueLight>(
        `http://${meta.bridgeIp}/api/${meta.username}/lights/${meta.lightId}`,
      );
      initial = data;
    } catch {
      /* probe всё равно успешен */
    }

    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'hue',
      type: DEVICE_TYPE.LIGHT,
      name: initial?.name ?? candidate.name,
      address: meta.bridgeIp,
      hidden: false,
      meta,
      status: initial?.state.reachable === false ? 'unreachable' : 'online',
      capabilities: buildHueCaps(meta, initial?.state ?? {}),
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    const meta = device.meta as HueMeta;
    try {
      const { data } = await this.http.get<HueLight>(
        `http://${meta.bridgeIp}/api/${meta.username}/lights/${meta.lightId}`,
      );
      return {
        ...device,
        status: data.state.reachable === false ? 'unreachable' : 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildHueCaps(meta, data.state),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const meta = device.meta as HueMeta;
    const url = `http://${meta.bridgeIp}/api/${meta.username}/lights/${meta.lightId}/state`;

    let body: Record<string, unknown> | null = null;
    if (command.capability === CAPABILITY.ON_OFF) {
      body = { on: Boolean(command.value) };
    } else if (
      command.capability === CAPABILITY.RANGE &&
      command.instance === INSTANCE.BRIGHTNESS
    ) {
      const percent = clamp(Number(command.value), RANGE.PERCENT.min, RANGE.PERCENT.max);
      body = { on: true, bri: Math.max(1, Math.round((percent / 100) * HUE_BRIGHTNESS_MAX)) };
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.RGB
    ) {
      const xy = rgbIntToXy(Number(command.value));
      body = { on: true, xy: [xy.x, xy.y] };
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.TEMPERATURE_K
    ) {
      body = { on: true, ct: kelvinToMired(Number(command.value)) };
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      await this.http.put(url, body);
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }
}

function buildHueCaps(meta: HueMeta, state: HueLight['state']): Capability[] {
  const caps: Capability[] = [capOnOff(Boolean(state.on))];

  caps.push(
    capBrightness(
      typeof state.bri === 'number'
        ? Math.max(1, Math.round((state.bri / HUE_BRIGHTNESS_MAX) * 100))
        : 100,
    ),
  );

  if (meta.hasColor || meta.hasTemp) {
    const isTempMode = state.colormode === 'ct' && meta.hasTemp;
    const k = state.ct ? miredToKelvin(state.ct) : 4000;
    const rgb = state.xy ? xyToRgbInt(state.xy[0], state.xy[1]) : 0xffffff;
    caps.push(
      capColor(isTempMode ? { kind: 'temperature_k', value: k } : { kind: 'rgb', value: rgb }, {
        rgb: meta.hasColor,
        temperatureK: meta.hasTemp ? HUE_KELVIN : undefined,
      }),
    );
  }

  return caps;
}

/** Pairing helper для UI. Жмётся кнопка на мосту → POST /api → username. */
export async function hueLinkBridge(
  bridgeIp: string,
  deviceType = 'smarthome-hub',
): Promise<string> {
  const r = await axios.post<
    Array<{ success?: { username: string }; error?: { description: string } }>
  >(`http://${bridgeIp}/api`, { devicetype: deviceType }, { timeout: HUE_HTTP_TIMEOUT_MS });
  const item = r.data[0];
  if (item?.error) throw new Error(item.error.description);
  if (item?.success?.username) return item.success.username;
  throw new Error('Hue: empty response');
}

/** Cloud N-UPnP discovery от Philips. Не требует SSDP-multicast — работает за NAT. */
export async function hueDiscoverBridges(): Promise<
  Array<{ id: string; internalipaddress: string }>
> {
  try {
    const r = await axios.get<Array<{ id: string; internalipaddress: string }>>(
      'https://discovery.meethue.com/',
      { timeout: HUE_HTTP_TIMEOUT_MS },
    );
    return r.data;
  } catch {
    return [];
  }
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
