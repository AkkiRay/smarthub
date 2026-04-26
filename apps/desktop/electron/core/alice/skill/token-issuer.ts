/**
 * @fileoverview OAuth bearer-токены, которые ХАБ выдаёт Алисе после привязки
 * аккаунта (см. {@link WebhookServer} `/oauth/*`).
 *
 * НЕ путать с другими «токенами Я.»:
 *   - `music_token` (oauth.yandex.ru, для Quasar API) — см. `yandex-oauth.ts`.
 *   - `x-token` (passport, для glagol-pairing) — см. `yandex-station-client.ts`.
 *   - `dialogs_oauth_token` — токен на client_id `c473ca268cd...`, нужен для
 *     `state-pusher.ts` (push в callback API).
 *
 * Single-user hub: «внутренний user_id» = `hubId`. Bearer-токен ничего не
 * идентифицирует, кроме «эта Алиса привязана к этому хабу». Криптографически —
 * random 256-bit, base64url.
 *
 * TTL:
 *   - Access:  30 дней (Алиса дёрнет refresh за неделю до истечения).
 *   - Refresh: 1 год.
 */

import { randomBytes } from 'node:crypto';
import type { SettingsStore } from '../../storage/settings-store.js';

const ACCESS_TTL_SEC = 60 * 60 * 24 * 30; // 30 дней; Алиса дёрнет refresh за неделю до конца
const REFRESH_TTL_SEC = 60 * 60 * 24 * 365; // 1 год — достаточно

const randomToken = (): string => randomBytes(32).toString('base64url');

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  internalUserId: string;
}

/**
 * Состояния OAuth /authorize → /token. Хранится в памяти (короткоживёт ~10 мин).
 * После /token запись удаляется. Persist не нужен — process restart = юзер
 * заново привяжет аккаунт в Я.приложении (это секунды).
 */
export interface AuthorizationCodeRecord {
  code: string;
  clientId: string;
  redirectUri: string;
  internalUserId: string;
  /** Epoch ms истечения. */
  expiresAt: number;
}

export class TokenIssuer {
  private codes = new Map<string, AuthorizationCodeRecord>();

  constructor(private readonly settings: SettingsStore) {}

  // ===== Authorization code =====

  issueCode(args: { clientId: string; redirectUri: string; internalUserId: string }): string {
    const code = randomToken();
    this.codes.set(code, {
      code,
      clientId: args.clientId,
      redirectUri: args.redirectUri,
      internalUserId: args.internalUserId,
      expiresAt: Date.now() + 10 * 60_000,
    });
    return code;
  }

  consumeCode(code: string): AuthorizationCodeRecord | null {
    const record = this.codes.get(code);
    if (!record) return null;
    this.codes.delete(code);
    if (record.expiresAt < Date.now()) return null;
    return record;
  }

  // ===== Access/refresh tokens =====

  issueTokenPair(internalUserId: string): IssuedTokenPair {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const now = Date.now();

    const alice = this.settings.getAlice();
    const issuedTokens = { ...alice.issuedTokens };
    issuedTokens[accessToken] = {
      internalUserId,
      issuedAt: now,
      expiresAt: now + ACCESS_TTL_SEC * 1000,
      refreshToken,
    };
    // Чистим истёкшие — не растёт бесконечно при regeneration loop'ах.
    for (const [token, record] of Object.entries(issuedTokens)) {
      if (record.expiresAt < now) delete issuedTokens[token];
    }
    this.settings.patchAlice({ issuedTokens });

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TTL_SEC,
      internalUserId,
    };
  }

  /** Найти запись по access_token. null если не найден или истёк. */
  resolveAccessToken(accessToken: string): {
    internalUserId: string;
    expiresAt: number;
  } | null {
    const record = this.settings.getAlice().issuedTokens[accessToken];
    if (!record) return null;
    if (record.expiresAt < Date.now()) return null;
    return { internalUserId: record.internalUserId, expiresAt: record.expiresAt };
  }

  /** Refresh: ищем запись по refresh_token, выдаём новую пару, старый access инвалидируем. */
  refresh(refreshToken: string): IssuedTokenPair | null {
    const alice = this.settings.getAlice();
    const entries = Object.entries(alice.issuedTokens);
    const found = entries.find(([, v]) => v.refreshToken === refreshToken);
    if (!found) return null;
    const [oldAccess, record] = found;
    // Удаляем старый access и выдаём новую пару
    const issuedTokens = { ...alice.issuedTokens };
    delete issuedTokens[oldAccess];
    this.settings.patchAlice({ issuedTokens });
    return this.issueTokenPair(record.internalUserId);
  }

  /** Полная инвалидация — Алиса дёрнула /unlink. */
  revokeAll(): void {
    this.settings.patchAlice({ issuedTokens: {} });
  }
}

export { ACCESS_TTL_SEC, REFRESH_TTL_SEC };
