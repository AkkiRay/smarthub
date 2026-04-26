/**
 * @fileoverview Main process entrypoint Electron-приложения.
 *
 * Bootstrap-последовательность:
 *   1. Single-instance lock — повторный запуск фокусирует уже открытое окно.
 *   2. `loadRuntimeEnv()` — читает `.env.<mode>` из пользовательского
 *      профиля и process-флагов.
 *   3. Storage-слой: {@link createSettingsStore} (encrypted electron-store)
 *      + {@link createDeviceStore} (better-sqlite3 в `userData/data/hub.sqlite`).
 *   4. Driver registry — лениво инициализирует драйверы у которых есть creds.
 *   5. Device registry — in-memory cache + write-through в SQLite.
 *   6. Service layer — discovery, polling, scenes, Alice integration.
 *   7. {@link SmartHomeHub} — фасад над всем core'ом для IPC.
 *   8. BrowserWindow + CSP + tray.
 *   9. IPC handlers + push-broadcast обратно в renderer.
 *
 * Архитектурный invariant: renderer НИКОГДА не импортирует main process
 * напрямую. Все взаимодействия — через `window.smarthome.*` IPC channels.
 *
 * Graceful shutdown: 5-секундный grace-period для drivers/storage; на
 * `before-quit` дёргает `hub.shutdown()` с timeout-протекцией.
 *
 * @see packages/shared/src/types/ipc.ts — IPC contract.
 */

import { app, BrowserWindow, ipcMain, nativeTheme, shell, dialog } from 'electron';
import { join } from 'node:path';
import log from 'electron-log/main.js';

import { createSettingsStore } from '@core/storage/settings-store.js';
import { createDeviceStore } from '@core/storage/device-store.js';
import { createDriverRegistry } from '@core/drivers/driver-registry.js';
import { createDeviceRegistry } from '@core/registry/device-registry.js';
import { createDiscoveryService } from '@core/discovery/discovery-service.js';
import { createPollingService } from '@core/polling/polling-service.js';
import { createSceneService } from '@core/scenes/scene-service.js';
import { createYandexStationClient } from '@core/alice/yandex-station-client.js';
import { createYandexStationDiscovery } from '@core/alice/yandex-station-discovery.js';
import { AliceBridge } from '@core/alice/skill/alice-bridge.js';
import { createSmartHomeHub, type SmartHomeHub } from '@core/hub/smart-home-hub.js';
import { registerIpcHandlers } from '@main/ipc/handlers.js';
import { installCsp } from '@main/security/csp.js';
import { safeOpenExternal } from '@main/security/open-external.js';
import { createTray, type TrayController } from '@main/tray.js';
import { loadRuntimeEnv } from '@main/env-loader.js';
import { resolveAppIcon } from '@main/app-icon.js';
import type { Platform } from '@smarthome/shared';

// КРИТИЧНО: setName ДО `app.getPath('userData')` — иначе Electron зафиксирует
// путь по `name` из package.json (`@smarthome/desktop`) и не пере-резолвит.
app.setName('SmartHome Hub');

// AppUserModelId обязателен на Windows для нормальных уведомлений и taskbar-grouping.
// Должен совпадать с `build.appId` в package.json.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.smarthome.hub');
}

// GPU / render-флаги — обязательно ДО app.whenReady(): Chromium читает их при
// инициализации composit'а, поздняя установка молча игнорируется.
//
// Зачем каждый:
//   - disable-features=CalculateNativeWinOcclusion (Windows): Chromium тротлит
//     rendering когда считает окно перекрытым; ложные срабатывания тормозят
//     WebGL и GSAP rAF до 1Hz при работе других окон поверх.
//   - disable-backgrounding-occluded-windows / disable-renderer-backgrounding:
//     рекдер-процесс не понижается в приоритете при потере фокуса (для hub'а
//     в трее это критично — иначе orb «замерзает» когда пользователь в браузере).
//   - enable-gpu-rasterization + enable-zero-copy: WebGL и compositor-кадры
//     обрабатываются на GPU без промежуточного копирования через shared mem.
//   - ignore-gpu-blocklist: на старых драйверах Chromium иногда выключает
//     hardware-acceleration по консервативному списку — для desktop'а смело
//     включаем (фоллбэк ANGLE остаётся).
//   - use-angle=d3d11 (Windows): нативный D3D11 backend стабильнее OpenGL.
app.commandLine.appendSwitch(
  'disable-features',
  'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('use-angle', 'd3d11');
}

