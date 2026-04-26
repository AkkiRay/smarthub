/**
 * @fileoverview HTTP-сервер навыка — process-local listener на random-порту,
 * внешний доступ обеспечивает {@link TunnelManager} (cloudflared).
 *
 * Endpoints
 * ---------
 * **OAuth (для привязки Алисы к хабу):**
 *   - `GET  /oauth/authorize` — HTML-form, юзер нажимает «Разрешить».
 *   - `POST /oauth/token`     — обмен code на access+refresh-токены.
 *
 * **Yandex Smart Home v1.0 webhook:**
 *   - `HEAD /v1.0`                          — health-check от Алисы.
 *   - `POST /v1.0/user/unlink`              — юзер отвязал аккаунт.
 *   - `GET  /v1.0/user/devices`             — список экспонированных устройств.
 *   - `POST /v1.0/user/devices/query`       — запрос текущего state'а.
 *   - `POST /v1.0/user/devices/action`      — выполнить команду.
 *
 * Безопасность
 * ------------
 *   - Все `/v1.0/*` (кроме HEAD) требуют валидный Bearer (issuedTokens в
 *     settings, выдаются {@link TokenIssuer}).
 *   - `/oauth/token` проверяет client_id + client_secret из {@link AliceSkillConfig}.
 *   - `/oauth/authorize` — single-user hub: требует HTML-confirm от пользователя,
 *     потом redirect обратно на Я. с `code + state`. Пароль не нужен — хаб
 *     локальный, юзер сам кликает на свой машине.
 *
 * SLA Алисы — 3 секунды на ответ. Action-flow вызывает driver registry синхронно
 * (всё равно бы лучше через очередь — но Алиса не любит async-deferred).
 */
//
// Soft-fail философия: на любом throw — 500 + лог; Алиса покажет «временная ошибка», но
// не уйдёт в /unlink. 3-секундный SLA — все обработчики синхронные либо асинхронные с
// immediate Promise.race против 2.5с таймаута.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import log from 'electron-log/main.js';
import type {
  AliceSkillConfig,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  Room,
  Scene,
} from '@smarthome/shared';
import { buildExposedDeviceList, isSceneYandexId, sceneIdFromYandexId } from './device-mapper.js';
import { TokenIssuer } from './token-issuer.js';
import type { SettingsStore } from '../../storage/settings-store.js';

const RESPONSE_BUDGET_MS = 2_500; // Алиса даёт 3с total → оставляем 500мс на сеть

export interface WebhookActivityEvent {
  method: 'devices' | 'query' | 'action' | 'unlink';
  ok: boolean;
  durationMs: number;
  at: string;
}

export interface WebhookServerDeps {
  settings: SettingsStore;
  /** Текущий список устройств (snapshot, обновляется на каждом запросе). */
  listDevices: () => Device[];
  listScenes: () => Scene[];
  listRooms: () => Room[];
  /** Запустить device command. Должно резолвиться < 2с. */
  executeCommand: (cmd: DeviceCommand) => Promise<DeviceCommandResult>;
  /** Запустить сценарий по id. */
  runScene: (sceneId: string) => Promise<void>;
  /** Колбэк для алёрта в UI о входящем запросе. */
  onActivity?: (event: WebhookActivityEvent) => void;
}

export class SkillWebhookServer {
  private server: Server | null = null;
  private port = 0;
  private readonly tokens: TokenIssuer;

  constructor(private readonly deps: WebhookServerDeps) {
    this.tokens = new TokenIssuer(deps.settings);
  }

