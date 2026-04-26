/**
 * yandex-iot driver — все устройства из «Дома с Алисой».
 *
 * discover()    → GET iot.quasar.yandex.ru/m/v3/user/devices; полный YandexHomeDevice
 *                 (включая capabilities + state) кладётся в `candidate.meta.raw`,
 *                 чтобы probe() не делал лишний HTTP.
 * probe()       → читает `candidate.meta.raw`, мапит capabilities в каноническую схему.
 * readState()   → snapshot-cache с TTL 30s — N устройств читаются за один HTTP.
 * execute()     → POST iot.quasar.yandex.ru/m/v3/user/devices/actions.
 *
 * Per-device endpoint /m/v3/user/devices/{id} в текущей версии iot.quasar отвечает
 * 404/redirect — поэтому источник истины — общий snapshot. Это совпадает с подходом
 * AlexxIT/YandexStation (см. yandex_quasar.py).
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
  // Yandex использует те же `devices.types.*` строки, что и наша схема —
  // достаточно проверить, входит ли значение в наш enum.
  const known = Object.values(DEVICE_TYPE) as string[];
  if (known.includes(yandexType)) return yandexType as DeviceType;
  // Префиксные — берём ближайшего родителя (`media_device.tv` → `media_device`).
  if (yandexType.startsWith('devices.types.media_device')) return DEVICE_TYPE.MEDIA;
  if (yandexType.startsWith('devices.types.cooking')) return DEVICE_TYPE.COOKING;
  if (yandexType.startsWith('devices.types.openable')) return DEVICE_TYPE.OPENABLE;
  return DEVICE_TYPE.OTHER;
}

/**
 * Yandex capability → canonical Capability. Yandex отдаёт capabilities в той же
 * схеме `devices.capabilities.*`, что и хранит хаб — поля retrievable / reportable
 * могут отсутствовать, ставим разумные дефолты.
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
  // У `devices.properties.float|event` обязателен parameters.instance (для UI/units).
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
    // Облачное устройство — нет LAN-host'а, ставим чистый scheme-маркер.
    address: 'yandex://iot',
    meta: {
      ...(d.room ? { room: d.room } : {}),
      ...(d.roomId ? { roomId: d.roomId } : {}),
      ...(d.householdId ? { householdId: d.householdId } : {}),
      ...(d.skillId ? { skillId: d.skillId } : {}),
      ...(d.iconUrl ? { iconUrl: d.iconUrl } : {}),
      yandexType: d.type,
      // Дискриминатор URL'а действий: `device` или `group`. Должен пережить serialize
      // через IPC structured-clone — кладём строкой.
      itemType: d.itemType,
      // Полный device-объект с capabilities/state — используется в probe(), чтобы
      // не делать лишний HTTP-запрос и не зависеть от снапшота при pair'е.
      raw: d as unknown as Record<string, unknown>,
    },
  };
}

/** Безопасно вытаскивает itemType из meta — на случай старых записей в БД. */
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
    // Привязываем к локальной комнате через `roomId` — он же является ID импортированной
    // room-записи в registry (см. syncYandexHome → rooms.upsert). В UI фильтр по комнате
    // работает one-line: device.room === room.id.
    ...(fresh.roomId ? { room: fresh.roomId } : {}),
    hidden: false,
    address: candidate.address,
    meta: {
      ...candidate.meta,
      yandexType: fresh.type,
      // roomName храним отдельно для тостов/UX; основная связь — через `room` (id).
      ...(fresh.room ? { roomName: fresh.room } : {}),
      ...(fresh.roomId ? { roomId: fresh.roomId } : {}),
      ...(fresh.iconUrl ? { iconUrl: fresh.iconUrl } : {}),
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
   * Snapshot-cache: чтобы при `polling.runOnce()` на 50 устройствах не делать 50 HTTP-запросов.
   * Один fetch на TTL — все readState() читают из него.
   * TTL короткий (5s): polling раз в 30s всё равно даст fresh данные, а UI-actions
   * (refresh-after-execute, обновление по клику) получат свежий state почти сразу.
   * Real-time push'и (см. subscribePush ниже) дополнительно патчат cache между fetch'ами.
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
        // Real-time подписка идёт после first snapshot'а — `updates_url` приходит
        // именно в его теле. Если URL прилетел и подписка ещё не открыта — открываем.
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
   * Обновляем snapshot-cache (чтобы следующий readState() видел свежее) и
   * нотифицируем подписчиков (registry → emit device:updated → renderer обновляет UI).
   */
  private startUpdatesStream(updatesUrl: string): void {
    this.updatesUnsubscribe = this.client.subscribeUpdates(updatesUrl, (externalId, raw) => {
      // Patch snapshot cache, чтобы readState() возвращал свежее значение.
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

      // Партиал-патч в формате нашего Device — отдаём listener'у. Он сам найдёт
      // device по (driver='yandex-iot', externalId) и сольёт.
      const partial: Partial<Device> = {
        ...(Array.isArray(raw.capabilities)
          ? { capabilities: raw.capabilities.map(mapCapability) }
          : {}),
        ...(Array.isArray(raw.properties) ? { properties: raw.properties.map(mapProperty) } : {}),
        ...(typeof raw.state === 'string'
          ? { status: raw.state === 'online' ? 'online' : 'offline' }
          : {}),
      };
      // Если push не принёс ни capabilities, ни properties, ни state — нет смысла
      // эмитить (избегаем лишних device:updated → renderer re-render).
      if (Object.keys(partial).length === 0) return;
      for (const listener of this.pushListeners) listener(externalId, partial);
    });
    this.logInfo('updates WS subscribed');
  }

  /**
   * Registry подписывается сюда при init'е. Возвращает unsubscribe.
   * Driver сам открывает WS на первом snapshot'е; listener'ы получают патчи
   * по мере приходящих push'ей.
   */
  subscribePush(
    listener: (externalId: string, partial: Partial<Device>) => void,
  ): () => void {
    this.pushListeners.add(listener);
    // Если snapshot ещё не запрашивался — fire-and-forget, чтобы стрим открылся.
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
    // Force-refresh — discover() это всегда явное user-действие (sync), нужен свежий snapshot.
    const snapshot = await this.getSnapshot(true);
    this.logInfo(`discover: ${snapshot.devices.length} devices from Yandex`);
    return snapshot.devices.map(discoveredFromYandex);
  }

  /**
   * Snapshot из кэша после discover() — нужен hub'у для импорта rooms/scenarios
   * без второго HTTP-запроса. Возвращает null если discover() ещё не запускался.
   */
  getCachedSnapshot(): YandexHomeSnapshot | null {
    return this.snapshotCache?.snapshot ?? null;
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    // Сначала пробуем raw-payload, прокинутый из discover() — без лишнего HTTP.
    const raw = candidate.meta?.['raw'];
    if (raw && typeof raw === 'object') {
      const fresh = raw as YandexHomeDevice;
      if (fresh.id && fresh.type) {
        return buildDeviceFromYandex(fresh, candidate);
      }
    }

    // Fallback: подняли pairing вручную, без discover() — берём из snapshot'а.
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
        // Устройство удалили из «Дома с Алисой» — пометим unreachable, sync позже его уберёт.
        return { ...device, status: 'unreachable', updatedAt: new Date().toISOString() };
      }
      const now = new Date().toISOString();
      // Подтягиваем room: если пользователь переложил устройство в Я.Доме в другую
      // комнату, локальная привязка должна догнаться через polling без ручного sync'а.
      // Также важно для устройств, спаренных ДО фикса room.id-мапинга — у них в БД
      // лежит пустой `room`, а в свежем snapshot'е roomId уже есть.
      const roomPatch = fresh.roomId ? { room: fresh.roomId } : {};
      return {
        ...device,
        ...roomPatch,
        meta: {
          ...device.meta,
          ...(fresh.roomId ? { roomId: fresh.roomId } : {}),
          ...(fresh.room ? { roomName: fresh.room } : {}),
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
      // Инвалидируем кэш — следующий readState() получит свежий state с примененным action.
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
