/**
 * @fileoverview Discriminated-union для railway-style error handling — не
 * заставляет caller'а писать try/catch вокруг каждого вызова, делает
 * ошибочный путь явным в типе.
 *
 * Используется в местах, где throw был бы неудобен: например в IPC handler'ах
 * (исключение через IPC бы потеряло stack-trace), в driver registry'е
 * (нужно отдать ошибку UI без падения процесса), в HTTP-клиентах с retry.
 *
 * @example
 * ```ts
 * function parsePort(raw: string): Result<number, string> {
 *   const n = Number(raw);
 *   if (!Number.isInteger(n) || n < 1 || n > 65535) {
 *     return err(`invalid port: ${raw}`);
 *   }
 *   return ok(n);
 * }
 *
 * const r = parsePort(input);
 * if (!r.ok) showToast(r.error);
 * else openSocket(r.value);
 * ```
 */

/**
 * Sum-тип успех/неуспех. Используйте {@link ok} и {@link err} для
 * конструирования (они корректно сужают тип).
 *
 * @template T - Тип успешного значения.
 * @template E - Тип ошибки. Default — {@link Error}.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

/**
 * Сконструировать успешный {@link Result}.
 *
 * @example `return ok({ host, port });`
 */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/**
 * Сконструировать неуспешный {@link Result}.
 *
 * @example `return err('timeout');`
 */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Извлечь значение или бросить — для границ системы, где ошибку всё равно
 * никто не обработает (например, top-level main() entry-point).
 *
 * Если `error` не является `Error` — оборачивает в `new Error(String(error))`.
 *
 * @throws — `result.error` (или `new Error(String(...))`) при `result.ok === false`.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
}
