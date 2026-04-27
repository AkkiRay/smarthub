/**
 * @fileoverview State callback в Я.Диалоги — когда внутреннее устройство
 * меняется (driver push, scene run, polling), хаб оповещает Алису, чтобы
 * кнопки/значки в её приложении обновлялись мгновенно (без 30-секундного
 * polling-loop'а на стороне Алисы).
 *
 * Endpoints (NOTE: домен `.net`, не `.ru`):
 *   - `POST https://dialogs.yandex.net/api/v1/skills/{skill_id}/callback/state`
 *      — изменение state одного или нескольких devices.
 *   - `POST https://dialogs.yandex.net/api/v1/skills/{skill_id}/callback/discovery`
 *      — список устройств изменился (добавили/убрали).
 *
 * Авторизация: `Authorization: OAuth <dialogs_oauth_token>` — токен с
 * client_id `c473ca268cd749d3a8371351a8f2bcbd` (выдаётся через
 * oauth.yandex.com по специальному embedded-flow в `AliceBridge`).
 *
 * Filtering / batching:
 *   - Дебаунс 1с — коллапсим взрывы апдейтов от polling в один POST на device.
 *   - Только `reportable: true` capability/property пушатся (на остальные
 *     Алиса не подписана; push'ить их — flood).
 *
 * При отсутствии `dialogs_oauth_token` skill всё равно работает — просто без
 * push (Алиса дёргает `/devices/query` сама раз в 30s).
 */

import axios, { type AxiosInstance } from 'axios';
import log from 'electron-log/main.js';
import type { Capability, Device, DeviceProperty } from '@smarthome/shared';

const DEBOUNCE_MS = 1_000;
const STATE_URL = (skillId: string): string =>
  `https://dialogs.yandex.net/api/v1/skills/${skillId}/callback/state`;
const DISCOVERY_URL = (skillId: string): string =>
  `https://dialogs.yandex.net/api/v1/skills/${skillId}/callback/discovery`;

/**
 * Cap на pending-Map. Если flush() висит (cloudflared down, сеть упала), enqueue
 * продолжает копить — без cap'а на час offline получаем тысячи Device-объектов
 * в памяти. При превышении дроп'аем самый старый (FIFO).
 */
const MAX_PENDING = 256;

export interface StatePusherDeps {
  /** Получить актуальный config (skillId, dialogsOauthToken). null если не настроено. */
  getConfig: () => { skillId: string; oauthToken: string } | null;
  /** Кому принадлежат устройства — single-user, обычно hubId. */
  getInternalUserId: () => string;
  /** На каждом успешном пуше дёргаем для статус-панели. */
  onSuccess?: () => void;
  /** 401 от dialogs.yandex.net — токен отозван или выдан не от того аккаунта. */
  onUnauthorized?: () => void;
}

export class StatePusher {
  private pending = new Map<string, Device>();
  private timer: NodeJS.Timeout | null = null;
  private readonly http: AxiosInstance;

  constructor(private readonly deps: StatePusherDeps) {
    this.http = axios.create({
      timeout: 4_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Помечает устройство как изменённое — пуш уйдёт после debounce-окна. */
  enqueue(device: Device): void {
    this.pending.set(device.id, device);
    // Map.set replace'ит существующий ключ → размер растёт только если разные
    // device-id. При size > MAX_PENDING дроп'аем самый старый (FIFO через
    // delete + re-set: V8 Map preserves insertion order).
    if (this.pending.size > MAX_PENDING) {
      const oldestKey = this.pending.keys().next().value;
      if (oldestKey !== undefined) this.pending.delete(oldestKey);
    }
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
    }
  }

  /** Принудительный flush — например, после явного действия из UI. */
  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.flush();
  }

  /**
   * Сообщить Алисе «список устройств обновился» — после toggle экспозиции или паре.
   * Алиса перечитает /v1.0/user/devices.
   */
  async pushDiscovery(): Promise<{ ok: boolean; error?: string }> {
    const config = this.deps.getConfig();
    if (!config) return { ok: false, error: 'skill_not_configured' };
    try {
      await this.http.post(
        DISCOVERY_URL(config.skillId),
        {
          ts: Date.now() / 1000,
          payload: { user_id: this.deps.getInternalUserId() },
        },
        { headers: { Authorization: `OAuth ${config.oauthToken}` } },
      );
      this.deps.onSuccess?.();
      return { ok: true };
    } catch (e) {
      log.warn('[state-pusher] discovery callback failed', e);
      const err = e as { response?: { status?: number } };
      if (err.response?.status === 401) this.deps.onUnauthorized?.();
      return { ok: false, error: (e as Error).message };
    }
  }

  // ============== Internals ==============

  private async flush(): Promise<void> {
    this.timer = null;
    const batch = Array.from(this.pending.values());
    this.pending.clear();
    if (!batch.length) return;

    const config = this.deps.getConfig();
    if (!config) {
      log.debug('[state-pusher] flush skipped — skill not configured');
      return;
    }

    const payload = {
      ts: Date.now() / 1000,
      payload: {
        user_id: this.deps.getInternalUserId(),
        devices: batch.map((d) => ({
          id: d.id,
          capabilities: d.capabilities.filter(isReportable).map(toCapabilityState),
          properties: d.properties.filter(isReportable).map(toPropertyState),
        })),
      },
    };

    try {
      await this.http.post(STATE_URL(config.skillId), payload, {
        headers: { Authorization: `OAuth ${config.oauthToken}` },
      });
      this.deps.onSuccess?.();
    } catch (e) {
      log.warn('[state-pusher] state callback failed', e);
      const err = e as { response?: { status?: number } };
      if (err.response?.status === 401) this.deps.onUnauthorized?.();
      // Не ретраим — Алиса всё равно поллит query при следующем взаимодействии.
    }
  }
}

function isReportable(capOrProp: Capability | DeviceProperty): boolean {
  return capOrProp.reportable === true;
}

function toCapabilityState(cap: Capability): {
  type: string;
  state?: { instance: string; value: unknown };
} {
  return cap.state ? { type: cap.type, state: cap.state } : { type: cap.type };
}

function toPropertyState(prop: DeviceProperty): {
  type: string;
  state?: { instance: string; value: unknown };
} {
  return prop.state ? { type: prop.type, state: prop.state } : { type: prop.type };
}
