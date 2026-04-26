// Mi Home / miIO local: UDP 54321, бинарный header (32 байта) + AES-128-CBC encrypted JSON.
// Token (32 hex) — секрет устройства, добывается из Mi Home App / Mi Home мобильного бэкапа /
// XiaomiCloud-Tokens-Extractor. Без token шифрование сделать нельзя — поэтому драйвер требует
// явный список устройств с указанием token.
//
// Header layout:
//   [0..2)   magic 0x2131
//   [2..4)   length (uint16 BE) = total packet
//   [4..8)   reserved (zeros у регулярных пакетов)
//   [8..12)  device id (uint32 BE)
//   [12..16) stamp (sec since "epoch" device)
//   [16..32) MD5 checksum (с token-substituted block)
//   [32..]   AES-CBC encrypted JSON (key=MD5(token), iv=MD5(MD5(token)+token))

import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';
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
  capMode,
  capOnOff,
} from '@smarthome/shared';
import { BaseDriver } from '../_shared/base-driver.js';

const MIIO_PORT = 54321;
const MIIO_BROADCAST = '255.255.255.255';
const MIIO_DISCOVER_TIMEOUT_MS = 2000;
const MIIO_RPC_TIMEOUT_MS = 2500;
const MIIO_TRANSITION_MS = 400;
const MIIO_KELVIN: { min: number; max: number } = { min: 1700, max: 6500 };

const HELLO = Buffer.from(
  '21310020ffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'hex',
);

const MIIO_WORK_MODES = ['auto', 'silent', 'medium', 'high', 'favorite'] as const;

interface MiioDevice {
  did: number;
  token: string;
  model?: string;
  name?: string;
  ip?: string;
}

interface MiioMeta extends Record<string, unknown> {
  did: number;
  token: string;
  model: string;
  type: 'light' | 'socket' | 'sensor' | 'humidifier' | 'purifier' | 'vacuum' | 'fan' | 'other';
}

export class MiIODriver extends BaseDriver {
  readonly id = 'miio' as const;
  readonly displayName = 'Mi Home (Local)';

  private requestId = 1;

  constructor(private readonly devices: MiioDevice[]) {
    super();
  }

  async discover(_signal: AbortSignal): Promise<DiscoveredDevice[]> {
    // Discovery: HELLO broadcast → каждое miIO-устройство отвечает Hello-Reply (header без шифрования).
    // Но без token нельзя получить state — поэтому возвращаем только candidates с token из creds.
    const sock = createSocket({ type: 'udp4', reuseAddr: true });
    const seen = new Map<string, string>(); // did -> ip

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
        const out: DiscoveredDevice[] = [];
        for (const d of this.devices) {
          const ip = seen.get(String(d.did)) ?? d.ip;
          if (!ip) continue;
          const type = inferType(d.model ?? '');
          out.push({
            driver: 'miio',
            externalId: String(d.did),
            type: typeToDeviceType(type),
            name: d.name ?? d.model ?? `Mi device ${d.did}`,
            address: `${ip}:${MIIO_PORT}`,
            meta: { did: d.did, token: d.token, model: d.model ?? '', type } satisfies MiioMeta,
          });
        }
        resolve(out);
      };

      sock.on('message', (msg, rinfo) => {
        if (msg.length < 32 || msg.readUInt16BE(0) !== 0x2131) return;
        const did = msg.readUInt32BE(8);
        seen.set(String(did), rinfo.address);
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
        sock.send(HELLO, 0, HELLO.length, MIIO_PORT, MIIO_BROADCAST);
      });

