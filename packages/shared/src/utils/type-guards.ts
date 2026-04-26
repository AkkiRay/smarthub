// Type-guards для безопасного извлечения значений из `unknown`-payload'ов.
// Используются в драйверах вместо `value as number` без валидации.

/** Безопасный JSON.parse — возвращает `null` при ошибке вместо throw. */
export function safeJsonParse<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** HTTP status из axios/fetch error без unsafe-cast'а. */
export function getHttpStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const response = (err as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return null;
  const status = (response as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

/** Сообщение из произвольной ошибки (Error, string, unknown). */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(err);
}

// ---- Capability value coercion ----------------------------------------------
//
// Capability.state.value — `unknown`, потому что зависит от capability.type.
// Эти helpers безопасно приводят к ожидаемому типу с fallback'ом.

export function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === 'on' || value === '1';
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

export function asInt(value: unknown, fallback = 0): number {
  return Math.trunc(asNumber(value, fallback));
}

/** Числовой диапазон с clamp'ом — для brightness/volume/temperature commands. */
export function asClampedInt(value: unknown, min: number, max: number, fallback = min): number {
  const n = asInt(value, fallback);
  return Math.max(min, Math.min(max, n));
}

/** Безопасная проверка plain-object без instanceof Object (cross-realm). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