  async start(): Promise<{ port: number }> {
    if (this.server) return { port: this.port };
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        // Все обработчики catch-all-обёрнуты — никаких uncaught throws не должно дойти до сокета.
        void this.route(req, res).catch((err) => {
          log.error('[skill-webhook] unhandled error', err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'internal' }));
          }
        });
      });
      server.on('error', reject);
      // Bind на 127.0.0.1 — туннель проксирует на localhost; никаких external listeners.
      server.listen(0, '127.0.0.1', () => {
        this.server = server;
        const addr = server.address() as AddressInfo;
        this.port = addr.port;
        log.info(`[skill-webhook] listening on 127.0.0.1:${this.port}`);
        resolve({ port: this.port });
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = null;
    this.port = 0;
  }

  getPort(): number {
    return this.port;
  }

  // ============== Routing ==============

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // CORS-preflight только для OAuth-страницы; webhook'и Алисы не используют CORS.
    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
      res.end();
      return;
    }

    if (path === '/oauth/authorize' && method === 'GET') return this.handleAuthorizeGet(url, res);
    if (path === '/oauth/authorize' && method === 'POST') return this.handleAuthorizePost(req, res);
    if (path === '/oauth/token' && method === 'POST') return this.handleTokenPost(req, res);

    // Yandex Smart Home webhook (with version-flexibility: v1.0 — единственная актуальная).
    if (path === '/v1.0' && method === 'HEAD') {
      res.statusCode = 200;
      res.end();
      return;
    }
    if (path === '/v1.0' && method === 'GET') {
      // Alice не делает GET / — но удобно для дебага «жив ли URL».
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (path === '/v1.0/user/unlink' && method === 'POST') return this.handleUnlink(req, res);
    if (path === '/v1.0/user/devices' && method === 'GET') return this.handleListDevices(req, res);
    if (path === '/v1.0/user/devices/query' && method === 'POST') return this.handleQuery(req, res);
    if (path === '/v1.0/user/devices/action' && method === 'POST')
      return this.handleAction(req, res);

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found', path }));
  }

  // ============== OAuth: /authorize ==============

  /**
   * Алиса редиректит юзера сюда с client_id, redirect_uri, response_type=code, state, scope.
   * Мы рендерим простой HTML «подтвердите подключение» — single-user hub, нет логина.
   */
  private handleAuthorizeGet(url: URL, res: ServerResponse): void {
    const config = this.deps.settings.getAlice().config;
    const errors: string[] = [];

    const clientId = url.searchParams.get('client_id') ?? '';
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const responseType = url.searchParams.get('response_type') ?? 'code';

    if (!config) errors.push('Skill ещё не настроен в SmartHome Hub.');
    if (config && clientId !== config.oauthClientId) errors.push('Неверный client_id.');
    if (responseType !== 'code')
      errors.push(`response_type должен быть "code", получен "${responseType}".`);

    res.statusCode = errors.length ? 400 : 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(renderAuthorizePage({ clientId, redirectUri, state, errors }));
  }

  private async handleAuthorizePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readForm(req);
    const config = this.deps.settings.getAlice().config;

    const clientId = body.get('client_id') ?? '';
    const redirectUri = body.get('redirect_uri') ?? '';
    const state = body.get('state') ?? '';

    if (!config || clientId !== config.oauthClientId) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        renderAuthorizePage({ clientId, redirectUri, state, errors: ['Неверный client_id.'] }),
      );
      return;
    }

    const internalUserId = this.deps.settings.get('hubId');
    const code = this.tokens.issueCode({ clientId, redirectUri, internalUserId });

    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);

    res.statusCode = 302;
    res.setHeader('Location', target.toString());
    res.end();
  }

  // ============== OAuth: /token ==============

  private async handleTokenPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readForm(req);
    const config = this.deps.settings.getAlice().config;

    const clientId = body.get('client_id') ?? '';
    const clientSecret = body.get('client_secret') ?? '';
    const grantType = body.get('grant_type') ?? '';

    const fail = (status: number, error: string, description?: string): void => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error, error_description: description }));
    };

    if (!config) return fail(400, 'invalid_client', 'Skill not configured');
    if (clientId !== config.oauthClientId || clientSecret !== config.oauthClientSecret) {
      return fail(401, 'invalid_client');
    }

    if (grantType === 'authorization_code') {
      const code = body.get('code') ?? '';
      const record = this.tokens.consumeCode(code);
      if (!record) return fail(400, 'invalid_grant', 'Code expired or unknown');
      const pair = this.tokens.issueTokenPair(record.internalUserId);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          access_token: pair.accessToken,
          token_type: 'bearer',
          expires_in: pair.expiresIn,
          refresh_token: pair.refreshToken,
        }),
      );
      return;
    }

    if (grantType === 'refresh_token') {
      const refreshToken = body.get('refresh_token') ?? '';
      const pair = this.tokens.refresh(refreshToken);
      if (!pair) return fail(400, 'invalid_grant', 'Refresh token invalid');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          access_token: pair.accessToken,
          token_type: 'bearer',
          expires_in: pair.expiresIn,
          refresh_token: pair.refreshToken,
        }),
      );
      return;
    }

    return fail(400, 'unsupported_grant_type', `Unknown grant_type: ${grantType}`);
  }

  // ============== Webhook helpers ==============

  private authorize(req: IncomingMessage): { internalUserId: string } | null {
    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length).trim();
    const record = this.tokens.resolveAccessToken(token);
    if (!record) return null;
    return { internalUserId: record.internalUserId };
  }

  private requestId(req: IncomingMessage): string {
    const id = req.headers['x-request-id'];
    return typeof id === 'string' ? id : '';
  }

  private writeJson(res: ServerResponse, status: number, payload: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  }

  private async withBudget<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), RESPONSE_BUDGET_MS);
    });
    try {
      return await Promise.race([work(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private reportActivity(
    method: WebhookActivityEvent['method'],
    ok: boolean,
    startedAt: number,
  ): void {
    this.deps.onActivity?.({
      method,
      ok,
      durationMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    });
  }

  // ============== Webhook: /unlink, /devices, /query, /action ==============

  private async handleUnlink(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startedAt = Date.now();
    const requestId = this.requestId(req);
    if (!this.authorize(req)) {
      this.writeJson(res, 401, { error: 'unauthorized' });
      this.reportActivity('unlink', false, startedAt);
      return;
    }
    this.tokens.revokeAll();
    this.writeJson(res, 200, { request_id: requestId });
    this.reportActivity('unlink', true, startedAt);
  }

  private async handleListDevices(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startedAt = Date.now();
    const auth = this.authorize(req);
    if (!auth) {
      this.writeJson(res, 401, { error: 'unauthorized' });
      this.reportActivity('devices', false, startedAt);
      return;
    }
    const requestId = this.requestId(req);
    const alice = this.deps.settings.getAlice();
    const list = buildExposedDeviceList({
      devices: this.deps.listDevices(),
      scenes: this.deps.listScenes(),
      rooms: this.deps.listRooms(),
      deviceExposures: alice.deviceExposures,
      sceneExposures: alice.sceneExposures,
    });
    this.writeJson(res, 200, {
      request_id: requestId,
      payload: {
        user_id: auth.internalUserId,
        devices: list,
      },
    });
    this.reportActivity('devices', true, startedAt);
  }

  private async handleQuery(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startedAt = Date.now();
    const auth = this.authorize(req);
    if (!auth) {
      this.writeJson(res, 401, { error: 'unauthorized' });
      this.reportActivity('query', false, startedAt);
      return;
    }
    const requestId = this.requestId(req);
    const body = (await readJson(req)) as { devices?: Array<{ id: string }> };
    const requested = body.devices ?? [];

    const alice = this.deps.settings.getAlice();
    const exposed = buildExposedDeviceList({
      devices: this.deps.listDevices(),
      scenes: this.deps.listScenes(),
      rooms: this.deps.listRooms(),
      deviceExposures: alice.deviceExposures,
      sceneExposures: alice.sceneExposures,
    });
    const byId = new Map(exposed.map((d) => [d.id, d]));

    const devices = requested.map((req) => {
      const found = byId.get(req.id);
      if (!found) {
        return {
          id: req.id,
          error_code: 'DEVICE_NOT_FOUND',
          error_message: 'Устройство не найдено в текущей экспозиции',
        };
      }
      return {
        id: req.id,
        capabilities: found.capabilities.map((c) => ({
          type: c.type,
          state: c.state,
        })),
        properties: found.properties.map((p) => ({
          type: p.type,
          state: p.state,
        })),
      };
    });

    this.writeJson(res, 200, {
      request_id: requestId,
      payload: { devices },
    });
    this.reportActivity('query', true, startedAt);
  }

  private async handleAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startedAt = Date.now();
    const auth = this.authorize(req);
    if (!auth) {
      this.writeJson(res, 401, { error: 'unauthorized' });
      this.reportActivity('action', false, startedAt);
      return;
    }
    const requestId = this.requestId(req);
    interface ActionRequest {
      payload?: {
        devices?: Array<{
          id: string;
          custom_data?: unknown;
          capabilities?: Array<{
            type: string;
            state: { instance: string; value: unknown };
          }>;
        }>;
      };
    }
    const body = (await readJson(req)) as ActionRequest;
    const requested = body.payload?.devices ?? [];

    const result = await this.withBudget(
      async () => {
        const responses = await Promise.all(
          requested.map(async (deviceReq) => {
            // Сценарий → запуск scene; one virtual on_off-instance.
            if (isSceneYandexId(deviceReq.id)) {
              const sceneId = sceneIdFromYandexId(deviceReq.id);
              try {
                await this.deps.runScene(sceneId);
                return {
                  id: deviceReq.id,
                  capabilities: (deviceReq.capabilities ?? []).map((c) => ({
                    type: c.type,
                    state: {
                      instance: c.state.instance,
                      action_result: { status: 'DONE' as const },
                    },
                  })),
                };
              } catch (e) {
                return {
                  id: deviceReq.id,
                  capabilities: (deviceReq.capabilities ?? []).map((c) => ({
                    type: c.type,
                    state: {
                      instance: c.state.instance,
                      action_result: {
                        status: 'ERROR' as const,
                        error_code: 'INTERNAL_ERROR',
                        error_message: (e as Error).message,
                      },
                    },
                  })),
                };
              }
            }

            // Реальное устройство
            const capabilityResponses = await Promise.all(
              (deviceReq.capabilities ?? []).map(async (capReq) => {
                try {
                  const r = await this.deps.executeCommand({
                    deviceId: deviceReq.id,
                    capability: capReq.type as DeviceCommand['capability'],
                    instance: capReq.state.instance,
                    value: capReq.state.value,
                  });
                  return {
                    type: capReq.type,
                    state: {
                      instance: capReq.state.instance,
                      action_result:
                        r.status === 'DONE'
                          ? { status: 'DONE' as const }
                          : {
                              status: 'ERROR' as const,
                              error_code: r.errorCode ?? 'INTERNAL_ERROR',
                              error_message: r.errorMessage,
                            },
                    },
                  };
                } catch (e) {
                  return {
                    type: capReq.type,
                    state: {
                      instance: capReq.state.instance,
                      action_result: {
                        status: 'ERROR' as const,
                        error_code: 'INTERNAL_ERROR',
                        error_message: (e as Error).message,
                      },
                    },
                  };
                }
              }),
            );
            return { id: deviceReq.id, capabilities: capabilityResponses };
          }),
        );
        return responses;
      },
      // Fallback: всё, что не успели — DEVICE_UNREACHABLE с пометкой timeout.
      requested.map((d) => ({
        id: d.id,
        capabilities: (d.capabilities ?? []).map((c) => ({
          type: c.type,
          state: {
            instance: c.state.instance,
            action_result: {
              status: 'ERROR' as const,
              error_code: 'DEVICE_UNREACHABLE',
              error_message: 'Хаб не успел ответить за 2.5с',
            },
          },
        })),
      })),
    );

    this.writeJson(res, 200, {
      request_id: requestId,
      payload: { devices: result },
    });
    this.reportActivity('action', true, startedAt);
  }
}

// ============== Helpers ==============

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      // 256KiB — Алиса сама не шлёт больше; защита от случайного flood.
      if (total > 256 * 1024) {
        req.destroy(new Error('payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8')) as unknown;
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const buf = await readBody(req);
  return new URLSearchParams(buf.toString('utf8'));
}

/** Минимальная HTML-страница «подтверждение привязки». Стиль брендовый. */
function renderAuthorizePage(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  errors: string[];
}): string {
  const errorBlock = args.errors.length
    ? `<div class="errors">${args.errors.map((e) => `<p>⚠ ${escapeHtml(e)}</p>`).join('')}</div>`
    : '';
  const formBlock = args.errors.length
    ? ''
    : `<form method="POST" action="/oauth/authorize">
         <input type="hidden" name="client_id" value="${escapeHtml(args.clientId)}" />
         <input type="hidden" name="redirect_uri" value="${escapeHtml(args.redirectUri)}" />
         <input type="hidden" name="state" value="${escapeHtml(args.state)}" />
         <button type="submit">Привязать Алису к моему хабу</button>
       </form>`;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>SmartHome Hub — привязка Алисы</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #0d0e18; color: #e8e9f3;
         margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .card { max-width: 420px; padding: 28px; border-radius: 16px;
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 8px 0; color: #b8bccf; }
  button { display: block; width: 100%; padding: 14px 16px; margin-top: 20px;
           font-size: 15px; font-weight: 600; color: #fff; background: #6852FF;
           border: none; border-radius: 10px; cursor: pointer; }
  button:hover { background: #7a66ff; }
  .errors { margin-top: 16px; padding: 12px 14px; border-radius: 8px;
            background: rgba(255,87,119,0.1); border: 1px solid rgba(255,87,119,0.3); color: #ff8aa0; }
  .errors p { margin: 4px 0; color: inherit; }
</style>
</head>
<body>
  <main class="card">
    <h1>Привязка Алисы</h1>
    <p>Алиса хочет получить доступ к устройствам вашего хаба «SmartHome Hub». После подтверждения колонка и приложение «Дом с Алисой» смогут управлять лампами, розетками и сценариями голосом.</p>
    ${errorBlock}
    ${formBlock}
  </main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
