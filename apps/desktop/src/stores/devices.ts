/**
 * @fileoverview Pinia-store сопряжённых устройств — single source of truth для
 * renderer'а.
 *
 * Что внутри:
 *   - `devices: ref<Device[]>` — список из main process'а (получен через
 *     `window.smarthome.devices.list()` на mount + IPC `device:updated` events).
 *   - `byId(id)` — индекс для быстрого lookup'а в компонентах.
 *   - `byRoom(roomId)` — фильтр для RoomsView.
 *   - `execute(cmd)` — оборачивает IPC `devices.execute`, на ERROR кидает toast.
 *   - `executeSilent(cmd)` — тот же execute, но без авто-toast'а (для bulk-операций
 *     где caller сам аггрегирует результаты в один summary-toast).
 *   - `rename(id, name)`, `setRoom(...)`, `remove(...)`, `refresh(...)` — IPC
 *     wrappers с локальным cache patching.
 *
 * HMR: `acceptHMRUpdate` сохраняет state при vite hot-reload — devices не
 * пере-fetch'атся на каждое сохранение файла.
 */

import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DiscoveredDevice,
  DiscoveryProgress,
} from '@smarthome/shared';
import { useToasterStore } from './toaster';
import { useYandexStationStore } from './yandexStation';

/** JSON-roundtrip: Vue Proxy не сериализуется через IPC structured-clone. */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const EMPTY_PROGRESS: DiscoveryProgress = {
  cycleActive: false,
  cycleStartedAt: 0,
  drivers: [],
};

