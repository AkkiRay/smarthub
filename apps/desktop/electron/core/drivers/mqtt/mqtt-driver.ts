// MQTT driver под Zigbee2MQTT-style retained topics + опциональный extraTopicPrefix
// для tasmota/ESPHome/HA. Тип устройства и capabilities выводятся из набора полей retained-payload.

import mqtt, { type MqttClient } from 'mqtt';
import log from 'electron-log/main.js';
import type {
  Capability,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceDriver,
  DeviceProperty,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';

interface MqttCreds {
  url: string;
  username?: string;
  password?: string;
  /** Дополнительный topic-prefix для не-Z2M (ESPHome / tasmota / HA discovery). */
  extraTopicPrefix?: string;
}

type StateMap = Record<string, unknown>;

export class MqttDriver implements DeviceDriver {
  readonly id = 'mqtt' as const;
  readonly displayName = 'MQTT (Zigbee2MQTT, ESPHome)';

  private client: MqttClient | null = null;
  private latestState = new Map<string, StateMap>();
  private connected = false;

  constructor(private creds: MqttCreds) {}

  private async connect(): Promise<MqttClient> {
    if (this.client && this.connected) return this.client;
    this.client = mqtt.connect(this.creds.url, {
      username: this.creds.username,
      password: this.creds.password,
      reconnectPeriod: 5000,
      connectTimeout: 5000,
    });
    return await new Promise((resolve, reject) => {
      this.client!.once('connect', () => {
        this.connected = true;
        log.info('MQTT connected');
        const subs = this.subscriptions();
        for (const sub of subs) {
          this.client!.subscribe(sub, { qos: 0 });
        }
        this.client!.on('message', (topic, payload) => {
          // Skip служебных topic-ов: bridge/availability/HA discovery config — не device-state.
          if (topic.includes('/bridge/') || topic.endsWith('/availability')) return;
          if (topic.endsWith('/config')) return;
          try {
            const text = payload.toString('utf8');
            // ESPHome/tasmota шлют raw строкой ON/OFF/число; Z2M — JSON.
            const obj: StateMap = text.startsWith('{')
              ? (JSON.parse(text) as StateMap)
              : { state: text };
            const prev = this.latestState.get(topic) ?? {};
            this.latestState.set(topic, { ...prev, ...obj });
          } catch {
            /* ignore non-json */
          }
        });
        resolve(this.client!);
      });
      this.client!.once('error', (err) => {
        this.connected = false;
        reject(err);
      });
    });
  }

  private subscriptions(): string[] {
    const subs = ['zigbee2mqtt/+', 'zigbee2mqtt/+/+'];
    const extra = this.creds.extraTopicPrefix?.trim();
    if (extra) {
      const cleaned = extra.replace(/\/+$/, '');
      subs.push(`${cleaned}/+`, `${cleaned}/+/+`, `${cleaned}/+/+/+`);
    }
    return subs;
  }

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    try {
      await this.connect();
    } catch (e) {
      log.warn(`MQTT connect failed: ${(e as Error).message}`);
      return [];
    }
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        const out: DiscoveredDevice[] = [];
        for (const [topic, state] of this.latestState.entries()) {
          if (topic.includes('/bridge/') || topic.endsWith('/availability')) continue;
          if (topic.endsWith('/set') || topic.endsWith('/get')) continue;
          const friendly = friendlyName(topic);
          const type = detectType(state);
          out.push({
            driver: 'mqtt' as const,
            externalId: topic,
            type,
            name: friendly,
            address: this.creds.url,
            meta: { topic, lastState: state },
          });
        }
        resolve(out);
      }, 1500);
      signal.addEventListener('abort', () => clearTimeout(timer));
    });
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const now = new Date().toISOString();
    const meta = candidate.meta as { topic: string; lastState?: StateMap };
    const lastState = meta.lastState ?? this.latestState.get(meta.topic) ?? {};
    const { capabilities, properties } = buildMqttCapsAndProps(candidate.type, lastState);
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'mqtt',
      type: candidate.type,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      status: 'online',
      meta: candidate.meta,
      capabilities,
      properties,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    const state = this.latestState.get(device.externalId) ?? {};
    const { capabilities, properties } = buildMqttCapsAndProps(device.type, state);
    return {
      ...device,
      status: this.connected ? 'online' : 'unreachable',
      lastSeenAt: new Date().toISOString(),
      // Если retained-state ещё не пришёл — fallback на старые caps, иначе ползунки в UI мигнут.
      capabilities: capabilities.length ? capabilities : device.capabilities,
      properties: properties.length ? properties : device.properties,
    };
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    try {
      const client = await this.connect();
      const setTopic = `${device.externalId}/set`;
      const payload = canonicalToMqttPayload(command);
      if (!payload) {
        return {
          deviceId: device.id,
          capability: command.capability,
          instance: command.instance,
          status: 'ERROR',
          errorCode: 'UNSUPPORTED_CAPABILITY',
        };
      }
      await new Promise<void>((resolve, reject) =>
        client.publish(setTopic, JSON.stringify(payload), { qos: 0 }, (err) =>
          err ? reject(err) : resolve(),
        ),
      );
      return {
        deviceId: device.id,
        capability: command.capability,
        instance: command.instance,
        status: 'DONE',
      };
    } catch (e) {
      return {
        deviceId: device.id,
        capability: command.capability,
        instance: command.instance,
        status: 'ERROR',
        errorCode: 'DEVICE_UNREACHABLE',
        errorMessage: (e as Error).message,
      };
    }
  }

  async shutdown() {
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    this.connected = false;
    this.latestState.clear();
  }
}