// ПОСЛЕ setName: использует app.getPath('userData') для приоритетного кандидата.
const _envLoad = loadRuntimeEnv(app);

// Локальная константа вместо process.env['APP_ROOT'] — с noUncheckedIndexedAccess
// последняя имеет тип `string | undefined`.
const APP_ROOT = join(__dirname, '..', '..');
process.env['APP_ROOT'] = APP_ROOT;

// IS_DEV строго через `app.isPackaged` — env-flag из `userData/.env` не должен
// включать dev-CSP / DevTools в production.
const IS_DEV = !app.isPackaged;
const VITE_DEV_SERVER_URL = IS_DEV ? process.env['VITE_DEV_SERVER_URL'] : undefined;
const RENDERER_DIST = join(APP_ROOT, 'dist');
const PRELOAD = join(__dirname, '..', 'preload', 'index.js');

// Single-instance lock: иначе SQLite WAL побьётся и multicast-сокеты подерутся за порт.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // log ещё не инициализирован — пишем напрямую в stdout.
  // eslint-disable-next-line no-console
  console.warn('[SmartHome Hub] Already running — focusing existing window and exiting.');
  app.quit();
  process.exit(0);
}

const LOG_LEVEL = (process.env['LOG_LEVEL'] ?? 'info') as 'debug' | 'info' | 'warn' | 'error';
log.transports.file.level = LOG_LEVEL;
log.transports.console.level = IS_DEV ? 'debug' : LOG_LEVEL;
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.info(`SmartHome Hub starting | electron=${process.versions.electron} | dev=${IS_DEV}`);
log.info(`User data dir: ${app.getPath('userData')}`);
log.info(`Logs dir: ${log.transports.file.getFile().path}`);
if (_envLoad.loadedFrom.length) {
  log.info(`Env override: ${_envLoad.applied} keys from ${_envLoad.loadedFrom.join(', ')}`);
}
log.info(
  `Config: LOG_LEVEL=${LOG_LEVEL} | mock=${process.env['HUB_ENABLE_MOCK'] ?? 'false'} | discovery=${process.env['HUB_DISCOVERY_INTERVAL_MS'] ?? '15000'}ms | poll=${process.env['HUB_POLL_INTERVAL_MS'] ?? '30000'}ms`,
);

// В Electron unhandled rejection молчаливые → production-вылет = чёрный экран без причины.
process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason);
});
app.on('render-process-gone', (_e, _wc, details) => {
  log.error('render-process-gone', details);
  if (details.reason === 'crashed') {
    const icon = resolveAppIcon();
    void dialog.showMessageBox({
      type: 'error',
      title: 'SmartHome Hub',
      message: 'Renderer завершился с ошибкой',
      detail: 'Перезапустите приложение. Подробности в логах.',
      buttons: ['OK'],
      ...(icon ? { icon } : {}),
    });
  }
});
app.on('child-process-gone', (_e, details) => {
  log.error('child-process-gone', details);
});

let mainWindow: BrowserWindow | null = null;
let hub: SmartHomeHub | null = null;
let tray: TrayController | null = null;

async function createWindow(): Promise<void> {
  const icon = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    // Поддержка mobile-first: 360px (iPhone SE портрет) — минимум для удобной работы,
    // компактнее уже не имеет смысла. UI ниже 720 переходит в drawer-режим
    // sidebar'а. Высота 480 — landscape phone.
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'SmartHome Hub',
    icon,
    // Custom titlebar; на macOS hiddenInset чтобы native traffic-lights остались.
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0F0F1A',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false — переход на true возможен после аудита preload-импортов.
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
      // Весь network — через main process, единая точка контроля доступа.
      allowRunningInsecureContent: false,
      webviewTag: false,
      // Hub-resident в трее: пользователь сворачивает окно, GSAP-таймлайн в
      // Welcome / Alice продолжает крутиться без замедления. Дефолтно Chromium
      // дропает RAF до 1Hz для unfocused windows.
      backgroundThrottling: false,
    },
  });

  // Defence-in-depth: deny attach даже если webviewTag окажется включён.
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
    log.warn('main-window: blocked will-attach-webview');
  });

  // Permission requests (notifications/geolocation/media) — deny by default.
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      log.warn(`main-window: denied permission request "${permission}"`);
      callback(false);
    },
  );

  nativeTheme.themeSource = 'dark';

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // External links → системный браузер через scheme-allow-list.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url);
    return { action: 'deny' };
  });

  // Renderer навигирует только внутри своего bundle / vite-dev-сервера.
  // Origin-точное сравнение (не startsWith) — `http://localhost:5173.evil.com` не пройдёт.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let allowed = false;
    try {
      const target = new URL(url);
      if (VITE_DEV_SERVER_URL) {
        allowed = target.origin === new URL(VITE_DEV_SERVER_URL).origin;
      } else {
        allowed = target.protocol === 'file:';
      }
    } catch {
      allowed = false;
    }
    if (!allowed) {
      event.preventDefault();
      safeOpenExternal(url);
    }
  });

  if (VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(VITE_DEV_SERVER_URL);
    if (process.env['HUB_OPEN_DEVTOOLS'] !== 'false') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    await mainWindow.loadFile(join(RENDERER_DIST, 'index.html'));
  }
}

