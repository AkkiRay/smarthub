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
 *
 * Хранение: на диске только `sha256(token)`; lookup — хэшированием и
 * constant-time match через `timingSafeEqual`.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SettingsStore } from '../../storage/settings-store.js';

const ACCESS_TTL_SEC = 60 * 60 * 24 * 30;
const REFRESH_TTL_SEC = 60 * 60 * 24 * 365;

const randomToken = (): string => randomBytes(32).toString('base64url');
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Constant-time hex-string compare для timing-safe lookup. */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  internalUserId: string;
}

/** OAuth /authorize → /token state, in-memory ~10 мин; удаляется после /token. */
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
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(private readonly settings: SettingsStore) {
    this.migrateLegacyPlaintextTokens();
    this.pruneTimer = setInterval(() => this.pruneExpiredCodes(), 5 * 60_000);
    this.pruneTimer.unref?.();
  }

  /** Освободить ресурсы (тестовые контексты, hot-reload в dev). */
  dispose(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
  }

  private pruneExpiredCodes(): void {
    const now = Date.now();
    for (const [k, v] of this.codes) {
      if (v.expiresAt < now) this.codes.delete(k);
    }
  }

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
    issuedTokens[hashToken(accessToken)] = {
      internalUserId,
      issuedAt: now,
      expiresAt: now + ACCESS_TTL_SEC * 1000,
      refreshToken: hashToken(refreshToken),
    };
    for (const [tokenHash, record] of Object.entries(issuedTokens)) {
      if (record.expiresAt < now) delete issuedTokens[tokenHash];
    }
    this.settings.patchAlice({ issuedTokens });

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TTL_SEC,
      internalUserId,
    };
  }

  /** Lookup по access_token; full-scan без early-out для timing-safe match. null если не найден или истёк. */
  resolveAccessToken(accessToken: string): {
    internalUserId: string;
    expiresAt: number;
  } | null {
    if (typeof accessToken !== 'string' || accessToken.length === 0) return null;
    const candidate = hashToken(accessToken);
    let match: { internalUserId: string; expiresAt: number } | null = null;
    for (const [storedHash, record] of Object.entries(this.settings.getAlice().issuedTokens)) {
      const equal = safeEqualHex(storedHash, candidate);
      if (equal && !match) {
        match = { internalUserId: record.internalUserId, expiresAt: record.expiresAt };
      }
    }
    if (!match) return null;
    if (match.expiresAt < Date.now()) return null;
    return match;
  }

  /** Refresh: lookup по refresh_token (full-scan), выдача новой пары, инвалидация старого access. */
  refresh(refreshToken: string): IssuedTokenPair | null {
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) return null;
    const candidate = hashToken(refreshToken);
    const alice = this.settings.getAlice();
    let foundHash: string | null = null;
    let foundRecord: { internalUserId: string } | null = null;
    for (const [storedHash, v] of Object.entries(alice.issuedTokens)) {
      const equal = typeof v.refreshToken === 'string' && safeEqualHex(v.refreshToken, candidate);
      if (equal && !foundHash) {
        foundHash = storedHash;
        foundRecord = { internalUserId: v.internalUserId };
      }
    }
    if (!foundHash || !foundRecord) return null;
    const issuedTokens = { ...alice.issuedTokens };
    delete issuedTokens[foundHash];
    this.settings.patchAlice({ issuedTokens });
    return this.issueTokenPair(foundRecord.internalUserId);
  }

  /** Полная инвалидация — Алиса дёрнула /unlink. */
  revokeAll(): void {
    this.settings.patchAlice({ issuedTokens: {} });
  }

  /** Удаляет legacy plaintext-ключи (не sha256-hex); валидные sha256-hex-ключи остаются. */
  private migrateLegacyPlaintextTokens(): void {
    const tokens = this.settings.getAlice().issuedTokens;
    const legacyKeys = Object.keys(tokens).filter((k) => !/^[0-9a-f]{64}$/.test(k));
    if (legacyKeys.length === 0) return;
    const cleaned = { ...tokens };
    for (const k of legacyKeys) delete cleaned[k];
    this.settings.patchAlice({ issuedTokens: cleaned });
  }
}

export { ACCESS_TTL_SEC, REFRESH_TTL_SEC };
