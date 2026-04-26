/**
 * @fileoverview WiZ (Philips/Signify) LAN driver. UDP `:38899`, JSON-RPC.
 * Discovery: broadcast `getPilot` → unicast `result` от каждой лампы.
 * Control: одна UDP request/response пара на команду, без keepalive.
 */

import { createSocket, type Socket as DgramSocket } from 'node:dgram';
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
import { kelvinToMired, miredToKelvin, rgbIntToTuple, tupleToRgbInt } from '../_shared/color.js';
import { BaseDriver } from '../_shared/base-driver.js';
import { broadcastDiscover } from '../_shared/udp-broadcast.js';

const WIZ_PORT = 38899;
const WIZ_DISCOVER_TIMEOUT_MS = 2500;
const WIZ_RPC_TIMEOUT_MS = 2000;
const WIZ_KELVIN: { min: number; max: number } = { min: 2200, max: 6500 };

interface WizPilot {
  mac?: string;
  rssi?: number;
  state?: boolean;
  dimming?: number;
  r?: number;
  g?: number;
  b?: number;
  c?: number; // cool white channel, 0..255
  w?: number; // warm white channel, 0..255
  temp?: number; // color temperature в mireds
  sceneId?: number;
  speed?: number;
  src?: string;
}

interface WizMeta extends Record<string, unknown> {
  mac: string;
  pilot?: WizPilot;
}

export class WizDriver extends BaseDriver {
  readonly id = 'wiz' as const;
  readonly displayName = 'WiZ';

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    const found = new Map<string, { address: string; pilot: WizPilot }>();
    const payload = Buffer.from(JSON.stringify({ method: 'getPilot', params: {} }));
    await broadcastDiscover({
      driverId: 'wiz',
      port: WIZ_PORT,
      payload,
      timeoutMs: WIZ_DISCOVER_TIMEOUT_MS,
      signal,
      onMessage: (msg, rinfo) => {
        try {
          const obj = JSON.parse(msg.toString('utf8')) as { result?: WizPilot };
          const mac = obj.result?.mac;
          if (mac) found.set(mac, { address: rinfo.address, pilot: obj.result! });
        } catch {
          /* non-json */
        }
      },
    });
    return Array.from(found.entries()).map(([mac, { address, pilot }]) => ({
      driver: 'wiz' as const,
      externalId: mac,
      type: DEVICE_TYPE.LIGHT,
      name: `WiZ ${mac.slice(-6).toUpperCase()}`,
      address: `${address}:${WIZ_PORT}`,
      meta: { mac, pilot } satisfies WizMeta,
    }));
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as WizMeta;
    const pilot = meta.pilot ?? {};
    const now = new Date().toISOString();
    const supportsRgb = pilot.r !== undefined || pilot.g !== undefined || pilot.b !== undefined;
    const supportsTemp = pilot.temp !== undefined || pilot.c !== undefined || pilot.w !== undefined;

    const capabilities: Capability[] = [
      capOnOff(Boolean(pilot.state)),
      capBrightness(pilot.dimming ?? 100),
    ];

    if (supportsRgb || supportsTemp) {
      const rgb = supportsRgb
        ? tupleToRgbInt(pilot.r ?? 255, pilot.g ?? 255, pilot.b ?? 255)
        : 0xffffff;
      const k = pilot.temp ? miredToKelvin(pilot.temp) : 4000;
      capabilities.push(
        capColor(pilot.temp ? { kind: 'temperature_k', value: k } : { kind: 'rgb', value: rgb }, {
          rgb: true,
          temperatureK: supportsTemp ? WIZ_KELVIN : undefined,
        }),
      );
    }

    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'wiz',
      type: DEVICE_TYPE.LIGHT,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      meta: candidate.meta,
      status: 'online',
      capabilities,
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const pilot = await this.rpc<WizPilot>(device.address, 'getPilot', {});
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: device.capabilities.map((c) => {
          if (c.type === CAPABILITY.ON_OFF) {
            return { ...c, state: { instance: INSTANCE.ON, value: Boolean(pilot.state) } };
          }
          if (c.type === CAPABILITY.RANGE) {
            return {
              ...c,
              state: { instance: INSTANCE.BRIGHTNESS, value: pilot.dimming ?? 100 },
            };
          }
          if (c.type === CAPABILITY.COLOR_SETTING) {
            if (pilot.temp) {
              return {
                ...c,
                state: { instance: INSTANCE.TEMPERATURE_K, value: miredToKelvin(pilot.temp) },
              };
            }
            const rgb = tupleToRgbInt(pilot.r ?? 255, pilot.g ?? 255, pilot.b ?? 255);
            return { ...c, state: { instance: INSTANCE.RGB, value: rgb } };
          }
          return c;
        }),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    try {
      if (command.capability === CAPABILITY.ON_OFF) {
        await this.rpc(device.address, 'setPilot', { state: Boolean(command.value) });
      } else if (
        command.capability === CAPABILITY.RANGE &&
        command.instance === INSTANCE.BRIGHTNESS
      ) {
        const v = clamp(Math.round(Number(command.value)), 10, RANGE.PERCENT.max);
        await this.rpc(device.address, 'setPilot', { dimming: v });
      } else if (
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.RGB
      ) {
        const [r, g, b] = rgbIntToTuple(Number(command.value));
        await this.rpc(device.address, 'setPilot', { r, g, b });
      } else if (
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.TEMPERATURE_K
      ) {
        // `temp` (mireds) поддерживается всеми моделями; `c`/`w` пары — только tunable-white.
        const k = clamp(Number(command.value), WIZ_KELVIN.min, WIZ_KELVIN.max);
        await this.rpc(device.address, 'setPilot', { temp: kelvinToMired(k) });
      } else {
        return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
      }
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  /** Sessionless UDP RPC: один socket на один request, response по rinfo. */
  private rpc<T = WizPilot>(address: string, method: string, params: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const [host, portStr] = address.includes(':')
        ? address.split(':')
        : [address, String(WIZ_PORT)];
      const port = Number(portStr);
      const sock: DgramSocket = createSocket('udp4');
      const payload = Buffer.from(JSON.stringify({ method, params }));
      let settled = false;
      const fail = (e: Error): void => {
        if (settled) return;
        settled = true;
        sock.close();
        reject(e);
      };
      const succeed = (v: T): void => {
        if (settled) return;
        settled = true;
        sock.close();
        resolve(v);
      };
      sock.on('message', (msg) => {
        try {
          const obj = JSON.parse(msg.toString('utf8')) as {
            result?: T;
            error?: { message: string };
          };
          if (obj.error) fail(new Error(obj.error.message));
          else if (obj.result) succeed(obj.result);
        } catch (e) {
          fail(e as Error);
        }
      });
      sock.on('error', fail);
      sock.send(payload, 0, payload.length, port, host!, (e) => {
        if (e) fail(e);
      });
      setTimeout(() => fail(new Error('WiZ timeout')), WIZ_RPC_TIMEOUT_MS);
    });
  }
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
