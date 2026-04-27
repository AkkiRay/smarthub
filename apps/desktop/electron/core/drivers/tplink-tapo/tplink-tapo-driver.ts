/**
 * @fileoverview
 * TP-Link Tapo (P100/P110/L510/L530/L630): локальный HTTP-протокол.
 *
 * Две версии handshake'а в полевых условиях:
 *   - **KLAP v2** (firmware ≥ 1.1.0, default на shipping-устройствах с конца 2022):
 *     SHA-256-handshake без RSA, два POST /app/handshake1+2 + AES-128-CBC.
 *     auth_hash = SHA-256(SHA-1(email) || SHA-1(password)). Сессия на 24ч, привязана
 *     к TP_SESSIONID cookie.
 *   - **secure-passthrough** (firmware < 1.1.0): RSA-1024 handshake → AES-128-CBC.
 *     На новых прошивках больше не работает (handshake возвращает 1003).
 *
 * Драйвер сначала пробует KLAP, при отказе (HTTP 404 на /handshake1) деградирует
 * на legacy secure-passthrough. Token и session-cookie передаются ИСКЛЮЧИТЕЛЬНО
 * в Cookie/X-headers — раньше token шёл в URL query, что светилось в access-логах
 * и hop-by-hop кэшах.
 */

import axios, { type AxiosInstance } from 'axios';
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  generateKeyPairSync,
  privateDecrypt,
  createHash,
  randomBytes,
} from 'node:crypto';
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

const TAPO_HTTP_TIMEOUT_MS = 5000;
const TAPO_KELVIN: { min: number; max: number } = { min: 2500, max: 6500 };

interface TapoCreds {
  email: string;
  password: string;
  /** Опционально: список host'ов, если discovery недоступно (Tapo в LAN не отвечает на broadcast). */
  hosts?: string[];
}

type TapoProtocol = 'klap' | 'passthrough';

interface TapoSession {
  protocol: TapoProtocol;
  cipher: TapoCipher;
  /** TP_SESSIONID cookie (общий для KLAP/passthrough). */
  cookie: string;
  /** Только passthrough: token, выданный login_device. */
  token?: string;
  /** KLAP v2: монотонный счётчик IV (last 4 bytes IV). Растёт с каждым encrypted-запросом. */
  seq?: number;
}

interface TapoCipher {
  key: Buffer;
  iv: Buffer;
}

interface TapoDeviceInfo {
  device_id: string;
  fw_ver: string;
  hw_ver: string;
  type: string;
  model: string;
  mac: string;
  hw_id: string;
  fw_id: string;
  oem_id: string;
  device_on?: boolean;
  brightness?: number;
  hue?: number;
  saturation?: number;
  color_temp?: number;
  nickname: string;
  region: string;
}

interface TapoMeta extends Record<string, unknown> {
  model: string;
  isBulb: boolean;
  isColor: boolean;
  isVariableTemp: boolean;
  isDimmable: boolean;
}

export class TPLinkTapoDriver extends BaseDriver {
  readonly id = 'tplink-tapo' as const;
  readonly displayName = 'TP-Link Tapo';

  private readonly http: AxiosInstance = axios.create({ timeout: TAPO_HTTP_TIMEOUT_MS });
  // Single-flight: храним Promise, не TapoSession. Два параллельных request'а на тот же
  // host получат одну и ту же in-flight handshake-операцию вместо двух конкурентных,
  // которые перезаписывали бы друг другу seq-counter и давали IV-collision в KLAP.
  private sessions = new Map<string, Promise<TapoSession>>();

  constructor(private readonly creds: TapoCreds) {
    super();
  }

  async discover(_signal: AbortSignal): Promise<DiscoveredDevice[]> {
    // Tapo не отвечает на UDP broadcast — discovery делается через cloud OR явный список IP.
    const hosts = this.creds.hosts ?? [];
    const found: DiscoveredDevice[] = [];

    for (const host of hosts) {
      try {
        const info = await this.getDeviceInfo(host);
        const meta = inferMeta(info);
        found.push({
          driver: 'tplink-tapo',
          externalId: info.device_id,
          type: meta.isBulb ? DEVICE_TYPE.LIGHT : DEVICE_TYPE.SOCKET,
          name: decodeBase64(info.nickname) || info.model,
          address: host,
          meta,
        });
      } catch (e) {
        this.logWarn(`probe ${host} failed`, e);
      }
    }
    return found;
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    try {
      const info = await this.getDeviceInfo(candidate.address);
      const meta = inferMeta(info);
      const type: DeviceType = meta.isBulb ? DEVICE_TYPE.LIGHT : DEVICE_TYPE.SOCKET;
      const now = new Date().toISOString();
      return {
        id: '',
        externalId: info.device_id,
        driver: 'tplink-tapo',
        type,
        name: decodeBase64(info.nickname) || candidate.name,
        address: candidate.address,
        hidden: false,
        meta,
        status: 'online',
        capabilities: buildTapoCaps(type, meta, info),
        properties: [],
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      };
    } catch (e) {
      this.logWarn('probe failed', e);
      return null;
    }
  }

