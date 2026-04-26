/**
 * @fileoverview Type-guards и safe-coercion helper'ы для извлечения значений
 * из `unknown`-payload'ов (HTTP-ответы, IPC-payload'ы, capability state'ы).
 *
 * Используются драйверами вместо `value as number` без валидации — последнее
 * приводит к runtime-ошибкам когда внешний API меняет формат.
 *
 * Группы функций:
 *   - JSON / HTTP — {@link safeJsonParse}, {@link getHttpStatus}, {@link getErrorMessage}
 *   - Coercion    — {@link asBool}, {@link asNumber}, {@link asString}, {@link asInt},
 *                   {@link asClampedInt}
 *   - Object guards — {@link isPlainObject}
 */

/**
 * Безопасный {@link JSON.parse} — возвращает `null` при `SyntaxError` вместо
 * throw. Удобно для парсинга responses от внешних API, которые иногда
 * присылают пустую строку или HTML-error page вместо JSON.
 *
 * @template T - Ожидаемый тип после парсинга.
 * @returns Распарсенный объект или `null` при ошибке.
 *
 * @example
 * ```ts
 * const payload = safeJsonParse<{ status: string }>(rawBody);
 * if (!payload || payload.status !== 'ok') return null;
 * ```
 */
export function safeJsonParse<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Извлечь HTTP-статус из axios/fetch error без unsafe-cast'а. Возвращает
 * `null` если в ошибке нет `.response.status` (например, network error).
 */
export function getHttpStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const response = (err as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return null;
  const status = (response as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

/**
 * Универсальное извлечение message из произвольной ошибки.
 *
 * Поддерживает: {@link Error} (`.message`), `string`, объекты с `.message`,
 * fallback — `String(err)`.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(err);
}

/**
 * Привести unknown к boolean. Понимает строки `'true'`/`'on'`/`'1'` (cloud
 * API часто шлют именно их вместо настоящего bool) и числа (`0` → false,
 * иначе → true).
 */
export function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === 'on' || value === '1';
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

/**
 * Привести unknown к number. Защита от `NaN` / `Infinity`: если результат
 * не finite, возвращает fallback.
 */
export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * Привести unknown к string. Number/boolean становятся строкой через
 * `String()`; объекты и null — fallback.
 */
export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

/**
 * Привести unknown к integer (округление к нулю — `Math.trunc`).
 *
 * @example `asInt('42.7')` → `42`
 */
export function asInt(value: unknown, fallback = 0): number {
  return Math.trunc(asNumber(value, fallback));
}

/**
 * Integer с clamp'ом в диапазон `[min, max]`. Используется для
 * brightness/volume/temperature commands — защита от драйверов, которые
 * присылают значения вне декларированного range.
 *
 * @param fallback - Если задан, используется при non-numeric value.
 *                   По умолчанию = `min`.
 */
export function asClampedInt(value: unknown, min: number, max: number, fallback = min): number {
  const n = asInt(value, fallback);
  return Math.max(min, Math.min(max, n));
}

/**
 * Безопасная проверка plain-object (без `instanceof Object`, который ломается
 * через iframe / Worker / vm.context — другой realm имеет свой `Object`).
 *
 * Принимает: `{}`, `Object.create(null)`, литералы.
 * Отклоняет: `null`, массивы, функции, `Date`, `Map`, инстансы классов.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
