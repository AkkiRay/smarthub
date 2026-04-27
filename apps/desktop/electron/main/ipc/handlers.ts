/**
 * @fileoverview IPC-handlers — тонкий transport-слой над {@link SmartHomeHub}.
 *
 * Ответственность handler'а:
 *   - Привязать `ipcMain.handle('<channel>', ...)` к hub-методу.
 *   - Логировать failure'ы в main.log с префиксом канала.
 *   - Форвардить hub-events обратно в renderer как `event:<channel>`.
 *
 * Никакой бизнес-логики — она целиком живёт в hub'е и сервисах. Это позволяет
 * заменить транспорт (например, на WebSocket для headless-режима) без
 * переписывания core'а.
 *
 * Регистрация нового API-метода:
 *   1. Добавить тип в `IpcApi` (`packages/shared/src/types/ipc.ts`).
 *   2. Добавить вызов `hub.<method>` в этом файле.
 *   3. Добавить вызов `invoke(...)` в `preload/index.ts`.
 *
 * Push-events форвардятся декларативно: добавление события — одна строка
 * в {@link HUB_EVENTS}.
 */

import { app } from 'electron';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import log from 'electron-log/main.js';
import type { DriverCredentials, DriverId } from '@smarthome/shared';
import type { SmartHomeHub } from '@core/hub/smart-home-hub.js';
import { safeOpenExternal } from '@main/security/open-external.js';

/** Поля, которые НИКОГДА не возвращаются renderer'у (bcrypt-style маска). */
const SECRET_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /^pin$/i,
];

/**
 * Маскирует sensitive-поля creds: оставляет последние 4 символа, остальное — `***`.
 * UI показывает «●●●●1234» — юзер видит, что creds сохранены, но raw secret не утекает.
 */
