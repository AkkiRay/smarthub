/**
 * @fileoverview Generic loopback-OAuth helper для desktop-приложений.
 * Запускает изолированное BrowserWindow с partition'ом, lockdown-навигацией
 * (allow-list хостов + HTTPS-only + popup-deny + form-submit guard) и
 * парсингом OAuth-callback'а через переданный inspector.
 *
 * Используется Yandex-OAuth (`yandex-oauth.ts`). Когда у провайдера будет
 * реальный public OAuth client (без shipped client_secret), новый driver
 * подключается через config-объект — без копирования lockdown-логики.
 *
 * @example
 * ```ts
 * const result = await runOauthWindow({
 *   partition: 'persist:provider-oauth',
 *   title: 'Войти через Provider',
 *   authorizeUrl: 'https://provider.com/oauth/authorize?...',
 *   hostMatcher: (h) => h.endsWith('.provider.com'),
 *   inspectUrl: (url) => parseProviderCallback(url),
 *   logTag: 'ProviderOauth',
 * });
 * ```
 */

import { BrowserWindow, session, shell } from 'electron';
import log from 'electron-log/main.js';
import { resolveAppIcon } from '../app-icon.js';

export interface RunOauthWindowOptions<T> {
  /** Electron-партиция (`persist:<id>`). Cookies живут отдельно от main-сессии. */
  partition: string;
  /** Заголовок окна. */
  title: string;
  /** Стартовый URL — обычно `<authorize-endpoint>?client_id=...&...`. */
  authorizeUrl: string;
  /**
   * Allow-list хостов: вернуть `true` если этот URL допустимо открыть в окне.
   * Receives host-name (без схемы). Должен быть anchored regex / suffix-check
   * (НЕ `includes` — иначе attacker.com с подстрокой провайдера пройдёт).
   */
  hostMatcher: (host: string) => boolean;
  /**
   * Парсит navigation-URL. Если в нём есть OAuth-callback (token / code) —
   * вернуть результат, иначе `null`. Promise resolve'нется этим значением.
   */
  inspectUrl: (url: string) => T | null;
  /** Optional parent-window — модальное окно. */
  parent?: BrowserWindow;
  /** Префикс для `electron-log` warning'ов; default `'OauthWindow'`. */
  logTag?: string;
  /** Width / height окна; defaults 520×720. */
  width?: number;
  height?: number;
}

/**
 * Открывает изолированное OAuth-окно, дожидается callback'а или закрытия,
 * возвращает `T | null`. Lockdown навигации применяется автоматически.
 */
export function runOauthWindow<T>(opts: RunOauthWindowOptions<T>): Promise<T | null> {
  const tag = opts.logTag ?? 'OauthWindow';

  return new Promise((resolve) => {
    const oauthSession = session.fromPartition(opts.partition);
    const icon = resolveAppIcon();
    const win = new BrowserWindow({
      width: opts.width ?? 520,
      height: opts.height ?? 720,
      modal: !!opts.parent,
      ...(opts.parent ? { parent: opts.parent } : {}),
      autoHideMenuBar: true,
      title: opts.title,
      backgroundColor: '#0F0F1A',
      ...(icon ? { icon } : {}),
      webPreferences: {
        session: oauthSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    let settled = false;
    const finish = (result: T | null): void => {
      if (settled) return;
      settled = true;
      try {
        win.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    };

    lockdownOauthWindow(win, opts.hostMatcher, tag);

    const inspect = (url: string): void => {
      const result = opts.inspectUrl(url);
      if (result !== null) finish(result);
    };

    win.webContents.on('will-redirect', (_e, url) => inspect(url));
    win.webContents.on('did-redirect-navigation', (_e, url) => inspect(url));
    win.webContents.on('did-navigate', (_e, url) => inspect(url));
    win.webContents.on('did-navigate-in-page', (_e, url) => inspect(url));

    win.on('closed', () => finish(null));

    void win.loadURL(opts.authorizeUrl).catch((e) => {
      log.warn(`${tag}: loadURL failed`, e);
      finish(null);
    });
  });
}

/**
 * Стандартный lockdown navigation'а OAuth-окна — popup deny, allow-list
 * хостов, HTTPS-only, will-redirect / will-frame-navigate guards.
 *
 * @param win - окно, на которое навешиваем guards.
 * @param hostMatcher - функция проверки allowed host'а.
 * @param logTag - префикс для warning-логов.
 */
export function lockdownOauthWindow(
  win: BrowserWindow,
  hostMatcher: (host: string) => boolean,
  logTag: string,
): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        void shell.openExternal(u.toString());
      }
    } catch {
      /* malformed url */
    }
    return { action: 'deny' };
  });

  const guard = (event: Electron.Event, url: string, kind: string): void => {
    let allowed = false;
    try {
      const target = new URL(url);
      // SSL-strip защита: HTTPS-only обязателен.
      allowed = target.protocol === 'https:' && hostMatcher(target.hostname);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      event.preventDefault();
      log.warn(`${logTag}: blocked ${kind} to ${url}`);
    }
  };

  win.webContents.on('will-navigate', (e, url) => guard(e, url, 'will-navigate'));
  win.webContents.on('will-redirect', (e, url) => guard(e, url, 'will-redirect'));
  win.webContents.on('will-frame-navigate', (e) => {
    const url = e.url;
    if (!url) return;
    let allowed = false;
    try {
      const target = new URL(url);
      allowed = target.protocol === 'https:' && hostMatcher(target.hostname);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      e.preventDefault();
      log.warn(`${logTag}: blocked frame navigation to ${url}`);
    }
  });
}

/**
 * Stand-alone helper: открыть БrowserWindow с lockdown'ом, без OAuth-callback'а.
 * Используется для embedded device-binding flow (Yandex Дом с Алисой и т.п.).
 *
 * @returns Promise, который resolve'ится при close окна.
 */
export function runLockedDownWindow(opts: {
  partition: string;
  title: string;
  url: string;
  hostMatcher: (host: string) => boolean;
  logTag?: string;
  width?: number;
  height?: number;
  parent?: BrowserWindow;
}): Promise<void> {
  const tag = opts.logTag ?? 'OauthWindow';
  return new Promise((resolve) => {
    const oauthSession = session.fromPartition(opts.partition);
    const icon = resolveAppIcon();
    const win = new BrowserWindow({
      width: opts.width ?? 980,
      height: opts.height ?? 760,
      ...(opts.parent ? { parent: opts.parent, modal: false } : {}),
      autoHideMenuBar: true,
      title: opts.title,
      backgroundColor: '#0F0F1A',
      ...(icon ? { icon } : {}),
      webPreferences: {
        session: oauthSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    lockdownOauthWindow(win, opts.hostMatcher, tag);

    let resolved = false;
    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    win.on('closed', finish);

    void win.loadURL(opts.url).catch((e) => {
      log.warn(`${tag}: loadURL failed`, e);
      try {
        win.close();
      } catch {
        /* already */
      }
      finish();
    });
  });
}
