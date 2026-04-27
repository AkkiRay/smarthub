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
import { randomBytes } from 'node:crypto';
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
import { isYandexWebhookSource, noteWebhookRequestId } from './webhook-trust.js';

const RESPONSE_BUDGET_MS = 2_500; // Алиса даёт 3с total → оставляем 500мс на сеть
/** Cap на concurrent executeCommand'ы — защита от device-spam'а при action-batch на 50+ устройств. */
const ACTION_CONCURRENCY_LIMIT = 8;
/** Жёсткий таймаут на чтение тела запроса — защита от slow-loris. */
const BODY_READ_TIMEOUT_MS = 8_000;

/** Pool-сериализация: max N concurrent. Возвращает результат в порядке входа. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx]!, idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Allow-list redirect_uri для /authorize — open-redirect защита.
 * Актуально на 2026: Yandex документирует ровно один redirect_uri —
 * `https://social.yandex.net/broker/redirect`. Старые `.ru/` и `dialogs.yandex.ru/`
 * оставлены как fallback на случай, если sandbox / regional flows используют их.
 */
const ALLOWED_REDIRECT_PREFIXES = [
  'https://social.yandex.net/broker/redirect',
  'https://social.yandex.ru/broker/redirect',
  'https://dialogs.yandex.ru/oauth/',
];

/** TTL HTML-формы /oauth/authorize (CSRF-nonce живёт ровно столько). */
const AUTHORIZE_FORM_TTL_MS = 10 * 60 * 1000;

/**
 * Допустимые error_code в Yandex Smart Home v1.0 (актуально на 2026-04).
 * Прислать что-то вне списка → Алиса логирует «invalid response» в skill-debug
 * и шлёт юзеру generic «временная ошибка».
 *
 * Полный список:
 * https://yandex.ru/dev/dialogs/smart-home/doc/concepts/response-codes.html
 */
const YANDEX_ERROR_CODES = new Set([
  'DOOR_OPEN',
  'LID_OPEN',
  'REMOTE_CONTROL_DISABLED',
  'LOW_CHARGE_LEVEL',
  'NOT_ENOUGH_WATER',
  'NOT_ENOUGH_DETERGENT',
  'CONTAINER_FULL',
  'CONTAINER_EMPTY',
  'DRIP_TRAY_FULL',
  'DEVICE_STUCK',
  'DEVICE_OFF',
  'DEVICE_BUSY',
  'FIRMWARE_OUT_OF_DATE',
  'HUMAN_INVOLVEMENT_NEEDED',
  'INVALID_ACTION',
  'INVALID_VALUE',
  'NOT_SUPPORTED_IN_CURRENT_MODE',
  'ACCOUNT_LINKING_ERROR',
  'INTERNAL_ERROR',
  'DEVICE_NOT_FOUND',
  'DEVICE_UNREACHABLE',
]);

/**
 * Маппинг внутренних driver error-codes (`UNSUPPORTED_CAPABILITY`,
 * `AUTH_REQUIRED`, `YANDEX_HTTP_ERROR`, `TIMEOUT`, …) → Yandex spec.
 * Без него непрошедшие spec'у коды вылетают сырыми и Алиса жалуется на
 * формат payload'а в skill-debug'е.
 */
function mapToYandexErrorCode(driverCode: string | undefined): string {
  if (!driverCode) return 'INTERNAL_ERROR';
  if (YANDEX_ERROR_CODES.has(driverCode)) return driverCode;
  switch (driverCode) {
    case 'UNSUPPORTED_CAPABILITY':
    case 'INVALID_INSTANCE':
      return 'INVALID_ACTION';
    case 'INVALID_VALUE':
    case 'OUT_OF_RANGE':
      return 'INVALID_VALUE';
    case 'AUTH_REQUIRED':
    case 'TOKEN_EXPIRED':
      return 'ACCOUNT_LINKING_ERROR';
    case 'TIMEOUT':
    case 'NETWORK_ERROR':
    case 'YANDEX_HTTP_ERROR':
      return 'DEVICE_UNREACHABLE';
    case 'NOT_PAIRED':
    case 'BRIDGE_OFFLINE':
      return 'DEVICE_UNREACHABLE';
    case 'BUSY':
      return 'DEVICE_BUSY';
    case 'POLICY_VIOLATION':
      return 'INVALID_ACTION';
    default:
      return 'INTERNAL_ERROR';
  }
}
/** Максимум одновременно «висящих» CSRF-nonce'ов. */
const AUTHORIZE_FORM_MAX = 64;