  async readState(device: Device): Promise<Device> {
    try {
      const info = await this.getDeviceInfo(device.address);
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: buildTapoCaps(device.type, device.meta as TapoMeta, info),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const meta = device.meta as TapoMeta;

    try {
      const params: Record<string, unknown> = {};
      if (command.capability === CAPABILITY.ON_OFF) {
        params['device_on'] = Boolean(command.value);
      } else if (
        command.capability === CAPABILITY.RANGE &&
        command.instance === INSTANCE.BRIGHTNESS
      ) {
        params['device_on'] = true;
        params['brightness'] = clamp(Number(command.value), RANGE.PERCENT.min, RANGE.PERCENT.max);
      } else if (
        meta.isColor &&
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.RGB
      ) {
        const hsv = rgbIntToHsv(Number(command.value));
        params['device_on'] = true;
        params['hue'] = Math.round(hsv.h);
        params['saturation'] = Math.round(hsv.s * 100);
        params['color_temp'] = 0;
      } else if (
        meta.isVariableTemp &&
        command.capability === CAPABILITY.COLOR_SETTING &&
        command.instance === INSTANCE.TEMPERATURE_K
      ) {
        params['device_on'] = true;
        params['color_temp'] = clamp(Number(command.value), TAPO_KELVIN.min, TAPO_KELVIN.max);
        params['saturation'] = 0;
      } else {
        return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
      }
      await this.secureRequest(device.address, 'set_device_info', params);
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  override async shutdown(): Promise<void> {
    this.sessions.clear();
  }

  private async getDeviceInfo(host: string): Promise<TapoDeviceInfo> {
    const r = await this.secureRequest<{ result: TapoDeviceInfo }>(host, 'get_device_info', {});
    return r.result;
  }

  // Secure handshake: пробуем KLAP v2 (новые firmware), при отказе fallback в legacy passthrough.
  // Сессия кешируется per-host; при error_code -1501/-1012 выбрасываем кеш и retry.
  private async secureRequest<T = { result: unknown }>(
    host: string,
    method: string,
    params: object,
  ): Promise<T> {
    const session = await this.getOrCreateSession(host);
    try {
      return await this.invokeWithSession<T>(host, session, method, params);
    } catch (e) {
      const msg = (e as Error).message;
      const expired = /-1501|-1012|expired|HTTP 401|HTTP 403/.test(msg);
      if (!expired) throw e;
      // Token expired — выбрасываем кеш (только если он ссылается на ту же сессию,
      // иначе паралельный invocation мог уже успеть refresh'нуть и нам не надо повторно).
      if (this.sessions.get(host) && (await this.sessions.get(host)) === session) {
        this.sessions.delete(host);
      }
      const fresh = await this.getOrCreateSession(host);
      return await this.invokeWithSession<T>(host, fresh, method, params);
    }
  }

  /**
   * Single-flight cache: возвращает существующий Promise или стартует новый
   * handshake. Параллельные request'ы на тот же host await'ят одну
   * in-flight операцию. На failure запись удаляется, чтобы следующий
   * request попробовал заново.
   */
  private getOrCreateSession(host: string): Promise<TapoSession> {
    const existing = this.sessions.get(host);
    if (existing) return existing;
    const fresh = this.handshake(host).catch((e) => {
      // Failure → удаляем reject'нутый Promise из кеша, иначе все будущие
      // вызовы будут получать ту же ошибку.
      if (this.sessions.get(host) === fresh) this.sessions.delete(host);
      throw e;
    });
    this.sessions.set(host, fresh);
    return fresh;
  }

  /**
   * Пробует KLAP v2; если устройство возвращает 404/-1003 (старая firmware),
   * деградирует на legacy secure-passthrough.
   */
  private async handshake(host: string): Promise<TapoSession> {
    try {
      return await this.handshakeKlap(host);
    } catch (e) {
      const msg = (e as Error).message;
      if (/HTTP 404|HTTP 400|-1003|-1010|handshake1/.test(msg)) {
        this.logWarn(`KLAP handshake unavailable on ${host} (${msg}), falling back to legacy passthrough`);
        return this.handshakePassthrough(host);
      }
      throw e;
    }
  }

  /**
   * KLAP v2: shipping-протокол с конца 2022. SHA-256 handshake без RSA.
   *
   * 1. POST /app/handshake1 с client_nonce(16). Сервер отвечает server_nonce(16) +
   *    auth_hash = SHA-256(SHA-1(email) || SHA-1(password)) ⊕ ...
   * 2. POST /app/handshake2 с подтверждающим хешем.
   * 3. session-key = SHA-256("lsk" || local_seed || remote_seed || auth_hash).slice(0,16)
   *    iv-prefix    = SHA-256("iv"  || local_seed || remote_seed || auth_hash).slice(0,12)
   *    seq-init     = big-endian int32 из SHA-256(...).slice(28,32)
   *    sig          = SHA-256("ldk" || local_seed || remote_seed || auth_hash).slice(0,28)
   * Каждый encrypted-request: IV = iv_prefix || (seq++ as int32 BE);
   * envelope = sig || sha256(sig || seq || ciphertext) || ciphertext.
   */
  private async handshakeKlap(host: string): Promise<TapoSession> {
    const baseUrl = `http://${host}:80/app`;
    const localSeed = randomBytes(16);

    let h1Resp;
    try {
      h1Resp = await this.http.post(`${baseUrl}/handshake1`, localSeed, {
        responseType: 'arraybuffer',
        headers: { 'Content-Type': 'application/octet-stream' },
        validateStatus: () => true,
      });
    } catch (e) {
      throw new Error(`KLAP handshake1 transport failed: ${(e as Error).message}`);
    }
    if (h1Resp.status !== 200) {
      throw new Error(`KLAP handshake1: HTTP ${h1Resp.status}`);
    }

    const h1Body = Buffer.from(h1Resp.data as ArrayBuffer);
    if (h1Body.length < 48) throw new Error(`KLAP handshake1: short response (${h1Body.length}B)`);
    const remoteSeed = h1Body.subarray(0, 16);
    const serverHash = h1Body.subarray(16, 48);

    // auth_hash = SHA256( SHA1(email) || SHA1(password) ).
    const sha1 = (s: string) => createHash('sha1').update(s).digest();
    const authHash = createHash('sha256')
      .update(Buffer.concat([sha1(this.creds.email), sha1(this.creds.password)]))
      .digest();

    // Verify server's hash: SHA-256(local_seed || remote_seed || auth_hash).
    const expectedServerHash = createHash('sha256')
      .update(Buffer.concat([localSeed, remoteSeed, authHash]))
      .digest();
    if (!serverHash.equals(expectedServerHash)) {
      throw new Error('KLAP handshake1: invalid credentials (auth_hash mismatch)');
    }

    const cookie = pickSessionCookie(h1Resp.headers['set-cookie']);
    if (!cookie) throw new Error('KLAP handshake1: missing TP_SESSIONID cookie');

    // handshake2: SHA-256(remote_seed || local_seed || auth_hash).
    const clientHash = createHash('sha256')
      .update(Buffer.concat([remoteSeed, localSeed, authHash]))
      .digest();

    const h2Resp = await this.http.post(`${baseUrl}/handshake2`, clientHash, {
      responseType: 'arraybuffer',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie },
      validateStatus: () => true,
    });
    if (h2Resp.status !== 200) throw new Error(`KLAP handshake2: HTTP ${h2Resp.status}`);

    // Derive session key + iv prefix + initial seq.
    const lsk = createHash('sha256')
      .update(Buffer.concat([Buffer.from('lsk'), localSeed, remoteSeed, authHash]))
      .digest();
    const ivBuf = createHash('sha256')
      .update(Buffer.concat([Buffer.from('iv'), localSeed, remoteSeed, authHash]))
      .digest();
    const ldk = createHash('sha256')
      .update(Buffer.concat([Buffer.from('ldk'), localSeed, remoteSeed, authHash]))
      .digest();

    const key = lsk.subarray(0, 16);
    const ivPrefix = ivBuf.subarray(0, 12);
    // Unsigned int32 — KLAP spec кладёт seq как uint32 BE. readInt32BE при bit31=1
    // даёт отрицательное число, последующий writeInt32BE в IV пишет two's-complement
    // вместо беззнакового — устройство с шансом 50% получит IV, который не совпадает
    // с тем, что само рассчитало → AES-CBC валит расшифровку.
    const seqInit = ivBuf.readUInt32BE(28);
    const sig = ldk.subarray(0, 28);

    return {
      protocol: 'klap',
      cipher: { key, iv: Buffer.concat([ivPrefix, sig]) },
      cookie,
      seq: seqInit,
    };
  }

  /** Legacy secure-passthrough: RSA-1024 handshake → AES-128-CBC. */
  private async handshakePassthrough(host: string): Promise<TapoSession> {
    const url = `http://${host}:80/app`;
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 1024,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const handshake = await this.http.post(url, {
      method: 'handshake',
      params: { key: publicKey },
      requestTimeMils: Date.now(),
    });
    const enc = handshake.data?.result?.key as string | undefined;
    const cookie = pickSessionCookie(handshake.headers['set-cookie']);
    if (!enc || !cookie) throw new Error('Tapo handshake failed');

    const decoded = privateDecrypt(
      { key: createPrivateKey(privateKey), padding: 1 /* PKCS1 v1.5 */ },
      Buffer.from(enc, 'base64'),
    );
    const cipher: TapoCipher = { key: decoded.subarray(0, 16), iv: decoded.subarray(16, 32) };

    const loginPayload = {
      method: 'login_device',
      params: {
        username: Buffer.from(createHash('sha1').update(this.creds.email).digest('hex')).toString(
          'base64',
        ),
        password: Buffer.from(this.creds.password).toString('base64'),
      },
      requestTimeMils: Date.now(),
    };
    const encryptedLogin = encryptAes(JSON.stringify(loginPayload), cipher);
    const loginResp = await this.http.post(
      url,
      { method: 'securePassthrough', params: { request: encryptedLogin } },
      { headers: { Cookie: cookie } },
    );
    const decryptedLogin = JSON.parse(decryptAes(loginResp.data.result.response, cipher)) as {
      result?: { token: string };
      error_code?: number;
    };
    if (!decryptedLogin.result?.token) {
      throw new Error(`Tapo login failed: ${decryptedLogin.error_code}`);
    }
    return { protocol: 'passthrough', cipher, cookie, token: decryptedLogin.result.token };
  }

  private async invokeWithSession<T>(
    host: string,
    session: TapoSession,
    method: string,
    params: object,
  ): Promise<T> {
    const payload = JSON.stringify({ method, params, requestTimeMils: Date.now() });
    if (session.protocol === 'klap') return this.invokeKlap<T>(host, session, payload);
    return this.invokePassthrough<T>(host, session, payload);
  }

  private async invokeKlap<T>(host: string, session: TapoSession, payload: string): Promise<T> {
    // seq — uint32 с wrap'ом (после 0xFFFFFFFF мы пере-handshake'имся, но 4 млрд
    // запросов на сессию хватает на годы). >>> 0 гарантирует unsigned-семантику.
    const seq = ((session.seq ?? 0) + 1) >>> 0;
    session.seq = seq;
    const ivPrefix = session.cipher.iv.subarray(0, 12);
    const sig = session.cipher.iv.subarray(12, 40);
    const seqBuf = Buffer.alloc(4);
    seqBuf.writeUInt32BE(seq, 0);
    const iv = Buffer.concat([ivPrefix, seqBuf]);
    const cipher = createCipheriv('aes-128-cbc', session.cipher.key, iv);
    const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const integrity = createHash('sha256')
      .update(Buffer.concat([sig, seqBuf, ciphertext]))
      .digest();
    const body = Buffer.concat([integrity, ciphertext]);

    const r = await this.http.post(`http://${host}:80/app/request?seq=${seq}`, body, {
      responseType: 'arraybuffer',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: session.cookie },
      validateStatus: () => true,
    });
    if (r.status !== 200) throw new Error(`KLAP request HTTP ${r.status}`);

    const buf = Buffer.from(r.data as ArrayBuffer);
    if (buf.length < 32) throw new Error(`KLAP response too short (${buf.length}B)`);
    const respCiphertext = buf.subarray(32);
    const decipher = createDecipheriv('aes-128-cbc', session.cipher.key, iv);
    const text = Buffer.concat([decipher.update(respCiphertext), decipher.final()]).toString(
      'utf8',
    );
    const dec = JSON.parse(text) as { result?: T; error_code?: number; msg?: string };
    if (dec.error_code && dec.error_code !== 0) {
      throw new Error(`Tapo error ${dec.error_code}: ${dec.msg ?? 'unknown'}`);
    }
    return dec.result as T;
  }

  private async invokePassthrough<T>(host: string, session: TapoSession, payload: string): Promise<T> {
    const encrypted = encryptAes(payload, session.cipher);
    if (!session.token) throw new Error('Tapo passthrough: missing token');
    // Token и cookie передаём ТОЛЬКО в заголовках — раньше token был в URL ?token=,
    // что светилось в access-логах прокси и hop-by-hop кешах.
    const r = await this.http.post(
      `http://${host}:80/app`,
      { method: 'securePassthrough', params: { request: encrypted } },
      {
        headers: {
          Cookie: session.cookie,
          'X-Tapo-Token': session.token,
        },
      },
    );
    const dec = JSON.parse(decryptAes(r.data.result.response, session.cipher)) as {
      result?: T;
      error_code?: number;
      msg?: string;
    };
    if (dec.error_code && dec.error_code !== 0) {
      throw new Error(`Tapo error ${dec.error_code}: ${dec.msg ?? 'unknown'}`);
    }
    return dec.result as T;
  }
}

function pickSessionCookie(setCookie: unknown): string {
  if (!Array.isArray(setCookie)) return '';
  for (const raw of setCookie) {
    if (typeof raw !== 'string') continue;
    const first = raw.split(';')[0];
    if (first?.startsWith('TP_SESSIONID=')) return first;
  }
  // Fallback: первая cookie в массиве, если устройство шлёт её другим именем.
  const first = (setCookie[0] as string | undefined)?.split(';')[0];
  return first ?? '';
}

function buildTapoCaps(type: DeviceType, meta: TapoMeta, info: TapoDeviceInfo): Capability[] {
  const caps: Capability[] = [capOnOff(Boolean(info.device_on))];
  if (type !== DEVICE_TYPE.LIGHT) return caps;

  if (meta.isDimmable) {
    caps.push(capBrightness(Math.max(1, info.brightness ?? 100)));
  }

  if (meta.isColor || meta.isVariableTemp) {
    const k = info.color_temp && info.color_temp > 0 ? info.color_temp : 4000;
    const rgb = meta.isColor
      ? hsvToRgbInt(info.hue ?? 0, (info.saturation ?? 0) / 100, (info.brightness ?? 100) / 100)
      : 0xffffff;
    const isTempMode = Boolean(info.color_temp && info.color_temp > 0);
    caps.push(
      capColor(isTempMode ? { kind: 'temperature_k', value: k } : { kind: 'rgb', value: rgb }, {
        rgb: meta.isColor,
        temperatureK: meta.isVariableTemp ? TAPO_KELVIN : undefined,
      }),
    );
  }
  return caps;
}

function inferMeta(info: TapoDeviceInfo): TapoMeta {
  // Modern (2025-2026) Tapo lineup:
  //   L510/L530/L535/L630 — bulbs (L5xx variable temp; L530/L535/L6xx full color RGBWW)
  //   L900/L920/L930      — light strips (color)
  //   P100/P105/P110/P115 — plugs (P11x — energy monitoring)
  //   P300/P304            — power strips (multi-outlet)
  //   H100                 — hub
  // На firmware ≥1.1.0 все используют KLAP v2 (см. handshakeKlap).
  const m = info.model.toUpperCase();
  const isBulb = /^L[5-9]/.test(m) || /BULB|STRIP|LIGHT/.test(info.type);
  // Color = full RGB. L530/L535/L630 + все L9xx (light strips).
  const isColor = /^L530|^L535|^L630|^L6[3-9]\d|^L9/.test(m);
  // Variable temp без RGB = L510/L520; color-bulbs тоже умеют CT.
  const isVariableTemp = isColor || /^L5[12]0/.test(m);
  return { model: info.model, isBulb, isColor, isVariableTemp, isDimmable: isBulb };
}

function decodeBase64(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return '';
  try {
    const buf = Buffer.from(s, 'base64');
    const utf8 = buf.toString('utf8');
    // Если в результате есть U+FFFD — устройство, скорее всего, шлёт latin-1.
    // Пробуем latin-1 как fallback (Tapo прошивки до 1.0.7 выдавали именно его
    // для не-ASCII никнеймов).
    if (utf8.includes('�')) {
      return buf.toString('latin1');
    }
    return utf8;
  } catch {
    return s;
  }
}

function encryptAes(text: string, c: TapoCipher): string {
  const cipher = createCipheriv('aes-128-cbc', c.key, c.iv);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}
function decryptAes(b64: string, c: TapoCipher): string {
  const decipher = createDecipheriv('aes-128-cbc', c.key, c.iv);
  return Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
