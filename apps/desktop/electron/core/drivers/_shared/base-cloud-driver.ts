/**
 * @fileoverview Базовый класс для cloud-драйверов (Tuya, eWeLink, Govee,
 * Sber, Aqara, …). Расширяет {@link BaseDriver} двумя возможностями:
 *
 *   1. **Shared axios instance** — единый `AxiosInstance` с заданным baseURL
 *      и timeout'ом, не плодим инстансы на каждый запрос.
 *   2. **Single-flight refresh-on-401** — если параллельно стартовали 5
 *      запросов и все получили 401, refresh-токена вызовется ОДИН раз,
 *      остальные дождутся его и retry'нут с новым токеном.
 *
 * Subclass обязан реализовать:
 *   - `refreshToken()` — обновляет внутренний state (сохраняет новый
 *      access/refresh-токен в `SettingsStore`).
 *   - `applyAuth(config)` — ставит `Authorization` header перед запросом
 *      (вызывается ДО каждого `request()`, в том числе при retry).
 *
 * `request<T>(config)` автоматически:
 *   1. Применяет `applyAuth()`.
 *   2. Шлёт запрос.
 *   3. При HTTP 401 — single-flight refresh + retry один раз.
 *   4. При retry-попадании 401 — бросает (юзер увидит auth-required toast).
 */

import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { getHttpStatus } from '@smarthome/shared';
import { BaseDriver } from './base-driver.js';

export interface BaseCloudDriverOptions {
  baseURL: string;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
}

/** Максимальное ожидание Retry-After перед тем как сдаться (cloud's retry-after может быть минуты). */
const RETRY_AFTER_MAX_MS = 60_000;
/** Минимум — defensive (некоторые cloud'ы шлют 0 или отрицательное; ставим 1с floor). */
const RETRY_AFTER_MIN_MS = 1_000;

export abstract class BaseCloudDriver extends BaseDriver {
  protected readonly http: AxiosInstance;
  private refreshInFlight: Promise<void> | null = null;

  constructor(options: BaseCloudDriverOptions) {
    super();
    this.http = axios.create({
      baseURL: options.baseURL,
      timeout: options.timeoutMs ?? 6000,
      headers: options.defaultHeaders,
    });
  }

  /** Должен обновить внутренний token; бросает если refresh невозможен. */
  protected abstract refreshToken(): Promise<void>;

  /** Ставит Authorization header перед каждым запросом. */
  protected abstract applyAuth(config: AxiosRequestConfig): AxiosRequestConfig;

  /**
   * Wraps `axios.request` с двумя механизмами:
   *  1. **Single-flight refresh-on-401** — параллельные запросы дожидаются
   *     одного refresh.
   *  2. **Retry-After handling on 429/503** — uniform across cloud drivers,
   *     ждём сколько cloud просит, retry один раз. Govee 60req/min, eWeLink
   *     30req/min — без обработки fail-soft возвращает DEVICE_UNREACHABLE.
   */
  protected async request<T>(config: AxiosRequestConfig): Promise<T> {
    const send = async (): Promise<T> => {
      const r = await this.http.request<T>(this.applyAuth(config));
      return r.data;
    };
    try {
      return await send();
    } catch (e) {
      const status = getHttpStatus(e);
      if (status === 401) {
        if (!this.refreshInFlight) {
          this.refreshInFlight = this.refreshToken().finally(() => {
            this.refreshInFlight = null;
          });
        }
        await this.refreshInFlight;
        return send();
      }
      if (status === 429 || status === 503) {
        const waitMs = parseRetryAfter((e as AxiosError).response?.headers);
        if (waitMs > 0) {
          await new Promise((r) => setTimeout(r, waitMs));
          return send();
        }
      }
      throw e;
    }
  }
}

/**
 * Парсит `Retry-After` header (RFC 7231): либо delta-seconds (integer), либо
 * HTTP-date. Возвращает ms (≥ RETRY_AFTER_MIN_MS) или 0 если header отсутствует.
 */
function parseRetryAfter(headers: unknown): number {
  if (!headers || typeof headers !== 'object') return 0;
  const raw = (headers as Record<string, unknown>)['retry-after'];
  if (typeof raw !== 'string') return 0;
  const trimmed = raw.trim();
  // Delta-seconds.
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, Math.round(seconds * 1000)));
  }
  // HTTP-date.
  const ts = Date.parse(trimmed);
  if (!Number.isNaN(ts)) {
    return Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, ts - Date.now()));
  }
  return 0;
}
