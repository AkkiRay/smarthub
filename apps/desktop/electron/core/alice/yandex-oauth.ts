/**
 * Implicit OAuth Yandex ID в отдельном BrowserWindow.
 *
 * Изолированный partition `persist:yandex-oauth` — cookies живут отдельно от
 * основной сессии приложения. Слушаем navigation events, ловим `#access_token=…`
 * и закрываем окно. Если пользователь закрыл окно сам — резолвим null.
 */

import { BrowserWindow, session } from 'electron';
import log from 'electron-log/main.js';
import { resolveAppIcon } from '../../main/app-icon.js';
import {
  buildOauthUrl,
  YANDEX_DIALOGS_CALLBACK_CLIENT_ID,
  parseOauthCallback,
} from './yandex-quasar-api.js';

export interface YandexOauthResult {
  accessToken: string;
  /** Seconds, либо 0 если Yandex не передал. */
  expiresIn: number;
}

export interface RunYandexOauthOptions {
  parent?: BrowserWindow;
  /** `music` (default) — для glagol API; `dialogs-callback` — для skill push. */
  scope?: 'music' | 'dialogs-callback';
  title?: string;
}

/** Electron-партиция для cookies OAuth-сессии Яндекса. */
export const YANDEX_OAUTH_PARTITION = 'persist:yandex-oauth';
const PARTITION = YANDEX_OAUTH_PARTITION;

export async function runYandexOauth(
  optsOrParent?: RunYandexOauthOptions | BrowserWindow,
): Promise<YandexOauthResult | null> {
  // Back-compat: ранее первый аргумент был BrowserWindow.
  const opts: RunYandexOauthOptions =
    optsOrParent && 'webContents' in optsOrParent
      ? { parent: optsOrParent }
      : ((optsOrParent as RunYandexOauthOptions | undefined) ?? {});

  const clientId =
    opts.scope === 'dialogs-callback' ? YANDEX_DIALOGS_CALLBACK_CLIENT_ID : undefined;
  const url = buildOauthUrl(clientId);
  const title =
    opts.title ??
    (opts.scope === 'dialogs-callback' ? 'Токен для push в Алису' : 'Войти через Яндекс');

  return new Promise((resolve) => {
    const oauthSession = session.fromPartition(PARTITION);

    const icon = resolveAppIcon();
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      modal: !!opts.parent,
      ...(opts.parent ? { parent: opts.parent } : {}),
      autoHideMenuBar: true,
      title,
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
    const finish = (result: YandexOauthResult | null): void => {
      if (settled) return;
      settled = true;
      try {
        win.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    };

    // Implicit flow: token прилетает в hash. Слушаем все navigation events,
    // т.к. Yandex редиректит через несколько промежуточных URL.
    const inspect = (url: string): void => {
      if (!url.includes('#access_token=')) return;
      const parsed = parseOauthCallback(url);
      if (parsed) {
        log.info('YandexOauth: token acquired (expires_in=%d)', parsed.expiresIn);
        finish(parsed);
      }
    };

    win.webContents.on('will-redirect', (_e, url) => inspect(url));
    win.webContents.on('did-redirect-navigation', (_e, url) => inspect(url));
    win.webContents.on('did-navigate', (_e, url) => inspect(url));
    win.webContents.on('did-navigate-in-page', (_e, url) => inspect(url));

    win.on('closed', () => finish(null));

    void win.loadURL(url).catch((e) => {
      log.warn('YandexOauth: loadURL failed', e);
      finish(null);
    });
  });
}

/** Стирает cookies/storage OAuth-партиции. */
export async function clearYandexOauthSession(): Promise<void> {
  const oauthSession = session.fromPartition(PARTITION);
  await oauthSession.clearStorageData();
}

/**
 * Открывает embedded-BrowserWindow на yandex.ru/quasar (страница «Дома с Алисой»)
 * в той же `persist:yandex-oauth` партиции — юзер уже авторизован, видит список
 * устройств, может добавить новую лампочку прямо внутри хаба.
 *
 * Промис резолвится когда юзер закрыл окно (мы НЕ можем точно знать, добавил ли
 * он устройство — поэтому caller должен сделать `syncYandexHome()` после resolve'а).
 */
export async function openYandexHomeBindingWindow(parent?: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const oauthSession = session.fromPartition(PARTITION);
    const icon = resolveAppIcon();
    const win = new BrowserWindow({
      width: 980,
      height: 760,
      ...(parent ? { parent, modal: false } : {}),
      autoHideMenuBar: true,
      title: 'Добавить устройство в «Дом с Алисой»',
      backgroundColor: '#0F0F1A',
      ...(icon ? { icon } : {}),
      webPreferences: {
        session: oauthSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    let resolved = false;
    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    win.on('closed', finish);

    void win.loadURL('https://yandex.ru/quasar/iot').catch((e) => {
      log.warn('YandexHomeBinding: loadURL failed', e);
      try {
        win.close();
      } catch {
        /* already */
      }
      finish();
    });
  });
}