/** Hardening-заголовки HTML/JSON-ответов. */
function applySecurityHeaders(res: ServerResponse, kind: 'html' | 'json'): void {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'interest-cohort=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (kind === 'html') {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
  }
}

function isAllowedRedirectUri(uri: string): boolean {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 1024) return false;
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const normalized = parsed.origin + parsed.pathname;
  return ALLOWED_REDIRECT_PREFIXES.some((p) => normalized.startsWith(p));
}

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

interface AuthorizeFormState {
  clientId: string;
  redirectUri: string;
  state: string;
  expiresAt: number;
}

export class SkillWebhookServer {
  private server: Server | null = null;
  private port = 0;
  private readonly tokens: TokenIssuer;
  /** CSRF-nonce → snapshot полей /authorize. Только эти nonce принимаются POST-ом. */
  private readonly authorizeForms = new Map<string, AuthorizeFormState>();

  constructor(private readonly deps: WebhookServerDeps) {
    this.tokens = new TokenIssuer(deps.settings);
  }

  private issueAuthorizeNonce(state: Omit<AuthorizeFormState, 'expiresAt'>): string {
    const nonce = randomBytes(24).toString('base64url');
    this.pruneAuthorizeForms();
    this.authorizeForms.set(nonce, { ...state, expiresAt: Date.now() + AUTHORIZE_FORM_TTL_MS });
    return nonce;
  }

  private consumeAuthorizeNonce(nonce: string): AuthorizeFormState | null {
    if (typeof nonce !== 'string' || nonce.length === 0) return null;
    const record = this.authorizeForms.get(nonce);
    if (!record) return null;
    this.authorizeForms.delete(nonce);
    if (record.expiresAt < Date.now()) return null;
    return record;
  }

  private pruneAuthorizeForms(): void {
    const now = Date.now();
    for (const [k, v] of this.authorizeForms) {
      if (v.expiresAt < now) this.authorizeForms.delete(k);
    }
    if (this.authorizeForms.size <= AUTHORIZE_FORM_MAX) return;
    const sorted = [...this.authorizeForms.entries()].sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt,
    );
    const drop = sorted.length - AUTHORIZE_FORM_MAX;
    for (let i = 0; i < drop; i++) this.authorizeForms.delete(sorted[i]![0]);
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
      // `once` — startup-error → reject; runtime errors ловит долгоживущий ниже.
      server.once('error', reject);
      // Bind на 127.0.0.1 — туннель проксирует на localhost; никаких external listeners.
      server.listen(0, '127.0.0.1', () => {
        this.server = server;
        const addr = server.address() as AddressInfo;
        this.port = addr.port;
        server.removeListener('error', reject);
        server.on('error', (err) => log.error('[skill-webhook] runtime server error', err));
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

    // CORS не нужен: Yandex шлёт server-to-server, OAuth-form — same-origin.
    // На preflight отвечаем без Access-Control-Allow-Origin — браузер блокирует cross-origin сам.
    if (method === 'OPTIONS') {
      res.statusCode = 204;
      applySecurityHeaders(res, 'json');
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
    if (!isAllowedRedirectUri(redirectUri))
      errors.push('redirect_uri не из allow-list (ожидается social.yandex.net/.ru или dialogs.yandex.ru).');

    res.statusCode = errors.length ? 400 : 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    applySecurityHeaders(res, 'html');
    // CSRF-nonce выдаётся ТОЛЬКО при отсутствии ошибок — иначе формы нет.
    const nonce = errors.length ? '' : this.issueAuthorizeNonce({ clientId, redirectUri, state });
    res.end(renderAuthorizePage({ clientId, redirectUri, state, errors, nonce }));
  }

  private async handleAuthorizePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readForm(req);
    const config = this.deps.settings.getAlice().config;

    const clientId = body.get('client_id') ?? '';
    const redirectUri = body.get('redirect_uri') ?? '';
    const state = body.get('state') ?? '';
    const nonce = body.get('csrf_nonce') ?? '';

    const reject = (status: number, error: string): void => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      applySecurityHeaders(res, 'html');
      res.end(renderAuthorizePage({ clientId, redirectUri, state, errors: [error], nonce: '' }));
    };

    // CSRF-защита: nonce должен матчить запись, выданную текущим GET'ом.
    // Это блокирует form-submit'ы из произвольных origin'ов даже при weak-CORS прокси.
    const formState = this.consumeAuthorizeNonce(nonce);
    if (!formState) {
      return reject(403, 'Сессия привязки устарела. Обновите страницу и подтвердите снова.');
    }
    // Сверяем поля с тем, что выдавали в GET — иначе attacker мог бы подменить
    // redirect_uri/state на свои, оставив выданный nonce.
    if (
      formState.clientId !== clientId ||
      formState.redirectUri !== redirectUri ||
      formState.state !== state
    ) {
      return reject(403, 'Параметры формы изменились — отказ.');
    }

    if (!config || clientId !== config.oauthClientId) {
      return reject(400, 'Неверный client_id.');
    }
    if (!isAllowedRedirectUri(redirectUri)) {
      return reject(400, 'redirect_uri вне allow-list — отказ в редиректе.');
    }

    const internalUserId = this.deps.settings.get('hubId');
    const code = this.tokens.issueCode({ clientId, redirectUri, internalUserId });

    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);

