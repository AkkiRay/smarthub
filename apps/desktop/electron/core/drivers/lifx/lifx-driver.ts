/**
 * @fileoverview LIFX LAN driver. UDP `:56700`, binary header (36 байт) + payload.
 * Discovery: broadcast `GetService` (msg=2) → ответ `StateService` (msg=3) с MAC
 * и UDP-портом. Цвет/яркость: `Light::Get` (101) → `State` (107).
 *
 * Frame layout (little-endian):
 *   [0..2)   size (uint16)
 *   [2..4)   protocol(12) | addressable(1) | tagged(1) | origin(2)
 *   [4..8)   source (uint32, эхо в ответе)
 *   [8..16)  target MAC (6 bytes + 2 padding)
 *   [16..22) reserved
 *   [22..23) res_required(1) | ack_required(1) | reserved(6)
 *   [23..24) sequence
 *   [24..32) reserved
 *   [32..34) message type
 *   [34..36) reserved
 */

import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
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
import { broadcastDiscover } from '../_shared/udp-broadcast.js';

const LIFX_PORT = 56700;
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
  // Криптостойкий source — Math.random() мог давать collision у двух хабов в одной LAN
  // (одинаковый seed → одинаковый source → ответы перепутаются).
  private readonly source = randomBytes(4).readUInt32BE(0);
  private sequence = 0;

  /** Монотонный 8-битный sequence (LIFX header byte 23). */
  private nextSequence(): number {
    this.sequence = (this.sequence + 1) & 0xff;
    if (this.sequence === 0) this.sequence = 1;
    return this.sequence;
  }

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    // GetService — header без payload, tagged=true для broadcast по всем устройствам.
    const probe = buildPacket({
      source: this.source,
      target: '000000000000',
      type: MSG_GET_SERVICE,
      tagged: true,
      payload: Buffer.alloc(0),
    });
    const found = new Map<string, DiscoveredDevice>();
    await broadcastDiscover({
      driverId: 'lifx',
      port: LIFX_PORT,
      payload: probe,
      timeoutMs: LIFX_DISCOVER_TIMEOUT_MS,
      signal,
      onMessage: (msg, rinfo) => {
        const parsed = parseHeader(msg);
        if (!parsed || parsed.type !== MSG_STATE_SERVICE) return;
        if (msg.length < 41) return;
        const service = msg.readUInt8(36);
        const port = msg.readUInt32LE(37);
        if (service !== 1) return; // service=1 → UDP transport
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
      },
    });
    return Array.from(found.values());
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as LifxMeta;
    const now = new Date().toISOString();

    let state: LightState | null = null;
    try {
      state = await this.lightGet(candidate.address, meta.mac);
    } catch {
      /* probe валиден без initial state, caps собираются с дефолтами */
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
        // SetColor требует hue/saturation/brightness/kelvin одновременно — читаем текущий state и патчим.
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

  /** Отправляет один LIFX-пакет unicast'ом и опционально ждёт response типа `expectType`. */
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
      const sequence = this.nextSequence();
      const packet = buildPacket({
        source: this.source,
        sequence,
        target: mac,
        type,
        tagged: false,
        res_required: expectType !== undefined,
        payload,
      });
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      const fail = (e: Error): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        sock.close();
        reject(e);
      };
      const succeed = (b: Buffer): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        sock.close();
        resolve(b);
      };
      sock.on('message', (msg) => {
        const h = parseHeader(msg);
        if (!h) return;
        // Strict correlation: чужой LIFX в LAN тоже шлёт STATE-пакеты,
        // принимаем ТОЛЬКО тот ответ, что эхом нашего source+sequence.
        if (h.source !== this.source) return;
        if (h.sequence !== sequence) return;
        if (expectType !== undefined && h.type !== expectType) return;
        succeed(msg);
      });
      sock.on('error', fail);
      sock.send(packet, 0, packet.length, port, host!, (e) => {
        if (e) fail(e);
        else if (expectType === undefined) succeed(Buffer.alloc(0));
      });
      timer = setTimeout(() => fail(new Error('LIFX timeout')), LIFX_RPC_TIMEOUT_MS);
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
    // saturation < 0.05 трактуется как white-mode → state читается из temperature_k вместо rgb.
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
  sequence: number;
  type: number;
}

function parseHeader(buf: Buffer): ParsedHeader | null {
  if (buf.length < 36) return null;
  const size = buf.readUInt16LE(0);
  if (size > buf.length) return null;
  const source = buf.readUInt32LE(4);
  const target = buf.subarray(8, 14).toString('hex');
  const sequence = buf.readUInt8(23);
  const type = buf.readUInt16LE(32);
  return { size, source, target, sequence, type };
}

function buildPacket(opts: {
  source: number;
  sequence?: number;
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
  buf.writeUInt8((opts.sequence ?? 0) & 0xff, 23);

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
    // Label — fixed 32-byte UTF-8 поле, padded null'ами. Cut'аем по ПЕРВОМУ null
    // (а не только trailing), иначе при reuse'е буфера старое имя «затекает»
    // в конец нового, на смене name через app получаем «New\x00Old».
    label: cutAtFirstNull(buf.subarray(off + 12, off + 12 + 32)).toString('utf8'),
  };
}

function cutAtFirstNull(b: Buffer): Buffer {
  const idx = b.indexOf(0);
  return idx === -1 ? b : b.subarray(0, idx);
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
