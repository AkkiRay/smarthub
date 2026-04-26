/**
 * yandex-iot driver — все устройства из «Дома с Алисой».
 *
 * discover()    → GET iot.quasar.yandex.ru/m/v3/user/devices; полный YandexHomeDevice
 *                 (включая capabilities + state) кладётся в `candidate.meta.raw`.
 * probe()       → читает `candidate.meta.raw`, мапит capabilities в каноническую схему.
 * readState()   → snapshot-cache c TTL 5s — N устройств читаются за один HTTP.
 * execute()     → POST iot.quasar.yandex.ru/m/v3/user/devices/actions.
 *
 * Источник истины — общий snapshot: per-device endpoint /m/v3/user/devices/{id}
 * отвечает 404/redirect.
 *
 * Auth: session cookies партиции `persist:yandex-oauth` (общая c yandex-station).
 * Драйвер активен только когда юзер авторизован — модуль возвращает null без auth.
 */

import type {
  Capability,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceProperty,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import { DEVICE_TYPE } from '@smarthome/shared';
import { BaseDriver } from '../_shared/base-driver.js';
import {
  YandexIotClient,
  type YandexHomeCapability,
  type YandexHomeDevice,
  type YandexHomeProperty,
  type YandexHomeSnapshot,
} from '../../alice/yandex-iot-api.js';

/** Yandex device.type → канонический DeviceType. Неизвестные → OTHER. */
function mapDeviceType(yandexType: string): DeviceType {
  const known = Object.values(DEVICE_TYPE) as string[];
  if (known.includes(yandexType)) return yandexType as DeviceType;
  // Префиксные типы → ближайший родитель (`media_device.tv` → `media_device`).
  if (yandexType.startsWith('devices.types.media_device')) return DEVICE_TYPE.MEDIA;
  if (yandexType.startsWith('devices.types.cooking')) return DEVICE_TYPE.COOKING;
  if (yandexType.startsWith('devices.types.openable')) return DEVICE_TYPE.OPENABLE;
  return DEVICE_TYPE.OTHER;
}

/**
 * Yandex capability → canonical Capability. Схема `devices.capabilities.*` совпадает
 * с хабом; retrievable / reportable могут отсутствовать — ставим дефолты.
 */
function mapCapability(c: YandexHomeCapability): Capability {
  const out: Capability = {
    type: c.type as Capability['type'],
    retrievable: c.retrievable ?? true,
    reportable: c.reportable ?? false,
  };
  if (c.parameters) out.parameters = c.parameters;
  if (c.state && typeof c.state === 'object') {
    const s = c.state as { instance?: string; value?: unknown };
    if (typeof s.instance === 'string') {
      out.state = { instance: s.instance, value: s.value };
    }
  }
  return out;
}

function mapProperty(p: YandexHomeProperty): DeviceProperty {
  // `devices.properties.float|event`: parameters.instance обязателен (для UI/units).
  const params = (p.parameters ?? {}) as { instance?: string; unit?: string };
  const out: DeviceProperty = {
    type: p.type as DeviceProperty['type'],
    retrievable: p.retrievable ?? true,
    reportable: p.reportable ?? false,
    parameters: {
      instance: params.instance ?? 'value',
      ...(params.unit ? { unit: params.unit } : {}),
    },
  };
  if (p.state && typeof p.state === 'object') {
    const s = p.state as { instance?: string; value?: unknown };
    if (typeof s.instance === 'string' && (typeof s.value === 'number' || typeof s.value === 'string' || typeof s.value === 'boolean')) {
      out.state = { instance: s.instance, value: s.value };
    }
  }
  return out;
}

function discoveredFromYandex(d: YandexHomeDevice): DiscoveredDevice {
  return {
    driver: 'yandex-iot',
    externalId: d.id,
    type: mapDeviceType(d.type),
    name: d.name,
    // Cloud-устройство без LAN-host'а — scheme-маркер.
    address: 'yandex://iot',
    meta: {
      ...(d.room ? { room: d.room } : {}),
      ...(d.roomId ? { roomId: d.roomId } : {}),
      ...(d.householdId ? { householdId: d.householdId } : {}),
      ...(d.skillId ? { skillId: d.skillId } : {}),
      ...(d.iconUrl ? { iconUrl: d.iconUrl } : {}),
      // Glagol-style serial смарт-колонок — ключ связки cloud-Device ↔ локальная
      // WS-сессия (`useSpeakerNavigation`).
      ...(d.quasarDeviceId ? { quasarDeviceId: d.quasarDeviceId } : {}),
      ...(d.quasarPlatform ? { quasarPlatform: d.quasarPlatform } : {}),
      yandexType: d.type,
      // Дискриминатор URL'а действий: `device` либо `group`. Сериализуется
      // через IPC structured-clone — храним строкой.
      itemType: d.itemType,
      // Полный device-объект с capabilities/state — используется в probe()
      // вместо повторного HTTP при pair'е.
      raw: d as unknown as Record<string, unknown>,
    },
  };
}

/** Извлекает itemType из meta. Default — `device`. */
function itemTypeFrom(meta: Record<string, unknown> | undefined): 'device' | 'group' {
  const v = meta?.['itemType'];
  return v === 'group' ? 'group' : 'device';
}

function buildDeviceFromYandex(
  fresh: YandexHomeDevice,
  candidate: DiscoveredDevice,
  preserve?: Pick<Device, 'id' | 'createdAt'>,
): Device {
  const now = new Date().toISOString();
  const isOnline = fresh.online !== false;
  return {
    id: preserve?.id ?? '',
    externalId: fresh.id,
    driver: 'yandex-iot',
    type: mapDeviceType(fresh.type),
    name: fresh.name || candidate.name,
    // `roomId` — ID импортированной room-записи в registry (syncYandexHome →
    // rooms.upsert). UI фильтрует через device.room === room.id.
    ...(fresh.roomId ? { room: fresh.roomId } : {}),
    hidden: false,
    address: candidate.address,
    meta: {
      ...candidate.meta,
      yandexType: fresh.type,
      // roomName — отдельное поле для UI; основная связь через `room` (id).
      ...(fresh.room ? { roomName: fresh.room } : {}),
      ...(fresh.roomId ? { roomId: fresh.roomId } : {}),
      ...(fresh.iconUrl ? { iconUrl: fresh.iconUrl } : {}),
      ...(fresh.quasarDeviceId ? { quasarDeviceId: fresh.quasarDeviceId } : {}),
      ...(fresh.quasarPlatform ? { quasarPlatform: fresh.quasarPlatform } : {}),
    },
    status: isOnline ? 'online' : 'offline',
    capabilities: fresh.capabilities.map(mapCapability),
    properties: fresh.properties.map(mapProperty),
    createdAt: preserve?.createdAt ?? now,
    updatedAt: now,
    lastSeenAt: now,
  };
}

export class YandexIotDriver extends BaseDriver {
  readonly id = 'yandex-iot' as const;
  readonly displayName = 'Дом с Алисой';

  private readonly client = new YandexIotClient();

  /**
   * Snapshot-cache: один fetch на TTL — все readState() читают из него.
   * TTL 5s; polling раз в 30s даёт свежие данные, UI-actions получают state
   * почти сразу. Real-time push'и (см. subscribePush) патчат cache между fetch'ами.
   */
  private snapshotCache: { snapshot: YandexHomeSnapshot; fetchedAt: number } | null = null;
  private static readonly SNAPSHOT_TTL_MS = 5_000;

  /** In-flight promise — concurrent readState() не плодят дубль-запросы. */
  private snapshotInFlight: Promise<YandexHomeSnapshot> | null = null;

  /** Disconnect-fn от updates-WS, если подписка живёт. */
  private updatesUnsubscribe: (() => void) | null = null;

  /** Listeners на push-state-changes — registry подписывается через subscribePush(). */
  private readonly pushListeners = new Set<(externalId: string, partial: Partial<Device>) => void>();

  private async getSnapshot(forceRefresh = false): Promise<YandexHomeSnapshot> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.snapshotCache &&
      now - this.snapshotCache.fetchedAt < YandexIotDriver.SNAPSHOT_TTL_MS
    ) {
      return this.snapshotCache.snapshot;
    }
    if (this.snapshotInFlight) return this.snapshotInFlight;

    this.snapshotInFlight = this.client
      .fetchUserDevices()
      .then((snapshot) => {
        this.snapshotCache = { snapshot, fetchedAt: Date.now() };
        // `updates_url` приходит в теле первого snapshot'а; на нём открываем
        // real-time подписку, если ещё не открыта.
        if (snapshot.updatesUrl && !this.updatesUnsubscribe) {
          this.startUpdatesStream(snapshot.updatesUrl);
        }
        return snapshot;
      })
      .finally(() => {
        this.snapshotInFlight = null;
      });
    return this.snapshotInFlight;
  }

  /**
   * Real-time WS push: Yandex шлёт `update_states` сообщения с дельтой по device-state.
   * Patches snapshot-cache и нотифицирует pushListeners (registry → device:updated → UI).
   */
  private startUpdatesStream(updatesUrl: string): void {
    this.updatesUnsubscribe = this.client.subscribeUpdates(updatesUrl, (externalId, raw) => {
      const cached = this.snapshotCache?.snapshot;
      if (cached) {
        const idx = cached.devices.findIndex((d) => d.id === externalId);
        if (idx !== -1) {
          const prev = cached.devices[idx]!;
          const next: YandexHomeDevice = {
            ...prev,
            ...(Array.isArray(raw.capabilities)
              ? { capabilities: raw.capabilities as YandexHomeDevice['capabilities'] }
              : {}),
            ...(Array.isArray(raw.properties)
              ? { properties: raw.properties as YandexHomeDevice['properties'] }
              : {}),
            ...(typeof raw.state === 'string' ? { online: raw.state === 'online' } : {}),
          };
          cached.devices.splice(idx, 1, next);
        }
      }

      // Partial-патч в формате Device. Listener ищет device по
      // (driver='yandex-iot', externalId) и мерджит.
      const partial: Partial<Device> = {
        ...(Array.isArray(raw.capabilities)
          ? { capabilities: raw.capabilities.map(mapCapability) }
          : {}),
        ...(Array.isArray(raw.properties) ? { properties: raw.properties.map(mapProperty) } : {}),
        ...(typeof raw.state === 'string'
          ? { status: raw.state === 'online' ? 'online' : 'offline' }
          : {}),
      };
      // Push без capabilities/properties/state — skip emit.
      if (Object.keys(partial).length === 0) return;
      for (const listener of this.pushListeners) listener(externalId, partial);
    });
    this.logInfo('updates WS subscribed');
  }

  /**
   * Подписка на real-time push'и. Возвращает unsubscribe. Driver открывает WS
   * на первом snapshot'е; listener'ы получают partial-Device на каждый push.
   */
  subscribePush(
    listener: (externalId: string, partial: Partial<Device>) => void,
  ): () => void {
    this.pushListeners.add(listener);
    // Если snapshot ещё не запрашивался — fire-and-forget для открытия стрима.
    if (!this.snapshotCache && !this.snapshotInFlight) {
      void this.getSnapshot().catch((e) => {
        this.logWarn('initial snapshot for push-stream failed', e);
      });
    }
    return () => {
      this.pushListeners.delete(listener);
    };
  }

  async discover(_signal: AbortSignal): Promise<DiscoveredDevice[]> {
    // discover() — explicit user-action (sync); force fresh snapshot.
    const snapshot = await this.getSnapshot(true);
    this.logInfo(`discover: ${snapshot.devices.length} devices from Yandex`);
    return snapshot.devices.map(discoveredFromYandex);
  }

  /**
   * Snapshot из кэша. Hub использует для импорта rooms/scenarios без повторного
   * HTTP. Возвращает null до первого discover().
   */
  getCachedSnapshot(): YandexHomeSnapshot | null {
    return this.snapshotCache?.snapshot ?? null;
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    // Raw-payload из discover() — без HTTP.
    const raw = candidate.meta?.['raw'];
    if (raw && typeof raw === 'object') {
      const fresh = raw as YandexHomeDevice;
      if (fresh.id && fresh.type) {
        return buildDeviceFromYandex(fresh, candidate);
      }
    }

    // Fallback для pairing без discover() — читаем из snapshot'а.
    try {
      const snapshot = await this.getSnapshot();
      const fresh = snapshot.devices.find((d) => d.id === candidate.externalId);
      if (fresh) return buildDeviceFromYandex(fresh, candidate);
    } catch (e) {
      this.logWarn(`probe(${candidate.externalId}) snapshot fetch failed`, e);
    }
    this.logWarn(`probe: device ${candidate.externalId} not found in Yandex snapshot`);
    return null;
  }

  async readState(device: Device): Promise<Device> {
    try {
      const snapshot = await this.getSnapshot();
      const fresh = snapshot.devices.find((d) => d.id === device.externalId);
      if (!fresh) {
        // Устройство отсутствует в snapshot — `unreachable`, sync позже удалит.
        return { ...device, status: 'unreachable', updatedAt: new Date().toISOString() };
      }
      const now = new Date().toISOString();
      const roomPatch = fresh.roomId ? { room: fresh.roomId } : {};
      return {
        ...device,
        ...roomPatch,
        meta: {
          ...device.meta,
          ...(fresh.roomId ? { roomId: fresh.roomId } : {}),
          ...(fresh.room ? { roomName: fresh.room } : {}),
          // Backfill quasar_info — нужен Speaker→Device lookup в `useSpeakerNavigation`.
          ...(fresh.quasarDeviceId ? { quasarDeviceId: fresh.quasarDeviceId } : {}),
          ...(fresh.quasarPlatform ? { quasarPlatform: fresh.quasarPlatform } : {}),
        },
        status: fresh.online === false ? 'offline' : 'online',
        capabilities: fresh.capabilities.map(mapCapability),
        properties: fresh.properties.map(mapProperty),
        updatedAt: now,
        lastSeenAt: now,
      };
    } catch (e) {
      this.logWarn(`readState(${device.externalId}) failed`, e);
      return {
        ...device,
        status: 'unreachable',
        updatedAt: new Date().toISOString(),
      };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    try {
      const result = await this.client.executeAction({
        itemType: itemTypeFrom(device.meta),
        deviceId: device.externalId,
        capability: command.capability,
        instance: command.instance,
        value: command.value,
      });
      if (!result.ok) {
        return this.err(
          device,
          command,
          result.status ?? 'YANDEX_REJECTED',
          result.error ?? 'Yandex отклонил действие',
        );
      }
      // Invalidate cache — следующий readState() прочитает свежий state.
      this.snapshotCache = null;
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'YANDEX_HTTP_ERROR', e);
    }
  }

  override async shutdown(): Promise<void> {
    if (this.updatesUnsubscribe) {
      this.updatesUnsubscribe();
      this.updatesUnsubscribe = null;
    }
    this.pushListeners.clear();
    this.snapshotCache = null;
    this.snapshotInFlight = null;
  }
}
