/**
 * @fileoverview SmartHomeHub — фасад core-приложения. Точка входа для всех
 * IPC-handler'ов, делегирует работу подсистемам:
 *
 *   - {@link DeviceRegistry}        — CRUD устройств, room-membership, exec-routing.
 *   - {@link DriverRegistry}        — driver lifecycle, descriptors, credentials.
 *   - {@link DiscoveryService}      — параллельный scan по всем активным драйверам.
 *   - {@link PollingService}        — periodic state refresh для online-устройств.
 *   - {@link SceneService}          — scene CRUD + execution.
 *   - {@link YandexStationClient}   — локальная Я.Станция (WS на :1961).
 *   - {@link AliceBridge}           — Alice Smart Home Skill (cloud webhook).
 *
 * Hub не содержит бизнес-логики сам по себе — он только склеивает подсистемы
 * и форвардит их события в общий {@link EventEmitter}-bus. IPC handler'ы
 * читают этот bus и пушат события в renderer.
 *
 * Renderer не знает про внутреннюю топологию: для него существует только
 * `window.smarthome.*` API.
 */

import { EventEmitter } from 'node:events';
import log from 'electron-log/main.js';
import type {
  AliceDeviceExposure,
  AliceDevicePreview,
  AliceSceneExposure,
  AliceSkillConfig,
  AliceStatus,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DiscoveredDevice,
  DriverCredentials,
  DriverId,
  HubInfo,
  Platform,
  Room,
  Scene,
  YandexAuthStatus,
  YandexHomeSnapshot,
  YandexStationCandidate,
  YandexStationCommand,
  YandexStationEvent,
  YandexStationOnAccount,
  YandexStationStatus,
} from '@smarthome/shared';

import type { DeviceStore } from '../storage/device-store.js';
import type { SettingsStore, YandexStationCreds } from '../storage/settings-store.js';
import type { DriverRegistry } from '../drivers/driver-registry.js';
import type { DeviceRegistry } from '../registry/device-registry.js';
import type { DiscoveryService } from '../discovery/discovery-service.js';
import type { PollingService } from '../polling/polling-service.js';
import type { SceneService } from '../scenes/scene-service.js';
import type { YandexStationClient } from '../alice/yandex-station-client.js';
import type { YandexStationDiscovery } from '../alice/yandex-station-discovery.js';
import { YandexQuasarClient } from '../alice/yandex-quasar-api.js';
import { YandexIotClient } from '../alice/yandex-iot-api.js';
import { YandexImportService } from '../alice/yandex-import-service.js';
import {
  runYandexOauth,
  clearYandexOauthSession,
  openYandexHomeBindingWindow,
} from '../alice/yandex-oauth.js';
import { ALICE_TIMEOUT, YANDEX_STATION_PORT } from '../alice/constants.js';
import type { AliceBridge } from '../alice/skill/alice-bridge.js';
import type { WebhookActivityEvent } from '../alice/skill/webhook-server.js';

export interface HubEvents {
  'device:updated': (device: Device) => void;
  'device:removed': (payload: { id: string }) => void;
  'room:upserted': (room: Room) => void;
  'room:removed': (payload: { id: string }) => void;
  'discovery:candidate': (candidate: DiscoveredDevice) => void;
  'discovery:state': (state: { running: boolean }) => void;
  'discovery:progress': (progress: import('@smarthome/shared').DiscoveryProgress) => void;
  'yandexStation:status': (status: YandexStationStatus) => void;
  'yandexStation:event': (event: YandexStationEvent) => void;
  'alice:status': (status: AliceStatus) => void;
  'alice:webhook-activity': (event: WebhookActivityEvent) => void;
}

export interface SmartHomeHubDeps {
  appVersion: string;
  platform: Platform;
  settings: SettingsStore;
  deviceStore: DeviceStore;
  driverRegistry: DriverRegistry;
  deviceRegistry: DeviceRegistry;
  discovery: DiscoveryService;
  polling: PollingService;
  sceneService: SceneService;
  yandexStation: YandexStationClient;
  yandexStationDiscovery: YandexStationDiscovery;
  aliceBridge: AliceBridge;
}

