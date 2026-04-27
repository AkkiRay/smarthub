/**
 * Implicit OAuth Yandex ID в отдельном BrowserWindow.
 *
 * Изолированный partition `persist:yandex-oauth` — cookies живут отдельно от
 * основной сессии приложения. Слушаем navigation events, ловим `#access_token=…`
 * и закрываем окно. Если пользователь закрыл окно сам — резолвим null.
 */

import { BrowserWindow, session, shell } from 'electron';
import log from 'electron-log/main.js';
import { resolveAppIcon } from '../../main/app-icon.js';
import {
  buildOauthUrl,
  YANDEX_DIALOGS_CALLBACK_CLIENT_ID,
  parseOauthCallback,
} from './yandex-quasar-api.js';

/** Anchored allow-list хостов для OAuth-окна (yandex.ru/com/by/kz/net/com.tr). */
const YANDEX_HOST_REGEX =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*yandex\.(?:ru|com|by|kz|net|com\.tr)$/i;

function isYandexHost(host: string): boolean {
  return typeof host === 'string' && host.length > 0 && YANDEX_HOST_REGEX.test(host);
}

/**
 * Deny popup'ов + filter `will-navigate` + form-submission + redirect.
 *
 * `will-navigate` ловит обычную клик-навигацию, НО не form-submit и не AJAX.
 * Для form-submit нужен `will-frame-navigate` или `did-frame-navigate` +
 * blocking через response-redirect. Также подключаем CSP через
 * `webRequest.onHeadersReceived`, чтобы запретить inline-script навсегда.
 */
function lockdownOauthWindow(win: BrowserWindow): void {
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
      // SSL-strip защита: http://-OAuth flow отдал бы access-token MITM'у
      // на той же LAN. Yandex давно возвращает HSTS, но блок'ируем явно.
      allowed = target.protocol === 'https:' && isYandexHost(target.hostname);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      event.preventDefault();
      log.warn(`YandexOauth: blocked ${kind} to ${url}`);
    }
  };

  win.webContents.on('will-navigate', (e, url) => guard(e, url, 'will-navigate'));
  // will-redirect — на случай 302 redirect'ов с Yandex на attacker-домен
  // (теоретически, если Yandex-страницу взломают и инжектируют redirect).
  win.webContents.on('will-redirect', (e, url) => guard(e, url, 'will-redirect'));
  // will-frame-navigate — ловит form-submit (POST с redirect) внутри top-frame
  // и iframe'ах. Без него attacker через XSS на Yandex-странице мог бы
  // отправить access_token формой на свой домен.
  win.webContents.on('will-frame-navigate', (e) => {
    const url = e.url;
    if (!url) return;
    let allowed = false;
    try {
      const target = new URL(url);
      allowed = target.protocol === 'https:' && isYandexHost(target.hostname);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      e.preventDefault();
      log.warn(`YandexOauth: blocked frame navigation to ${url}`);
    }
  });
}

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
  // Перегрузка: первый аргумент — либо options-объект, либо BrowserWindow.
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

    // Implicit flow: token прилетает в hash. Yandex редиректит через
    // несколько промежуточных URL — слушаем все navigation events.
    const inspect = (url: string): void => {
      if (!url.includes('#access_token=')) return;
      const parsed = parseOauthCallback(url);
      if (parsed) {
        log.info('YandexOauth: token acquired (expires_in=%d)', parsed.expiresIn);
        finish(parsed);
      }
    };

    lockdownOauthWindow(win);

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
 * Открывает embedded-BrowserWindow на yandex.ru/quasar в партиции
 * `persist:yandex-oauth`. Resolve'ится при close. Caller должен вызвать
 * `syncYandexHome()` для импорта добавленных устройств.
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

    lockdownOauthWindow(win);

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
