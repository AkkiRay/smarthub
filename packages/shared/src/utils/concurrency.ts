/**
 * @fileoverview Concurrency-helper'ы — pool-сериализация для bulk-операций
 * (LAN-host probe, Yandex device-import, OAuth-batch). Один общий хелпер
 * вместо локальных `Promise.all` + manual chunk-splitting в каждом сервисе.
 */

/**
 * Pool-сериализация: max N concurrent worker'ов. Возвращает результат в
 * исходном порядке. Bounded — не плодит 100+ открытых сокетов на /24-скан
 * или массовый Yandex-import.
 *
 * @example
 * ```ts
 * const results = await mapWithLimit(
 *   hosts,
 *   16,
 *   async (host) => probeKlap(host),
 * );
 * ```
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx]!, idx);
    }
  });
  await Promise.all(workers);
  return out;
}
