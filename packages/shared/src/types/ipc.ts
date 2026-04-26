/**
 * @fileoverview Compile-time контракт IPC между renderer'ом и main process'ом.
 *
 * Каждый канал, доступный в renderer'е через `window.smarthome.*`, ОБЯЗАН
 * быть описан в {@link IpcApi} — иначе TypeScript отвергнет вызов на этапе
 * сборки. Push-события (main → renderer) перечислены в {@link IpcEvents}.
 *
 * Архитектурный invariant:
 *   1. Renderer НИКОГДА не импортирует код main process'а напрямую.
 *   2. Все payload'ы — простые JSON-сериализуемые объекты (без функций,
 *      classes, Date — только plain objects, arrays, primitives).
 *   3. preload-script (`apps/desktop/electron/preload/index.ts`) пробрасывает
 *      сюда `contextBridge.exposeInMainWorld('smarthome', api)`.
 *
 * NOTE: namespace `window.chrome` НЕ используется — он зарезервирован
 * Chromium'ом под DevTools / extension API, contextBridge туда не пробивается.
 */

import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DiscoveredDevice,
  DriverId,
  Room,
} from './device.js';
import type { Scene } from './scene.js';
import type { DriverDescriptor } from './driver.js';
import type { DriverCredentials } from './driver-credentials.js';
import type {
  YandexStationCandidate,
  YandexStationCommand,
  YandexStationEvent,
  YandexStationStatus,
} from './yandex-station.js';
import type {
  AliceDeviceExposure,
  AliceDevicePreview,
  AliceSceneExposure,
  AliceSkillConfig,
  AliceStatus,
  GlagolPairingState,
} from './alice.js';

/** Значения Node os.platform() / process.platform. */
export type Platform = 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32';

