/**
 * @fileoverview Preload-script — типизированный мост между renderer'ом и main
 * process'ом, выставляется через `contextBridge.exposeInMainWorld`.
 *
 * Architecture:
 *   - Все методы IPC API возвращают Promise (через `ipcRenderer.invoke`).
 *   - Push-события из main приходят через `ipcRenderer.on(...)` и
 *     раздаются подписчикам в renderer'е.
 *   - Контракт типов — {@link IpcApi} в `packages/shared/src/types/ipc.ts`;
 *     любое изменение методов требует синхронной правки и тут, и там.
 *
 * Security:
 *   - `contextIsolation: true` — renderer не может дотянуться до Node.js.
 *   - `sandbox`-friendly — preload не использует Node API кроме electron.
 *   - Этот файл — единственный, кому contextBridge разрешает выставить
 *     API в `window`.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcApi, IpcEvents, Platform } from '@smarthome/shared';

const invoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: IpcApi = {
  app: {
    getVersion: () => invoke<string>('app:get-version'),
    getPlatform: () => invoke<Platform>('app:get-platform'),
    getHubInfo: () => invoke('app:get-hub-info'),
    getDiagnostics: () => invoke('app:get-diagnostics'),
    openLogsFolder: () => invoke<void>('app:open-logs-folder'),
    openExternal: (url) => invoke('app:open-external', url),
    // Fire-and-forget — renderer пушит ошибки в main.log без блокировки UI.
    reportError: (payload) => ipcRenderer.send('app:report-error', payload),
  },
  // Window-controls. НЕ под `window.chrome` — namespace зарезервирован Chromium'ом под
  // DevTools/extension API, contextBridge туда не пробивается (в проде ловили
  // «window.chrome.close is not a function»).
  window: {
    minimize: () => invoke<void>('window:minimize'),
    toggleMaximize: () => invoke<void>('window:toggle-maximize'),
    close: () => invoke<void>('window:close'),
  },
  devices: {
    list: () => invoke('devices:list'),
    get: (id) => invoke('devices:get', id),
    rename: (id, name) => invoke('devices:rename', id, name),
    setRoom: (id, roomId) => invoke('devices:set-room', id, roomId),
    remove: (id) => invoke('devices:remove', id),
    refresh: (id) => invoke('devices:refresh', id),
    refreshAll: () => invoke('devices:refresh-all'),
    execute: (cmd) => invoke('devices:execute', cmd),
  },
  discovery: {
    start: (opts) => invoke('discovery:start', opts),
    stop: () => invoke('discovery:stop'),
    isRunning: () => invoke('discovery:is-running'),
    candidates: () => invoke('discovery:candidates'),
    pair: (candidate) => invoke('discovery:pair', candidate),
    getProgress: () => invoke('discovery:get-progress'),
  },
  rooms: {
    list: () => invoke('rooms:list'),
    create: (input) => invoke('rooms:create', input),
    update: (id, patch) => invoke('rooms:update', id, patch),
    remove: (id) => invoke('rooms:remove', id),
  },
  scenes: {
    list: () => invoke('scenes:list'),
    create: (input) => invoke('scenes:create', input),
    update: (id, patch) => invoke('scenes:update', id, patch),
    remove: (id) => invoke('scenes:remove', id),
    run: (id) => invoke('scenes:run', id),
  },
  drivers: {
    list: () => invoke('drivers:list'),
    setCredentials: (driverId, creds) => invoke('drivers:set-credentials', driverId, creds),
    getCredentials: (driverId) => invoke('drivers:get-credentials', driverId),
    testCredentials: (driverId, values) => invoke('drivers:test-credentials', driverId, values),
    openExternal: (url) => invoke('drivers:open-external', url),
    signInOauth: (driverId, params) => invoke('drivers:sign-in-oauth', driverId, params),
  },
  yandexStation: {
    discover: (timeoutMs) => invoke('yandexStation:discover', timeoutMs),
    connect: (input) => invoke('yandexStation:connect', input),
    disconnect: () => invoke('yandexStation:disconnect'),
    getStatus: () => invoke('yandexStation:get-status'),
    sendCommand: (command) => invoke('yandexStation:send-command', command),
    getEvents: () => invoke('yandexStation:get-events'),
    clearEvents: () => invoke('yandexStation:clear-events'),
    getAuthStatus: () => invoke('yandexStation:get-auth-status'),
    signIn: () => invoke('yandexStation:sign-in'),
    signOut: () => invoke('yandexStation:sign-out'),
    fetchStations: () => invoke('yandexStation:fetch-stations'),
    fetchHomeDevices: () => invoke('yandexStation:fetch-home-devices'),
    syncHomeDevices: () => invoke('yandexStation:sync-home-devices'),
    listHouseholds: () => invoke('yandexStation:list-households'),
    setHousehold: (id) => invoke('yandexStation:set-household', id),
    setCloudControlPolicy: (allow) => invoke('yandexStation:set-cloud-control-policy', allow),
    openHomeBindingWindow: () => invoke('yandexStation:open-home-binding-window'),
    runHomeScenario: (id) => invoke('yandexStation:run-home-scenario', id),
    fetchScenarioDetails: (id) => invoke('yandexStation:fetch-scenario-details', id),
    renameHomeScenario: (id, name) => invoke('yandexStation:rename-home-scenario', id, name),
    deleteHomeScenario: (id) => invoke('yandexStation:delete-home-scenario', id),
    setHomeScenarioActive: (id, active) =>
      invoke('yandexStation:set-home-scenario-active', id, active),
    connectStation: (input) => invoke('yandexStation:connect-station', input),
  },
  updater: {
    getStatus: () => invoke('updater:get-status'),
    check: () => invoke('updater:check'),
    download: () => invoke('updater:download'),
    install: () => invoke('updater:install'),
  },
  alice: {
    getStatus: () => invoke('alice:get-status'),
    saveSkillConfig: (config) => invoke('alice:save-skill-config', config),
    getSkillConfig: () => invoke('alice:get-skill-config'),
    clearSkillConfig: () => invoke('alice:clear-skill-config'),
    startTunnel: () => invoke('alice:start-tunnel'),
    stopTunnel: () => invoke('alice:stop-tunnel'),
    listDevicePreviews: () => invoke('alice:list-device-previews'),
    setDeviceExposure: (exposure) => invoke('alice:set-device-exposure', exposure),
    setSceneExposure: (exposure) => invoke('alice:set-scene-exposure', exposure),
    getExposures: () => invoke('alice:get-exposures'),
    triggerDiscoveryCallback: () => invoke('alice:trigger-discovery-callback'),
    startGlagolPairing: () => invoke('alice:start-glagol-pairing'),
    getGlagolPairingState: () => invoke('alice:get-glagol-pairing-state'),
    cancelGlagolPairing: () => invoke('alice:cancel-glagol-pairing'),
    generateOauthCredentials: () => invoke('alice:generate-oauth-credentials'),
    probeCloudflared: () => invoke('alice:probe-cloudflared'),
    fetchDialogsCallbackToken: () => invoke('alice:fetch-dialogs-callback-token'),
    probeReachability: () => invoke('alice:probe-reachability'),
    verifyDialogsToken: () => invoke('alice:verify-dialogs-token'),
    ensureCloudflared: () => invoke('alice:ensure-cloudflared'),
  },
  events: {
    on(event, listener) {
      const channel = `event:${event}`;
      const handler = (_: unknown, payload: IpcEvents[typeof event]): void => listener(payload);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.off(channel, handler);
    },
  },
};

contextBridge.exposeInMainWorld('smarthome', api);

declare global {
  interface Window {
    smarthome: IpcApi;
  }
}
