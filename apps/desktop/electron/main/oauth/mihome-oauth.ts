/**
 * @fileoverview Embedded OAuth-флоу Mi Home — открывает реальную страницу
 * `account.xiaomi.com/pass/serviceLogin` в изолированном BrowserWindow,
 * пользователь сам проходит логин + email/SMS 2FA + captcha (Xiaomi anti-bot
 * любит активироваться на новых device-fingerprint'ах). После успешного
 * логина partition содержит `passToken` cookie — long-lived (~1 год).
 *
 * После закрытия окна:
 *   1. Берём cookies партиции (`passToken`, `userId`, `cUserId`, `pass_token`).
 *   2. Делаем silent `GET /pass/serviceLogin?sid=xiaomiio&_json=true` с этими
 *      cookies — Xiaomi возвращает `code: 0` со `ssecurity`/`userId`/`location`
 *      БЕЗ повторного запроса пароля (passToken для сервера достаточен).
 *   3. Дёргаем `location` → получаем `serviceToken` cookie.
 *   4. Возвращаем `MiSession` для прямой записи в driverCredentials.
 *
 * Без BrowserWindow реализовать 2FA-email handshake вручную невозможно:
 * Xiaomi `/identity/list` + `/identity/auth/<flag>` — private endpoints,
 * без identity_session cookie / device-fingerprint наш хэш всегда отвергается.
 */

import axios from 'axios';
import { session, type BrowserWindow } from 'electron';
import log from 'electron-log/main.js';
import { runOauthWindow } from './loopback-oauth.js';
import {
  decodeUtf8,
  extractCookie,
  parseMiJson,
  type MiSession,
} from '../../core/drivers/mihome-cloud/mihome-utils.js';

export interface RunMihomeOauthOptions {
  parent?: BrowserWindow;
  /** Регион сервера — попадёт в final session shape (driver использует region для baseURL). */
  region: 'cn' | 'de' | 'i2' | 'ru' | 'sg' | 'us';
}

export interface RunMihomeOauthResult {
  session: MiSession;
  region: 'cn' | 'de' | 'i2' | 'ru' | 'sg' | 'us';
}

/** Изолированная партиция cookies. Изоляция от main-сессии и других OAuth-окон. */
export const MIHOME_OAUTH_PARTITION = 'persist:mihome-oauth';

/**
 * Allow-list хостов: account.xiaomi.com (login), sts.api.io.mi.com (callback),
 * passport.xiaomi.com (legacy redirect), <region>.api.io.mi.com (final API),
 * mi.com / xiaomi.com root domains.
 */
const XIAOMI_HOST_REGEX =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*(?:xiaomi|mi)\.com$/i;

function isXiaomiHost(host: string): boolean {
  return typeof host === 'string' && host.length > 0 && XIAOMI_HOST_REGEX.test(host);
}

export async function runMihomeOauth(
  opts: RunMihomeOauthOptions,
): Promise<RunMihomeOauthResult | null> {
  const partition = MIHOME_OAUTH_PARTITION;

  // Очищаем партицию ДО открытия окна. Без этого stale cookies от прошлой
  // (неудачной или прошлой успешной) попытки заставляют Xiaomi сразу делать
  // 302 → sts.api.io.mi.com/sts при первом же запросе serviceLogin —
  // login UI вообще не успевает загрузиться, и cookies в партиции остаются
  // неполноценными (без passToken). Свежий старт гарантирует, что юзер
  // реально проходит login и сервер выдаёт passToken.
  try {
    const s = session.fromPartition(partition);
    await s.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers'],
    });
  } catch (e) {
    log.warn(`MihomeOauth: pre-clear partition failed: ${(e as Error).message}`);
  }

  // Стартовый URL: serviceLogin для sid=xiaomiio (Mi Home account scope).
  // _locale=en_US — английский UI вместо китайского по умолчанию для cn-сервера.
  const authUrl =
    'https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_locale=en_US&callback=' +
    encodeURIComponent('https://sts.api.io.mi.com/sts');

  // После login Xiaomi редиректит на sts.api.io.mi.com/sts — на этой странице
  // сервер устанавливает passToken cookie (в response set-cookie) и
  // отвечает plain-text "ok". Используем флаг + проверку реального наличия
  // passToken в партиции: navigation сам по себе не означает успех — cookies
  // могут быть неполноценными если редирект отдан до завершения auth-pipeline'а.
  let reached = false;

  const reachedCallback = await runOauthWindow<true>({
    partition,
    title: 'Войти в Mi Home',
    authorizeUrl: authUrl,
    hostMatcher: isXiaomiHost,
    logTag: 'MihomeOauth',
    width: 520,
    height: 720,
    ...(opts.parent ? { parent: opts.parent } : {}),
    inspectUrl: (navUrl) => {
      try {
        const u = new URL(navUrl);
        if (u.hostname !== 'sts.api.io.mi.com' || !u.pathname.startsWith('/sts')) return null;
        // Дублирующиеся events: closing-логика inside runOauthWindow только
        // первый non-null результат принимает; защита здесь минимальна.
        if (reached) return true;
        reached = true;
        log.info('MihomeOauth: callback reached, closing window');
        return true;
      } catch {
        return null;
      }
    },
  });

  if (!reachedCallback) {
    log.info('MihomeOauth: window closed before reaching sts callback');
    return null;
  }

  const fresh = await resilverSessionFromPartition();
  if (!fresh) return null;

  log.info('MihomeOauth: session acquired (region=%s, userId=%s)', opts.region, fresh.userId);
  return { session: fresh, region: opts.region };
}