function friendlyName(topic: string): string {
  const parts = topic.split('/');
  const last = parts[parts.length - 1] ?? topic;
  return last;
}

function detectType(state: StateMap): DeviceType {
  if ('brightness' in state || 'color' in state || 'color_temp' in state) {
    return 'devices.types.light';
  }
  if (
    'temperature' in state ||
    'humidity' in state ||
    'battery' in state ||
    'occupancy' in state ||
    'contact' in state
  ) {
    return 'devices.types.sensor';
  }
  if ('state' in state) return 'devices.types.socket';
  return 'devices.types.other';
}

interface CapsAndProps {
  capabilities: Capability[];
  properties: DeviceProperty[];
}

function buildMqttCapsAndProps(type: DeviceType, state: StateMap): CapsAndProps {
  const caps: Capability[] = [];
  const props: DeviceProperty[] = [];

  // ---- on_off ---------------------------------------------------------------
  if (type !== 'devices.types.sensor' || 'state' in state) {
    const stateStr = String(state['state'] ?? '').toUpperCase();
    caps.push({
      type: 'devices.capabilities.on_off',
      retrievable: true,
      reportable: true,
      state: { instance: 'on', value: stateStr === 'ON' || state['state'] === true },
    });
  }

  // ---- light: brightness + color/temperature --------------------------------
  if (type === 'devices.types.light') {
    if ('brightness' in state) {
      const raw = Number(state['brightness']);
      const pct = Number.isFinite(raw)
        ? Math.max(1, Math.min(100, Math.round((raw / 254) * 100)))
        : 100;
      caps.push({
        type: 'devices.capabilities.range',
        retrievable: true,
        reportable: true,
        parameters: {
          instance: 'brightness',
          unit: 'unit.percent',
          range: { min: 1, max: 100, precision: 1 },
        },
        state: { instance: 'brightness', value: pct },
      });
    }
    const hasColor = 'color' in state;
    const hasTemp = 'color_temp' in state;
    if (hasColor || hasTemp) {
      const isTempMode = hasTemp && (state['color_mode'] === 'color_temp' || !hasColor);
      const ct = hasTemp ? miredToKelvin(Number(state['color_temp']) || 250) : 4000;
      const rgb = hasColor ? colorObjectToRgbInt(state['color']) : 0xffffff;
      caps.push({
        type: 'devices.capabilities.color_setting',
        retrievable: true,
        reportable: true,
        parameters: {
          color_model: 'rgb',
          ...(hasTemp ? { temperature_k: { min: 2200, max: 6500 } } : {}),
        },
        state: isTempMode
          ? { instance: 'temperature_k', value: ct }
          : { instance: 'rgb', value: rgb },
      });
    }
  }

  // ---- properties (sensor + утилиты у любого устройства) --------------------
  for (const [key, raw] of Object.entries(state)) {
    const meta = SENSOR_PROPERTY_MAP[key];
    if (!meta) continue;
    const num = Number(raw);
    if (!Number.isFinite(num)) continue;
    props.push({
      type: 'devices.properties.float',
      retrievable: true,
      reportable: true,
      parameters: { instance: meta.instance, ...(meta.unit ? { unit: meta.unit } : {}) },
      state: { instance: meta.instance, value: num },
    });
  }

  return { capabilities: caps, properties: props };
}

