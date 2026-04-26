/**
 * yandex-lamp — passive LAN-detection для Яндекс Лампочек YNDX-XXXXX (Tuya OEM).
 *
 * Без OAuth и без cloud-credentials. Лампочка вещает Tuya v3.x UDP-broadcast на
 * порту 6667 каждые ~10 секунд — мы слушаем сокет, парсим незашифрованный header
 * (gwId + IP), и выдаём кандидата в Discovery.
 *
 * Контролить лампочку без `localKey` (хранится только в Tuya cloud / SmartLife
 * аккаунте) нельзя — поэтому `probe()` намеренно возвращает null с понятной
 * ошибкой и хинтом: «привяжите её через приложение Дом с Алисой → она появится
 * в хабе автоматически через yandex-iot driver».
 *
 * Tuya v3.3+ frame layout (только нужные нам поля):
 *   bytes 0..3   = 0x000055AA          (prefix-magic)
 *   bytes 12..15 = payload length (BE uint32)
 *   bytes 20..len = JSON payload (encrypted с v3.3, plain c v3.1)
 *   payload содержит { ip, gwId, productKey, version, ... }
 *
 * В v3.3+ payload зашифрован, но gwId дублируется ВНЕ payload в некоторых
 * прошивках. Для надёжности парсим ОБА варианта — plain JSON если получится,
 * иначе ищем 22-символьный gwId в hex-dump'е (typical Tuya pattern).
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

/**
 * Tuya broadcasts на двух портах одновременно — старый v3.1-протокол использует
 * 6666, v3.3+ перешёл на 6667. Yandex YNDX-XXXXX встречаются c обеими прошивками.
 * Слушаем оба, чтобы не упустить лампочку с устаревшей firmware.
 */
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
 * Извлекает payload из Tuya UDP-фрейма. Работает для v3.1/v3.3/v3.4 — в первых
 * двух payload — plain JSON, в v3.4 — зашифрован, но prefix-suffix те же.
 */
function extractTuyaPayload(buf: Buffer): Buffer | null {
  if (buf.length < 20) return null;
  if (!buf.subarray(0, 4).equals(TUYA_FRAME_PREFIX)) return null;
  // Длина payload в bytes 12..16 (BE uint32). Сам payload начинается с byte 20.
  const payloadLen = buf.readUInt32BE(12);
  if (payloadLen <= 0 || 16 + payloadLen > buf.length) return null;
  // Suffix-check (последние 4 байта payload-block'а).
  const suffixStart = 16 + payloadLen - 4;
  if (!buf.subarray(suffixStart, suffixStart + 4).equals(TUYA_FRAME_SUFFIX)) return null;
  // Skip return-code (4 bytes) и crc (4 bytes до suffix).
  return buf.subarray(20, suffixStart - 4);
}

/** Парсит plain JSON из payload (v3.1) либо ищет gwId в hex (v3.3+ encrypted). */
function parseBroadcast(payload: Buffer, fromIp: string): TuyaBroadcast | null {
  // Вариант 1 — plain JSON (v3.1, и некоторые v3.3 прошивки).
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
    /* not plain json — try encrypted-payload patterns */
  }

  // Вариант 2 — encrypted payload, но gwId 22 chars [a-z0-9] обычно «торчит»
  // в незашифрованных padding-байтах для совместимости с Tuya gateway-discovery.
  // Используем conservative pattern, ловит false-positive только при крайне
  // редкой коллизии в random-данных.
  const hex = payload.toString('hex');
  const ascii = payload.toString('latin1');
  const m = /\b[bd][a-f0-9]{21}\b/i.exec(ascii) ?? /\b[bd][a-f0-9]{21}\b/i.exec(hex);
  if (m) return { gwId: m[0], ip: fromIp };

  return null;
}

export class YandexLampDriver extends BaseDriver {
  readonly id = 'yandex-lamp' as const;
  readonly displayName = 'Яндекс Лампочка';

  /** Long-lived listeners (по одному на каждый порт). */
  private readonly listenerSockets: DgramSocket[] = [];
  /** Сколько raw-broadcasts получили (любой формат, до парсинга) — для диагностики. */
  private rawFramesReceived = 0;
  /** gwId → broadcast info; накапливается между discovery cycles. */
  private readonly seen = new Map<string, { ip: string; port: number; lastSeenAt: number; productKey?: string; version?: string }>();
  /** Stale-cutoff: 60s без broadcast → считаем что лампочка ушла из сети. */
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
        // Логируем первые 8 байт — для диагностики если Yandex использует кастомный envelope.
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
      // EADDRINUSE — нормально, если SmartLife/TuyaApp уже слушает порт. С reuseAddr
      // Linux/macOS нас пускают, на Windows иногда нет — тогда detection не работает,
      // но Hub не падает.
      this.logWarn(`UDP listener error on :${port}`, err);
    });

    sock.bind(port, () => {
      this.logInfo(`listening Tuya broadcasts on UDP :${port}`);
    });

    this.listenerSockets.push(sock);
  }

  /** Public-метод для DiscoveryService / UI — диагностика когда ничего не находится. */
  getDiagnostics(): { rawFramesReceived: number; seenCount: number; ports: readonly number[] } {
    return {
      rawFramesReceived: this.rawFramesReceived,
      seenCount: this.seen.size,
      ports: TUYA_BROADCAST_PORTS,
    };
  }

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    // Listener запущен в constructor — broadcasts накапливаются непрерывно.
    // Здесь мы просто ждём `DISCOVERY_LISTEN_MS`, чтобы успеть поймать минимум
    // один broadcast (10s interval — ловим в среднем 1-2 за 3.5s окно).
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DISCOVERY_LISTEN_MS);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    // Чистим stale.
    const now = Date.now();
    for (const [id, info] of this.seen) {
      if (now - info.lastSeenAt > YandexLampDriver.STALE_AFTER_MS) this.seen.delete(id);
    }

    const found: DiscoveredDevice[] = Array.from(this.seen.entries()).map(([gwId, info]) => ({
      driver: 'yandex-lamp' as const,
      externalId: gwId,
      type: DEVICE_TYPE.LIGHT,
      // Имя вида «Яндекс Лампочка •abc123» — последние 6 символов id (как у Тинькоффа в банкоматах).
      name: `Яндекс Лампочка •${gwId.slice(-6).toUpperCase()}`,
      address: `${info.ip}:${info.port}`,
      meta: {
        gwId,
        ip: info.ip,
        port: info.port,
        ...(info.productKey ? { productKey: info.productKey } : {}),
        ...(info.version ? { version: info.version } : {}),
        // UI-флаг: Discovery покажет специальный hint вместо обычной кнопки «Подключить».
        requiresYandexHomeApp: true,
      },
    }));
    this.logInfo(
      `discover: ${found.length} Yandex/Tuya lamps on LAN (raw frames: ${this.rawFramesReceived})`,
    );
    return found;
  }

  /**
   * Без `localKey` управление невозможно (Tuya v3.3+ encrypted protocol).
   * Возвращаем null с понятной ошибкой — UI должен показать guide пользователю.
   */
  async probe(_candidate: DiscoveredDevice): Promise<Device | null> {
    this.logWarn(
      'probe: Yandex/Tuya bulb cannot be paired without local key. ' +
        'Add it to «Дом с Алисой» first — yandex-iot driver will pick it up automatically.',
    );
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