function redactCredentials(creds: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!creds || typeof creds !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(creds)) {
    if (typeof v === 'string' && SECRET_KEY_PATTERNS.some((re) => re.test(k))) {
      out[k] = v.length > 4 ? `***${v.slice(-4)}` : '***';
    } else if (Array.isArray(v)) {
      // Списки host'ов / device-spec'ов — не трогаем (они нужны UI для отображения).
      out[k] = v;
    } else if (v && typeof v === 'object') {
      out[k] = redactCredentials(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface IpcHandlerDeps {
  ipcMain: IpcMain;
  hub: SmartHomeHub;
  getMainWindow: () => BrowserWindow | null;
}

/** События хаба, которые форвардятся в renderer как `event:<channel>`. Имя совпадает с IpcEvents key. */
const HUB_EVENTS = [
  'device:updated',
  'device:removed',
  'room:upserted',
  'room:removed',
  'discovery:candidate',
  'discovery:state',
  'discovery:progress',
  'yandexStation:status',
  'yandexStation:event',
  'alice:status',
  'alice:webhook-activity',
] as const;

type HandlerFn = (...args: unknown[]) => unknown | Promise<unknown>;

/** invoke-каналы → функция. Аргументы приходят БЕЗ IpcMainInvokeEvent (он отбрасывается в wrap'e). */
function buildHandlers(hub: SmartHomeHub): Record<string, HandlerFn> {
  return {
    // app
    'app:get-version': () => app.getVersion(),
    'app:get-platform': () => process.platform,
    'app:get-hub-info': () => hub.getInfo(),
    'app:open-external': (url) => safeOpenExternal(url),

    // devices
    'devices:list': () => hub.devices.list(),
    'devices:get': (id) => hub.devices.get(id as string),
    'devices:rename': (id, name) => hub.devices.rename(id as string, name as string),
    'devices:set-room': (id, roomId) => hub.devices.setRoom(id as string, roomId as string | null),
    'devices:remove': (id) => hub.devices.remove(id as string),
    'devices:refresh': (id) => hub.devices.refresh(id as string),
    'devices:refresh-all': () => hub.devices.refreshAll(),
    'devices:execute': (cmd) =>
      hub.devices.execute(cmd as Parameters<typeof hub.devices.execute>[0]),

    // discovery
    'discovery:start': (opts) =>
      hub.discovery.start(opts as Parameters<typeof hub.discovery.start>[0]),
    'discovery:stop': () => hub.discovery.stop(),
    'discovery:is-running': () => hub.discovery.isRunning(),
    'discovery:candidates': () => hub.discovery.candidates(),
    'discovery:get-progress': () => hub.discovery.getProgress(),
    'discovery:pair': (cand) =>
      hub.discovery.pair(cand as Parameters<typeof hub.discovery.pair>[0]),

    // rooms
    'rooms:list': () => hub.rooms.list(),
    'rooms:create': (input) => hub.rooms.create(input as Parameters<typeof hub.rooms.create>[0]),
    'rooms:update': (id, patch) =>
      hub.rooms.update(id as string, patch as Parameters<typeof hub.rooms.update>[1]),
    'rooms:remove': (id) => hub.rooms.remove(id as string),

    // scenes
    'scenes:list': () => hub.scenes.list(),
    'scenes:create': (input) => hub.scenes.create(input as Parameters<typeof hub.scenes.create>[0]),
    'scenes:update': (id, patch) =>
      hub.scenes.update(id as string, patch as Parameters<typeof hub.scenes.update>[1]),
    'scenes:remove': (id) => hub.scenes.remove(id as string),
    'scenes:run': (id) => hub.scenes.run(id as string),

    // drivers
    'drivers:list': () => hub.drivers.list(),
    'drivers:set-credentials': (driverId, creds) =>
      hub.drivers.setCredentials(driverId as DriverId, creds as DriverCredentials<DriverId>),
    // Redact: sensitive-поля (password/token/secret/key) маскируются —
    // raw secret в renderer'е не нужен, UI показывает только «●●●●1234».
    // Это закрывает leak через DevTools heap-snapshot и crash-reports.
    'drivers:get-credentials': (driverId) => {
      const raw = hub.drivers.getCredentials(driverId as DriverId);
      return redactCredentials(raw as Record<string, unknown>);
    },

    // Yandex Station
    'yandexStation:discover': (timeoutMs) =>
      hub.yandexStation.discover(timeoutMs as number | undefined),
    'yandexStation:connect': (input) =>
      hub.yandexStation.connect(input as Parameters<typeof hub.yandexStation.connect>[0]),
    'yandexStation:disconnect': () => hub.yandexStation.disconnect(),
    'yandexStation:get-status': () => hub.yandexStation.getStatus(),
    'yandexStation:send-command': (cmd) =>
      hub.yandexStation.sendCommand(cmd as Parameters<typeof hub.yandexStation.sendCommand>[0]),
    'yandexStation:get-events': () => hub.yandexStation.getEvents(),
    'yandexStation:clear-events': () => hub.yandexStation.clearEvents(),
    // OAuth + Quasar API
    'yandexStation:get-auth-status': () => hub.yandexStation.getAuthStatus(),
    'yandexStation:sign-in': () => hub.yandexStation.signIn(),
    'yandexStation:sign-out': () => hub.yandexStation.signOut(),
    'yandexStation:fetch-stations': () => hub.yandexStation.fetchStations(),
    'yandexStation:fetch-home-devices': () => hub.yandexStation.fetchHomeDevices(),
    'yandexStation:sync-home-devices': () => hub.yandexStation.syncHomeDevices(),
    'yandexStation:list-households': () => hub.yandexStation.listYandexHouseholds(),
    'yandexStation:set-household': (id) =>
      hub.yandexStation.setYandexHousehold(id as string | null),
    'yandexStation:set-cloud-control-policy': (allow) =>
      hub.yandexStation.setCloudControlPolicy(Boolean(allow)),
    'yandexStation:open-home-binding-window': () => hub.yandexStation.openHomeBindingWindow(),
    'yandexStation:run-home-scenario': (id) =>
      hub.yandexStation.runHomeScenario(id as string),
    'yandexStation:fetch-scenario-details': (id) =>
      hub.yandexStation.fetchScenarioDetails(id as string),
    'yandexStation:rename-home-scenario': (id, name) =>
      hub.yandexStation.renameHomeScenario(id as string, name as string),
    'yandexStation:delete-home-scenario': (id) =>
      hub.yandexStation.deleteHomeScenario(id as string),
    'yandexStation:set-home-scenario-active': (id, active) =>
      hub.yandexStation.setHomeScenarioActive(id as string, active as boolean),
    'yandexStation:connect-station': (input) =>
      hub.yandexStation.connectStation(
        input as Parameters<typeof hub.yandexStation.connectStation>[0],
      ),

    // Alice Smart Home skill bridge
    'alice:get-status': () => hub.alice.getStatus(),
    'alice:save-skill-config': (config) =>
      hub.alice.saveSkillConfig(config as Parameters<typeof hub.alice.saveSkillConfig>[0]),
    'alice:get-skill-config': () => hub.alice.getSkillConfig(),
    'alice:clear-skill-config': () => hub.alice.clearSkillConfig(),
    'alice:start-tunnel': () => hub.alice.startTunnel(),
    'alice:stop-tunnel': () => hub.alice.stopTunnel(),
    'alice:list-device-previews': () => hub.alice.listDevicePreviews(),
    'alice:set-device-exposure': (exposure) =>
      hub.alice.setDeviceExposure(exposure as Parameters<typeof hub.alice.setDeviceExposure>[0]),
    'alice:set-scene-exposure': (exposure) =>
      hub.alice.setSceneExposure(exposure as Parameters<typeof hub.alice.setSceneExposure>[0]),
    'alice:get-exposures': () => hub.alice.getExposures(),
    'alice:trigger-discovery-callback': () => hub.alice.triggerDiscoveryCallback(),

    // Quality-of-life
    'alice:generate-oauth-credentials': () => hub.alice.generateOauthCredentials(),
    'alice:probe-cloudflared': () => hub.alice.probeCloudflared(),
    'alice:fetch-dialogs-callback-token': () => hub.alice.fetchDialogsCallbackToken(),

    // Glagol embedded-OAuth pairing — пока перенаправлено в существующий yandexStation.signIn flow.
    // UI вызывает sign-in напрямую, но IPC контракт публикует и эти каналы для будущей доработки.
    'alice:start-glagol-pairing': () => ({
      stage: 'idle' as const,
      updatedAt: new Date().toISOString(),
      error: 'Используйте «Войти через Яндекс» в разделе «Колонка»',
    }),
    'alice:get-glagol-pairing-state': () => ({
      stage: 'idle' as const,
      updatedAt: new Date().toISOString(),
    }),
    'alice:cancel-glagol-pairing': () => ({
      stage: 'idle' as const,
      updatedAt: new Date().toISOString(),
    }),
  };
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const { ipcMain, hub } = deps;

  // Push-форвардинг подписок хаба в renderer.
  const broadcast = <T>(channel: string, payload: T): void => {
    const win = deps.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(`event:${channel}`, payload);
    }
  };
  for (const evt of HUB_EVENTS) {
    hub.on(evt, ((payload: unknown) => broadcast(evt, payload)) as never);
  }

  // Electron-сериализация Error теряет stack/cause/message — пересоздаём plain Error,
  // иначе renderer получает generic "An error occurred in the main process".
  // senderFrame-gate: запрос принимается ТОЛЬКО из main-frame нашего окна, не из
  // вложенных iframe (если когда-нибудь появятся через webview/embed). Это закрывает
  // компрометацию через 3rd-party SVG/iframe → IPC.
  const wrap = (channel: string, fn: HandlerFn) => {
    return async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<unknown> => {
      const win = deps.getMainWindow();
      const expected = win?.webContents.mainFrame;
      if (!expected || event.senderFrame !== expected) {
        log.warn(`IPC ${channel} rejected: sender frame is not main frame`);
        throw new Error('IPC sender not allowed');
      }
      try {
        return await fn(...args);
      } catch (e) {
        const err = e as Error;
        log.error(`IPC ${channel} failed: ${err.message ?? err}`, err);
        throw new Error(err.message ?? `IPC ${channel} failed`);
      }
    };
  };

  for (const [channel, fn] of Object.entries(buildHandlers(hub))) {
    ipcMain.handle(channel, wrap(channel, fn));
  }

  // Renderer error reporting → main.log. Иначе видно только в DevTools Console.
  ipcMain.on(
    'app:report-error',
    (_e, payload: { source: string; message: string; stack?: string }) => {
      log.error(
        `[renderer:${payload.source}] ${payload.message}${
          payload.stack ? '\n' + payload.stack : ''
        }`,
      );
    },
  );

  log.info('IPC handlers registered');
}
