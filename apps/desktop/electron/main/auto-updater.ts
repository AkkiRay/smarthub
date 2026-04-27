/**
 * @fileoverview Auto-update orchestration over electron-updater + GitHub Releases.
 *
 * Lifecycle / поток событий:
 *   1. На старте main process'а вызывается {@link initAutoUpdater} — настраивает
 *      transport (electron-log), GitHub-feed, отключает auto-download/auto-install
 *      (пользователь сам решает когда применить update).
 *   2. Через {@link UpdaterController.checkForUpdates} (IPC `updater:check`) UI
 *      инициирует проверку. Все state-переходы пушатся в renderer событием
 *      `update:status` (см. `IpcEvents.update:status`).
 *   3. {@link UpdaterController.download} стягивает .nupkg / .blockmap / DMG /
 *      AppImage delta во временную папку. Прогресс — через `update:status`
 *      `state: 'downloading'`.
 *   4. {@link UpdaterController.install} применяет update: `quitAndInstall(true,true)`
 *      — graceful quit + restart.
 *
 * Безопасность:
 *   - `verifyUpdateCodeSignature: false` в build config — Windows-кода без EV/OV
 *     цифровой подписи; нет смысла валидировать. На macOS подпись работает по
 *     умолчанию через notarization. На Linux — sha512 из `latest-linux.yml`.
 *   - Feed жёстко привязан к public GitHub-репозиторию. `provider: 'github'` +
 *     `releaseType: 'release'` — pre-release / draft не подхватываются.
 *
 * Dev-mode:
 *   - `app.isPackaged === false` → `autoUpdater.checkForUpdatesAndNotify()` молча
 *     no-op'ит. Чтобы не сыпать ошибками в DevTools при dev-сессии, мы вообще не
 *     инициализируем feed в dev — экспортируем noop-controller.
 *
 * @see apps/desktop/electron/main/ipc/handlers.ts — IPC binding.
 * @see packages/shared/src/types/ipc.ts (UpdateStatus / IpcEvents.update:status).
 */

import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main.js';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { UpdateStatus } from '@smarthome/shared';

const UPDATER_LOG = log.scope('updater');

/** Опубликованный наружу контроллер; в dev — все методы no-op. */
export interface UpdaterController {
  /** Текущий снимок состояния (UI читает на mount). */
  getStatus(): UpdateStatus;
  /** Pull GitHub-feed; не скачивает. */
  checkForUpdates(opts?: { silent?: boolean }): Promise<UpdateStatus>;
  /** Скачать update в фон; прогресс пушится в renderer. */
  download(): Promise<UpdateStatus>;
  /** Применить скачанный update — quit + restart. */
  install(): void;
  /** Disposer для shutdown. */
  dispose(): void;
}

const noopController: UpdaterController = {
  getStatus: () => ({ state: 'disabled', currentVersion: app.getVersion() }),
  checkForUpdates: async () => ({ state: 'disabled', currentVersion: app.getVersion() }),
  download: async () => ({ state: 'disabled', currentVersion: app.getVersion() }),
  install: () => undefined,
  dispose: () => undefined,
};

export interface InitUpdaterDeps {
  getMainWindow: () => BrowserWindow | null;
  /**
   * Период автоматической фоновой проверки. По умолчанию 6 часов; 0 — выключено.
   * Первая проверка — через 60с после старта (даём UI и discovery встать).
   */
  checkIntervalMs?: number;
}

/**
 * Инициализирует updater и возвращает контроллер. В dev-режиме (`!app.isPackaged`)
 * возвращает {@link noopController} без подписки на feed.
 */