/** Mi Home Android UA — без него Xiaomi anti-bot отвечает success-status БЕЗ ssecurity. */
const MIHOME_UA =
  'Android-14-9.6.108-com.xiaomi.smarthome-AndroidApp APP/com.xiaomi.smarthome APPV/9.6.108';

/**
 * Silent re-auth используя cookies партиции `persist:mihome-oauth`.
 *
 * passToken cookie живёт ~1 год; ssecurity/serviceToken протухают чаще.
 * Driver зовёт это при 401 — если passToken ещё валиден, сервер выдаст
 * свежие credentials без UI-окна. Если passToken тоже истёк — null,
 * и driver покажет «Откройте Настройки и войдите заново».
 *
 * GET /pass/serviceLogin для УЖЕ авторизованной сессии сразу возвращает
 * ssecurity/userId/location/cUserId/passToken (per PiotrMachowski/Xiaomi-cloud-tokens-extractor).
 */
export async function resilverSessionFromPartition(): Promise<MiSession | null> {
  const xiaomiSession = session.fromPartition(MIHOME_OAUTH_PARTITION);
  const allCookies = await xiaomiSession.cookies.get({});
  const passToken = allCookies.find((c) => c.name === 'passToken');
  if (!passToken) {
    log.info('MihomeOauth.resilver: no passToken in partition');
    return null;
  }
  const cookieHeader = allCookies.map((c) => `${c.name}=${c.value}`).join('; ');

  let json: {
    ssecurity?: string;
    userId?: number | string;
    cUserId?: string;
    passToken?: string;
    location?: string;
    code?: number;
    desc?: string;
    _sign?: string;
  } | null;
  try {
    const r = await axios.get<ArrayBuffer>(
      'https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true',
      {
        responseType: 'arraybuffer',
        maxRedirects: 0,
        validateStatus: () => true,
        timeout: 8000,
        headers: {
          'User-Agent': MIHOME_UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookieHeader,
        },
      },
    );
    json = parseMiJson(decodeUtf8(r.data));
  } catch (e) {
    log.warn(`MihomeOauth.resilver: serviceLogin failed: ${(e as Error).message}`);
    return null;
  }

  if (!json?.ssecurity || !json.userId || !json.location) {
    log.warn(
      `MihomeOauth.resilver: missing fields (code=${json?.code ?? '-'}, has_sign=${!!json?._sign}, has_ssec=${!!json?.ssecurity})`,
    );
    return null;
  }

  let serviceToken: string | null = null;
  try {
    const loc = await axios.get<ArrayBuffer>(json.location, {
      responseType: 'arraybuffer',
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 8000,
      headers: {
        'User-Agent': MIHOME_UA,
        Cookie: cookieHeader,
      },
    });
    const setCookies = loc.headers['set-cookie'] ?? [];
    serviceToken = extractCookie(setCookies, 'serviceToken');
  } catch (e) {
    log.warn(`MihomeOauth.resilver: location fetch failed: ${(e as Error).message}`);
    return null;
  }
  if (!serviceToken) {
    log.warn('MihomeOauth.resilver: no serviceToken cookie');
    return null;
  }

  return {
    userId: String(json.userId),
    ssecurity: json.ssecurity,
    serviceToken,
  };
}

/** Стирает cookies/storage партиции — для logout. */
export async function clearMihomeOauthSession(): Promise<void> {
  try {
    const s = session.fromPartition(MIHOME_OAUTH_PARTITION);
    await s.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers'],
    });
  } catch (e) {
    log.warn(`MihomeOauth: clear partition failed: ${(e as Error).message}`);
  }
}
