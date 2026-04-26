/**
 * @fileoverview Passive LAN-detection для Яндекс Лампочек YNDX-XXXXX
 * (Tuya OEM). Слушает Tuya UDP-broadcast на портах 6666/6667, парсит
 * незашифрованный header и эмитит кандидата с `gwId + IP`. Control недоступен
 * без `localKey` — `execute()` возвращает `YANDEX_LAMP_NEEDS_BINDING` с
 * подсказкой привязать лампочку через «Дом с Алисой».
 *
 * Tuya frame layout (v3.1/v3.3/v3.4):
 *   [0..4)   prefix `0x000055AA`
 *   [12..16) payload length (BE uint32)
 *   [20..]   payload (plain JSON в v3.1, encrypted в v3.3+)
 *   suffix   `0x0000AA55`
 */

import { createSocket, type Socket as DgramSocket } from 'node:dgram';
import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DiscoveredDevice,
} from '@smarthome/shared';
import { DEVICE_TYPE } from '@smarthome/shared';
import { BaseDriver } from '../_shared/base-driver.js';

/** Tuya v3.1 broadcasts на UDP `:6666`, v3.3+ — на `:6667`. Слушаем оба. */
const TUYA_BROADCAST_PORTS = [6666, 6667] as const;
const DISCOVERY_LISTEN_MS = 4500;
/** Tuya frame prefix: 0x000055AA. */
const TUYA_FRAME_PREFIX = Buffer.from([0x00, 0x00, 0x55, 0xaa]);
/** Tuya frame suffix: 0x0000AA55. */
const TUYA_FRAME_SUFFIX = Buffer.from([0x00, 0x00, 0xaa, 0x55]);

interface TuyaBroadcast {
  gwId: string;
  ip: string;
  productKey?: string;
  version?: string;
}

/**
 * Извлекает payload из Tuya UDP-фрейма (v3.1/v3.3/v3.4). Возвращает null
 * если frame некорректный (нет prefix/suffix либо payload-length out of range).
 */
function extractTuyaPayload(buf: Buffer): Buffer | null {
  if (buf.length < 20) return null;
  if (!buf.subarray(0, 4).equals(TUYA_FRAME_PREFIX)) return null;
  const payloadLen = buf.readUInt32BE(12);
  if (payloadLen <= 0 || 16 + payloadLen > buf.length) return null;
  const suffixStart = 16 + payloadLen - 4;
  if (!buf.subarray(suffixStart, suffixStart + 4).equals(TUYA_FRAME_SUFFIX)) return null;
  // Между [20] и suffix лежат return_code (4b) + crc (4b); полезные данные между ними.
  return buf.subarray(20, suffixStart - 4);
}

/** Парсит плейн JSON (v3.1) либо ищет 22-символьный gwId в payload (v3.3+ encrypted). */
function parseBroadcast(payload: Buffer, fromIp: string): TuyaBroadcast | null {
  try {
    const text = payload.toString('utf8');
    if (text.startsWith('{')) {
      const obj = JSON.parse(text) as TuyaBroadcast;
      if (obj.gwId) {
        return {
          gwId: obj.gwId,
          ip: obj.ip || fromIp,
          ...(obj.productKey ? { productKey: obj.productKey } : {}),
          ...(obj.version ? { version: obj.version } : {}),
        };
      }
    }
  } catch {
    /* payload не plain JSON, пробуем pattern-match по encrypted bytes */
  }

  // Tuya gwId — 22 chars `[bd][a-f0-9]{21}` и часто торчит из encrypted payload в служебных padding-байтах.
  const hex = payload.toString('hex');
  const ascii = payload.toString('latin1');
  const m = /\b[bd][a-f0-9]{21}\b/i.exec(ascii) ?? /\b[bd][a-f0-9]{21}\b/i.exec(hex);
  if (m) return { gwId: m[0], ip: fromIp };

  return null;
}

export class YandexLampDriver extends BaseDriver {
  readonly id = 'yandex-lamp' as const;
  readonly displayName = 'Яндекс Лампочка';

