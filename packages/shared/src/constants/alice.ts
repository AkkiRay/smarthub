// Public-константы Алисы — доступны и main-процессу, и renderer'у.
// Внутренние таймауты HTTP/WS-клиента живут отдельно в `apps/desktop/electron/core/alice/constants.ts`,
// потому что renderer о них знать не должен (он не открывает ни WS, ни axios).

/** WS-порт колонки Алисы. Зашит в прошивке колонки, mDNS обычно даёт его же. */
export const YANDEX_STATION_PORT = 1961;

/** mDNS-сервис колонок Алисы (`_yandexio._tcp.local`). */
export const YANDEX_STATION_MDNS_TYPE = 'yandexio';

/** Длительность mDNS-скана по умолчанию для UI / IPC. */
export const YANDEX_STATION_SCAN_MS = 4000;
