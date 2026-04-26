/**
 * REST-клиент Quasar API (`quasar.yandex.net/glagol/*`).
 *
 * Полный flow подключения колонки Алисы:
 *  1. OAuth Yandex (см. `yandex-oauth.ts`) → `music_token`.
 *  2. `GET /glagol/device_list` → колонки аккаунта.
 *  3. `GET /glagol/token?device_id=X&platform=Y` → per-device JWT (~1 час).
 *  4. mDNS даёт host:port → `wss://host:port/?token=<jwt>`.
 *
 * `music_token` живёт ~1 год, `device_token` ротируется ежечасно.
 */

import axios, { type AxiosInstance } from 'axios';
import {
  ALICE_TIMEOUT,
  QUASAR_API_BASE_URL,
  TOKEN_SAFE_DEFAULT_TTL_SEC,
  YANDEX_OAUTH_AUTHORIZE_URL,
} from './constants.js';

/** Public client_id Яндекс.Музыки — единственный с scope на glagol API. */
export const YANDEX_MUSIC_CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d';

/** Public client_id Я.Диалогов для push в `/api/v1/skills/<id>/callback/state`. */
export const YANDEX_DIALOGS_CALLBACK_CLIENT_ID = 'c473ca268cd749d3a8371351a8f2bcbd';

/** OAuth implicit URL для BrowserWindow. */
export function buildOauthUrl(clientId: string = YANDEX_MUSIC_CLIENT_ID): string {
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: clientId,
  });
  return `${YANDEX_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

/** Парсит `#access_token=…` из callback URL. */
export function parseOauthCallback(url: string): { accessToken: string; expiresIn: number } | null {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  if (!accessToken) return null;
  return {
    accessToken,
    expiresIn: Number(params.get('expires_in')) || 0,
  };
}

export interface QuasarDevice {
  id: string;
  name: string;
  platform: string;
  promoName?: string;
  config?: Record<string, unknown>;
  glagol?: {
    security?: {
      server_certificate?: string;
      server_private_key?: string;
    };
  };
}

export interface QuasarDeviceToken {
  /** JWT для wss-сессии. */
  token: string;
  /** Epoch-секунды истечения. */
  expiresAt: number;
}

/** Тонкая обёртка над axios; бросает Error при 4xx/5xx. */
export class YandexQuasarClient {
  private readonly http: AxiosInstance;

  constructor(private readonly musicToken: string) {
    this.http = axios.create({
      baseURL: QUASAR_API_BASE_URL,
      timeout: ALICE_TIMEOUT.QUASAR_HTTP_MS,
      headers: { Authorization: `Oauth ${musicToken}` },
    });
  }

  /** Колонки аккаунта. Бросает 401 при истёкшем `music_token`. */
  async fetchDeviceList(): Promise<QuasarDevice[]> {
    const r = await this.http.get<{ devices: QuasarDevice[]; status: string }>(
      '/glagol/device_list',
    );
    if (r.data.status !== 'ok') throw new Error(`device_list status=${r.data.status}`);
    return r.data.devices ?? [];
  }

  /** Свежий per-device JWT для wss-сессии. */
  async fetchDeviceToken(deviceId: string, platform: string): Promise<QuasarDeviceToken> {
    const r = await this.http.get<{ token: string; status: string }>('/glagol/token', {
      params: { device_id: deviceId, platform },
    });
    if (r.data.status !== 'ok' || !r.data.token) {
      throw new Error(`glagol/token status=${r.data.status}`);
    }
    // Quasar не возвращает `expires_in` — экстрагируем `exp` из JWT payload.
    const expFromJwt = decodeJwtExp(r.data.token);
    return {
      token: r.data.token,
      expiresAt: expFromJwt ?? Math.floor(Date.now() / 1000) + TOKEN_SAFE_DEFAULT_TTL_SEC,
    };
  }
}

function decodeJwtExp(jwt: string): number | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { exp?: number };
    return payload.exp ?? null;
  } catch {
    return null;
  }
}
