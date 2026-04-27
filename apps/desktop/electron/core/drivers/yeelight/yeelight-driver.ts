/**
 * @fileoverview Yeelight LAN driver. Discovery — SSDP M-SEARCH на multicast
 * `239.255.255.250:1982` (`ST: wifi_bulb`); control — JSON-RPC по TCP `:55443`.
 * Лампа допускает только одно TCP-connection одновременно: открываем и
 * закрываем socket на каждую команду.
 */

import { Socket } from 'node:net';
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
import { BaseDriver } from '../_shared/base-driver.js';
import { ssdpDiscover } from '../_shared/ssdp-discover.js';

const YEELIGHT_MULTICAST_ADDR = '239.255.255.250';
const YEELIGHT_MULTICAST_PORT = 1982;
const YEELIGHT_DEFAULT_PORT = 55443;
const YEELIGHT_DISCOVER_TIMEOUT_MS = 3500;
const YEELIGHT_RPC_TIMEOUT_MS = 2500;
const YEELIGHT_TRANSITION_MS = 400;
const YEELIGHT_KELVIN: { min: number; max: number } = { min: 1700, max: 6500 };

interface YeelightAdvert {
  id: string;
  location: string;
  model: string;
  power: string;
  bright: string;
  color_mode: string;
  ct: string;
  rgb: string;
  hue: string;
  sat: string;
  name: string;
  support: string;
}

interface YeelightMeta extends Record<string, unknown> {
  model: string;
  power: string;
  bright: number;
  rgb: number;
  ct: number;
  support: string[];
}

export class YeelightDriver extends BaseDriver {
  readonly id = 'yeelight' as const;
  readonly displayName = 'Yeelight';

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    const found = new Map<string, YeelightAdvert>();
    await ssdpDiscover({
      driverId: 'yeelight',
      multicastAddr: YEELIGHT_MULTICAST_ADDR,
      multicastPort: YEELIGHT_MULTICAST_PORT,
      st: 'wifi_bulb',
      timeoutMs: YEELIGHT_DISCOVER_TIMEOUT_MS,
      signal,
      onResponse: (text) => {
        const advert = parseAdvert(text);
        if (advert?.id) found.set(advert.id, advert);
      },
    });
    return Array.from(found.values()).map(toCandidate);
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = (candidate.meta ?? {}) as Partial<YeelightMeta>;
    const support = new Set(meta.support ?? []);
    // SSDP advert перечисляет поддерживаемые методы; capability'и формируем строго по этому списку.
    const supportsRgb = support.has('set_rgb') || support.has('set_hsv');
    const supportsCt = support.has('set_ct_abx');
    const supportsBright = support.has('set_bright');
    const now = new Date().toISOString();

