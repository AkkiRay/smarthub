/**
 * @fileoverview Контракт auto-update flow между main process'ом (electron-updater
 * + GitHub Releases) и renderer-UI.
 *
 * Состояния — discriminated union по `state`. UI делает `switch (status.state)`,
 * лишних optional-полей быть не должно: каждое state-варианте — точно те поля,
 * которые UI обязан показать.
 */

/**
 * Финальное состояние updater'а. Discriminated по `state`.
 *
 *   - `disabled`     — dev-режим / `app.isPackaged === false` / portable build.
 *   - `idle`         — старт, ещё ни одной проверки.
 *   - `checking`     — pull GitHub-feed.
 *   - `up-to-date`   — feed ответил, текущая версия — последняя.
 *   - `available`    — есть новая версия, ждём `download()`.
 *   - `downloading`  — качаем .nupkg / DMG / AppImage; прогресс в полях.
 *   - `downloaded`   — готово к `install()` (quitAndInstall).
 *   - `error`        — последний шаг упал; `error` — message.
 */
export type UpdateStatus =
  | { state: 'disabled'; currentVersion: string }
  | { state: 'idle'; currentVersion: string }
  | { state: 'checking'; currentVersion: string }
  | {
      state: 'up-to-date';
      currentVersion: string;
      version: string;
      checkedAt: string;
    }
  | {
      state: 'available';
      currentVersion: string;
      version: string;
      releaseDate?: string;
      releaseNotes?: string;
    }
  | {
      state: 'downloading';
      currentVersion: string;
      version?: string;
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | {
      state: 'downloaded';
      currentVersion: string;
      version: string;
      releaseDate?: string;
      releaseNotes?: string;
    }
  | {
      state: 'error';
      currentVersion: string;
      error: string;
    };