      const timer = setTimeout(finish, MIIO_DISCOVER_TIMEOUT_MS);
      _signal.addEventListener('abort', () => {
        clearTimeout(timer);
        finish();
      });
    });
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta = candidate.meta as MiioMeta;
    const now = new Date().toISOString();
    const type = typeToDeviceType(meta.type);
    let initial: unknown[] = [];
    try {
      initial = await this.callForType(candidate.address, meta, 'get_prop');
    } catch {
      /* probe not blocking */
    }
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'miio',
      type,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      meta,
      status: 'online',
      capabilities: buildMiioCaps(meta, initial),
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    const meta = device.meta as MiioMeta;
    try {
      const result = await this.callForType(device.address, meta, 'get_prop');
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildMiioCaps(meta, result),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const meta = device.meta as MiioMeta;

    try {
      const action = canonicalToMiio(meta, command);
      if (!action) return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
      await this.call(device.address, meta, action.method, action.params);
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  private async callForType(address: string, meta: MiioMeta, _method: string): Promise<unknown[]> {
    const props = propsForType(meta.type);
    if (!props.length) return [];
    const r = await this.call<unknown[]>(address, meta, 'get_prop', props);
    return r;
  }

  // miIO call: cipher key=md5(token), iv=md5(key+token), AES-128-CBC.
  private async call<T = unknown>(
    address: string,
    meta: MiioMeta,
    method: string,
    params: unknown,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const [host, portStr] = address.includes(':')
        ? address.split(':')
        : [address, String(MIIO_PORT)];
      const port = Number(portStr);
      const sock = createSocket('udp4');
      const tokenBuf = Buffer.from(meta.token, 'hex');
      const key = createHash('md5').update(tokenBuf).digest();
      const iv = createHash('md5')
        .update(Buffer.concat([key, tokenBuf]))
        .digest();
      const id = this.requestId++ & 0x7fffffff || 1;
      const json = JSON.stringify({ id, method, params });
      const cipher = createCipheriv('aes-128-cbc', key, iv);
      const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);

      // Header (без checksum): magic + length + 0 + did + stamp.
      const hdr = Buffer.alloc(32);
      hdr.writeUInt16BE(0x2131, 0);
      hdr.writeUInt16BE(32 + enc.length, 2);
      hdr.writeUInt32BE(0, 4);
      hdr.writeUInt32BE(meta.did, 8);
      hdr.writeUInt32BE(Math.floor(Date.now() / 1000), 12);
      // Замена checksum-блока на token, потом MD5 от всего пакета → чексумма.
      tokenBuf.copy(hdr, 16);
      const tmp = Buffer.concat([hdr, enc]);
      const checksum = createHash('md5').update(tmp).digest();
      checksum.copy(hdr, 16);
      const packet = Buffer.concat([hdr, enc]);

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
        if (msg.length < 32) return;
        const enc2 = msg.subarray(32);
        if (!enc2.length) return;
        try {
          const dec = createDecipheriv('aes-128-cbc', key, iv);
          const text = Buffer.concat([dec.update(enc2), dec.final()]).toString('utf8');
          const obj = JSON.parse(text) as { id: number; result?: T; error?: { message: string } };
          if (obj.id !== id) return;
          if (obj.error) fail(new Error(obj.error.message));
          else succeed((obj.result ?? []) as T);
        } catch (e) {
          fail(e as Error);
        }
      });
      sock.on('error', fail);
      sock.send(packet, 0, packet.length, port, host!, (e) => {
        if (e) fail(e);
      });
      setTimeout(() => fail(new Error('miIO timeout')), MIIO_RPC_TIMEOUT_MS);
    });
  }
}

function inferType(model: string): MiioMeta['type'] {
  const m = model.toLowerCase();
  if (m.includes('vacuum') || m.includes('roborock')) return 'vacuum';
  if (m.includes('humidifier')) return 'humidifier';
  if (m.includes('airpurifier') || m.includes('purifier')) return 'purifier';
  if (m.includes('fan')) return 'fan';
  if (m.includes('plug')) return 'socket';
  if (m.includes('light') || m.includes('bulb') || m.includes('lamp') || m.includes('yeelink')) {
    return 'light';
  }
  if (m.includes('sensor') || m.includes('aqara')) return 'sensor';
  return 'other';
}

