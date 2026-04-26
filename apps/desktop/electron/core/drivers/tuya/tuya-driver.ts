/**
 * @fileoverview Tuya Cloud driver. Подпись v1.0 BUSINESS:
 * `sign = HMAC-SHA256(clientId + accessToken + t + nonce + stringToSign)`.
 * Body SHA-256 считается всегда, включая пустое body (`sha256("")`); пропуск
 * приводит к `sign invalid` на POST-командах.
 */

import axios, { type AxiosInstance } from 'axios';
import { createHash, createHmac } from 'node:crypto';
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

interface TuyaCreds {
  apiKey: string;
  apiSecret: string;
  region?: string; // 'eu' | 'us' | 'cn' | 'in'
  uid?: string;
}

interface TuyaToken {
  access_token: string;
  refresh_token: string;
  expire_time: number;
  obtainedAt: number;
}

interface TuyaStatusItem {
  code: string;
  value: unknown;
}

export class TuyaDriver implements DeviceDriver {
  readonly id = 'tuya' as const;
  readonly displayName = 'Tuya / Smart Life';

  private readonly http: AxiosInstance;
  private token: TuyaToken | null = null;

  constructor(private creds: TuyaCreds) {
    const region = creds.region ?? 'eu';
    this.http = axios.create({
      baseURL: `https://openapi.tuya${region}.com`,
      timeout: 6000,
    });
  }