export type SmartHomeHub = ReturnType<typeof createSmartHomeHub>;

export function createSmartHomeHub(deps: SmartHomeHubDeps) {
  const emitter = new EventEmitter();
  // Memory-leak guard: warning при > 30 listener-ов.
  emitter.setMaxListeners(30);

  // Forward подсистемных событий в общий bus.
  deps.deviceRegistry.on('device:updated', (device) => {
    emitter.emit('device:updated', device);
  });
  deps.deviceRegistry.on('device:removed', (payload) => {
    emitter.emit('device:removed', payload);
  });
  deps.deviceRegistry.on('room:upserted', (room) => {
    emitter.emit('room:upserted', room);
  });
  deps.deviceRegistry.on('room:removed', (payload) => {
    emitter.emit('room:removed', payload);
  });
  deps.discovery.on('candidate', (candidate) => {
    emitter.emit('discovery:candidate', candidate);
  });
  deps.discovery.on('state', (state) => {
    emitter.emit('discovery:state', state);
  });
  deps.discovery.on('progress', (progress) => {
    emitter.emit('discovery:progress', progress);
  });
  deps.yandexStation.onStatus((status) => {
    emitter.emit('yandexStation:status', status);
  });
  deps.yandexStation.onEvent((event) => {
    emitter.emit('yandexStation:event', event);
  });

  // Alice skill bridge: статус → renderer; device-change → push в Алису.
  deps.aliceBridge.on('status', (status) => emitter.emit('alice:status', status));
  deps.aliceBridge.on('webhook-activity', (event) => emitter.emit('alice:webhook-activity', event));
  deps.deviceRegistry.on('device:updated', (device) => {
    deps.aliceBridge.notifyDeviceUpdated(device);
  });

  // ---- Lifecycle ------------------------------------------------------------

  const init = async (): Promise<void> => {
    await deps.deviceRegistry.init();
    await deps.driverRegistry.init();
    // Push-стримы (yandex-iot updates_url WS, в будущем MQTT/HomeAssistant) —
    // подписываемся ПОСЛЕ driverRegistry.init(), иначе driverRegistry.list()
    // ещё пустой и subscribePush ни разу не вызовется.
    deps.deviceRegistry.wirePushSubscriptions();
    await deps.sceneService.init();
    await deps.aliceBridge.init();

    // Auto-reconnect к колонке (fire-and-forget, не блокируем bootstrap).
    const stationCreds = deps.settings.get('yandexStation');
    if (stationCreds) {
      void deps.yandexStation.connect(stationCreds).catch((e) => {
        log.warn(`Yandex Station auto-connect failed: ${(e as Error).message}`);
      });
    }

    if (deps.settings.get('quasarAuth')?.musicToken && deps.driverRegistry.get('yandex-iot')) {
      void yandexImport.sync().catch((e) => {
        log.warn(`Yandex IoT auto-sync at boot failed: ${(e as Error).message}`);
      });
    }

    // Auto-start туннеля если skill уже привязывался ранее.
    const aliceState = deps.settings.getAlice();
    if (aliceState.config && Object.keys(aliceState.issuedTokens).length > 0) {
      void deps.aliceBridge.startTunnel().catch((e) => {
        log.warn(`Alice tunnel auto-start failed: ${(e as Error).message}`);
      });
    }

    // Polling — после deviceRegistry.init (иначе первый цикл по пустому реестру).
    deps.polling.start();
  };

  const shutdown = async (): Promise<void> => {
    log.info('SmartHomeHub: shutting down services');
    deps.polling.stop();
    await Promise.allSettled([
      deps.discovery.stop(),
      deps.yandexStation.disconnect(),
      deps.aliceBridge.shutdown(),
      deps.driverRegistry.shutdown(),
    ]);
    deps.deviceStore.close();
    emitter.removeAllListeners();
  };

  // ---- Public API: events ---------------------------------------------------

  const on = <E extends keyof HubEvents>(event: E, listener: HubEvents[E]): (() => void) => {
    emitter.on(event, listener as never);
    return () => emitter.off(event, listener as never);
  };

  // ---- Public API: app info -------------------------------------------------

  const getInfo = (): HubInfo => ({
    hubId: deps.settings.get('hubId'),
    version: deps.appVersion,
    platform: deps.platform,
    pairedDevices: deps.deviceRegistry.list().length,
    yandexStationConnected: deps.yandexStation.getStatus().connection === 'connected',
  });

  // ---- Public API: devices --------------------------------------------------

  const devices = {
    list: (): Device[] => deps.deviceRegistry.list(),
    get: (id: string): Device | null => deps.deviceRegistry.get(id),
    rename: (id: string, name: string): Device => deps.deviceRegistry.rename(id, name),
    setRoom: (id: string, roomId: string | null): Device => deps.deviceRegistry.setRoom(id, roomId),
    remove: (id: string): void => deps.deviceRegistry.remove(id),
    refresh: (id: string): Promise<Device> => deps.deviceRegistry.refresh(id),
    refreshAll: async (): Promise<Device[]> => {
      // Используем polling-cycle (concurrency-throttled, backoff-aware) вместо ручного цикла.
      await deps.polling.runOnce();
      return deps.deviceRegistry.list();
    },
    execute: (command: DeviceCommand): Promise<DeviceCommandResult> =>
      deps.deviceRegistry.execute(command),
  };

  // ---- Public API: discovery ------------------------------------------------

  const discovery = {
    start: (opts?: { mode?: 'once' | 'continuous' }): Promise<void> =>
      deps.discovery.start(opts ?? {}),
    stop: (): Promise<void> => deps.discovery.stop(),
    isRunning: (): boolean => deps.discovery.isRunning(),
    candidates: (): DiscoveredDevice[] => deps.discovery.candidates(),
    pair: (candidate: DiscoveredDevice): Promise<Device> => deps.deviceRegistry.pair(candidate),
    getProgress: () => deps.discovery.getProgress(),
  };

  // ---- Public API: rooms ----------------------------------------------------

  const rooms = {
    list: (): Room[] => deps.deviceRegistry.rooms.list(),
    create: (input: { name: string; icon: string }): Room =>
      deps.deviceRegistry.rooms.create(input),
    update: (id: string, patch: Partial<Pick<Room, 'name' | 'icon' | 'order'>>): Room =>
      deps.deviceRegistry.rooms.update(id, patch),
    remove: (id: string): void => deps.deviceRegistry.rooms.remove(id),
  };

  // ---- Public API: scenes ---------------------------------------------------

  const scenes = {
    list: (): Scene[] => deps.sceneService.list(),
    create: (input: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'>): Scene =>
      deps.sceneService.create(input),
    update: (id: string, patch: Partial<Scene>): Scene => deps.sceneService.update(id, patch),
    remove: (id: string): void => deps.sceneService.remove(id),
    run: (id: string): Promise<void> => deps.sceneService.run(id),
  };

  // ---- Public API: drivers --------------------------------------------------

  const drivers = {
    list: () => deps.driverRegistry.descriptors(),
    setCredentials: async <D extends DriverId>(
      driverId: D,
      creds: DriverCredentials<D>,
    ): Promise<void> => {
      deps.settings.setDriverCredentials(driverId, creds);
      // Cloud-драйверы регистрируются только после ввода creds — нужен повторный init.
      await deps.driverRegistry.reloadDriver(driverId);
    },
    getCredentials: <D extends DriverId>(driverId: D): Partial<DriverCredentials<D>> =>
      deps.settings.getDriverCredentials(driverId),
  };

  // ---- Public API: Yandex Station ------------------------------------------

  /** Запрашивает свежий per-device JWT и сохраняет в settings. Inject-ится в WS-клиент. */
  const refreshDeviceToken = async (): Promise<string | null> => {
    const auth = deps.settings.get('quasarAuth');
    const station = deps.settings.get('yandexStation');
    if (!auth?.musicToken || !station) return null;
    try {
      const quasar = new YandexQuasarClient(auth.musicToken);
      const fresh = await quasar.fetchDeviceToken(station.deviceId, station.platform ?? '');
      const updated: YandexStationCreds = {
        ...station,
        token: fresh.token,
        tokenExpiresAt: fresh.expiresAt,
      };
      deps.settings.set('yandexStation', updated);
      return fresh.token;
    } catch (e) {
      log.warn(`Quasar refreshDeviceToken failed: ${(e as Error).message}`);
      return null;
    }
  };
  deps.yandexStation.setTokenRefresher(refreshDeviceToken);

  /**
   * Сервис импорта «Дома с Алисой» — pair устройств, upsert комнат, cleanup orphans.
   * Хаб только проксирует вызовы; вся бизнес-логика и счётчики живут в сервисе.
   * Расширения (importGroups, importScenarios) добавляются как методы сервиса
   * без изменений здесь.
   */
  const yandexImport = new YandexImportService({
    settings: deps.settings,
    driverRegistry: deps.driverRegistry,
    deviceRegistry: deps.deviceRegistry,
  });

  const yandexStation = {
    // ?? на default-параметре scan() — TS не использует default value при явном `undefined`.
    discover: (timeoutMs?: number): Promise<YandexStationCandidate[]> =>
      deps.yandexStationDiscovery.scan(timeoutMs ?? ALICE_TIMEOUT.MDNS_SCAN_MS),
    connect: async (input: YandexStationCreds): Promise<YandexStationStatus> => {
      deps.settings.set('yandexStation', input);
      return deps.yandexStation.connect(input);
    },
    disconnect: async (): Promise<YandexStationStatus> => {
      deps.settings.set('yandexStation', null);
      await deps.yandexStation.disconnect();
      return deps.yandexStation.getStatus();
    },
    getStatus: (): YandexStationStatus => deps.yandexStation.getStatus(),
    sendCommand: (command: YandexStationCommand): Promise<{ ok: boolean; error?: string }> =>
      deps.yandexStation.sendCommand(command),

    getEvents: (): YandexStationEvent[] => deps.yandexStation.getRecentEvents(),
    clearEvents: (): void => deps.yandexStation.clearEvents(),

    // ---- OAuth + Quasar API: автоматический flow подключения ----
    getAuthStatus(): YandexAuthStatus {
      const auth = deps.settings.get('quasarAuth');
      if (!auth?.musicToken) return { authorized: false };
      return {
        authorized: true,
        ...(auth.expiresAt ? { expiresAt: new Date(auth.expiresAt * 1000).toISOString() } : {}),
      };
    },

    async signIn(): Promise<{ ok: boolean; error?: string }> {
      try {
        const result = await runYandexOauth();
        if (!result) return { ok: false, error: 'Окно входа закрыто без авторизации' };
        deps.settings.set('quasarAuth', {
          musicToken: result.accessToken,
          expiresAt: result.expiresIn ? Math.floor(Date.now() / 1000) + result.expiresIn : 0,
        });
        // Свежий токен → активируем yandex-iot driver и импортируем устройства
        // в фоне; UI перерисуется через events `device:updated`.
        await deps.driverRegistry.reloadDriver('yandex-iot');
        void yandexImport.sync().catch((e) => {
          log.warn(`Auto-sync after signIn failed: ${(e as Error).message}`);
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async signOut(): Promise<void> {
      deps.settings.set('quasarAuth', null);
      await clearYandexOauthSession();
      // Driver больше не должен пытаться ходить в iot.quasar — снимаем его.
      await deps.driverRegistry.reloadDriver('yandex-iot');
    },

    /** Ручной триггер импорта (кнопка «Синхронизировать с Яндексом»). */
    syncHomeDevices(): Promise<import('../alice/yandex-import-service.js').YandexImportSummary> {
      return yandexImport.sync();
    },

    /**
     * Открывает embedded-окно «Дома с Алисой» и после закрытия пытается импортировать
     * добавленные устройства. Возвращает summary импорта — UI покажет toast «найдена
     * 1 новая лампочка». Если юзер просто закрыл окно ничего не добавив — `imported: 0`.
     */
    async openHomeBindingWindow(): Promise<
      import('../alice/yandex-import-service.js').YandexImportSummary
    > {
      const auth = deps.settings.get('quasarAuth');
      if (!auth?.musicToken) {
        throw new Error('Сначала войдите через Яндекс — без авторизации окно покажет пустую страницу.');
      }
      await openYandexHomeBindingWindow();
      return yandexImport.sync();
    },

    /** Snapshot «Дома с Алисой» — устройства, комнаты, группы, сценарии. */
    async fetchHomeDevices(): Promise<YandexHomeSnapshot> {
      const auth = deps.settings.get('quasarAuth');
      if (!auth?.musicToken) {
        throw new Error('Не авторизованы в Я.Музыке. Нажмите «Войти через Яндекс».');
      }
      const iot = new YandexIotClient();
      return iot.fetchUserDevices();
    },

    /** Запустить сценарий «Дома с Алисой» по id. */
    async runHomeScenario(scenarioId: string): Promise<{ ok: boolean; error?: string }> {
      const auth = deps.settings.get('quasarAuth');
      if (!auth?.musicToken) {
        return { ok: false, error: 'Не авторизованы в Я.Музыке.' };
      }
      const iot = new YandexIotClient();
      const r = await iot.runScenario(scenarioId);
      return { ok: r.ok, ...(r.error ? { error: r.error } : {}) };
    },

    /** Полные детали сценария (для UI-редактора). */
    async fetchScenarioDetails(
      scenarioId: string,
    ): Promise<import('@smarthome/shared').YandexHomeScenarioDetails | null> {
      const auth = deps.settings.get('quasarAuth');
      if (!auth?.musicToken) {
        throw new Error('Не авторизованы в Я.Музыке.');
      }
      const iot = new YandexIotClient();
      return iot.fetchScenarioDetails(scenarioId);
    },

    async renameHomeScenario(
      scenarioId: string,
      name: string,
    ): Promise<{ ok: boolean; error?: string }> {
      const iot = new YandexIotClient();
      const r = await iot.renameScenario(scenarioId, name);
      return { ok: r.ok, ...(r.error ? { error: r.error } : {}) };
    },

    async deleteHomeScenario(scenarioId: string): Promise<{ ok: boolean; error?: string }> {
      const iot = new YandexIotClient();
      const r = await iot.deleteScenario(scenarioId);
      return { ok: r.ok, ...(r.error ? { error: r.error } : {}) };
    },

    async setHomeScenarioActive(
      scenarioId: string,
      active: boolean,
    ): Promise<{ ok: boolean; error?: string }> {
      const iot = new YandexIotClient();
      const r = await iot.setScenarioActive(scenarioId, active);
      return { ok: r.ok, ...(r.error ? { error: r.error } : {}) };
    },

    /** Quasar device_list ∪ mDNS-snapshot — колонкам в LAN дописываем host/port. */
    async fetchStations(): Promise<YandexStationOnAccount[]> {
      const auth = deps.settings.get('quasarAuth');
      if (!auth?.musicToken)
        throw new Error('Не авторизованы в Я.Музыке. Нажмите «Войти через Яндекс».');
      const quasar = new YandexQuasarClient(auth.musicToken);
      const [devices, lan] = await Promise.all([
        quasar.fetchDeviceList(),
        deps.yandexStationDiscovery.scan(ALICE_TIMEOUT.MDNS_SCAN_MS),
      ]);
      const lanByDevice = new Map(lan.map((c) => [c.deviceId, c]));
      return devices.map((d) => {
        const found = lanByDevice.get(d.id);
        return {
          deviceId: d.id,
          name: d.name,
          platform: d.platform,
          reachableLan: !!found,
          ...(found ? { host: found.host, port: found.port } : {}),
        };
      });
    },

    /**
     * Auto-connect к колонке: JWT → host/port → WSS + persist creds.
     * UI должен передавать `host`/`port` из `fetchStations()`, чтобы не делать
     * лишний 4s mDNS scan; иначе fallback на scan.
     */
    async connectStation(input: {
      deviceId: string;
      platform: string;
      name?: string;
      host?: string;
      port?: number;
    }): Promise<YandexStationStatus> {
      const auth = deps.settings.get('quasarAuth');
      if (!auth?.musicToken) throw new Error('Не авторизованы в Я.Музыке.');

      let host = input.host;
      let port = input.port;
      if (!host) {
        const lan = await deps.yandexStationDiscovery.scan(ALICE_TIMEOUT.MDNS_SCAN_MS);
        const found = lan.find((c) => c.deviceId === input.deviceId);
        if (!found) {
          throw new Error('Колонка не найдена в локальной сети — подключите к той же Wi-Fi.');
        }
        host = found.host;
        port = found.port;
      }

      const quasar = new YandexQuasarClient(auth.musicToken);
      const jwt = await quasar.fetchDeviceToken(input.deviceId, input.platform);

      const creds: YandexStationCreds = {
        host,
        port: port || YANDEX_STATION_PORT,
        deviceId: input.deviceId,
        token: jwt.token,
        tokenExpiresAt: jwt.expiresAt,
        platform: input.platform,
        ...(input.name ? { name: input.name } : {}),
      };
      deps.settings.set('yandexStation', creds);
      const status = await deps.yandexStation.connect(creds);
      // Колонка подключилась → пробуем импортировать устройства из «Дома с Алисой».
      // Без auth (yandex-iot ещё не активирован) skip; иначе fire-and-forget.
      if (deps.driverRegistry.get('yandex-iot')) {
        void yandexImport.sync().catch((e) => {
          log.warn(`Auto-sync after connectStation failed: ${(e as Error).message}`);
        });
      }
      return status;
    },
  };

  // ---- Public API: Alice skill bridge --------------------------------------

  const alice = {
    getStatus: (): AliceStatus => deps.aliceBridge.getStatus(),
    saveSkillConfig: (config: AliceSkillConfig): AliceStatus =>
      deps.aliceBridge.saveSkillConfig(config),
    getSkillConfig: (): AliceSkillConfig | null => deps.aliceBridge.getSkillConfig(),
    clearSkillConfig: (): AliceStatus => deps.aliceBridge.clearSkillConfig(),
    startTunnel: (): Promise<AliceStatus> => deps.aliceBridge.startTunnel(),
    stopTunnel: (): Promise<AliceStatus> => deps.aliceBridge.stopTunnel(),
    listDevicePreviews: (): AliceDevicePreview[] => deps.aliceBridge.listDevicePreviews(),
    setDeviceExposure: (exposure: AliceDeviceExposure): AliceDeviceExposure[] =>
      deps.aliceBridge.setDeviceExposure(exposure),
    setSceneExposure: (exposure: AliceSceneExposure): AliceSceneExposure[] =>
      deps.aliceBridge.setSceneExposure(exposure),
    getExposures: (): { devices: AliceDeviceExposure[]; scenes: AliceSceneExposure[] } =>
      deps.aliceBridge.getExposures(),
    triggerDiscoveryCallback: (): Promise<{ ok: boolean; error?: string }> =>
      deps.aliceBridge.triggerDiscoveryCallback(),

    /** UI-helper: сгенерировать пару client_id/client_secret вместо «придумайте сами». */
    generateOauthCredentials: () => deps.aliceBridge.generateOauthCredentials(),

    /** Upfront-проверка cloudflared (вызывается из onMounted AliceSkillBridge). */
    probeCloudflared: () => deps.aliceBridge.probeCloudflared(),

    /**
     * Embedded OAuth: открывает passport.yandex.ru с client_id Я.Диалогов и
     * сохраняет access_token в config.dialogsOauthToken — заменяет ручной квест
     * с oauth.yandex.com.
     */
    async fetchDialogsCallbackToken(): Promise<{ ok: boolean; error?: string }> {
      try {
        const result = await runYandexOauth({ scope: 'dialogs-callback' });
        if (!result) return { ok: false, error: 'Окно входа закрыто без авторизации' };
        const current = deps.settings.getAlice().config;
        if (!current) {
          return {
            ok: false,
            error: 'Сначала сохраните Skill ID и креды OAuth.',
          };
        }
        deps.aliceBridge.saveSkillConfig({
          ...current,
          dialogsOauthToken: result.accessToken,
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    // Glagol-pairing — пока stub: основной flow остаётся через yandexStation.signIn + connectStation.
    // TODO: вынести в отдельный wizard-state-machine, см. AliceView.glagol-pairing.
  };

  return {
    init,
    shutdown,
    on,
    getInfo,
    devices,
    discovery,
    rooms,
    scenes,
    drivers,
    yandexStation,
    alice,
  };
}
