/**
 * @fileoverview
 * Yeelight LAN: SSDP M-SEARCH в multicast 239.255.255.250:1982 + JSONRPC по TCP/55443.
 * Лампа держит max 1 connection одновременно — pool бессмысленен, открываем/закрываем сокет на каждую команду.
 */

import { createSocket, type Socket as DgramSocket } from 'node:dgram';
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

const YEELIGHT_MULTICAST_ADDR = '239.255.255.250';
const YEELIGHT_MULTICAST_PORT = 1982;
const YEELIGHT_DEFAULT_PORT = 55443;
const YEELIGHT_DISCOVER_TIMEOUT_MS = 3500;
const YEELIGHT_RPC_TIMEOUT_MS = 2500;
const YEELIGHT_TRANSITION_MS = 400;
const YEELIGHT_KELVIN: { min: number; max: number } = { min: 1700, max: 6500 };

const SEARCH_MESSAGE = [
  'M-SEARCH * HTTP/1.1',
  `HOST: ${YEELIGHT_MULTICAST_ADDR}:${YEELIGHT_MULTICAST_PORT}`,
  'MAN: "ssdp:discover"',
  'ST: wifi_bulb',
  '',
  '',
].join('\r\n');

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
    const socket: DgramSocket = createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map<string, YeelightAdvert>();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {
          /* already closed */
        }
        resolve(Array.from(found.values()).map(toCandidate));
      };

      socket.on('message', (msg) => {
        const advert = parseAdvert(msg.toString('utf8'));
        if (advert?.id) found.set(advert.id, advert);
      });
      socket.on('error', (e) => {
        this.logWarn('discovery socket error', e);
        finish();
      });
      socket.bind(0, () => {
        try {
          socket.setBroadcast(true);
          socket.send(
            SEARCH_MESSAGE,
            0,
            SEARCH_MESSAGE.length,
            YEELIGHT_MULTICAST_PORT,
            YEELIGHT_MULTICAST_ADDR,
          );
        } catch (e) {
          this.logWarn('M-SEARCH send failed', e);
          finish();
        }
      });

      const timer = setTimeout(finish, YEELIGHT_DISCOVER_TIMEOUT_MS);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        finish();
      });
    });
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = (candidate.meta ?? {}) as Partial<YeelightMeta>;
    const support = new Set(meta.support ?? []);
    // SSDP advert честно перечисляет методы. У белой mono-лампы set_rgb нет — color picker нельзя показывать.
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
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      obj[key] = value;
    }
  }
  if (!obj['id'] || !obj['location']) return null;
  return obj as unknown as YeelightAdvert;
}

function toCandidate(a: YeelightAdvert): DiscoveredDevice {
  const url = a.location.replace(/^yeelight:\/\//, '');
  return {
    driver: 'yeelight',
    externalId: a.id,
    type: DEVICE_TYPE.LIGHT,
    name: a.name || `Yeelight ${a.model}`,
    address: url,
    meta: {
      model: a.model,
      power: a.power,
      bright: Number(a.bright),
      rgb: Number(a.rgb),
      ct: Number(a.ct),
      support: a.support?.split(' ') ?? [],
    } satisfies YeelightMeta,
  };
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
