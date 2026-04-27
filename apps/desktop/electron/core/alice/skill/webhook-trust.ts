/**
 * Доверие к источнику запросов в Yandex Smart Home webhook.
 *
 * Webhook поднят на 127.0.0.1 за cloudflared (или иным reverse-прокси). До
 * `localhost`-сокета доходит TCP с loopback, поэтому отдельный IP allow-list
 * по сетевой адресации невозможен. Защита: Yandex проксирует уникальный
 * `X-Request-Id`, который мы кэшируем (replay-protection) + опциональный
 * shared-secret заголовок, который туннель добавляет на edge'е.
 *
 * При отсутствии HUB_WEBHOOK_TRUST_TOKEN в окружении доверие полагается
 * исключительно на Bearer-токен — это допустимо, но логируем factura.
 */

const REQUEST_ID_TTL_MS = 10 * 60 * 1000;
const REQUEST_ID_MAX = 4096;

const seenRequestIds = new Map<string, number>();

/** Optional header, который cloudflared добавляет в туннеле. */
export const YANDEX_WEBHOOK_TRUST_HEADER = 'x-hub-trust';

/** Возвращает true если запрос приходит из доверенного источника. */
export function isYandexWebhookSource(req: {
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  // Webhook слушает только на 127.0.0.1 — любой запрос дошёл через loopback,
  // значит cloudflared его уже терминировал. Фильтр на trust-header применяется
  // только если он сконфигурирован в окружении.
  const expected = process.env['HUB_WEBHOOK_TRUST_TOKEN'];
  if (!expected) return true;
  const got = req.headers[YANDEX_WEBHOOK_TRUST_HEADER];
  if (typeof got !== 'string') return false;
  return constantTimeEqualString(got, expected);
}

/**
 * Проверяет request_id на повтор. Возвращает true если запрос НОВЫЙ
 * (его можно обрабатывать), false — если уже видели в окне TTL.
 *
 * Алиса повторяет один запрос только при 5xx ответах — для idempotent action
 * это безопасно, но критично для unlink/action на нон-идемпотентные команды.
 */
export function noteWebhookRequestId(requestId: string): boolean {
  if (!requestId) return true;
  pruneSeenRequestIds();
  if (seenRequestIds.has(requestId)) return false;
  seenRequestIds.set(requestId, Date.now());
  return true;
}

function pruneSeenRequestIds(): void {
  const cutoff = Date.now() - REQUEST_ID_TTL_MS;
  for (const [id, ts] of seenRequestIds) {
    if (ts < cutoff) seenRequestIds.delete(id);
  }
  if (seenRequestIds.size <= REQUEST_ID_MAX) return;
  // FIFO-усечение — сохраняем «свежие».
  const sorted = [...seenRequestIds.entries()].sort((a, b) => a[1] - b[1]);
  const drop = sorted.length - REQUEST_ID_MAX;
  for (let i = 0; i < drop; i++) seenRequestIds.delete(sorted[i]![0]);
}

function constantTimeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
