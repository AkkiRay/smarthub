/**
 * Implicit OAuth Yandex ID в отдельном BrowserWindow.
 *
 * Изолированный partition `persist:yandex-oauth` — cookies живут отдельно от
 * основной сессии приложения. Слушаем navigation events, ловим `#access_token=…`
 * и закрываем окно. Если пользователь закрыл окно сам — резолвим null.
 *
 * Lockdown навигации (allow-list, HTTPS-only, popup-deny, form-submit guard)
 * делегирован в `electron/main/oauth/loopback-oauth.ts` — generic helper для
 * future-провайдеров.
 */

import type { BrowserWindow } from 'electron';
import log from 'electron-log/main.js';
import { runOauthWindow, runLockedDownWindow } from '../../main/oauth/loopback-oauth.js';
import { session } from 'electron';
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

export async function runYandexOauth(
  optsOrParent?: RunYandexOauthOptions | BrowserWindow,
): Promise<YandexOauthResult | null> {
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

  return runOauthWindow<YandexOauthResult>({
    partition: YANDEX_OAUTH_PARTITION,
    title,
    authorizeUrl: url,
    hostMatcher: isYandexHost,
    inspectUrl: (navUrl) => {
      if (!navUrl.includes('#access_token=')) return null;
      const parsed = parseOauthCallback(navUrl);
      if (parsed) {
        log.info('YandexOauth: token acquired (expires_in=%d)', parsed.expiresIn);
      }
      return parsed;
    },
    logTag: 'YandexOauth',
    ...(opts.parent ? { parent: opts.parent } : {}),
  });
}

/** Стирает cookies/storage OAuth-партиции. */
export async function clearYandexOauthSession(): Promise<void> {
  const oauthSession = session.fromPartition(YANDEX_OAUTH_PARTITION);
  await oauthSession.clearStorageData();
}

/**
 * Открывает embedded-BrowserWindow на yandex.ru/quasar в партиции
 * `persist:yandex-oauth`. Resolve'ится при close. Caller должен вызвать
 * `syncYandexHome()` для импорта добавленных устройств.
 */
export async function openYandexHomeBindingWindow(parent?: BrowserWindow): Promise<void> {
  return runLockedDownWindow({
    partition: YANDEX_OAUTH_PARTITION,
    title: 'Добавить устройство в «Дом с Алисой»',
    url: 'https://yandex.ru/quasar/iot',
    hostMatcher: isYandexHost,
    logTag: 'YandexHomeBinding',
    ...(parent ? { parent } : {}),
  });
}