export interface IpcApi {
  app: {
    getVersion: () => Promise<string>;
    getPlatform: () => Promise<Platform>;
    getHubInfo: () => Promise<HubInfo>;
    openExternal: (url: string) => Promise<void>;
    /** Fire-and-forget report renderer-ошибок в main.log. */
    reportError: (payload: { source: string; message: string; stack?: string }) => void;
  };
  /**
   * НЕ под `window.chrome` — этот namespace зарезервирован Chromium под DevTools/extension API,
   * contextBridge туда не пробивается.
   */
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
  };
  devices: {
    list: () => Promise<Device[]>;
    get: (id: string) => Promise<Device | null>;
    rename: (id: string, name: string) => Promise<Device>;
    setRoom: (id: string, roomId: string | null) => Promise<Device>;
    remove: (id: string) => Promise<void>;
    refresh: (id: string) => Promise<Device>;
    refreshAll: () => Promise<Device[]>;
    execute: (command: DeviceCommand) => Promise<DeviceCommandResult>;
  };
  discovery: {
    /**
     * mode: 'once' (default) — один цикл и стоп; 'continuous' — автоповтор каждые ~15с (debug).
     */
    start: (opts?: { mode?: 'once' | 'continuous' }) => Promise<void>;
    stop: () => Promise<void>;
    isRunning: () => Promise<boolean>;
    candidates: () => Promise<DiscoveredDevice[]>;
    pair: (candidate: DiscoveredDevice) => Promise<Device>;
    /** Снимок для инициализации UI после mount/refresh — renderer не ждёт следующий push. */
    getProgress: () => Promise<DiscoveryProgress>;
  };
  rooms: {
    list: () => Promise<Room[]>;
    create: (input: { name: string; icon: string }) => Promise<Room>;
    update: (id: string, patch: Partial<Pick<Room, 'name' | 'icon' | 'order'>>) => Promise<Room>;
    remove: (id: string) => Promise<void>;
  };
  scenes: {
    list: () => Promise<Scene[]>;
    create: (input: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Scene>;
    update: (id: string, patch: Partial<Scene>) => Promise<Scene>;
    remove: (id: string) => Promise<void>;
    run: (id: string) => Promise<void>;
  };
  drivers: {
    list: () => Promise<DriverDescriptor[]>;
    /** Tuya apiKey, MQTT url, ... — параметризовано по DriverId через DriverCredentialsMap. */
    setCredentials: <D extends DriverId>(driverId: D, creds: DriverCredentials<D>) => Promise<void>;
    getCredentials: <D extends DriverId>(driverId: D) => Promise<DriverCredentials<D>>;
  };
  yandexStation: {
    /** mDNS-сканер на N секунд. */
    discover: (timeoutMs?: number) => Promise<YandexStationCandidate[]>;
    /** Сохранить credentials и попытаться подключиться. Используется для ручного flow. */
    connect: (input: {
      host: string;
      port?: number;
      deviceId: string;
      token: string;
      platform?: string;
      name?: string;
    }) => Promise<YandexStationStatus>;
    disconnect: () => Promise<YandexStationStatus>;
    getStatus: () => Promise<YandexStationStatus>;
    sendCommand: (command: YandexStationCommand) => Promise<{ ok: boolean; error?: string }>;

    /** Snapshot ring-buffer'а событий glagol-сессии. */
    getEvents: () => Promise<YandexStationEvent[]>;
    /** Очистить буфер событий. */
    clearEvents: () => Promise<void>;

    // === OAuth + Quasar API: автоматический flow подключения колонки ===
    /** Текущий статус OAuth-привязки к Я.Музыке. */
    getAuthStatus: () => Promise<import('./yandex-station.js').YandexAuthStatus>;
    /** Открыть BrowserWindow с oauth.yandex.ru. Возвращает true если получили music_token. */
    signIn: () => Promise<{ ok: boolean; error?: string }>;
    /** Вылогинить — стереть music_token и cookies партиции. */
    signOut: () => Promise<void>;
    /**
     * Получить список колонок аккаунта (Quasar /glagol/device_list) + проверить mDNS.
     * Возвращает enriched-карточки для UI выбора.
     */
    fetchStations: () => Promise<import('./yandex-station.js').YandexStationOnAccount[]>;
    /** Snapshot «Дома с Алисой» (устройства / комнаты / группы / сценарии). */
    fetchHomeDevices: () => Promise<import('./yandex-station.js').YandexHomeSnapshot>;
    /** Запустить сценарий по id. */
    runHomeScenario: (scenarioId: string) => Promise<{ ok: boolean; error?: string }>;
    /** Полные детали (steps, settings, triggers raw) — для редактора. */
    fetchScenarioDetails: (
      scenarioId: string,
    ) => Promise<import('./yandex-station.js').YandexHomeScenarioDetails | null>;
    renameHomeScenario: (
      scenarioId: string,
      name: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    deleteHomeScenario: (scenarioId: string) => Promise<{ ok: boolean; error?: string }>;
    setHomeScenarioActive: (
      scenarioId: string,
      active: boolean,
    ) => Promise<{ ok: boolean; error?: string }>;
    /**
     * Импортирует устройства И комнаты из «Дома с Алисой» в локальный реестр.
     * Идемпотентно: новые — pair/upsert, существующие — refresh, исчезнувшие — remove.
     * `rooms` — число upsert'нутых yandex-комнат (id комнат = yandex roomId).
     */
    syncHomeDevices: () => Promise<{
      imported: number;
      updated: number;
      removed: number;
      failed: number;
      total: number;
      rooms: number;
      lastError?: string;
    }>;
    /**
     * Открывает embedded-окно «Дома с Алисой» (yandex.ru/quasar/iot) в той же
     * OAuth-партиции — юзер уже авторизован, может добавить лампочку прямо
     * внутри хаба. После закрытия окна автоматически делает sync — возвращает
     * тот же summary, что `syncHomeDevices()`.
     */
    openHomeBindingWindow: () => Promise<{
      imported: number;
      updated: number;
      removed: number;
      failed: number;
      total: number;
      rooms: number;
      lastError?: string;
    }>;
    /**
     * Полный auto-connect: запрашивает per-device JWT и поднимает WSS.
     * Если UI знает host/port из `fetchStations()` — лучше передать их сюда, чтобы
     * не делать второй 4-секундный mDNS-scan. Если их нет — фолбэк на свежий scan.
     */
    connectStation: (input: {
      deviceId: string;
      platform: string;
      name?: string;
      host?: string;
      port?: number;
    }) => Promise<YandexStationStatus>;
  };
  alice: {
    /** Один снимок всего alice-state — UI получает в onMounted, далее обновления через alice:status. */
    getStatus: () => Promise<AliceStatus>;

    // === Skill config & lifecycle ===
    /** Сохранить креды навыка. После save — кнопка «Запустить туннель» становится активной. */
    saveSkillConfig: (config: AliceSkillConfig) => Promise<AliceStatus>;
    getSkillConfig: () => Promise<AliceSkillConfig | null>;
    clearSkillConfig: () => Promise<AliceStatus>;

    // === Tunnel ===
    /** Поднять cloudflared (или иной транспорт). Возвращает обновлённый status с publicUrl. */
    startTunnel: () => Promise<AliceStatus>;
    stopTunnel: () => Promise<AliceStatus>;

    // === Device/scene exposure ===
    /** Список превью того, как ВСЕ устройства будут видны Алисе (даже если exposure=false). */
    listDevicePreviews: () => Promise<AliceDevicePreview[]>;
    setDeviceExposure: (exposure: AliceDeviceExposure) => Promise<AliceDeviceExposure[]>;
    setSceneExposure: (exposure: AliceSceneExposure) => Promise<AliceSceneExposure[]>;
    getExposures: () => Promise<{
      devices: AliceDeviceExposure[];
      scenes: AliceSceneExposure[];
    }>;
    /** Принудительно пушнуть discovery — Алиса перечитает список устройств. */
    triggerDiscoveryCallback: () => Promise<{ ok: boolean; error?: string }>;

    // === Glagol embedded OAuth pairing flow ===
    /** Открыть BrowserWindow с passport.yandex.ru, вернуть готовые creds для connect. */
    startGlagolPairing: () => Promise<GlagolPairingState>;
    /** Снимок текущего состояния пэйринга — UI поллит или подписывается на alice:glagol-pairing. */
    getGlagolPairingState: () => Promise<GlagolPairingState>;
    cancelGlagolPairing: () => Promise<GlagolPairingState>;

    // === Quality-of-life ===
    /** Сгенерировать пару OAuth-кредов (client_id+secret) вместо «придумайте сами». */
    generateOauthCredentials: () => Promise<{
      oauthClientId: string;
      oauthClientSecret: string;
    }>;
    /** Проверить, установлен ли cloudflared в PATH. */
    probeCloudflared: () => Promise<{
      installed: boolean;
      version?: string;
      error?: string;
    }>;
    /** Embedded OAuth для dialogsOauthToken — заменяет ручной квест с oauth.yandex.com. */
    fetchDialogsCallbackToken: () => Promise<{ ok: boolean; error?: string }>;
  };
  events: {
    /** Подписка на push от main. Возвращает unsubscribe. */
    on: <E extends keyof IpcEvents>(
      event: E,
      listener: (payload: IpcEvents[E]) => void,
    ) => () => void;
  };
}

export interface HubInfo {
  hubId: string;
  version: string;
  platform: Platform;
  pairedDevices: number;
  yandexStationConnected: boolean;
}

/** Фаза сканирования одного драйвера в текущем discovery-cycle. */
export type DriverScanPhase = 'idle' | 'scanning' | 'done' | 'error';

export interface DriverScanProgress {
  driverId: string;
  displayName: string;
  phase: DriverScanPhase;
  found: number;
  /** Сообщение если phase='error'. */
  error?: string;
  /** ms — длительность scanning-фазы (UI показывает «scanned in 1.2s»). */
  durationMs?: number;
  /** UTC ms начала цикла. */
  startedAt: number;
}

/** Снимок прогресса всего discovery-цикла. */
export interface DiscoveryProgress {
  /** true — цикл идёт, false — ждёт interval-tick. */
  cycleActive: boolean;
  cycleStartedAt: number;
  drivers: DriverScanProgress[];
}

/** Push-события от main. */
export interface IpcEvents {
  'device:updated': Device;
  'device:removed': { id: string };
  /** Создание / редактирование комнаты (включая yandex-импорт). */
  'room:upserted': Room;
  'room:removed': { id: string };
  'discovery:candidate': DiscoveredDevice;
  'discovery:state': { running: boolean };
  /** Триггерится на старт/конец цикла и при смене phase любого драйвера. */
  'discovery:progress': DiscoveryProgress;
  'yandexStation:status': YandexStationStatus;
  /** Push событий glagol-сессии. */
  'yandexStation:event': YandexStationEvent;
  /** Совокупный статус Alice-интеграции — заменяет точечные апдейты. */
  'alice:status': AliceStatus;
  /** Прогресс embedded-OAuth pairing колонки. */
  'alice:glagol-pairing': GlagolPairingState;
  /** Последняя webhook-активность для status-панели (debounced ~1s). */
  'alice:webhook-activity': {
    method: 'devices' | 'query' | 'action' | 'unlink';
    ok: boolean;
    durationMs: number;
    at: string;
  };
  /** Навигационная команда (например, из tray «Найти устройства») → renderer делает router.push. */
  'tray:navigate': { path: string };
  log: { level: 'info' | 'warn' | 'error'; message: string; ts: number };
}
