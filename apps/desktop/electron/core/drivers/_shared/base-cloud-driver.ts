/**
 * База для cloud-драйверов: shared axios instance + single-flight refresh-on-401.
 *
 * Subclass реализует `refreshToken()` (обновляет внутренний state) и `applyAuth()`
 * (ставит Authorization header перед запросом). `request()` авто-ретраит один раз
 * при 401, параллельные 401 ждут общий refresh.
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
