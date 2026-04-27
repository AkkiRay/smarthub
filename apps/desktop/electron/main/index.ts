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

// setName до `app.getPath('userData')` — Electron фиксирует путь по `name` при первом обращении.
app.setName('SmartHome Hub');

// AppUserModelId на Windows для notifications и taskbar-grouping; совпадает с `build.appId`.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.smarthome.hub');
}

// Chromium command-line флаги. Применяются до app.whenReady():
//   - disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling — отключение occlusion-throttle и wake-up throttle.
//   - disable-backgrounding-occluded-windows / disable-renderer-backgrounding — renderer-process сохраняет приоритет при потере focus.
//   - enable-gpu-rasterization + enable-zero-copy — GPU compositor без промежуточных copy через shared memory.
//   - ignore-gpu-blocklist — hardware-acceleration на драйверах из консервативного blocklist.
//   - use-angle=d3d11 (Windows) — D3D11 backend для ANGLE.
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

// Использует app.getPath('userData') для приоритетного кандидата env-файла.
const _envLoad = loadRuntimeEnv(app);

// APP_ROOT как локальная константа: с noUncheckedIndexedAccess process.env[k] имеет тип `string | undefined`.
const APP_ROOT = join(__dirname, '..', '..');
process.env['APP_ROOT'] = APP_ROOT;

// IS_DEV определяется через `app.isPackaged`, не через env-flag.
const IS_DEV = !app.isPackaged;
const VITE_DEV_SERVER_URL = IS_DEV ? process.env['VITE_DEV_SERVER_URL'] : undefined;
const RENDERER_DIST = join(APP_ROOT, 'dist');
const PRELOAD = join(__dirname, '..', 'preload', 'index.js');

// Single-instance lock: SQLite WAL и multicast-сокеты разделяются между процессами одного приложения.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // log ещё не инициализирован — stdout напрямую.
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

// Логирование uncaught exceptions и unhandled rejections.
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
    // Минимальный viewport: 360x480 для mobile-портрета и landscape phone.
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'SmartHome Hub',
    icon,
    // Custom titlebar; macOS — hiddenInset для native traffic-lights.
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0F0F1A',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: true бесплатно повышает изоляцию — preload использует только
      // electron (contextBridge/ipcRenderer), что разрешено sandbox-policy'ей.
      // RCE в renderer'е не эскалирует в host-process.
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // Network-доступ из renderer ходит через main process IPC.
      allowRunningInsecureContent: false,
      webviewTag: false,
      // RAF не дропается до 1Hz при unfocused window — orb и GSAP-таймлайны держат frame-rate.
      backgroundThrottling: false,
    },
  });

  // Deny attach для webview-тега независимо от webviewTag-флага.
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

  // Renderer-навигация ограничена origin'ом bundle / vite-dev-сервера. Origin-точное сравнение.
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

  // AliceBridge инстанцируется до hub'а; колбэки замкнуты на deviceRegistry/sceneService.
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
    // process.platform сужается до Platform (исключает android/cygwin/...).
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

    // Tray создаётся после окна — getMainWindow() возвращает инстанс.
    tray = createTray({
      getMainWindow: () => mainWindow,
      showMainWindow,
      triggerDiscovery: async () => {
        await showMainWindow();
        // IpcEvents-канал; renderer подписывается через smarthome.events.on().
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
  // Hub-resident: процесс остаётся в трее, выход через «Выйти» в tray-меню.
  if (!tray) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

// Graceful shutdown с 8-секундным timeout-protection.
// Cloud-драйверы (Aqara/Sber/eWeLink) могут держать HTTP-коннект до 6с при
// прогрессирующем 5xx; 5с давало преждевременный timeout посреди execute()
// → state в SQLite/storage оставался несогласованный.
let shuttingDown = false;
app.on('before-quit', async (event) => {
  if (shuttingDown || !hub) return;
  event.preventDefault();
  shuttingDown = true;
  log.info('App shutdown — graceful');
  try {
    await Promise.race([
      hub.shutdown(),
      new Promise((resolve) => setTimeout(resolve, 8_000)),
    ]);
  } catch (e) {
    log.warn(`shutdown timeout: ${(e as Error).message}`);
  }
  // Tray.destroy() до app.exit — на Windows иначе icon остаётся в трее до hover'а.
  tray?.destroy();
  tray = null;
  app.exit(0);
});

// IPC-handlers для window-controls frameless titlebar.
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());