  async discover(_signal: AbortSignal): Promise<DiscoveredDevice[]> {
    if (!this.creds.uid) return [];
    try {
      const data = await this.signedRequest<{
        result: Array<{
          id: string;
          name: string;
          ip: string;
          category: string;
          product_name: string;
          online: boolean;
          status?: TuyaStatusItem[];
        }>;
      }>('GET', `/v1.0/users/${this.creds.uid}/devices`);
      return data.result.map((d) => ({
        driver: 'tuya' as const,
        externalId: d.id,
        type: mapCategory(d.category),
        name: d.name,
        address: d.ip || 'cloud',
        meta: {
          category: d.category,
          product: d.product_name,
          online: d.online,
          lastStatus: d.status ?? [],
        },
      }));
    } catch (e) {
      log.warn(`Tuya discovery failed: ${(e as Error).message}`);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const now = new Date().toISOString();
    const meta = candidate.meta as {
      category?: string;
      lastStatus?: TuyaStatusItem[];
    };
    const status = meta.lastStatus ?? [];
    const { capabilities, properties } = buildCapsAndProps(candidate.type, status);
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'tuya',
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
    try {
      const data = await this.signedRequest<{
        result: TuyaStatusItem[];
      }>('GET', `/v1.0/devices/${device.externalId}/status`);
      const status = data.result ?? [];
      const { capabilities, properties } = buildCapsAndProps(device.type, status, {
        prevCaps: device.capabilities,
        prevProps: device.properties,
      });
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities,
        properties,
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const errOf = (code: string, message?: string): DeviceCommandResult => ({
      deviceId: device.id,
      capability: command.capability,
      instance: command.instance,
      status: 'ERROR',
      errorCode: code,
      errorMessage: message,
    });

    const tuyaCmd = canonicalToTuya(device, command);
    if (!tuyaCmd) return errOf('UNSUPPORTED_CAPABILITY');

    try {
      await this.signedRequest('POST', `/v1.0/devices/${device.externalId}/commands`, {
        commands: [tuyaCmd],
      });
      return {
        deviceId: device.id,
        capability: command.capability,
        instance: command.instance,
        status: 'DONE',
      };
    } catch (e) {
      return errOf('DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  async shutdown() {
    this.token = null;
  }

  private async ensureToken(): Promise<TuyaToken> {
    if (this.token && this.token.obtainedAt + this.token.expire_time * 1000 - 60_000 > Date.now()) {
      return this.token;
    }
    const t = Date.now();
    const path = '/v1.0/token?grant_type=1';
    // Token endpoint: signStr БЕЗ access_token, body — пустая строка.
    const bodyHash = sha256Hex('');
    const stringToSign = ['GET', bodyHash, '', path].join('\n');
    const nonce = '';
    const sign = hmacUpper(this.creds.apiKey + t + nonce + stringToSign, this.creds.apiSecret);
    const { data } = await this.http.get<{
      result: Omit<TuyaToken, 'obtainedAt'>;
      success?: boolean;
      msg?: string;
    }>(path, {
      headers: {
        client_id: this.creds.apiKey,
        sign,
        t: String(t),
        nonce,
        sign_method: 'HMAC-SHA256',
      },
    });
    if (!data.result?.access_token) {
      throw new Error(data.msg ?? 'Tuya token request failed');
    }
    this.token = { ...data.result, obtainedAt: Date.now() };
    return this.token;
  }

  private async signedRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const token = await this.ensureToken();
    const t = Date.now();
    const nonce = '';
    const bodyString = body === undefined ? '' : JSON.stringify(body);
    const bodyHash = sha256Hex(bodyString);
    const stringToSign = [method, bodyHash, '', path].join('\n');
    const sign = hmacUpper(
      this.creds.apiKey + token.access_token + t + nonce + stringToSign,
      this.creds.apiSecret,
    );
    const { data } = await this.http.request<T & { success?: boolean; msg?: string }>({
      method,
      url: path,
      data: body,
      headers: {
        client_id: this.creds.apiKey,
        access_token: token.access_token,
        sign,
        t: String(t),
        nonce,
        sign_method: 'HMAC-SHA256',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (data.success === false) {
      throw new Error(data.msg ?? 'Tuya API error');
    }
    return data;
  }
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function hmacUpper(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex').toUpperCase();
}

function mapCategory(category: string): DeviceType {
  // https://developer.tuya.com/en/docs/iot/standarddescription
  const lights = new Set(['dj', 'dd', 'fwd', 'tgq', 'xdd', 'dc', 'tgkg', 'gyd']);
  const sockets = new Set(['cz', 'pc']);
  const switches = new Set(['kg', 'tdq']);
  const thermostats = new Set(['wk', 'qn']);
  const sensors = new Set([
    'wsdcg',
    'ldcg',
    'mcs',
    'pir',
    'cobj',
    'co2bj',
    'sj',
    'rqbj',
    'ywbj',
    'ckmkzq',
    'pm25',
    'sgbj',
    'hps',
  ]);
  const vacuums = new Set(['sd']);
  const purifiers = new Set(['kj']);
  const humidifiers = new Set(['jsq']);
  if (lights.has(category)) return 'devices.types.light';
  if (sockets.has(category)) return 'devices.types.socket';
  if (switches.has(category)) return 'devices.types.switch';
  if (thermostats.has(category)) return 'devices.types.thermostat';
  if (sensors.has(category)) return 'devices.types.sensor';
  if (vacuums.has(category)) return 'devices.types.vacuum_cleaner';
  if (purifiers.has(category)) return 'devices.types.purifier';
  if (humidifiers.has(category)) return 'devices.types.humidifier';
  return 'devices.types.other';
}

const ON_CODES = ['switch_led', 'switch_1', 'switch'];
const BRIGHT_CODES = ['bright_value_v2', 'bright_value'];
const TEMP_CODES = ['temp_value_v2', 'temp_value'];
const COLOUR_CODES = ['colour_data_v2', 'colour_data'];
const WORK_MODE_CODES = ['work_mode'];
const THERMOSTAT_MODE_CODES = ['mode'];
const TEMP_SET_CODES = ['temp_set'];

interface CapsAndProps {
  capabilities: Capability[];
  properties: DeviceProperty[];
}

interface BuildOpts {
  prevCaps?: Capability[];
  prevProps?: DeviceProperty[];
}

function findStatus(items: TuyaStatusItem[], codes: string[]): TuyaStatusItem | undefined {
  for (const code of codes) {
    const found = items.find((s) => s.code === code);
    if (found) return found;
  }
  return undefined;
}

function buildCapsAndProps(
  type: DeviceType,
  status: TuyaStatusItem[],
  opts: BuildOpts = {},
): CapsAndProps {
  const capabilities: Capability[] = [];
  const properties: DeviceProperty[] = [];

  const onItem = findStatus(status, ON_CODES);
  const brightItem = findStatus(status, BRIGHT_CODES);
  const tempItem = findStatus(status, TEMP_CODES);
  const colourItem = findStatus(status, COLOUR_CODES);
  const workModeItem = findStatus(status, WORK_MODE_CODES);
  const thermostatModeItem = findStatus(status, THERMOSTAT_MODE_CODES);
  const tempSetItem = findStatus(status, TEMP_SET_CODES);

  // ---- on_off (всегда, кроме чистых датчиков без switch) ---------------------
  if (type !== 'devices.types.sensor' || onItem) {
    capabilities.push({
      type: 'devices.capabilities.on_off',
      retrievable: true,
      reportable: true,
      state: { instance: 'on', value: Boolean(onItem?.value) },
    });
  }

  // ---- light: brightness + color + temperature -------------------------------
  if (type === 'devices.types.light') {
    if (brightItem) {
      capabilities.push({
        type: 'devices.capabilities.range',
        retrievable: true,
        reportable: true,
        parameters: {
          instance: 'brightness',
          unit: 'unit.percent',
          range: { min: 1, max: 100, precision: 1 },
        },
        state: {
          instance: 'brightness',
          value: tuyaBrightToPercent(Number(brightItem.value) || 0),
        },
      });
    }
    if (colourItem || tempItem) {
      const isTemperatureMode = workModeItem?.value === 'white';
      const rgbValue = colourItem ? tuyaColourToRgbInt(colourItem.value) : 0xffffff;
      const ctValue = tempItem ? tuyaTempToKelvin(Number(tempItem.value) || 0) : 4000;
      capabilities.push({
        type: 'devices.capabilities.color_setting',
        retrievable: true,
        reportable: true,
        parameters: {
          color_model: 'rgb',
          ...(tempItem ? { temperature_k: { min: 2700, max: 6500 } } : {}),
        },
        state:
          isTemperatureMode && tempItem
            ? { instance: 'temperature_k', value: ctValue }
            : { instance: 'rgb', value: rgbValue },
      });
    }
  }

  // ---- thermostat: range temp_set + mode -------------------------------------
  if (type === 'devices.types.thermostat') {
    if (tempSetItem) {
      capabilities.push({
        type: 'devices.capabilities.range',
        retrievable: true,
        reportable: true,
        parameters: {
          instance: 'temperature',
          unit: 'unit.temperature.celsius',
          range: { min: 5, max: 35, precision: 1 },
        },
        state: { instance: 'temperature', value: Number(tempSetItem.value) || 22 },
      });
    }
    if (thermostatModeItem) {
      capabilities.push({
        type: 'devices.capabilities.mode',
        retrievable: true,
        reportable: true,
        parameters: {
          instance: 'thermostat',
          modes: [
            { value: 'auto' },
            { value: 'heat' },
            { value: 'cool' },
            { value: 'eco' },
            { value: 'off' },
          ],
        },
        state: { instance: 'thermostat', value: String(thermostatModeItem.value ?? 'auto') },
      });
    }
  }

  // ---- properties: всё, что приходит как float-измерение ---------------------
  for (const item of status) {
    const prop = tuyaStatusToProperty(item);
    if (prop) properties.push(prop);
  }

  // Partial status-read: fallback на prevCaps / prevProps для сохранения capabilities.
  if (!capabilities.length && opts.prevCaps?.length) {
    return {
      capabilities: opts.prevCaps,
      properties: properties.length ? properties : (opts.prevProps ?? []),
    };
  }
  return { capabilities, properties };
}

// Tuya brightness 10..1000 ↔ 1..100%.
function tuyaBrightToPercent(v: number): number {
  if (v <= 0) return 1;
  const pct = Math.round((v / 1000) * 100);
  return Math.max(1, Math.min(100, pct));
}
function percentToTuyaBright(p: number): number {
  const v = Math.round((Math.max(1, Math.min(100, p)) / 100) * 1000);
  return Math.max(10, v);
}
// Tuya temp 0..1000 ↔ 2700..6500K (linear).
function tuyaTempToKelvin(v: number): number {
  const k = 2700 + (Math.max(0, Math.min(1000, v)) / 1000) * (6500 - 2700);
  return Math.round(k);
}
function kelvinToTuyaTemp(k: number): number {
  const clamped = Math.max(2700, Math.min(6500, k));
  return Math.round(((clamped - 2700) / (6500 - 2700)) * 1000);
}
// Tuya colour_data_v2: {h: 0..360, s: 0..1000, v: 0..1000}.
function tuyaColourToRgbInt(value: unknown): number {
  let parsed: { h?: number; s?: number; v?: number } = {};
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as typeof parsed;
    } catch {
      /* ignore */
    }
  } else if (value && typeof value === 'object') {
    parsed = value as typeof parsed;
  }
  const h = Number(parsed.h ?? 0);
  const s = Number(parsed.s ?? 1000) / 1000;
  const v = Number(parsed.v ?? 1000) / 1000;
  return hsvToRgbInt(h, s, v);
}
function rgbIntToTuyaColour(rgb: number): { h: number; s: number; v: number } {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round((h * 60 + 360) % 360);
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s: Math.round(s * 1000), v: Math.round(v * 1000) };
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
  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);
  return (ri << 16) | (gi << 8) | bi;
}

const PROPERTY_MAP: Record<string, { instance: string; unit?: string }> = {
  va_temperature: { instance: 'temperature', unit: 'unit.temperature.celsius' },
  temp_current: { instance: 'temperature', unit: 'unit.temperature.celsius' },
  temp_indoor: { instance: 'temperature', unit: 'unit.temperature.celsius' },
  va_humidity: { instance: 'humidity', unit: 'unit.percent' },
  humidity_value: { instance: 'humidity', unit: 'unit.percent' },
  battery_percentage: { instance: 'battery_level', unit: 'unit.percent' },
  battery_state: { instance: 'battery_level' },
  cur_power: { instance: 'power', unit: 'unit.watt' },
  cur_voltage: { instance: 'voltage' },
  cur_current: { instance: 'amperage' },
  bright_value: { instance: 'illumination' },
  pm25_value: { instance: 'pm2.5_density' },
  co2_value: { instance: 'co2_level' },
};

function tuyaStatusToProperty(item: TuyaStatusItem): DeviceProperty | null {
  const meta = PROPERTY_MAP[item.code];
  if (!meta) return null;
  const num = Number(item.value);
  if (!Number.isFinite(num)) return null;
  // Эвристика: Tuya шлёт температуру в десятых долях °C (225 = 22.5°C). Если > 100 — делим на 10.
  let normalized = num;
  if ((meta.instance === 'temperature' || meta.instance === 'humidity') && Math.abs(num) > 100) {
    normalized = num / 10;
  }
  return {
    type: 'devices.properties.float',
    retrievable: true,
    reportable: true,
    parameters: { instance: meta.instance, ...(meta.unit ? { unit: meta.unit } : {}) },
    state: { instance: meta.instance, value: normalized },
  };
}

function canonicalToTuya(
  device: Device,
  command: DeviceCommand,
): { code: string; value: unknown } | null {
  if (command.capability === 'devices.capabilities.on_off') {
    const code = device.type === 'devices.types.light' ? 'switch_led' : 'switch_1';
    return { code, value: Boolean(command.value) };
  }
  if (command.capability === 'devices.capabilities.range') {
    if (command.instance === 'brightness') {
      return { code: 'bright_value_v2', value: percentToTuyaBright(Number(command.value)) };
    }
    if (command.instance === 'temperature') {
      return { code: 'temp_set', value: Number(command.value) };
    }
  }
  if (command.capability === 'devices.capabilities.color_setting') {
    if (command.instance === 'rgb') {
      const hsv = rgbIntToTuyaColour(Number(command.value));
      return { code: 'colour_data_v2', value: hsv };
    }
    if (command.instance === 'temperature_k') {
      return { code: 'temp_value_v2', value: kelvinToTuyaTemp(Number(command.value)) };
    }
  }
  if (command.capability === 'devices.capabilities.mode') {
    return { code: 'mode', value: String(command.value) };
  }
  return null;
}
