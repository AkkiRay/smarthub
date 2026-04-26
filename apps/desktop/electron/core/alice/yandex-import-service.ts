/**
 * Импорт «Дома с Алисой» в локальный реестр.
 *
 * Один публичный метод — `sync()`. Внутри:
 *   1. validateAuth     — кидает понятную ошибку, если юзер не вошёл через Яндекс.
 *   2. ensureDriver     — реактивирует yandex-iot-driver (после signIn).
 *   3. discoverFromYandex — driver.discover() + кэш-snapshot.
 *   4. importRooms      — yandex room.id ↦ локальная Room (origin='yandex').
 *   5. importDevices    — pair / refresh / remove orphans.
 *   6. summary          — счётчики для toast'а.
 *
 * Расширения (когда понадобятся): importGroups, importScenarios, importHouseholds —
 * добавляются как новые private-методы, sync() вызывает их между импортом комнат
 * и устройств. Все side-effect'ы локализованы здесь, а не размазаны по hub'у.
 */

import log from 'electron-log/main.js';
import type { DiscoveredDevice, YandexHomeSnapshot } from '@smarthome/shared';
import type { SettingsStore } from '../storage/settings-store.js';
import type { DriverRegistry } from '../drivers/driver-registry.js';
import type { DeviceRegistry } from '../registry/device-registry.js';
import { guessRoomIcon } from './room-icon-guesser.js';

export interface YandexImportSummary {
  /** Новых устройств запейрено в локальном реестре. */
  imported: number;
  /** Существующих устройств — обновлено state'ом. */
  updated: number;
  /** Удалено устройств, которых больше нет в Я.Доме. */
  removed: number;
  /** Сколько pair/refresh упало (auth протух / single-device 404 / etc). */
  failed: number;
  /** Всего обнаружено устройств в Yandex'е (target). */
  total: number;
  /** Сколько yandex-комнат прошло upsert. */
  rooms: number;
  /** Сообщение последней ошибки — пробрасываем в toast вместе с failed > 0. */
  lastError?: string;
}

export interface YandexImportServiceDeps {
  settings: SettingsStore;
  driverRegistry: DriverRegistry;
  deviceRegistry: DeviceRegistry;
}

/** Драйвер yandex-iot выставляет этот метод (cached snapshot после discover). */
interface YandexIotDriverLike {
  getCachedSnapshot?(): YandexHomeSnapshot | null;
}

export class YandexImportService {
  private static readonly DRIVER_ID = 'yandex-iot';

  constructor(private readonly deps: YandexImportServiceDeps) {}

  async sync(): Promise<YandexImportSummary> {
    this.validateAuth();
    await this.ensureDriver();

    const candidates = await this.discoverFromYandex();
    const yandexDeviceIds = new Set(candidates.map((c) => c.externalId));
    const snapshot = this.cachedSnapshot();

    const roomsImported = snapshot ? this.importRooms(snapshot) : 0;
    if (!snapshot) {
      log.warn('YandexImport: snapshot cache empty after discover() — rooms skipped');
    }

    const deviceStats = await this.importDevices(candidates, yandexDeviceIds);

    const summary: YandexImportSummary = {
      ...deviceStats,
      total: candidates.length,
      rooms: roomsImported,
    };
    log.info(
      `YandexImport.sync: +${summary.imported} imported, ${summary.updated} updated, ` +
        `-${summary.removed} removed, ${summary.failed} failed, ${summary.rooms} rooms ` +
        `(total ${summary.total})`,
    );
    return summary;
  }

  // ---- private --------------------------------------------------------------

  private validateAuth(): void {
    const auth = this.deps.settings.get('quasarAuth');
    if (!auth?.musicToken) {
      throw new Error('Не авторизованы в Яндексе. Войдите через раздел «Подключение Алисы».');
    }
  }