function typeToDeviceType(t: MiioMeta['type']): DeviceType {
  switch (t) {
    case 'light':
      return DEVICE_TYPE.LIGHT;
    case 'socket':
      return DEVICE_TYPE.SOCKET;
    case 'sensor':
      return DEVICE_TYPE.SENSOR;
    case 'humidifier':
      return DEVICE_TYPE.HUMIDIFIER;
    case 'purifier':
      return DEVICE_TYPE.PURIFIER;
    case 'vacuum':
      return DEVICE_TYPE.VACUUM;
    case 'fan':
      return DEVICE_TYPE.FAN;
    default:
      return DEVICE_TYPE.OTHER;
  }
}

function propsForType(t: MiioMeta['type']): string[] {
  switch (t) {
    case 'light':
      return ['power', 'bright', 'rgb', 'ct'];
    case 'socket':
      return ['power'];
    case 'humidifier':
      return ['power', 'mode', 'humidity', 'temp_dec'];
    case 'purifier':
      return ['power', 'mode', 'aqi', 'humidity', 'temp_dec'];
    case 'vacuum':
      return ['state', 'battery', 'fan_power'];
    case 'fan':
      return ['power', 'natural_level'];
    default:
      return ['power'];
  }
}

function buildMiioCaps(meta: MiioMeta, props: unknown[]): Capability[] {
  const caps: Capability[] = [];
  const arr = Array.isArray(props) ? props : [];

  if (meta.type === 'light') {
    const [power, bright, rgb, ct] = arr as [string, number, number, number];
    caps.push(capOnOff(power === 'on'));
    caps.push(capBrightness(bright || 100));
    caps.push(
      capColor(
        ct ? { kind: 'temperature_k', value: ct } : { kind: 'rgb', value: rgb || 0xffffff },
        { rgb: true, temperatureK: MIIO_KELVIN },
      ),
    );
  } else if (meta.type === 'socket') {
    const [power] = arr as [string];
    caps.push(capOnOff(power === 'on'));
  } else if (meta.type === 'humidifier' || meta.type === 'purifier' || meta.type === 'fan') {
    const [power, mode] = arr as [string, string];
    caps.push(capOnOff(power === 'on'));
    if (typeof mode === 'string') {
      caps.push(capMode('work_mode', MIIO_WORK_MODES, mode));
    }
  } else if (meta.type === 'vacuum') {
    const [state, battery] = arr as [number, number];
    caps.push(capOnOff(state === 5 || state === 17 || state === 11));
    void battery;
  }
  return caps;
}

function canonicalToMiio(
  meta: MiioMeta,
  command: DeviceCommand,
): { method: string; params: unknown[] } | null {
  if (meta.type === 'light') {
    if (command.capability === CAPABILITY.ON_OFF) {
      return {
        method: 'set_power',
        params: [command.value ? 'on' : 'off', 'smooth', MIIO_TRANSITION_MS],
      };
    }
    if (command.capability === CAPABILITY.RANGE && command.instance === INSTANCE.BRIGHTNESS) {
      return {
        method: 'set_bright',
        params: [clamp(Number(command.value), RANGE.PERCENT.min, RANGE.PERCENT.max)],
      };
    }
    if (command.capability === CAPABILITY.COLOR_SETTING && command.instance === INSTANCE.RGB) {
      return { method: 'set_rgb', params: [Number(command.value)] };
    }
    if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.TEMPERATURE_K
    ) {
      return {
        method: 'set_ct_abx',
        params: [clamp(Number(command.value), MIIO_KELVIN.min, MIIO_KELVIN.max)],
      };
    }
  }
  if (meta.type === 'socket' && command.capability === CAPABILITY.ON_OFF) {
    return { method: 'set_power', params: [command.value ? 'on' : 'off'] };
  }
  if (
    (meta.type === 'humidifier' || meta.type === 'purifier' || meta.type === 'fan') &&
    command.capability === CAPABILITY.ON_OFF
  ) {
    return { method: 'set_power', params: [command.value ? 'on' : 'off'] };
  }
  if (meta.type === 'vacuum' && command.capability === CAPABILITY.ON_OFF) {
    return { method: command.value ? 'app_start' : 'app_pause', params: [] };
  }
  return null;
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
