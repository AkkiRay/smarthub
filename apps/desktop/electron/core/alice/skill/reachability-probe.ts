/**
 * @fileoverview Внешний reachability-probe — проверяет, что публичный URL
 * туннеля **реально** достижим Алисой, а не просто что `cloudflared` subprocess
 * жив у нас локально.
 *
 * Используется как «детектор лжи» для UI: stage `tunnel-up` лжёт, если
 * cloudflared edge-сторона ещё не зарегистрировала connection или quick-tunnel
 * получил DNS, но 522'нит (race на cold-start). Без честной пробы юзер
 * привязывает аккаунт в «Доме с Алисой» и упирается в timeout, не понимая,
 * что не так.
 *
 * Реализация: HEAD на `${publicUrl}/v1.0`. Webhook-server отвечает 200 на HEAD
 * без auth (см. `webhook-server.ts`). Запрос идёт через системный resolver,
 * **не** через loopback — туннель пройдёт полный путь Yandex→Cloudflare→хаб.
 *
 * Соображения безопасности:
 *   - Принимаем только HTTPS-урл, протокол `http:` отказываем.
 *   - Хост-allowlist: `*.trycloudflare.com` (quick-tunnel) или host из
 *     `customDomain` юзера. Не позволяем зайти на чужой URL через подмену
 *     `publicUrl` (атака на бэкенд возможна только если settings-store
 *     скомпрометирован — но защищаемся в глубину).
 *   - Таймаут 6с — Алиса ждёт 3с, нам нужен запас на network jitter.
 */

import { request as httpsRequest } from 'node:https';
import type { AliceReachabilityResult } from '@smarthome/shared';

const PROBE_TIMEOUT_MS = 6_000;

export interface ReachabilityProbeOptions {
  /** Публичный URL туннеля. Должен быть HTTPS. */
  publicUrl: string;
  /** Опциональный customDomain — расширяет host-allowlist (named tunnel). */
  customDomain?: string;
}

/**
 * Дёргает HEAD `${publicUrl}/v1.0`. Возвращает структурированный результат —
 * ошибки не выкидывает, всегда резолвится.
 */
export async function probeWebhookReachability(
  opts: ReachabilityProbeOptions,
): Promise<AliceReachabilityResult> {
  const startedAt = Date.now();
  const at = new Date().toISOString();

  let url: URL;
  try {
    url = new URL(opts.publicUrl);
  } catch {
    return {
      at,
      ok: false,
      status: 0,
      latencyMs: 0,
      error: 'Невалидный publicUrl — туннель не выдал URL',
    };
  }

  if (url.protocol !== 'https:') {
    return {
      at,
      ok: false,
      status: 0,
      latencyMs: 0,
      error: `Протокол ${url.protocol} — Алиса требует HTTPS`,
    };
  }

  if (!isAllowedProbeHost(url.hostname, opts.customDomain)) {
    return {
      at,
      ok: false,
      status: 0,
      latencyMs: 0,
      error: `Хост ${url.hostname} вне allow-list (cloudflared / customDomain)`,
    };
  }

  const probeUrl = new URL('/v1.0', url);

  return await new Promise<AliceReachabilityResult>((resolve) => {
    let settled = false;
    const finish = (r: AliceReachabilityResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const req = httpsRequest(
      {
        method: 'HEAD',
        hostname: probeUrl.hostname,
        port: probeUrl.port || 443,
        path: probeUrl.pathname,
        headers: {
          'User-Agent': 'SmartHome-Hub/reachability-probe',
        },
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const latencyMs = Date.now() - startedAt;
        // Резолвим до того, как тело прочитается (HEAD без тела всё равно).
        res.resume();
        finish({
          at,
          ok: status >= 200 && status < 300,
          status,
          latencyMs,
          error:
            status >= 200 && status < 300
              ? undefined
              : `HEAD /v1.0 вернул ${status} — Алиса не сможет достучаться`,
        });
      },
    );

    req.on('timeout', () => {
      try {
        req.destroy(new Error('timeout'));
      } catch {
        /* noop */
      }
      finish({
        at,
        ok: false,
        status: 0,
        latencyMs: Date.now() - startedAt,
        error: `Таймаут ${PROBE_TIMEOUT_MS / 1000}с — туннель не отвечает извне`,
      });
    });

    req.on('error', (err) => {
      finish({
        at,
        ok: false,
        status: 0,
        latencyMs: Date.now() - startedAt,
        error: err.message,
      });
    });

    req.end();
  });
}

function isAllowedProbeHost(hostname: string, customDomain?: string): boolean {
  if (hostname === customDomain) return true;
  if (hostname.endsWith('.trycloudflare.com')) return true;
  if (hostname.endsWith('.cfargotunnel.com')) return true;
  return false;
}
