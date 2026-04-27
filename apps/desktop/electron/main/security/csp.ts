// CSP-header injection из main: разные политики dev/prod (Vite HMR требует liberal connect-src).

import { session } from 'electron';

const PROD_CSP = [
  "default-src 'self'",
  // unsafe-inline для script НЕ даём; для style — да (SCSS-bundle инлайнит ради first-paint).
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // Renderer не ходит наружу — весь network через main.
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

const DEV_CSP = [
  "default-src 'self'",
  // Vite инжектирует module preloads + HMR-runtime → unsafe-inline/eval нужны.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // Vite HMR по WS на localhost:5173.
  "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

export function installCsp(isDev: boolean): void {
  const policy = isDev ? DEV_CSP : PROD_CSP;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
        // Дополнительный hardening (не CSP, но логично рядом).
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'Referrer-Policy': ['strict-origin-when-cross-origin'],
      },
    });
  });

  // Все permission-запросы (camera, mic, geolocation, ...) → отказ. SmartHome Hub их не использует.
  // Внешние ссылки обрабатываются через setWindowOpenHandler в main/index.ts.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    void permission;
    callback(false);
  });
}
