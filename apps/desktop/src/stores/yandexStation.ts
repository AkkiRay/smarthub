/** Pinia store колонки Алисы: connection status + candidates + IPC-обёртки. */

import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  HubInfo,
  YandexHomeSnapshot,
  YandexStationCandidate,
  YandexStationCommand,
  YandexStationEvent,
  YandexStationStatus,
} from '@smarthome/shared';

const MAX_UI_EVENTS = 80;
import { YANDEX_STATION_PORT, YANDEX_STATION_SCAN_MS } from '@smarthome/shared';

/** Plain-clone Vue reactive proxy для IPC structured-clone. */
const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
import { useToasterStore } from './toaster';

export const useYandexStationStore = defineStore('yandexStation', () => {
  const status = ref<YandexStationStatus | null>(null);
  const info = ref<HubInfo | null>(null);
  const candidates = ref<YandexStationCandidate[]>([]);
  const isScanning = ref(false);
  /** Журнал glagol-событий (старое → новое). */
  const events = ref<YandexStationEvent[]>([]);
  /** Snapshot «Дома с Алисой». */
  const home = ref<YandexHomeSnapshot | null>(null);
  const isLoadingHome = ref(false);
  const homeError = ref<string | null>(null);

  async function fetchHome(): Promise<YandexHomeSnapshot | null> {
    if (isLoadingHome.value) return home.value;
    isLoadingHome.value = true;
    homeError.value = null;
    try {
      home.value = await window.smarthome.yandexStation.fetchHomeDevices();
      return home.value;
    } catch (e) {
      homeError.value = (e as Error).message;
      return null;
    } finally {
      isLoadingHome.value = false;
    }
  }

  // HMR-safe: setup-script of root view может перезапуститься (Vite HMR / Suspense remount),
  // и onMounted дёрнет bootstrap повторно. Без guard'а на каждый IPC-event навешивается
  // новый listener — один клик начинает писать N дубликатов в журнал.
  let subscribed = false;

  async function bootstrap(): Promise<void> {
    const [s, i, e] = await Promise.all([
      window.smarthome.yandexStation.getStatus(),
      window.smarthome.app.getHubInfo(),
      window.smarthome.yandexStation.getEvents(),
    ]);
    status.value = s;
    info.value = i;
    events.value = e.slice(-MAX_UI_EVENTS);
    if (subscribed) return;
    subscribed = true;
    window.smarthome.events.on('yandexStation:status', (next) => {
      status.value = next;
    });
    window.smarthome.events.on('yandexStation:event', (evt) => {
      // Defense-in-depth: даже если listener зарегался повторно (или main по ошибке
      // дублирует push), один и тот же event.id попадает в журнал ровно один раз.
      if (events.value.length > 0 && events.value[events.value.length - 1]?.id === evt.id) return;
      events.value.push(evt);
      if (events.value.length > MAX_UI_EVENTS) {
        events.value.splice(0, events.value.length - MAX_UI_EVENTS);
      }
    });
  }

  async function clearEvents(): Promise<void> {
    await window.smarthome.yandexStation.clearEvents();
    events.value = [];
  }

  async function scan(
    timeoutMs: number = YANDEX_STATION_SCAN_MS,
  ): Promise<YandexStationCandidate[]> {
    isScanning.value = true;
    try {
      candidates.value = await window.smarthome.yandexStation.discover(timeoutMs);
      return candidates.value;
    } finally {
      isScanning.value = false;
    }
  }

  async function connect(input: {
    host: string;
    port?: number;
    deviceId: string;
    token: string;
    platform?: string;
    name?: string;
  }): Promise<YandexStationStatus> {
    const toaster = useToasterStore();
    return toaster.run(
      async () => {
        status.value = await window.smarthome.yandexStation.connect(
          toPlain({ ...input, port: input.port ?? YANDEX_STATION_PORT }),
        );
        info.value = await window.smarthome.app.getHubInfo();
        return status.value;
      },
      { success: 'Колонка подключена', error: 'Не удалось подключиться' },
    );
  }

  async function disconnect(): Promise<void> {
    status.value = await window.smarthome.yandexStation.disconnect();
    info.value = await window.smarthome.app.getHubInfo();
  }

  async function sendCommand(command: YandexStationCommand): Promise<boolean> {
    const result = await window.smarthome.yandexStation.sendCommand(toPlain(command));
    if (!result.ok) {
      const toaster = useToasterStore();
      toaster.push({ kind: 'error', message: result.error ?? 'Ошибка отправки команды' });
    }
    return result.ok;
  }

  return {
    status,
    info,
    candidates,
    isScanning,
    events,
    home,
    isLoadingHome,
    homeError,
    bootstrap,
    scan,
    connect,
    disconnect,
    sendCommand,
    clearEvents,
    fetchHome,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useYandexStationStore, import.meta.hot));
}
