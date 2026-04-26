/**
 * @fileoverview TP-Link Kasa LAN driver (HS100/HS103/HS105/HS110/HS200/HS220/
 * KL-серия). Local TCP/UDP `:9999`, autoencrypt (running XOR со starting key
 * `0xAB`). Discovery: UDP-broadcast `system.get_sysinfo`. Control: TCP `:9999`
 * с 4-byte big-endian length prefix перед encrypted payload.
 *
 * Tapo (P100/P110/L530/L630) использует KLAP-протокол — отдельный driver.
 */

import { Socket } from 'node:net';
import { broadcastDiscover } from '../_shared/udp-broadcast.js';
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
import { hsvToRgbInt, rgbIntToHsv } from '../_shared/color.js';
import { BaseDriver } from '../_shared/base-driver.js';

const KASA_PORT = 9999;
const KASA_DISCOVER_TIMEOUT_MS = 2500;
const KASA_TCP_TIMEOUT_MS = 2500;
const KASA_TRANSITION_MS = 400;
const KASA_KELVIN: { min: number; max: number } = { min: 2500, max: 6500 };

interface KasaSysInfo {
  alias?: string;
  dev_name?: string;
  model?: string;
  mic_type?: string;
  type?: string;
  deviceId?: string;
  hwId?: string;
  mac?: string;
  relay_state?: number;
  on_off?: number;
  brightness?: number;
  hue?: number;
  saturation?: number;
  color_temp?: number;
  is_color?: number;
  is_dimmable?: number;
  is_variable_color_temp?: number;
}

interface KasaResponse {
  system?: { get_sysinfo?: KasaSysInfo };
  'smartlife.iot.smartbulb.lightingservice'?: {
    get_light_state?: KasaSysInfo;
    transition_light_state?: KasaSysInfo;
  };
}

interface KasaMeta extends Record<string, unknown> {
  model: string;
  isBulb: boolean;
  isColor: boolean;
  isVariableTemp: boolean;
  isDimmable: boolean;
}

export class TPLinkKasaDriver extends BaseDriver {
  readonly id = 'tplink-kasa' as const;
  readonly displayName = 'TP-Link Kasa';

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    const found = new Map<string, DiscoveredDevice>();
    const probe = encrypt(JSON.stringify({ system: { get_sysinfo: {} } }));
    await broadcastDiscover({
      driverId: 'tplink-kasa',
      port: KASA_PORT,
      payload: probe,
      timeoutMs: KASA_DISCOVER_TIMEOUT_MS,
      signal,
      onMessage: (msg, rinfo) => {
        try {
          const obj = JSON.parse(decrypt(msg)) as KasaResponse;
          const info = obj.system?.get_sysinfo;
          if (!info) return;
          const id = info.deviceId ?? info.mac ?? rinfo.address;
          const isBulb = Boolean(
            info.is_color || info.is_variable_color_temp || info.mic_type?.includes('BULB'),
          );
          const type: DeviceType = isBulb
            ? DEVICE_TYPE.LIGHT
            : info.model?.startsWith('HS22') ||
                info.model?.includes('SW') ||
                info.type === 'IOT.SMARTSWITCH'
              ? DEVICE_TYPE.SWITCH
              : DEVICE_TYPE.SOCKET;
          found.set(id, {
            driver: 'tplink-kasa',
            externalId: id,
            type,
            name: info.alias ?? info.dev_name ?? info.model ?? 'Kasa device',
            address: `${rinfo.address}:${KASA_PORT}`,
            meta: {
              model: info.model ?? '',
              isBulb,
              isColor: Boolean(info.is_color),
              isVariableTemp: Boolean(info.is_variable_color_temp),
              isDimmable: Boolean(info.is_dimmable) || isBulb,
              sysinfo: info,
            },
          });
        } catch {
          /* ignore non-kasa traffic */
        }
      },
    });
    return Array.from(found.values());
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const meta =
      (candidate.meta as KasaMeta & { sysinfo?: KasaSysInfo }) ?? ({ isBulb: false } as KasaMeta);
    const sys = (meta as { sysinfo?: KasaSysInfo }).sysinfo;
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'tplink-kasa',
      type: candidate.type,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      meta,
      status: 'online',
      capabilities: buildKasaCaps(candidate.type, meta, sys ?? {}),
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const resp = await this.tcpRequest(
        device.address,
        device.type === DEVICE_TYPE.LIGHT
          ? { 'smartlife.iot.smartbulb.lightingservice': { get_light_state: {} } }
          : { system: { get_sysinfo: {} } },
      );
      const ls = resp['smartlife.iot.smartbulb.lightingservice']?.get_light_state;
      const sys = resp.system?.get_sysinfo;
      const merged = { ...(sys ?? {}), ...(ls ?? {}) };
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildKasaCaps(device.type, device.meta as KasaMeta, merged),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const meta = device.meta as KasaMeta;
    const isBulb = device.type === DEVICE_TYPE.LIGHT;