  private async ensureDriver(): Promise<void> {
    if (this.deps.driverRegistry.get(YandexImportService.DRIVER_ID)) return;
    // Auth уже есть, но driver ещё не зарегистрирован (race с reloadDriver()
    // после signIn). Реактивируем — driver.create() прочитает свежий quasarAuth.
    await this.deps.driverRegistry.reloadDriver(YandexImportService.DRIVER_ID);
    if (!this.deps.driverRegistry.get(YandexImportService.DRIVER_ID)) {
      throw new Error('Драйвер «Дом с Алисой» не запустился. Попробуйте перезайти через Яндекс.');
    }
  }

  private async discoverFromYandex(): Promise<DiscoveredDevice[]> {
    const driver = this.deps.driverRegistry.require(YandexImportService.DRIVER_ID);
    const ac = new AbortController();
    return driver.discover(ac.signal);
  }

  /** Snapshot из кэша драйвера (заполняется в discover() выше). */
  private cachedSnapshot(): YandexHomeSnapshot | null {
    const driver = this.deps.driverRegistry.get(
      YandexImportService.DRIVER_ID,
    ) as unknown as YandexIotDriverLike | null;
    return driver?.getCachedSnapshot?.() ?? null;
  }

  /**
   * Идемпотентный upsert yandex-комнат + cleanup orphans.
   * ID локальной комнаты === yandex roomId — так фильтр устройств по комнате
   * работает join-style: device.room === room.id.
   */
  private importRooms(snapshot: YandexHomeSnapshot): number {
    const yandexRoomIds = new Set(snapshot.rooms.map((r) => r.id));
    let imported = 0;
    for (let i = 0; i < snapshot.rooms.length; i++) {
      const r = snapshot.rooms[i]!;
      try {
        this.deps.deviceRegistry.rooms.upsert({
          id: r.id,
          name: r.name,
          icon: guessRoomIcon(r.name),
          origin: 'yandex',
          order: i,
          // deviceIds регистрируем при device-обновлениях; здесь не трогаем.
        });
        imported++;
      } catch (e) {
        log.warn(
          `YandexImport.importRooms: ${r.id} (${r.name}) failed: ${(e as Error).message}`,
        );
      }
    }
    // Удаляем yandex-комнаты, которых больше нет в Я.Доме. Локальные (origin='local')
    // не трогаем — пользователь создал их вручную.
    for (const room of this.deps.deviceRegistry.rooms.list()) {
      if (room.origin === 'yandex' && !yandexRoomIds.has(room.id)) {
        this.deps.deviceRegistry.rooms.remove(room.id);
      }
    }
    return imported;
  }

  /**
   * Идемпотентный pair/refresh устройств + cleanup orphans.
   * Возвращает счётчики без `total`/`rooms` (их добавляет sync()).
   */
  private async importDevices(
    candidates: DiscoveredDevice[],
    yandexDeviceIds: Set<string>,
  ): Promise<Pick<YandexImportSummary, 'imported' | 'updated' | 'removed' | 'failed' | 'lastError'>> {
    let imported = 0;
    let updated = 0;
    let failed = 0;
    let lastError: string | undefined;

    for (const c of candidates) {
      const existing = this.deps.deviceRegistry.findByExternalId(
        YandexImportService.DRIVER_ID,
        c.externalId,
      );
      try {
        if (existing) {
          await this.deps.deviceRegistry.refresh(existing.id);
          updated++;
        } else {
          await this.deps.deviceRegistry.pair(c);
          imported++;
        }
      } catch (e) {
        failed++;
        lastError = (e as Error).message;
        log.warn(
          `YandexImport.importDevices: pair/refresh ${c.externalId} (${c.name}) failed: ${lastError}`,
        );
      }
    }

    let removed = 0;
    for (const d of this.deps.deviceRegistry.list()) {
      if (d.driver === YandexImportService.DRIVER_ID && !yandexDeviceIds.has(d.externalId)) {
        this.deps.deviceRegistry.remove(d.id);
        removed++;
      }
    }

    return { imported, updated, removed, failed, ...(lastError ? { lastError } : {}) };
  }
}