const SENSOR_PROPERTY_MAP: Record<string, { instance: string; unit?: string }> = {
  temperature: { instance: 'temperature', unit: 'unit.temperature.celsius' },
  humidity: { instance: 'humidity', unit: 'unit.percent' },
  battery: { instance: 'battery_level', unit: 'unit.percent' },
  illuminance: { instance: 'illumination' },
  illuminance_lux: { instance: 'illumination' },
  power: { instance: 'power', unit: 'unit.watt' },
  voltage: { instance: 'voltage' },
  current: { instance: 'amperage' },
  energy: { instance: 'energy' },
  pm25: { instance: 'pm2.5_density' },
  co2: { instance: 'co2_level' },
  linkquality: { instance: 'link_quality' },
};

function miredToKelvin(mired: number): number {
  if (!mired) return 4000;
  return Math.round(1_000_000 / mired);
}
function kelvinToMired(k: number): number {
  return Math.round(1_000_000 / Math.max(1500, Math.min(7000, k)));
}

function colorObjectToRgbInt(color: unknown): number {
  if (typeof color === 'string') {
    const m = color.match(/^#?([0-9a-f]{6})$/i);
    if (m && m[1]) return parseInt(m[1], 16);
  }
  if (color && typeof color === 'object') {
    const c = color as Record<string, unknown>;
    if ('hex' in c && typeof c['hex'] === 'string') {
      const m = c['hex'].match(/^#?([0-9a-f]{6})$/i);
      if (m && m[1]) return parseInt(m[1], 16);
    }
    if ('r' in c && 'g' in c && 'b' in c) {
      return (
        ((Number(c['r']) & 0xff) << 16) | ((Number(c['g']) & 0xff) << 8) | (Number(c['b']) & 0xff)
      );
    }
    if ('hue' in c && 'saturation' in c) {
      return hsvToRgbInt(Number(c['hue']) || 0, (Number(c['saturation']) || 0) / 100, 1);
    }
    if ('x' in c && 'y' in c) {
      return xyToRgbInt(Number(c['x']) || 0.3, Number(c['y']) || 0.3);
    }
  }
  return 0xffffff;
}

function rgbIntToTuple(rgb: number): [number, number, number] {
  return [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
}

function hsvToRgbInt(h: number, s: number, v: number): number {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return (
    (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255)
  );
}

// XY (CIE 1931) → sRGB. Hue/IKEA шлют XY вместо RGB.
function xyToRgbInt(x: number, y: number): number {
  const z = 1 - x - y;
  const Y = 1;
  const X = (Y / Math.max(y, 1e-6)) * x;
  const Z = (Y / Math.max(y, 1e-6)) * z;
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
  const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const max = Math.max(r, g, b, 1e-6);
  r = gamma(Math.max(0, r / max));
  g = gamma(Math.max(0, g / max));
  b = gamma(Math.max(0, b / max));
  const ri = Math.round(Math.max(0, Math.min(1, r)) * 255);
  const gi = Math.round(Math.max(0, Math.min(1, g)) * 255);
  const bi = Math.round(Math.max(0, Math.min(1, b)) * 255);
  return (ri << 16) | (gi << 8) | bi;
}

function canonicalToMqttPayload(command: DeviceCommand): Record<string, unknown> | null {
  if (command.capability === 'devices.capabilities.on_off') {
    return { state: command.value ? 'ON' : 'OFF' };
  }
  if (command.capability === 'devices.capabilities.range' && command.instance === 'brightness') {
    const pct = Math.max(1, Math.min(100, Number(command.value)));
    return { brightness: Math.round((pct / 100) * 254), state: 'ON' };
  }
  if (command.capability === 'devices.capabilities.color_setting' && command.instance === 'rgb') {
    const [r, g, b] = rgbIntToTuple(Number(command.value));
    return { color: { r, g, b }, state: 'ON' };
  }
  if (
    command.capability === 'devices.capabilities.color_setting' &&
    command.instance === 'temperature_k'
  ) {
    return { color_temp: kelvinToMired(Number(command.value)), state: 'ON' };
  }
  if (command.capability === 'devices.capabilities.mode') {
    return { [command.instance]: command.value };
  }
  return null;
}