    res.statusCode = 302;
    res.setHeader('Location', target.toString());
    applySecurityHeaders(res, 'json');
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
      applySecurityHeaders(res, 'json');
      res.end(JSON.stringify({ error, error_description: description }));
    };

    if (!config) return fail(400, 'invalid_client', 'Skill not configured');
    // Constant-time comparison: байтовые `===` пускают timing-side-channel,
    // через который cloud-attacker за серию запросов извлекает clientSecret.
    if (
      !constantTimeEqualString(clientId, config.oauthClientId) ||
      !constantTimeEqualString(clientSecret, config.oauthClientSecret)
    ) {
      return fail(401, 'invalid_client');
    }

    if (grantType === 'authorization_code') {
      const code = body.get('code') ?? '';
      const requestRedirectUri = body.get('redirect_uri') ?? '';
      const record = this.tokens.consumeCode(code);
      if (!record) return fail(400, 'invalid_grant', 'Code expired or unknown');
      // RFC 6749 §4.1.3 — client_id и redirect_uri должны совпасть с /authorize.
      if (record.clientId !== clientId) {
        return fail(400, 'invalid_grant', 'client_id mismatch');
      }
      if (record.redirectUri !== requestRedirectUri) {
        return fail(400, 'invalid_grant', 'redirect_uri mismatch');
      }
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
    if (!isYandexWebhookSource(req)) {
      log.warn('[skill-webhook] rejected request: missing or invalid trust header');
      return null;
    }
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

  /**
   * Replay-protection: возвращает true если request_id уже видели в TTL-окне.
   * Action handler должен пропускать обработку с 200 + cached-style ответом
   * (Yandex повторяет ровно при 5xx, но мы перестраховываемся).
   */
  private isReplayedRequest(req: IncomingMessage): boolean {
    const id = this.requestId(req);
    if (!id) return false;
    return !noteWebhookRequestId(id);
  }

  private writeJson(res: ServerResponse, status: number, payload: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    applySecurityHeaders(res, 'json');
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
    // Unlink — non-idempotent. Повторный вызов после 5xx должен no-op'нуть.
    if (this.isReplayedRequest(req)) {
      log.info(`[skill-webhook] dropped replayed unlink request_id=${requestId}`);
      this.writeJson(res, 200, { request_id: requestId });
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
    // Action — non-idempotent (включить таймер, открыть штору).
    // Дубликат с тем же request_id отдаём «успехом» без повторного вызова executeCommand.
    if (this.isReplayedRequest(req)) {
      log.info(`[skill-webhook] dropped replayed action request_id=${requestId}`);
      this.writeJson(res, 200, { request_id: requestId, payload: { devices: [] } });
      this.reportActivity('action', true, startedAt);
      return;
    }
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
        return mapWithLimit(requested, ACTION_CONCURRENCY_LIMIT, async (deviceReq) => {
          const reqCaps = deviceReq.capabilities ?? [];
          // Device-level fallback — Алиса прислала action на устройство без capabilities
          // (теоретически invalid request, но spec разрешает device-level action_result).
          if (reqCaps.length === 0) {
            return {
              id: deviceReq.id,
              action_result: {
                status: 'ERROR' as const,
                error_code: 'INVALID_ACTION',
                error_message: 'Empty capabilities array',
              },
            };
          }

          // Сценарий → запуск scene; one virtual on_off-instance.
          if (isSceneYandexId(deviceReq.id)) {
            const sceneId = sceneIdFromYandexId(deviceReq.id);
            try {
              await this.deps.runScene(sceneId);
              return {
                id: deviceReq.id,
                capabilities: reqCaps.map((c) => ({
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
                capabilities: reqCaps.map((c) => ({
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

          // Реальное устройство — capabilities внутри одного устройства паралл-сериализуем
          // нерезаное (внутри уже Promise.all), но cap внешний пул на устройства.
          const capabilityResponses = await Promise.all(
            reqCaps.map(async (capReq) => {
              const instance = typeof capReq?.state?.instance === 'string' ? capReq.state.instance : '';
              if (!instance.trim()) {
                return {
                  type: capReq.type,
                  state: {
                    instance,
                    action_result: {
                      status: 'ERROR' as const,
                      error_code: 'INVALID_ACTION',
                      error_message: 'Missing capability instance',
                    },
                  },
                };
              }
              try {
                const r = await this.deps.executeCommand({
                  deviceId: deviceReq.id,
                  capability: capReq.type as DeviceCommand['capability'],
                  instance,
                  value: capReq.state.value,
                });
                return {
                  type: capReq.type,
                  state: {
                    instance,
                    action_result:
                      r.status === 'DONE'
                        ? { status: 'DONE' as const }
                        : {
                            status: 'ERROR' as const,
                            // Yandex принимает ТОЛЬКО whitelisted error_code'ы;
                            // driver-defined codes переводятся в spec-форму.
                            error_code: mapToYandexErrorCode(r.errorCode),
                            error_message: r.errorMessage,
                          },
                  },
                };
              } catch (e) {
                return {
                  type: capReq.type,
                  state: {
                    instance,
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
        });
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
    let settled = false;
    const destroyAndFail = (err: Error): void => {
      if (settled) return;
      settled = true;
      try {
        req.destroy(err);
      } catch {
        /* socket already gone */
      }
      reject(err);
    };
    // Slow-loris: хард-таймаут на чтение всего тела. Без него атакующий шлёт
    // по 1 байту с длинными паузами и держит сокет открытым часами, занимая
    // file-descriptor'ы. 256KiB-кэп помогает только если злодей быстрый.
    const timer = setTimeout(
      () => destroyAndFail(new Error('body read timeout')),
      BODY_READ_TIMEOUT_MS,
    );
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      // 256KiB — Алиса сама не шлёт больше; защита от случайного flood.
      if (total > 256 * 1024) {
        clearTimeout(timer);
        destroyAndFail(new Error('payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (e) => {
      clearTimeout(timer);
      destroyAndFail(e);
    });
    req.on('close', () => {
      clearTimeout(timer);
      destroyAndFail(new Error('socket closed before body completed'));
    });
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
  /** CSRF-nonce из issueAuthorizeNonce. Без него POST отбрасывается. */
  nonce: string;
}): string {
  const errorBlock = args.errors.length
    ? `<div class="errors">${args.errors.map((e) => `<p>⚠ ${escapeHtml(e)}</p>`).join('')}</div>`
    : '';
  const formBlock = args.errors.length || !args.nonce
    ? ''
    : `<form method="POST" action="/oauth/authorize" autocomplete="off">
         <input type="hidden" name="client_id" value="${escapeHtml(args.clientId)}" />
         <input type="hidden" name="redirect_uri" value="${escapeHtml(args.redirectUri)}" />
         <input type="hidden" name="state" value="${escapeHtml(args.state)}" />
         <input type="hidden" name="csrf_nonce" value="${escapeHtml(args.nonce)}" />
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

/** Constant-time string compare (без раннего выхода по длине, отличие маскируется). */
function constantTimeEqualString(a: string, b: string): boolean {
  const la = a.length;
  const lb = b.length;
  const max = Math.max(la, lb);
  let diff = la ^ lb;
  for (let i = 0; i < max; i++) {
    const ca = i < la ? a.charCodeAt(i) : 0;
    const cb = i < lb ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}