async function bootstrap(): Promise<SmartHomeHub> {
  const settings = await createSettingsStore();
  const deviceStore = await createDeviceStore();
  const driverRegistry = createDriverRegistry({ settings });
  const deviceRegistry = createDeviceRegistry({ deviceStore, driverRegistry });
  const discovery = createDiscoveryService({ driverRegistry, deviceRegistry, settings });
  const polling = createPollingService({ deviceRegistry });
  const sceneService = createSceneService({ deviceStore, deviceRegistry });
  const yandexStation = createYandexStationClient();
  const yandexStationDiscovery = createYandexStationDiscovery();

  // AliceBridge инстанцируется ДО hub'а: он не зависит от него, но hub держит на него ref.
  // Колбэки замкнуты лениво на deviceRegistry/sceneService → не зависят от hub-фасада.
  const aliceBridge = new AliceBridge({
    settings,
    listDevices: () => deviceRegistry.list(),
    listScenes: () => sceneService.list(),
    listRooms: () => deviceRegistry.rooms.list(),
    executeCommand: (cmd) => deviceRegistry.execute(cmd),
    runScene: (sceneId) => sceneService.run(sceneId),
    getStationStatus: () => yandexStation.getStatus(),
  });

  const created = createSmartHomeHub({
    appVersion: app.getVersion(),
    // process.platform содержит экзотические значения (android/cygwin/...) — сужаем до Platform.
    platform: process.platform as Platform,
    settings,
    deviceStore,
    driverRegistry,
    deviceRegistry,
    discovery,
    polling,
    sceneService,
    yandexStation,
    yandexStationDiscovery,
    aliceBridge,
  });

  await created.init();
  return created;
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

async function showMainWindow(): Promise<void> {
  if (!mainWindow) {
    await createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

app.whenReady().then(async () => {
  try {
    installCsp(IS_DEV);
    hub = await bootstrap();
    registerIpcHandlers({
      ipcMain,
      hub,
      getMainWindow: () => mainWindow,
    });
    await createWindow();

    // Tray ПОСЛЕ окна, чтобы getMainWindow() уже возвращал инстанс.
    tray = createTray({
      getMainWindow: () => mainWindow,
      showMainWindow,
      triggerDiscovery: async () => {
        await showMainWindow();
        // Канал общий с IpcEvents — renderer подписывается типизированно через smarthome.events.on().
        mainWindow?.webContents.send('event:tray:navigate', { path: '/discovery?scan=1' });
      },
    });
  } catch (error) {
    log.error('Fatal startup error', error);
    const icon = resolveAppIcon();
    void dialog.showMessageBox({
      type: 'error',
      title: 'SmartHome Hub — ошибка запуска',
      message: 'Не удалось инициализировать приложение',
      detail: (error as Error).message,
      buttons: ['Закрыть'],
      ...(icon ? { icon } : {}),
    });
    app.exit(1);
  }
});

app.on('window-all-closed', () => {
  // Hub-resident: остаёмся в трее, выход только через «Выйти» в меню.
  // На macOS dock-convention — тоже не квитим.
  if (!tray) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

// Таймаут — чтобы не висеть в трее если driver-сокет не закрылся.
let shuttingDown = false;
app.on('before-quit', async (event) => {
  if (shuttingDown || !hub) return;
  event.preventDefault();
  shuttingDown = true;
  log.info('App shutdown — graceful');
  try {
    await Promise.race([hub.shutdown(), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  } catch (e) {
    log.warn(`shutdown timeout: ${(e as Error).message}`);
  }
  // Tray уничтожаем ДО app.exit — иначе на Windows иконка висит в трее до hover'а.
  tray?.destroy();
  tray = null;
  app.exit(0);
});

// Window-controls для frameless titlebar.
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());
