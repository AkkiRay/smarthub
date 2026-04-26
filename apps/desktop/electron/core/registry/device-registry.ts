/**
 * @fileoverview Device registry — in-memory cache всех сопряжённых устройств
 * с write-through в {@link DeviceStore} (better-sqlite3).
 *
 * Архитектура:
 *   - Все mutation'ы проходят через registry — это гарантирует, что каждое
 *     изменение синхронно летит и в SQLite, и в {@link EventEmitter}-bus
 *     (для пуша в renderer).
 *   - Registry владеет device-объектами; никто другой их не клонирует и
 *     не возвращает stale-snapshot.
 *   - События: `device:updated`, `device:removed`, `room:upserted`, `room:removed`.
 *
 * Routing команд:
 *   `execute(command)` находит device, его driver, делегирует в `driver.execute(...)`,
 *   обновляет cached state result'ом, эмитит `device:updated`. Renderer
 *   получает обновлённое значение через push, без отдельного refresh-вызова.
 *
 * Push-subscriptions:
 *   Если driver реализует `subscribePush()`, registry подписывается при init'е
 *   и мержит partial-Device patch'и в полный device-объект.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import log from 'electron-log/main.js';
import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DiscoveredDevice,
  Room,
} from '@smarthome/shared';
import type { DeviceStore } from '../storage/device-store.js';
import type { DriverRegistry } from '../drivers/driver-registry.js';

interface DeviceRegistryEvents {
  'device:updated': (device: Device) => void;
  'device:removed': (payload: { id: string }) => void;
  'room:upserted': (room: Room) => void;
  'room:removed': (payload: { id: string }) => void;
}

export type DeviceRegistry = ReturnType<typeof createDeviceRegistry>;

export function createDeviceRegistry(deps: {
  deviceStore: DeviceStore;
  driverRegistry: DriverRegistry;
}) {
  const emitter = new EventEmitter();
  const cache = new Map<string, Device>();
  const roomCache = new Map<string, Room>();

  const emitUpdated = (device: Device): void => {
    emitter.emit('device:updated', device);
  };

  const persistAndEmit = (device: Device): Device => {
    cache.set(device.id, device);
    deps.deviceStore.devices.upsert(device);
    emitUpdated(device);
    return device;
  };

  /**
   * Push-подписки на каждом драйвере, который умеет real-time (yandex-iot
   * через `updates_url` WS, в будущем — MQTT/Hue eventstream/etc). Регистрируем
   * один раз в init(); драйвер сам управляет своим транспортом.
   */
  const pushUnsubscribes: Array<() => void> = [];
  const wirePushFromDriver = (driver: ReturnType<DriverRegistry['list']>[number]): void => {
    if (typeof driver.subscribePush !== 'function') return;
    const unsub = driver.subscribePush((externalId, partial) => {
      const existing = (() => {
        for (const d of cache.values()) {
          if (d.driver === driver.id && d.externalId === externalId) return d;
        }
        return null;
      })();
      if (!existing) return;
      const now = new Date().toISOString();
      const merged: Device = {
        ...existing,
        ...partial,
        updatedAt: now,
        lastSeenAt: now,
      };
      persistAndEmit(merged);
    });
    pushUnsubscribes.push(unsub);
  };

  return {
    async init(): Promise<void> {
      for (const d of deps.deviceStore.devices.list()) cache.set(d.id, d);
      for (const r of deps.deviceStore.rooms.list()) roomCache.set(r.id, r);
      log.info(`DeviceRegistry: ${cache.size} devices, ${roomCache.size} rooms loaded`);
    },

    /**
     * Hub вызывает ПОСЛЕ driverRegistry.init() — иначе `driverRegistry.list()`
     * ещё пуст. Subscribe ко всем драйверам, которые умеют push (yandex-iot
     * через WS, MQTT-bridge, etc). Идемпотентно — повторный вызов не дублирует
     * подписки, потому что хранятся `unsubscribe`-функции.
     */
    wirePushSubscriptions(): void {
      // Если уже были подписки (reload-driver кейс) — снимаем старые.
      for (const unsub of pushUnsubscribes) {
        try {
          unsub();
        } catch {
          /* unsubscribe best-effort */
        }
      }
      pushUnsubscribes.length = 0;
      for (const driver of deps.driverRegistry.list()) wirePushFromDriver(driver);
      log.info(
        `DeviceRegistry: ${pushUnsubscribes.length} push-subscriptions wired`,
      );
    },

    on<E extends keyof DeviceRegistryEvents>(
      event: E,
      listener: DeviceRegistryEvents[E],
    ): () => void {
      emitter.on(event, listener as never);
      return () => emitter.off(event, listener as never);
    },

    list: (): Device[] => Array.from(cache.values()),

    get: (id: string): Device | null => cache.get(id) ?? null,

    findByExternalId(driver: string, externalId: string): Device | null {
      for (const d of cache.values()) {
        if (d.driver === driver && d.externalId === externalId) return d;
      }
      return null;
    },

    async pair(candidate: DiscoveredDevice): Promise<Device> {
      const existing = this.findByExternalId(candidate.driver, candidate.externalId);
      if (existing) return existing;

      log.info(
        `pair: driver=${candidate.driver} externalId=${candidate.externalId} type=${candidate.type}`,
      );
      const driver = deps.driverRegistry.require(candidate.driver);
      let probed: Device | null;
      try {
        probed = await driver.probe(candidate);
      } catch (e) {
        log.error(`pair: probe failed for ${candidate.driver}/${candidate.externalId}`, e);
        throw e;
      }
      if (!probed) throw new Error(`Driver ${candidate.driver} could not probe candidate`);

      const now = new Date().toISOString();
      const device: Device = {
        ...probed,
        id: probed.id || randomUUID(),
        hidden: false,
        createdAt: now,
        updatedAt: now,
        status: 'online',
      };
      try {
        const result = persistAndEmit(device);
        log.info(`Paired ${device.name} via ${device.driver}`);
        return result;
      } catch (e) {
        log.error(`pair: persist failed for ${device.driver}/${device.externalId}`, e);
        throw e;
      }
    },

    async refresh(id: string): Promise<Device> {
      const existing = cache.get(id);
      if (!existing) throw new Error(`Unknown device ${id}`);
      const driver = deps.driverRegistry.require(existing.driver);
      try {
        const fresh = await driver.readState(existing);
        const merged: Device = {
          ...existing,
          ...fresh,
          updatedAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        };
        return persistAndEmit(merged);
      } catch (e) {
        const offline: Device = {
          ...existing,
          status: 'unreachable',
          updatedAt: new Date().toISOString(),
        };
        log.warn(`refresh(${id}) failed: ${(e as Error).message}`);
        return persistAndEmit(offline);
      }
    },

    async execute(command: DeviceCommand): Promise<DeviceCommandResult> {
      const device = cache.get(command.deviceId);
      if (!device) {
        return {
          deviceId: command.deviceId,
          capability: command.capability,
          instance: command.instance,
          status: 'ERROR',
          errorCode: 'DEVICE_NOT_FOUND',
          errorMessage: `Device ${command.deviceId} is not paired`,
        };
      }
      const driver = deps.driverRegistry.require(device.driver);
      const result = await driver.execute(device, command);
      if (result.status === 'DONE') {
        // Optimistic update: state применяем сразу, фактический пуш от устройства перезатрёт при разногласии.
        const updated: Device = {
          ...device,
          capabilities: device.capabilities.map((c) =>
            c.type === command.capability && c.state?.instance === command.instance
              ? { ...c, state: { instance: command.instance, value: command.value } }
              : c,
          ),
          updatedAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        };
        persistAndEmit(updated);

        // Подтягиваем свежий state через ~1.5s — за это время большинство девайсов
        // успевают применить команду И обновить связанные properties (потребление,
        // температура и т.п.). Без этого пользователь видит обновлённую capability,
        // но property-карточки остаются stale до следующего polling-цикла (30s).
        setTimeout(() => {
          void this.refresh(command.deviceId).catch((e) => {
            log.debug(
              `post-execute refresh ${command.deviceId} failed: ${(e as Error).message}`,
            );
          });
        }, 1500);
      }
      return result;
    },

    rename(id: string, name: string): Device {
      const existing = cache.get(id);
      if (!existing) throw new Error(`Unknown device ${id}`);
      return persistAndEmit({ ...existing, name, updatedAt: new Date().toISOString() });
    },

    setRoom(id: string, roomId: string | null): Device {
      const existing = cache.get(id);
      if (!existing) throw new Error(`Unknown device ${id}`);
      return persistAndEmit({
        ...existing,
        room: roomId ?? undefined,
        updatedAt: new Date().toISOString(),
      });
    },

    remove(id: string): void {
      cache.delete(id);
      deps.deviceStore.devices.remove(id);
      emitter.emit('device:removed', { id });
    },

    rooms: {
      list: (): Room[] => Array.from(roomCache.values()).sort((a, b) => a.order - b.order),
      get: (id: string): Room | null => roomCache.get(id) ?? null,
      create(input: { name: string; icon: string }): Room {
        const room: Room = {
          id: randomUUID(),
          name: input.name,
          icon: input.icon,
          order: roomCache.size,
          deviceIds: [],
          origin: 'local',
        };
        roomCache.set(room.id, room);
        deps.deviceStore.rooms.upsert(room);
        emitter.emit('room:upserted', room);
        return room;
      },
      update(id: string, patch: Partial<Pick<Room, 'name' | 'icon' | 'order'>>): Room {
        const existing = roomCache.get(id);
        if (!existing) throw new Error(`Unknown room ${id}`);
        const updated = { ...existing, ...patch };
        roomCache.set(id, updated);
        deps.deviceStore.rooms.upsert(updated);
        emitter.emit('room:upserted', updated);
        return updated;
      },
      /**
       * Upsert по explicit ID — для импорта из «Дома с Алисой» (id = yandex roomId).
       * Идемпотентно: при повторном sync'е обновляет name/order, origin остаётся 'yandex'.
       * deviceIds пересчитывается из текущего реестра — поэтому передаём из вне.
       */
      upsert(input: {
        id: string;
        name: string;
        icon: string;
        origin: Room['origin'];
        order?: number;
        deviceIds?: string[];
      }): Room {
        const existing = roomCache.get(input.id);
        const room: Room = {
          id: input.id,
          name: input.name,
          icon: input.icon,
          order: input.order ?? existing?.order ?? roomCache.size,
          deviceIds: input.deviceIds ?? existing?.deviceIds ?? [],
          origin: input.origin,
        };
        roomCache.set(room.id, room);
        deps.deviceStore.rooms.upsert(room);
        emitter.emit('room:upserted', room);
        return room;
      },
      remove(id: string): void {
        roomCache.delete(id);
        deps.deviceStore.rooms.remove(id);
        emitter.emit('room:removed', { id });
      },
    },

    /** Hub вызывает при app shutdown — отписываемся от всех push-стримов. */
    shutdown(): void {
      for (const unsub of pushUnsubscribes) {
        try {
          unsub();
        } catch {
          /* unsubscribe best-effort */
        }
      }
      pushUnsubscribes.length = 0;
    },
  };
}
