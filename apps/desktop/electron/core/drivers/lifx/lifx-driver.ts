// LIFX LAN: UDP 56700, бинарный header (36 байт) + payload.
// Discovery: broadcast GetService (msg=2) → LIFX отвечает StateService (msg=3) с MAC и портом.
// Для чтения цвета используется Light::Get (101) → State (107).
//
// Frame layout (всё little-endian):
//   [0..2)  size (uint16)
//   [2..4)  protocol(12) | addressable(1) | tagged(1) | origin(2)  → 0x3400 для unicast
//   [4..8)  source (uint32, эхо в ответе)
//   [8..16) target MAC (6 bytes + 2 padding)
//   [16..22) reserved
//   [22..23) res_required(1) | ack_required(1) | reserved(6)
//   [23..24) sequence
//   [24..32) reserved
//   [32..34) message type
//   [34..36) reserved

import { createSocket } from 'node:dgram';
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
import { hsvToRgbInt, rgbIntToHsv } from '../_shared/color.js';
import { BaseDriver } from '../_shared/base-driver.js';

const LIFX_PORT = 56700;
const LIFX_BROADCAST = '255.255.255.255';
const LIFX_DISCOVER_TIMEOUT_MS = 2500;
const LIFX_RPC_TIMEOUT_MS = 2000;
const LIFX_TRANSITION_MS = 400;
const LIFX_KELVIN: { min: number; max: number } = { min: 2500, max: 9000 };

const MSG_GET_SERVICE = 2;
const MSG_STATE_SERVICE = 3;
const MSG_LIGHT_GET = 101;
const MSG_LIGHT_SET_COLOR = 102;
const MSG_LIGHT_SET_POWER = 117;
const MSG_LIGHT_STATE = 107;

interface LifxMeta extends Record<string, unknown> {
  mac: string;
  port: number;
}

export class LifxDriver extends BaseDriver {
  readonly id = 'lifx' as const;
  readonly displayName = 'LIFX';
  private readonly source = Math.floor(Math.random() * 0xffffffff);

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    const sock = createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map<string, DiscoveredDevice>();

    return await new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        try {
          sock.close();
        } catch {
          /* closed */
        }
        resolve(Array.from(found.values()));
      };

      sock.on('message', (msg, rinfo) => {
        const parsed = parseHeader(msg);
        if (!parsed || parsed.type !== MSG_STATE_SERVICE) return;
        const service = msg.readUInt8(36);
        const port = msg.readUInt32LE(37);
        if (service !== 1) return; // только UDP-сервис
        const mac = parsed.target;
        if (found.has(mac)) return;
        found.set(mac, {
          driver: 'lifx',
          externalId: mac,
          type: DEVICE_TYPE.LIGHT,
          name: `LIFX ${mac.slice(-6).toUpperCase()}`,
          address: `${rinfo.address}:${port}`,
          meta: { mac, port } satisfies LifxMeta,
        });
      });

      sock.on('error', (e) => {
        this.logWarn('discovery error', e);
        finish();
      });

      sock.bind(0, () => {
        try {
          sock.setBroadcast(true);
        } catch {
          /* fallback */
        }
        const pkt = buildPacket({
          source: this.source,
          target: '000000000000',
          type: MSG_GET_SERVICE,
          tagged: true,
          payload: Buffer.alloc(0),
        });
        sock.send(pkt, 0, pkt.length, LIFX_PORT, LIFX_BROADCAST);
      });

      const timer = setTimeout(finish, LIFX_DISCOVER_TIMEOUT_MS);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        finish();
      });
    });
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as LifxMeta;
    const now = new Date().toISOString();

    // Сразу читаем initial state, иначе UI после pair'а покажет дефолтный белый.
    let state: LightState | null = null;
    try {
      state = await this.lightGet(candidate.address, meta.mac);
    } catch {
      /* probe всё равно успешен — caps по дефолту */
    }

    const capabilities: Capability[] = buildCaps(state);
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'lifx',
      type: DEVICE_TYPE.LIGHT,
      name: state?.label || candidate.name,
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
    const meta = device.meta as LifxMeta;
    try {
      const state = await this.lightGet(device.address, meta.mac);
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildCaps(state),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const meta = device.meta as LifxMeta;

    try {
      if (command.capability === CAPABILITY.ON_OFF) {
        const payload = Buffer.alloc(6);
        payload.writeUInt16LE(command.value ? 0xffff : 0, 0);
        payload.writeUInt32LE(LIFX_TRANSITION_MS, 2); // duration ms
        await this.send(device.address, meta.mac, MSG_LIGHT_SET_POWER, payload);
      } else {
        // Все цветовые/яркостные изменения шлются одним SetColor — нужен текущий state.
        const cur = await this.lightGet(device.address, meta.mac);
        let h = cur.hue,
          s = cur.saturation,
          b = cur.brightness,
          k = cur.kelvin;

        if (command.capability === CAPABILITY.RANGE && command.instance === INSTANCE.BRIGHTNESS) {
          const pct = clamp(Number(command.value), RANGE.PERCENT.min, RANGE.PERCENT.max);
          b = Math.round((pct / 100) * 65535);
        } else if (
          command.capability === CAPABILITY.COLOR_SETTING &&
          command.instance === INSTANCE.RGB
        ) {
          const hsv = rgbIntToHsv(Number(command.value));
          h = Math.round((hsv.h / 360) * 65535);
          s = Math.round(hsv.s * 65535);
          b = Math.round(hsv.v * 65535);
        } else if (
          command.capability === CAPABILITY.COLOR_SETTING &&
          command.instance === INSTANCE.TEMPERATURE_K
        ) {
          k = clamp(Number(command.value), LIFX_KELVIN.min, LIFX_KELVIN.max);
          s = 0;
        } else {
          return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
        }

        const payload = Buffer.alloc(13);
        payload.writeUInt8(0, 0); // reserved
        payload.writeUInt16LE(h & 0xffff, 1);
        payload.writeUInt16LE(s & 0xffff, 3);
        payload.writeUInt16LE(b & 0xffff, 5);
        payload.writeUInt16LE(k & 0xffff, 7);
        payload.writeUInt32LE(LIFX_TRANSITION_MS, 9);
        await this.send(device.address, meta.mac, MSG_LIGHT_SET_COLOR, payload);
      }
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  private async lightGet(address: string, mac: string): Promise<LightState> {
    const resp = await this.send(address, mac, MSG_LIGHT_GET, Buffer.alloc(0), MSG_LIGHT_STATE);
    return parseLightState(resp);
  }

  // Один сокет на запрос — ack/state приходит одним unicast'ом.
  private send(
    address: string,
    mac: string,
    type: number,
    payload: Buffer,
    expectType?: number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const [host, portStr] = address.includes(':')
        ? address.split(':')
        : [address, String(LIFX_PORT)];
      const port = Number(portStr);
      const sock = createSocket('udp4');
      const packet = buildPacket({
        source: this.source,
        target: mac,
        type,
        tagged: false,
        res_required: expectType !== undefined,
        payload,
      });
      let settled = false;
      const fail = (e: Error): void => {
        if (settled) return;
        settled = true;
        sock.close();
        reject(e);
      };
      const succeed = (b: Buffer): void => {
        if (settled) return;
        settled = true;
        sock.close();
        resolve(b);
      };
      sock.on('message', (msg) => {
        const h = parseHeader(msg);
        if (!h) return;
        if (expectType !== undefined && h.type !== expectType) return;
        succeed(msg);
      });
      sock.on('error', fail);
      sock.send(packet, 0, packet.length, port, host!, (e) => {
        if (e) fail(e);
        else if (expectType === undefined) succeed(Buffer.alloc(0));
      });
      setTimeout(() => fail(new Error('LIFX timeout')), LIFX_RPC_TIMEOUT_MS);
    });
  }
}