export const useDevicesStore = defineStore('devices', () => {
  const devices = ref<Device[]>([]);
  const candidates = ref<DiscoveredDevice[]>([]);
  const isDiscovering = ref(false);
  const isLoading = ref(false);
  // Инициализируется через discovery.getProgress() при bootstrap, чтобы UI не пустовал до первого push'а.
  const discoveryProgress = ref<DiscoveryProgress>(EMPTY_PROGRESS);

  const onlineCount = computed(() => devices.value.filter((d) => d.status === 'online').length);
  const offlineCount = computed(() => devices.value.filter((d) => d.status !== 'online').length);

  const byId = computed(() => {
    const m = new Map<string, Device>();
    for (const d of devices.value) m.set(d.id, d);
    return m;
  });

  const byRoom = computed(() => {
    const m = new Map<string, Device[]>();
    for (const d of devices.value) {
      const key = d.room ?? '__unassigned';
      const list = m.get(key) ?? [];
      list.push(d);
      m.set(key, list);
    }
    return m;
  });

  const lights = computed(() => devices.value.filter((d) => d.type === 'devices.types.light'));

  // Live derivation: backend ставит `knownDeviceId` только в scan-цикле — флаг становится stale.
  // Тут считаем актуально через event `device:updated`/`device:removed`.
  const pairedByExternalKey = computed(() => {
    const m = new Map<string, string>();
    for (const d of devices.value) m.set(`${d.driver}:${d.externalId}`, d.id);
    return m;
  });

  function pairedDeviceIdFor(
    c: Pick<DiscoveredDevice, 'driver' | 'externalId'>,
  ): string | undefined {
    return pairedByExternalKey.value.get(`${c.driver}:${c.externalId}`);
  }

  /**
   * Кандидаты, которых ещё НЕТ в реестре. Используется в /discovery и в badge'е
   * сайдбара — иначе badge «Поиск» зеркалит badge «Устройства» (один и тот же
   * физический девайс присутствует и там, и там после первого pair'а).
   */
  const unpairedCandidates = computed(() =>
    candidates.value.filter((c) => !pairedByExternalKey.value.has(`${c.driver}:${c.externalId}`)),
  );

  async function bootstrap() {
    isLoading.value = true;
    try {
      const [list, cand, progress] = await Promise.all([
        window.smarthome.devices.list(),
        window.smarthome.discovery.candidates(),
        window.smarthome.discovery.getProgress(),
      ]);
      devices.value = list;
      candidates.value = cand;
      discoveryProgress.value = progress;
    } finally {
      isLoading.value = false;
    }
  }

  // HMR-safe: App.vue:onMounted может дёрнуть subscribeRealtime повторно при
  // Vite-перезапуске setup-script'а — без guard'а listeners стакаются и каждый
  // device-event приходит N раз.
  let realtimeSubscribed = false;

  function subscribeRealtime() {
    if (realtimeSubscribed) return;
    realtimeSubscribed = true;
    window.smarthome.events.on('device:updated', (device) => {
      const idx = devices.value.findIndex((d) => d.id === device.id);
      if (idx === -1) devices.value = [device, ...devices.value];
      else devices.value.splice(idx, 1, device);
    });
    window.smarthome.events.on('device:removed', ({ id }) => {
      devices.value = devices.value.filter((d) => d.id !== id);
    });
    window.smarthome.events.on('discovery:candidate', (c) => {
      const key = `${c.driver}:${c.externalId}`;
      const idx = candidates.value.findIndex((x) => `${x.driver}:${x.externalId}` === key);
      if (idx === -1) candidates.value = [...candidates.value, c];
      else candidates.value.splice(idx, 1, c);
    });
    window.smarthome.events.on('discovery:state', ({ running }) => {
      isDiscovering.value = running;
    });
    window.smarthome.events.on('discovery:progress', (progress) => {
      discoveryProgress.value = progress;
    });
  }

  async function startDiscovery(opts: { mode?: 'once' | 'continuous' } = {}) {
    // Default 'once' — предсказуемый UX, не нагружаем фон UDP-сокетами.
    await window.smarthome.discovery.start({ mode: opts.mode ?? 'once' });
    isDiscovering.value = true;
  }
  async function stopDiscovery() {
    await window.smarthome.discovery.stop();
    isDiscovering.value = false;
  }

  /** Pair с тостами — для legacy quick-pair меню. */
  async function pair(candidate: DiscoveredDevice): Promise<Device> {
    const toaster = useToasterStore();
    return toaster
      .run(window.smarthome.discovery.pair(toPlain(candidate)), {
        error: 'Не удалось добавить устройство',
      })
      .then((device) => {
        toaster.push({ kind: 'success', message: `${device.name} подключён` });
        return device;
      });
  }

  /** Без тостов и без catch — для `PairDeviceFlow.vue`, который сам рендерит progress + error. */
  async function pairSilent(candidate: DiscoveredDevice): Promise<Device> {
    return window.smarthome.discovery.pair(toPlain(candidate));
  }

  async function execute(command: DeviceCommand): Promise<DeviceCommandResult> {
    const result = await window.smarthome.devices.execute(toPlain(command));
    if (result.status === 'ERROR') {
      const toaster = useToasterStore();
      toaster.push({ kind: 'error', message: result.errorMessage ?? 'Команда не выполнена' });
    }
    return result;
  }

  /**
   * Execute без авто-toaster — для bulk-операций (комната включает 10 ламп —
   * 10 одинаковых toast'ов с одной и той же ошибкой бесполезны). Caller сам
   * аггрегирует результаты и показывает один summary-toast.
   */
  async function executeSilent(command: DeviceCommand): Promise<DeviceCommandResult> {
    return window.smarthome.devices.execute(toPlain(command));
  }

  async function rename(id: string, name: string): Promise<Device> {
    const updated = await window.smarthome.devices.rename(id, name);
    const idx = devices.value.findIndex((d) => d.id === id);
    if (idx !== -1) devices.value.splice(idx, 1, updated);
    return updated;
  }

  async function remove(id: string) {
    await window.smarthome.devices.remove(id);
    devices.value = devices.value.filter((d) => d.id !== id);
  }

  async function refresh(id: string) {
    const updated = await window.smarthome.devices.refresh(id);
    const idx = devices.value.findIndex((d) => d.id === id);
    if (idx !== -1) devices.value.splice(idx, 1, updated);
  }

  type SyncSummary = {
    imported: number;
    updated: number;
    removed: number;
    failed: number;
    total: number;
    rooms: number;
    householdId: string | null;
    availableHouseholds: Array<{ id: string; name: string }>;
    currentNetwork: {
      gatewayMac: string | null;
      ssid: string | null;
      subnet: string | null;
      detectedAt: string;
    } | null;
    lastError?: string;
  };

  // Concurrent callers (RoomsView/DevicesView/AliceHomeDevices/onMount) share одну
  // Promise — иначе HOUSEHOLD_AMBIGUOUS/NETWORK_MISMATCH плодит дубль-toast'ы.
  let inflightSync: Promise<SyncSummary> | null = null;

  /**
   * Тянет устройства из «Дома с Алисой» через iot.quasar и импортирует в реестр.
   * Backend сам разрулит pair/refresh/remove. UI получит дельту через push-events.
   */
  async function syncYandexHome(opts: { silent?: boolean } = {}): Promise<SyncSummary> {
    if (inflightSync) return inflightSync;
    inflightSync = runSync(opts).finally(() => {
      inflightSync = null;
    });
    return inflightSync;
  }

  async function runSync(opts: { silent?: boolean }): Promise<SyncSummary> {
    const toaster = useToasterStore();
    // silent — для авто-backfill'а на маунте /devices: пользователь не нажимал
    // кнопку «Из Яндекса», ему не нужен «Синхронизация…» toast.
    const pendingId = opts.silent
      ? null
      : toaster.push({
          kind: 'pending',
          message: 'Синхронизация с Яндексом…',
        });
    try {
      const summary = await window.smarthome.yandexStation.syncHomeDevices();
      // Подтянем актуальный snapshot — на случай, если push-event'ы прилетели позже.
      const fresh = await window.smarthome.devices.list();
      devices.value = fresh;

      try {
        const rooms = await window.smarthome.rooms.list();
        const roomsStore = (await import('./rooms')).useRoomsStore();
        roomsStore.setRooms(rooms);
      } catch {
        /* rooms-store не открыт или backend не доступен — переоткроется при mount */
      }

      // Сводка для пользователя. Если все попытки pair/refresh упали — это error-toast,
      // чтобы юзер сразу видел, что что-то сломано, а не «синхронизировано 5» при нуле.
      const allFailed = summary.failed > 0 && summary.failed === summary.total;
      let kind: 'success' | 'error' = 'success';
      let message: string;
      let detail: string | undefined;

      if (summary.total === 0) {
        // Если станция уже подключена локально через glagol, простое «нет
        // устройств» врёт — у пользователя есть колонка, она просто не в
        // облачном реестре «Дома с Алисой». Объясняем разрыв двух каналов.
        const stationConnected =
          useYandexStationStore().status?.connection === 'connected';
        if (stationConnected) {
          message = 'Колонка работает локально, но не в «Доме с Алисой»';
          detail =
            'Локальный канал уже подключён. Чтобы получить полный пульт через хаб, добавьте колонку в приложении «Дом с Алисой» от Яндекса.';
        } else {
          message = 'В аккаунте Яндекса нет устройств';
        }
      } else if (allFailed) {
        kind = 'error';
        message = `Не удалось импортировать ${summary.total} устройств`;
        detail = summary.lastError ?? 'Подробности в main.log';
      } else {
        const parts: string[] = [];
        if (summary.imported) parts.push(`+${summary.imported} новых`);
        if (summary.updated) parts.push(`${summary.updated} обновлено`);
        if (summary.removed) parts.push(`-${summary.removed} удалено`);
        if (summary.failed) parts.push(`${summary.failed} с ошибкой`);
        message = parts.length
          ? `Синхронизация: ${parts.join(', ')}`
          : `Уже актуально (${summary.total} устройств)`;
        if (summary.rooms) detail = `Импортировано комнат: ${summary.rooms}`;
        if (summary.failed && summary.lastError) detail = summary.lastError;
      }
      if (pendingId !== null) {
        toaster.update(pendingId, {
          kind,
          message,
          ...(detail ? { detail } : {}),
        });
      }
      return summary;
    } catch (e) {
      const msg = (e as Error).message ?? 'Неизвестная ошибка';
      // IPC сериализует Error без custom props — детектим по тексту message.
      // HOUSEHOLD_AMBIGUOUS / NETWORK_MISMATCH — user-actionable, не unexpected.
      const isUserAction =
        msg.startsWith('В аккаунте Яндекса') || msg.startsWith('Текущая сеть');
      if (pendingId !== null) {
        toaster.update(pendingId, {
          kind: isUserAction ? 'pending' : 'error',
          message: isUserAction ? msg : `Не удалось синхронизировать: ${msg}`,
        });
      }
      throw e;
    }
  }

  return {
    devices,
    candidates,
    unpairedCandidates,
    isDiscovering,
    isLoading,
    discoveryProgress,
    byId,
    byRoom,
    lights,
    onlineCount,
    offlineCount,
    pairedByExternalKey,
    pairedDeviceIdFor,
    bootstrap,
    subscribeRealtime,
    startDiscovery,
    stopDiscovery,
    pair,
    pairSilent,
    execute,
    executeSilent,
    rename,
    remove,
    refresh,
    syncYandexHome,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDevicesStore, import.meta.hot));
}
