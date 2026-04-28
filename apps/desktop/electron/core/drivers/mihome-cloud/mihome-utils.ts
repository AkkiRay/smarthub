/**
 * @fileoverview Shared helpers для Mi Home Cloud driver'а и OAuth flow.
 * Вынесены из `mihome-cloud-driver.ts`, чтобы embedded-OAuth helper
 * (`main/oauth/mihome-oauth.ts`) использовал ту же UTF-8 decode / JSON-strip /
 * cookie-extract логику без копипасты.
 */

/**
 * Manual UTF-8 decode для login-step'ов: `responseEncoding: 'utf8'` axios http-adapter
 * игнорирует, response с китайским `desc` приходит latin1 → mojibake.
 */
export function decodeUtf8(data: ArrayBuffer): string {
  return Buffer.from(data).toString('utf8');
}

/** Mi Cloud отдаёт JSON с anti-XSS префиксом `&&&START&&&`. */
export function parseMiJson<T>(text: string): T | null {
  try {
    return JSON.parse(text.replace(/^&&&START&&&/, '')) as T;
  } catch {
    return null;
  }
}

/** Извлечь значение cookie по имени из массива Set-Cookie заголовков. */
export function extractCookie(cookies: string[], name: string): string | null {
  for (const c of cookies) {
    const m = new RegExp(`${name}=([^;]+)`).exec(c);
    if (m) return m[1] ?? null;
  }
  return null;
}

export interface MiSession {
  userId: string;
  ssecurity: string;
  serviceToken: string;
}
