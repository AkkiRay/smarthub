/**
 * Alice/Yandex Station — main-process константы (HTTP/WS таймауты, URL'ы).
 * Кросс-процессные значения (порт, mDNS-тип) живут в `@smarthome/shared`.
 */

import { YANDEX_STATION_SCAN_MS } from '@smarthome/shared';

export { YANDEX_STATION_PORT, YANDEX_STATION_MDNS_TYPE } from '@smarthome/shared';

export const YANDEX_OAUTH_AUTHORIZE_URL = 'https://oauth.yandex.ru/authorize';
export const QUASAR_API_BASE_URL = 'https://quasar.yandex.net';

export const ALICE_TIMEOUT = {
  MDNS_SCAN_MS: YANDEX_STATION_SCAN_MS,
  QUASAR_HTTP_MS: 6000,
  WS_HANDSHAKE_MS: 8000,
  /** @deprecated Заменён на `GLAGOL_PING_INTERVAL_MS` (app-level glagol-ping). */
  WS_PING_INTERVAL_MS: 30_000,
  /** Интервал app-level `{command:'ping'}` для keep-alive glagol-сессии. */
  GLAGOL_PING_INTERVAL_MS: 10_000,
  /** Таймаут ожидания response с `requestId` после `sendCommand`. */
  WS_RESPONSE_MS: 4000,
  /** Минимум между двумя refresh-ами JWT — защита от refresh-loop при 401-каскаде. */
  TOKEN_REFRESH_DEBOUNCE_MS: 5000,
} as const;

/** Pre-emptive refresh JWT за N секунд до истечения. */
export const TOKEN_PREEMPTIVE_REFRESH_SEC = 60;

/** Fallback TTL когда JWT-payload не парсится (Quasar не возвращает `expires_in`). */
export const TOKEN_SAFE_DEFAULT_TTL_SEC = 3500;

/** Exponential backoff WS reconnect'ов. */
export const WS_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
