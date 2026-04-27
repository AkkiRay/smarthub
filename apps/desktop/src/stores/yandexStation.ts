/** Pinia store колонки Алисы: connection status + candidates + IPC-обёртки. */

import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref } from 'vue';
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

/** Plain-clone Vue reactive proxy для IPC `structured-clone`. */
const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
import { useToasterStore } from './toaster';

export const useYandexStationStore = defineStore('yandexStation', () => {
  const status = ref<YandexStationStatus | null>(null);
  const info = ref<HubInfo | null>(null);
  const candidates = ref<YandexStationCandidate[]>([]);
  const isScanning = ref(false);
  /** Журнал glagol-событий (старое → новое). */
  const events = ref<YandexStationEvent[]>([]);
  /** Snapshot «Дома с Алисой» (raw — все households аккаунта). */
  const home = ref<YandexHomeSnapshot | null>(null);
  const isLoadingHome = ref(false);
  const homeError = ref<string | null>(null);
  /** Активный household — backend-truth, обновляется через listHouseholds/setHousehold. */
  const selectedHouseholdId = ref<string | null>(null);

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

  /**
   * Snapshot, отфильтрованный по `selectedHouseholdId`. Quasar API возвращает
   * все households одним ответом — фильтрация на стороне UI.
   *
   * При `selectedHouseholdId === null` возвращает raw без фильтра.
   */
  const homeFiltered = computed<YandexHomeSnapshot | null>(() => {
    const raw = home.value;
    if (!raw) return null;
    const id = selectedHouseholdId.value;
    if (!id) return raw;
    const filteredDevices = raw.devices.filter((d) => d.householdId === id);
    const deviceIds = new Set(filteredDevices.map((d) => d.id));
    return {
      ...raw,
      devices: filteredDevices,
      rooms: raw.rooms.filter((r) => !r.householdId || r.householdId === id),
      groups: raw.groups.filter((g) => !g.householdId || g.householdId === id),
      // Scenario не содержит `householdId` — match по device-membership.
      scenarios: raw.scenarios.filter((s) => s.devices.some((d) => deviceIds.has(d))),
    };
  });

  function setSelectedHousehold(id: string | null): void {
    selectedHouseholdId.value = id;
  }

  /**
   * Голосовое состояние Алисы, нормализованное к 4 значениям для JarvisOrb:
   * `idle | listening | speaking | busy`. Glagol-states `SHAZAM` и прочие → `busy`.
   *
   * При `connection !== 'connected'` всегда `idle`.
   *
   * Glagol-quirk: явный `aliceState='SPEAKING'` часто пропускается, во время
   * TTS приходит `BUSY` либо `THINKING` + `vinsResponse.cards[].text` в одном
   * event'е. Поэтому источник истины SPEAKING — `aliceText`, появившийся
   * ПОСЛЕ последнего `aliceState='IDLE'` (включая same-event со state'ом).
   */
  const voiceState = computed<'idle' | 'listening' | 'speaking' | 'busy'>(() => {
    if (status.value?.connection !== 'connected') return 'idle';

    let latestStateIdx = -1;
    let latestState: string | undefined;
    let latestAliceTextIdx = -1;
    let latestIdleIdx = -1;
    for (let i = events.value.length - 1; i >= 0; i--) {
      const e = events.value[i];
      if (!e) continue;
      if (latestStateIdx === -1 && e.aliceState) {
        latestStateIdx = i;
        latestState = e.aliceState;
      }
      if (latestAliceTextIdx === -1 && e.aliceText) {
        latestAliceTextIdx = i;
      }
      if (latestIdleIdx === -1 && e.aliceState === 'IDLE') {
        latestIdleIdx = i;
      }
      if (latestStateIdx !== -1 && latestAliceTextIdx !== -1 && latestIdleIdx !== -1) break;
    }

    // aliceText появился после последнего IDLE — Алиса сейчас озвучивает ответ.
    // Покрывает: BUSY+aliceText same-event, THINKING+aliceText same-event,
    // и любые будущие state-метки glagol'а во время TTS.
    if (latestAliceTextIdx !== -1 && latestAliceTextIdx > latestIdleIdx) return 'speaking';

    if (latestState === 'LISTENING') return 'listening';
    if (latestState === 'SPEAKING') return 'speaking';
    if (latestState === 'IDLE') return 'idle';
    if (latestState) return 'busy'; // BUSY, SHAZAM, прочее
    return 'idle';
  });

  // HMR-guard: bootstrap идемпотентен, IPC-listener'ы регистрируются один раз.
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
      // Дедуп по `event.id` — гарантирует at-most-once в журнале.
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
    homeFiltered,
    isLoadingHome,
    homeError,
    selectedHouseholdId,
    setSelectedHousehold,
    voiceState,
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