    const capabilities: Capability[] = [capOnOff(meta.power === 'on')];
    if (supportsBright) {
      capabilities.push(capBrightness(meta.bright ?? 100));
    }
    if (supportsRgb || supportsCt) {
      capabilities.push(
        capColor(
          supportsRgb
            ? { kind: 'rgb', value: meta.rgb ?? 0xffffff }
            : { kind: 'temperature_k', value: meta.ct ?? 4000 },
          { rgb: supportsRgb, temperatureK: supportsCt ? YEELIGHT_KELVIN : undefined },
        ),
      );
    }

    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'yeelight',
      type: DEVICE_TYPE.LIGHT,
      name: candidate.name || 'Yeelight Bulb',
      address: candidate.address,
      hidden: false,
      meta,
      status: 'online',
      capabilities,
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    const props = ['power', 'bright', 'rgb', 'ct', 'hue', 'sat'];
    const result = await this.sendCommand(device.address, 'get_prop', props).catch(() => null);
    if (!result || !Array.isArray(result)) return { ...device, status: 'unreachable' };
    const [power, bright, rgb] = result as [string, string, string];
    return {
      ...device,
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      capabilities: device.capabilities.map((c) => {
        if (c.type === CAPABILITY.ON_OFF) {
          return { ...c, state: { instance: INSTANCE.ON, value: power === 'on' } };
        }
        if (c.type === CAPABILITY.RANGE && c.state?.instance === INSTANCE.BRIGHTNESS) {
          return { ...c, state: { instance: INSTANCE.BRIGHTNESS, value: Number(bright) || 100 } };
        }
        if (c.type === CAPABILITY.COLOR_SETTING) {
          return { ...c, state: { instance: INSTANCE.RGB, value: Number(rgb) || 0xffffff } };
        }
        return c;
      }),
    };
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    try {
      if (command.capability === CAPABILITY.ON_OFF) {
        await this.sendCommand(device.address, 'set_power', [
          command.value ? 'on' : 'off',
          'smooth',
          YEELIGHT_TRANSITION_MS,
        ]);
      } else if (
        command.capability === CAPABILITY.RANGE &&
        command.instance === INSTANCE.BRIGHTNESS
      ) {
        const v = clamp(Number(command.value), RANGE.PERCENT.min, RANGE.PERCENT.max);
        await this.sendCommand(device.address, 'set_bright', [v, 'smooth', YEELIGHT_TRANSITION_MS]);
      } else if (
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.RGB
      ) {
        const rgb = clamp(Number(command.value), 0, 0xffffff);
        await this.sendCommand(device.address, 'set_rgb', [rgb, 'smooth', YEELIGHT_TRANSITION_MS]);
      } else if (
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.TEMPERATURE_K
      ) {
        const ct = clamp(Number(command.value), YEELIGHT_KELVIN.min, YEELIGHT_KELVIN.max);
        await this.sendCommand(device.address, 'set_ct_abx', [
          ct,
          'smooth',
          YEELIGHT_TRANSITION_MS,
        ]);
      } else {
        return this.err(
          device,
          command,
          'UNSUPPORTED_CAPABILITY',
          'This Yeelight does not support this command',
        );
      }
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  private sendCommand(address: string, method: string, params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const [host, portStr] = address.includes(':')
        ? address.split(':')
        : [address, String(YEELIGHT_DEFAULT_PORT)];
      const port = Number(portStr);
      if (!host || !Number.isFinite(port)) {
        reject(new Error(`Invalid Yeelight address: ${address}`));
        return;
      }
      const sock = new Socket();
      const id = Math.floor(Math.random() * 1e8);
      const payload = JSON.stringify({ id, method, params }) + '\r\n';
      let settled = false;
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        sock.destroy();
        reject(err);
      };
      const succeed = (value: unknown): void => {
        if (settled) return;
        settled = true;
        sock.end();
        resolve(value);
      };
      sock.setTimeout(YEELIGHT_RPC_TIMEOUT_MS);
      sock.on('timeout', () => fail(new Error('Yeelight timeout')));
      sock.on('error', fail);
      sock.connect(port, host, () => sock.write(payload));
      sock.on('data', (buf) => {
        try {
          const lines = buf.toString('utf8').split('\r\n').filter(Boolean);
          for (const line of lines) {
            const obj = JSON.parse(line) as {
              id?: number;
              result?: unknown;
              error?: { message: string };
            };
            if (obj.id === id) {
              if (obj.error) fail(new Error(obj.error.message));
              else succeed(obj.result);
              return;
            }
          }
        } catch (e) {
          fail(e as Error);
        }
      });
    });
  }
}

function parseAdvert(text: string): YeelightAdvert | null {
  const lines = text.split(/\r?\n/);
  const obj: Record<string, string> = {};
  for (const line of lines) {
    // Skip status-line ("HTTP/1.1 200 OK", "M-SEARCH...") и другие без ':'.
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    let value = line.slice(idx + 1).trim();
    // Yeelight name бывает hex-encoded (lampname=`74657374` для `test`) если
    // пользователь установил кириллический name через приложение. Detect:
    // только hex-chars, чётная длина, > 4. Decode best-effort, на failure
    // — оставляем raw.
    if (
      key === 'name' &&
      value &&
      /^[0-9a-f]+$/i.test(value) &&
      value.length % 2 === 0 &&
      value.length >= 4
    ) {
      try {
        const decoded = Buffer.from(value, 'hex').toString('utf8');
        if (!decoded.includes(' ') && decoded.length > 0) value = decoded;
      } catch {
        /* keep raw value */
      }
    }
    obj[key] = value;
  }
  if (!obj['id'] || !obj['location']) return null;
  return obj as unknown as YeelightAdvert;
}

function toCandidate(a: YeelightAdvert): DiscoveredDevice {
  // Yeelight LOCATION = `yeelight://<host>:<port>`. validate port присутствует,
  // иначе sendCommand упадёт на parseInt(undefined).
  const stripped = a.location.replace(/^yeelight:\/\//, '');
  const url = stripped.includes(':') ? stripped : `${stripped}:${YEELIGHT_DEFAULT_PORT}`;
  // model fallback — старые firmware (<2018) не присылают `model`, шлют `model_id`.
  const model = a.model || ((a as unknown as { model_id?: string }).model_id ?? 'unknown');
  // brightness/rgb/ct могут быть пустой строкой → NaN, fallback на дефолты.
  const numOr = (v: unknown, def: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  return {
    driver: 'yeelight',
    externalId: a.id,
    type: DEVICE_TYPE.LIGHT,
    name: a.name || `Yeelight ${model}`,
    address: url,
    meta: {
      model,
      power: a.power || 'off',
      bright: numOr(a.bright, 100),
      rgb: numOr(a.rgb, 0xffffff),
      ct: numOr(a.ct, 4000),
      support: a.support?.split(/\s+/).filter(Boolean) ?? [],
    } satisfies YeelightMeta,
  };
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