    try {
      if (command.capability === CAPABILITY.ON_OFF) {
        if (isBulb) {
          await this.tcpRequest(device.address, {
            'smartlife.iot.smartbulb.lightingservice': {
              transition_light_state: {
                on_off: command.value ? 1 : 0,
                transition_period: KASA_TRANSITION_MS,
              },
            },
          });
        } else {
          await this.tcpRequest(device.address, {
            system: { set_relay_state: { state: command.value ? 1 : 0 } },
          });
        }
      } else if (
        isBulb &&
        command.capability === CAPABILITY.RANGE &&
        command.instance === INSTANCE.BRIGHTNESS
      ) {
        const v = clamp(Math.round(Number(command.value)), RANGE.PERCENT.min, RANGE.PERCENT.max);
        await this.tcpRequest(device.address, {
          'smartlife.iot.smartbulb.lightingservice': {
            transition_light_state: {
              on_off: 1,
              brightness: v,
              transition_period: KASA_TRANSITION_MS,
            },
          },
        });
      } else if (
        isBulb &&
        meta.isColor &&
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.RGB
      ) {
        const hsv = rgbIntToHsv(Number(command.value));
        await this.tcpRequest(device.address, {
          'smartlife.iot.smartbulb.lightingservice': {
            transition_light_state: {
              on_off: 1,
              hue: Math.round(hsv.h),
              saturation: Math.round(hsv.s * 100),
              brightness: Math.max(1, Math.round(hsv.v * 100)),
              color_temp: 0,
              transition_period: KASA_TRANSITION_MS,
            },
          },
        });
      } else if (
        isBulb &&
        meta.isVariableTemp &&
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.TEMPERATURE_K
      ) {
        const k = clamp(Number(command.value), KASA_KELVIN.min, KASA_KELVIN.max);
        await this.tcpRequest(device.address, {
          'smartlife.iot.smartbulb.lightingservice': {
            transition_light_state: {
              on_off: 1,
              color_temp: k,
              transition_period: KASA_TRANSITION_MS,
            },
          },
        });
      } else {
        return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
      }
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  private tcpRequest(address: string, payload: unknown): Promise<KasaResponse> {
    return new Promise((resolve, reject) => {
      const [host, portStr] = address.includes(':')
        ? address.split(':')
        : [address, String(KASA_PORT)];
      const port = Number(portStr);
      const sock = new Socket();
      const data = encryptWithLength(JSON.stringify(payload));
      let buf = Buffer.alloc(0);
      let settled = false;
      const fail = (e: Error): void => {
        if (settled) return;
        settled = true;
        sock.destroy();
        reject(e);
      };
      sock.setTimeout(KASA_TCP_TIMEOUT_MS);
      sock.on('timeout', () => fail(new Error('Kasa timeout')));
      sock.on('error', fail);
      sock.connect(port, host!, () => sock.write(data));
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length < 4) return;
        const len = buf.readUInt32BE(0);
        if (buf.length >= 4 + len) {
          try {
            const decoded = decrypt(buf.subarray(4, 4 + len));
            settled = true;
            sock.end();
            resolve(JSON.parse(decoded) as KasaResponse);
          } catch (e) {
            fail(e as Error);
          }
        }
      });
    });
  }
}

function buildKasaCaps(type: DeviceType, meta: KasaMeta, sys: KasaSysInfo): Capability[] {
  const isOn = (sys.relay_state ?? sys.on_off ?? 0) === 1;
  const caps: Capability[] = [capOnOff(isOn)];
  if (type !== DEVICE_TYPE.LIGHT) return caps;

  if (meta.isDimmable) {
    caps.push(capBrightness(Math.max(1, sys.brightness ?? 100)));
  }

  if (meta.isColor || meta.isVariableTemp) {
    const k = sys.color_temp && sys.color_temp > 0 ? sys.color_temp : 4000;
    const rgb = meta.isColor
      ? hsvToRgbInt(
          sys.hue ?? 0,
          (sys.saturation ?? 0) / 100,
          Math.max(0.01, (sys.brightness ?? 100) / 100),
        )
      : 0xffffff;
    const isTempMode = Boolean(sys.color_temp && sys.color_temp > 0 && meta.isVariableTemp);
    caps.push(
      capColor(isTempMode ? { kind: 'temperature_k', value: k } : { kind: 'rgb', value: rgb }, {
        rgb: meta.isColor,
        temperatureK: meta.isVariableTemp ? KASA_KELVIN : undefined,
      }),
    );
  }
  return caps;
}

/** Kasa autoencrypt: running XOR с initial key `0xAB`, ключом следующего байта становится текущий ciphertext-байт. */
function encrypt(text: string): Buffer {
  const buf = Buffer.from(text, 'utf8');
  let key = 0xab;
  for (let i = 0; i < buf.length; i++) {
    key = key ^ buf[i]!;
    buf[i] = key;
  }
  return buf;
}
/** Обратная операция к {@link encrypt}: ключом следующего байта становится текущий ciphertext-байт. */
function decrypt(buf: Buffer): string {
  const out = Buffer.alloc(buf.length);
  let key = 0xab;
  for (let i = 0; i < buf.length; i++) {
    out[i] = key ^ buf[i]!;
    key = buf[i]!;
  }
  return out.toString('utf8');
}
/** Encrypt + 4-byte big-endian length prefix (TCP framing для Kasa). */
function encryptWithLength(text: string): Buffer {
  const enc = encrypt(text);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(enc.length, 0);
  return Buffer.concat([len, enc]);
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