  /** Long-lived UDP listeners — по одному на каждый Tuya broadcast port. */
  private readonly listenerSockets: DgramSocket[] = [];
  /** Счётчик raw-broadcasts (любой формат, до парсинга). Используется в диагностике. */
  private rawFramesReceived = 0;
  /** Map `gwId → last-seen broadcast info`. Накапливается между discovery cycles. */
  private readonly seen = new Map<string, { ip: string; port: number; lastSeenAt: number; productKey?: string; version?: string }>();
  /** TTL без broadcast'а, после которого лампочка считается ушедшей из сети. */
  private static readonly STALE_AFTER_MS = 60_000;

  constructor() {
    super();
    for (const port of TUYA_BROADCAST_PORTS) this.startListener(port);
  }

  private startListener(port: number): void {
    const sock = createSocket({ type: 'udp4', reuseAddr: true });

    sock.on('message', (msg, rinfo) => {
      this.rawFramesReceived++;
      const payload = extractTuyaPayload(msg);
      if (!payload) {
        // Первые 3 unknown-фрейма пишем в лог: 8 байт head'а для диагностики envelope.
        if (this.rawFramesReceived <= 3) {
          this.logInfo(
            `unknown UDP frame on :${port} from ${rinfo.address} (${msg.length}b, head=${msg.subarray(0, 8).toString('hex')})`,
          );
        }
        return;
      }
      const parsed = parseBroadcast(payload, rinfo.address);
      if (!parsed) return;
      this.seen.set(parsed.gwId, {
        ip: parsed.ip,
        port,
        lastSeenAt: Date.now(),
        ...(parsed.productKey ? { productKey: parsed.productKey } : {}),
        ...(parsed.version ? { version: parsed.version } : {}),
      });
    });

    sock.on('error', (err) => {
      this.logWarn(`UDP listener error on :${port}`, err);
    });

    sock.bind(port, () => {
      this.logInfo(`listening Tuya broadcasts on UDP :${port}`);
    });

    this.listenerSockets.push(sock);
  }

  /** Диагностика: счётчик raw-фреймов, число known-устройств, prob'нутые ports. */
  getDiagnostics(): { rawFramesReceived: number; seenCount: number; ports: readonly number[] } {
    return {
      rawFramesReceived: this.rawFramesReceived,
      seenCount: this.seen.size,
      ports: TUYA_BROADCAST_PORTS,
    };
  }

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DISCOVERY_LISTEN_MS);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const now = Date.now();
    for (const [id, info] of this.seen) {
      if (now - info.lastSeenAt > YandexLampDriver.STALE_AFTER_MS) this.seen.delete(id);
    }

    const found: DiscoveredDevice[] = Array.from(this.seen.entries()).map(([gwId, info]) => ({
      driver: 'yandex-lamp' as const,
      externalId: gwId,
      type: DEVICE_TYPE.LIGHT,
      name: `Яндекс Лампочка •${gwId.slice(-6).toUpperCase()}`,
      address: `${info.ip}:${info.port}`,
      meta: {
        gwId,
        ip: info.ip,
        port: info.port,
        ...(info.productKey ? { productKey: info.productKey } : {}),
        ...(info.version ? { version: info.version } : {}),
        // Флаг для UI: рендерит hint про «Дом с Алисой» вместо кнопки «Подключить».
        requiresYandexHomeApp: true,
      },
    }));
    this.logInfo(
      `discover: ${found.length} Yandex/Tuya lamps on LAN (raw frames: ${this.rawFramesReceived})`,
    );
    return found;
  }

  /** Возвращает null: control требует `localKey` (Tuya v3.3+ encrypted), который доступен только через `yandex-iot` driver. */
  async probe(_candidate: DiscoveredDevice): Promise<Device | null> {
    this.logWarn('probe: Yandex/Tuya bulb requires localKey, pair through Дом с Алисой instead');
    return null;
  }

  async readState(device: Device): Promise<Device> {
    return { ...device, status: 'unreachable', updatedAt: new Date().toISOString() };
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    return this.err(
      device,
      command,
      'YANDEX_LAMP_NEEDS_BINDING',
      'Эта лампочка детектирована в LAN, но управлять можно только после привязки к «Дому с Алисой».',
    );
  }

  override async shutdown(): Promise<void> {
    for (const sock of this.listenerSockets) {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
    }
    this.listenerSockets.length = 0;
    this.seen.clear();
  }
}