interface LightState {
  hue: number;
  saturation: number;
  brightness: number;
  kelvin: number;
  power: number;
  label: string;
}

function buildCaps(state: LightState | null): Capability[] {
  const isOn = state ? state.power > 0 : false;
  const pct = state ? Math.round((state.brightness / 65535) * 100) : 100;
  const sat = state ? state.saturation / 65535 : 1;
  const rgb = state
    ? hsvToRgbInt((state.hue / 65535) * 360, state.saturation / 65535, state.brightness / 65535)
    : 0xffffff;
  const k = state?.kelvin ?? 4000;

  return [
    capOnOff(isOn),
    capBrightness(Math.max(1, pct)),
    // Если saturation ~0 — лампа в white-mode.
    capColor(sat < 0.05 ? { kind: 'temperature_k', value: k } : { kind: 'rgb', value: rgb }, {
      rgb: true,
      temperatureK: LIFX_KELVIN,
    }),
  ];
}

interface ParsedHeader {
  size: number;
  source: number;
  target: string;
  type: number;
}

function parseHeader(buf: Buffer): ParsedHeader | null {
  if (buf.length < 36) return null;
  const size = buf.readUInt16LE(0);
  if (size > buf.length) return null;
  const source = buf.readUInt32LE(4);
  const target = buf.subarray(8, 14).toString('hex');
  const type = buf.readUInt16LE(32);
  return { size, source, target, type };
}

function buildPacket(opts: {
  source: number;
  target: string;
  type: number;
  tagged: boolean;
  res_required?: boolean;
  payload: Buffer;
}): Buffer {
  const headerSize = 36;
  const total = headerSize + opts.payload.length;
  const buf = Buffer.alloc(total);

  buf.writeUInt16LE(total, 0);

  // Frame: protocol(12 bits) = 1024, addressable=1, tagged, origin=0.
  let frame = 1024 & 0x0fff;
  frame |= 1 << 12; // addressable
  if (opts.tagged) frame |= 1 << 13;
  buf.writeUInt16LE(frame, 2);

  buf.writeUInt32LE(opts.source >>> 0, 4);

  const macHex = opts.target.replace(/:/g, '').toLowerCase().padStart(12, '0');
  for (let i = 0; i < 6; i++) {
    buf.writeUInt8(parseInt(macHex.substr(i * 2, 2), 16), 8 + i);
  }

  // Frame Address byte 22: res_required bit0, ack_required bit1.
  let flags = 0;
  if (opts.res_required) flags |= 0x01;
  buf.writeUInt8(flags, 22);
  buf.writeUInt8(0, 23); // sequence

  buf.writeUInt16LE(opts.type, 32);

  if (opts.payload.length) opts.payload.copy(buf, headerSize);
  return buf;
}

function parseLightState(buf: Buffer): LightState {
  const off = 36;
  return {
    hue: buf.readUInt16LE(off),
    saturation: buf.readUInt16LE(off + 2),
    brightness: buf.readUInt16LE(off + 4),
    kelvin: buf.readUInt16LE(off + 6),
    power: buf.readUInt16LE(off + 10),
    label: buf
      .subarray(off + 12, off + 12 + 32)
      .toString('utf8')
      .replace(/\0+$/, ''),
  };
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
