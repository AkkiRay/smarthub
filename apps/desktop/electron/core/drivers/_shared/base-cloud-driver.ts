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

import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { getHttpStatus } from '@smarthome/shared';
import { BaseDriver } from './base-driver.js';

export interface BaseCloudDriverOptions {
  baseURL: string;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
}

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

  protected async request<T>(config: AxiosRequestConfig): Promise<T> {
    const send = async (): Promise<T> => {
      const r = await this.http.request<T>(this.applyAuth(config));
      return r.data;
    };
    try {
      return await send();
    } catch (e) {
      if (getHttpStatus(e) !== 401) throw e;
      if (!this.refreshInFlight) {
        this.refreshInFlight = this.refreshToken().finally(() => {
          this.refreshInFlight = null;
        });
      }
      await this.refreshInFlight;
      return send();
    }
  }
}
