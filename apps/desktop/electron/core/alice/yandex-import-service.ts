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
import {
  detectCurrentNetwork,
  findHouseholdForNetwork,
  type NetworkSignature,
} from '../network/network-identity.js';
import { guessRoomIcon } from './room-icon-guesser.js';

export interface YandexImportSummary {
  imported: number;
  updated: number;
  removed: number;
  failed: number;
  /** Devices в Я.доме после household-фильтра. */
  total: number;
  rooms: number;
  /** Активный household. */
  householdId: string | null;
  /** Все households аккаунта — для UI selector'а. */
  availableHouseholds: YandexHomeHousehold[];
  /** Текущая сетевая identity (SSID + subnet). */
  currentNetwork: NetworkSignature | null;
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
    const currentNetwork = await detectCurrentNetwork();
    const householdId = this.resolveHousehold(households, currentNetwork);

    // Bind current network to active household — следующий sync на этой сети auto-pick.
    if (householdId) this.rememberNetworkForHousehold(householdId, currentNetwork);

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
      currentNetwork,
    };
    log.info(
      `YandexImport.sync: household=${householdId ?? 'all'} ssid=${currentNetwork.ssid ?? '-'} ` +
        `subnet=${currentNetwork.subnet ?? '-'} | +${summary.imported} imported, ` +
        `${summary.updated} updated, -${summary.removed} removed, ${summary.failed} failed, ` +
        `${summary.rooms} rooms (total ${summary.total}, ${households.length} households)`,
    );
    return summary;
  }

  /** Households + selected + current net + bound id + cloud-control flag. */
  async listHouseholds(): Promise<{
    households: YandexHomeHousehold[];
    selected: string | null;
    currentNetwork: NetworkSignature;
    boundHouseholdId: string | null;
    allowCloudControlOffNetwork: boolean;
  }> {
    this.validateAuth();
    await this.ensureDriver();
    await this.discoverFromYandex();
    const snapshot = this.cachedSnapshot();
    const currentNetwork = await detectCurrentNetwork();
    const bindings = this.deps.settings.get('householdNetworks');
    return {
      households: snapshot?.households ?? [],
      selected: this.deps.settings.get('selectedHouseholdId'),
      currentNetwork,
      boundHouseholdId: findHouseholdForNetwork(currentNetwork, bindings),
      allowCloudControlOffNetwork: this.deps.settings.get('allowCloudControlOffNetwork'),
    };
  }

  setCloudControlPolicy(allow: boolean): void {
    this.deps.settings.set('allowCloudControlOffNetwork', allow);
    log.info(`YandexImport: allowCloudControlOffNetwork = ${allow}`);
  }

  /**
   * Сохраняет выбор + purge yandex-устройств других домов + асинхронно отвязывает
   * текущую сеть от прежних bindings (anti-stale при перепривязке).
   */
  setSelectedHousehold(id: string | null): void {
    const prev = this.deps.settings.get('selectedHouseholdId');
    this.deps.settings.set('selectedHouseholdId', id);
    log.info(`YandexImport: selectedHouseholdId ${prev ?? 'null'} → ${id ?? 'null'}`);
    if (id && prev !== id) {
      let pruned = 0;
      for (const d of this.deps.deviceRegistry.list()) {
        if (
          d.driver === YandexImportService.DRIVER_ID &&
          d.meta?.['householdId'] !== id
        ) {
          this.deps.deviceRegistry.remove(d.id);
          pruned++;
        }
      }
      if (pruned > 0) log.info(`YandexImport: pruned ${pruned} devices from other households`);
      void this.unbindCurrentNetworkFromOtherHouseholds(id).catch((e) =>
        log.warn(`YandexImport: stale-binding cleanup failed: ${(e as Error).message}`),
      );
    }
  }

  /** Удаляет current network signature из bindings всех households кроме `keepId`. */
  private async unbindCurrentNetworkFromOtherHouseholds(keepId: string): Promise<void> {
    const current = await detectCurrentNetwork();
    if (!current.gatewayMac && !current.ssid && !current.subnet) return;
    const bindings = { ...this.deps.settings.get('householdNetworks') };
    let changed = false;
    for (const [hid, sigs] of Object.entries(bindings)) {
      if (hid === keepId) continue;
      const filtered = sigs.filter((s) => !this.signaturesMatch(s, current));
      if (filtered.length !== sigs.length) {
        bindings[hid] = filtered;
        changed = true;
      }
    }
    if (changed) {
      this.deps.settings.set('householdNetworks', bindings);
      log.info('YandexImport: cleaned stale network bindings from other households');
    }
  }

  private signaturesMatch(
    a: { gatewayMac?: string | null; ssid: string | null; subnet: string | null },
    b: NetworkSignature,
  ): boolean {
    if (a.gatewayMac && b.gatewayMac) return a.gatewayMac === b.gatewayMac;
    if (a.ssid && b.ssid) return a.ssid === b.ssid;
    if (!a.ssid && !b.ssid && !a.gatewayMac && !b.gatewayMac && a.subnet && b.subnet) {
      return a.subnet === b.subnet;
    }
    return false;
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
   * Resolution: 0→null | 1→auto | network-bound→switch+persist |
   * stored валиден И network match → ok | иначе throw NETWORK_MISMATCH/AMBIGUOUS.
   */
  private resolveHousehold(
    households: YandexHomeHousehold[],
    currentNetwork: NetworkSignature,
  ): string | null {
    if (households.length === 0) return null;

    if (households.length === 1) {
      const only = households[0]!.id;
      if (this.deps.settings.get('selectedHouseholdId') !== only) {
        this.deps.settings.set('selectedHouseholdId', only);
      }
      return only;
    }

    const bindings = this.deps.settings.get('householdNetworks');
    const networkBound = findHouseholdForNetwork(currentNetwork, bindings);
    if (networkBound && households.some((h) => h.id === networkBound)) {
      if (this.deps.settings.get('selectedHouseholdId') !== networkBound) {
        log.info(`YandexImport: network match → switching to ${networkBound}`);
        this.setSelectedHousehold(networkBound);
      }
      return networkBound;
    }

    const stored = this.deps.settings.get('selectedHouseholdId');
    if (stored && households.some((h) => h.id === stored)) {
      // Если household уже привязан к сетям и current не из них — sync rejected.
      const storedBindings = bindings[stored] ?? [];
      const onBoundNet =
        storedBindings.length === 0 ||
        storedBindings.some((b) => this.signaturesMatch(b, currentNetwork));
      if (!onBoundNet) {
        throw Object.assign(
          new Error(
            `Текущая сеть (${currentNetwork.ssid ?? currentNetwork.subnet ?? 'неизвестна'}) ` +
              `не привязана к активному дому. Подключитесь к домашней сети или ` +
              `выберите другой дом.`,
          ),
          { code: 'NETWORK_MISMATCH', currentNetwork, householdId: stored },
        );
      }
      return stored;
    }

    const list = households.map((h) => `«${h.name}»`).join(', ');
    throw Object.assign(
      new Error(
        `В аккаунте Яндекса ${households.length} домов: ${list}. ` +
          `Выберите активный дом перед синхронизацией.`,
      ),
      { code: 'HOUSEHOLD_AMBIGUOUS', households },
    );
  }

  /** Запоминает текущую сеть как одну из привязанных к household. */
  private rememberNetworkForHousehold(householdId: string, sig: NetworkSignature): void {
    if (!sig.gatewayMac && !sig.ssid && !sig.subnet) return;
    const all = { ...this.deps.settings.get('householdNetworks') };
    const list = all[householdId] ? [...all[householdId]] : [];
    if (list.some((existing) => this.signaturesMatch(existing, sig))) return;
    list.push(sig);
    all[householdId] = list;
    this.deps.settings.set('householdNetworks', all);
    log.info(
      `YandexImport: bound network mac=${sig.gatewayMac ?? '-'} ssid=${sig.ssid ?? '-'} subnet=${sig.subnet ?? '-'} → ${householdId}`,
    );
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