export function initAutoUpdater(deps: InitUpdaterDeps): UpdaterController {
  if (!app.isPackaged) {
    UPDATER_LOG.info('dev-mode — auto-updater disabled');
    return noopController;
  }

  const checkIntervalMs = deps.checkIntervalMs ?? 6 * 60 * 60 * 1000;

  autoUpdater.logger = UPDATER_LOG;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  let status: UpdateStatus = {
    state: 'idle',
    currentVersion: app.getVersion(),
  };

  function setStatus(next: UpdateStatus): void {
    status = next;
    const win = deps.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('event:update:status', status);
    }
  }

  autoUpdater.on('checking-for-update', () => {
    UPDATER_LOG.info('checking…');
    setStatus({ state: 'checking', currentVersion: app.getVersion() });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    UPDATER_LOG.info(`update-available v${info.version}`);
    setStatus({
      state: 'available',
      currentVersion: app.getVersion(),
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: normalizeNotes(info.releaseNotes),
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    UPDATER_LOG.info(`up-to-date (latest=${info.version})`);
    setStatus({
      state: 'up-to-date',
      currentVersion: app.getVersion(),
      version: info.version,
      checkedAt: new Date().toISOString(),
    });
  });

  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    const inflightVersion =
      status.state === 'available' ||
      status.state === 'downloading' ||
      status.state === 'downloaded'
        ? status.version
        : undefined;
    setStatus({
      state: 'downloading',
      currentVersion: app.getVersion(),
      ...(inflightVersion !== undefined ? { version: inflightVersion } : {}),
      percent: Math.round(p.percent),
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    UPDATER_LOG.info(`downloaded v${info.version}`);
    setStatus({
      state: 'downloaded',
      currentVersion: app.getVersion(),
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: normalizeNotes(info.releaseNotes),
    });
  });

  autoUpdater.on('error', (err) => {
    UPDATER_LOG.warn(`error: ${err?.message ?? err}`);
    setStatus({
      state: 'error',
      currentVersion: app.getVersion(),
      error: err?.message ?? String(err),
    });
  });

  // Первый check — через 60с, далее по интервалу. signal: AbortController при dispose.
  const firstCheckTimer = setTimeout(() => {
    void controller.checkForUpdates({ silent: true });
  }, 60_000);

  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  if (checkIntervalMs > 0) {
    intervalTimer = setInterval(() => {
      void controller.checkForUpdates({ silent: true });
    }, checkIntervalMs);
  }

  const controller: UpdaterController = {
    getStatus: () => status,

    async checkForUpdates(opts) {
      try {
        await autoUpdater.checkForUpdates();
        return status;
      } catch (e) {
        const message = (e as Error).message ?? String(e);
        UPDATER_LOG.warn(`check failed: ${message}`);
        if (!opts?.silent) {
          setStatus({
            state: 'error',
            currentVersion: app.getVersion(),
            error: message,
          });
        }
        return status;
      }
    },

    async download() {
      if (status.state !== 'available') {
        UPDATER_LOG.warn(`download requested in state '${status.state}', ignoring`);
        return status;
      }
      try {
        await autoUpdater.downloadUpdate();
        return status;
      } catch (e) {
        const message = (e as Error).message ?? String(e);
        UPDATER_LOG.warn(`download failed: ${message}`);
        setStatus({
          state: 'error',
          currentVersion: app.getVersion(),
          error: message,
        });
        return status;
      }
    },

    install() {
      if (status.state !== 'downloaded') {
        UPDATER_LOG.warn(`install requested in state '${status.state}', ignoring`);
        return;
      }
      UPDATER_LOG.info('quitAndInstall — graceful');
      // isSilent=false → даём NSIS показать UAC; isForceRunAfter=true → сразу
      // запустить новую версию после установки.
      autoUpdater.quitAndInstall(false, true);
    },

    dispose() {
      clearTimeout(firstCheckTimer);
      if (intervalTimer) clearInterval(intervalTimer);
      autoUpdater.removeAllListeners();
    },
  };

  return controller;
}

function normalizeNotes(raw: UpdateInfo['releaseNotes']): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  // Массив объектов { version, note } — берём notes последнего бампа.
  return raw.map((r) => r.note).filter(Boolean).join('\n\n') || undefined;
}
