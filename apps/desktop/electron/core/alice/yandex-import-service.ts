/**
 * Импорт «Дома с Алисой» в локальный реестр.
 *
 * `sync()`:
 *   1. validateAuth / ensureDriver
 *   2. discover() из yandex-iot
 *   3. resolveHousehold — settings.selectedHouseholdId | авто-выбор по max devices
 *   4. importRooms / importDevices с фильтром по household
 *   5. orphan-sweep с sanity-gates (skip если candidates=0 или ≥50% paired)
 */

import log from 'electron-log/main.js';
import type {
  DiscoveredDevice,
  YandexHomeHousehold,
  YandexHomeSnapshot,
} from '@smarthome/shared';
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
  /** Всего обнаружено устройств в Yandex'е (target, после фильтра household). */
  total: number;
  /** Сколько yandex-комнат прошло upsert. */
  rooms: number;
  /** ID активного дома, в который импортируем. */
  householdId: string | null;
  /** Все доступные дома — для UI selector'а. */
  availableHouseholds: YandexHomeHousehold[];
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
  /** Если orphan-sweep попытается удалить ≥ этого порога paired-устройств — отменяем. */
  private static readonly ORPHAN_SWEEP_MAX_RATIO = 0.5;

  constructor(private readonly deps: YandexImportServiceDeps) {}

  async sync(): Promise<YandexImportSummary> {
    this.validateAuth();
    await this.ensureDriver();

    // discover() может бросить (auth, network, 5xx) — пускаем наверх БЕЗ mutation'ов.
    const candidates = await this.discoverFromYandex();
    const snapshot = this.cachedSnapshot();
    const households = snapshot?.households ?? [];
    const householdId = this.resolveHousehold(households, candidates);

    const filteredCandidates = householdId
      ? candidates.filter((c) => c.meta?.['householdId'] === householdId)
      : candidates;
    const yandexDeviceIds = new Set(filteredCandidates.map((c) => c.externalId));

    const roomsImported = snapshot ? this.importRooms(snapshot, householdId) : 0;
    if (!snapshot) {
      log.warn('YandexImport: snapshot cache empty after discover() — rooms skipped');
    }

    const deviceStats = await this.importDevices(filteredCandidates, yandexDeviceIds);

    const summary: YandexImportSummary = {
      ...deviceStats,
      total: filteredCandidates.length,
      rooms: roomsImported,
      householdId,
      availableHouseholds: households,
    };
    log.info(
      `YandexImport.sync: household=${householdId ?? 'all'} | ` +
        `+${summary.imported} imported, ${summary.updated} updated, ` +
        `-${summary.removed} removed, ${summary.failed} failed, ${summary.rooms} rooms ` +
        `(total ${summary.total}, ${households.length} households available)`,
    );
    return summary;
  }

  /** Возвращает список households без mutation'ов — для UI селектора. */
  async listHouseholds(): Promise<{
    households: YandexHomeHousehold[];
    selected: string | null;
  }> {
    this.validateAuth();
    await this.ensureDriver();
    await this.discoverFromYandex();
    const snapshot = this.cachedSnapshot();
    return {
      households: snapshot?.households ?? [],
      selected: this.deps.settings.get('selectedHouseholdId'),
    };
  }

  /** Сохраняет выбор юзера. Следующий `sync()` отфильтрует по этому ID. */
  setSelectedHousehold(id: string | null): void {
    this.deps.settings.set('selectedHouseholdId', id);
    log.info(`YandexImport: selectedHouseholdId set to ${id ?? 'null'}`);
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

  /** stored ID если валиден → max-devices auto-pick → null (households пуст). */
  private resolveHousehold(
    households: YandexHomeHousehold[],
    candidates: DiscoveredDevice[],
  ): string | null {
    if (households.length === 0) return null;

    const stored = this.deps.settings.get('selectedHouseholdId');
    if (stored && households.some((h) => h.id === stored)) return stored;

    // Авто-выбор: дом с максимальным числом устройств.
    const counts = new Map<string, number>();
    for (const c of candidates) {
      const hid = c.meta?.['householdId'];
      if (typeof hid === 'string') counts.set(hid, (counts.get(hid) ?? 0) + 1);
    }
    let bestId = households[0]!.id;
    let bestCount = counts.get(bestId) ?? 0;
    for (const h of households) {
      const cnt = counts.get(h.id) ?? 0;
      if (cnt > bestCount) {
        bestId = h.id;
        bestCount = cnt;
      }
    }
    this.deps.settings.set('selectedHouseholdId', bestId);
    log.warn(
      `YandexImport: auto-selected household ${bestId} (${bestCount} devices) ` +
        `from ${households.length} available — set in settings.`,
    );
    return bestId;
  }

  /**
   * Идемпотентный upsert yandex-комнат + cleanup orphans.
   * ID локальной комнаты === yandex roomId — так фильтр устройств по комнате
   * работает join-style: device.room === room.id.
   */
  private importRooms(snapshot: YandexHomeSnapshot, householdId: string | null): number {
    const filteredRooms = householdId
      ? snapshot.rooms.filter((r) => !r.householdId || r.householdId === householdId)
      : snapshot.rooms;
    const yandexRoomIds = new Set(filteredRooms.map((r) => r.id));
    let imported = 0;
    for (let i = 0; i < filteredRooms.length; i++) {
      const r = filteredRooms[i]!;
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
    // Cleanup yandex-rooms; origin='local' не трогаем. Skip если filteredRooms пуст.
    if (filteredRooms.length > 0) {
      for (const room of this.deps.deviceRegistry.rooms.list()) {
        if (room.origin === 'yandex' && !yandexRoomIds.has(room.id)) {
          this.deps.deviceRegistry.rooms.remove(room.id);
        }
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
    const orphanCandidates = this.deps.deviceRegistry
      .list()
      .filter((d) => d.driver === YandexImportService.DRIVER_ID && !yandexDeviceIds.has(d.externalId));
    const pairedCount = this.deps.deviceRegistry
      .list()
      .filter((d) => d.driver === YandexImportService.DRIVER_ID).length;

    // Sanity-gates: skip sweep если candidates=0 при paired>0, или ratio≥50%.
    const willWipeAll = candidates.length === 0 && pairedCount > 0;
    const willWipeMost =
      pairedCount > 0 && orphanCandidates.length / pairedCount >= YandexImportService.ORPHAN_SWEEP_MAX_RATIO;
    if (willWipeAll || willWipeMost) {
      log.warn(
        `YandexImport: orphan sweep aborted — would remove ${orphanCandidates.length}/${pairedCount} ` +
          `(candidates=${candidates.length}). Likely API issue, not real removals.`,
      );
    } else {
      for (const d of orphanCandidates) {
        this.deps.deviceRegistry.remove(d.id);
        removed++;
      }
    }

    return { imported, updated, removed, failed, ...(lastError ? { lastError } : {}) };
  }
}
