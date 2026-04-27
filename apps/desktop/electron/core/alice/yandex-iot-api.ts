/**
 * @fileoverview HTTP/WebSocket-клиент cloud-сервиса «Дом с Алисой» (iot.quasar) —
 * fetch'ит устройства, запускает actions, подписывается на real-time updates.
 *
 * Authentication
 * --------------
 * - Session cookies из Electron-партиции `persist:yandex-oauth` (юзер
 *   логинится через web-flow Яндекса, рендерящийся в `BrowserView`).
 * - CSRF-токен `csrfToken2`, парсится из HTML страницы `https://yandex.ru/quasar`.
 *   Кэшируется на 5 минут; auto-refresh при 401/403.
 * - Bearer-токен Я.Музыки этими endpoint'ами НЕ принимается, хотя и живёт в
 *   той же партиции. Cookies + CSRF обязательны.
 *
 * Endpoint map
 * ---------------------------------------------------------------------------
 * | Method | Path                                                 | Назначение     |
 * |--------|------------------------------------------------------|----------------|
 * | GET    | `/m/v3/user/devices`                                 | Полный snapshot|
 * | GET    | `/m/user/{itemType}s/{id}`                           | Одно устройство|
 * | POST   | `/m/user/{itemType}s/{id}/actions`                   | Run action     |
 * | POST   | `/m/v3/user/custom/group/color/apply`                | Color/CCT      |
 * | GET    | `/m/user/scenarios`                                  | Список сценариев|
 * | POST   | `/m/user/scenarios/{id}/actions`                     | Запустить сцен.|
 * | GET    | `/m/v4/user/scenarios/{id}/edit`                     | Edit-snapshot  |
 * | PUT    | `/m/v4/user/scenarios/{id}`                          | Обновить       |
 * | DELETE | `/m/v4/user/scenarios/{id}`                          | Удалить        |
 *
 * `itemType` — `'device'` либо `'group'`, читается литерально из
 * `device.item_type` в snapshot'е. Плюральная форма приклеивается к URL.
 *
 * Несуществующие endpoint'ы (отдают 404):
 *   - `/m/v3/user/devices/{id}`       (single-device на v3-префиксе)
 *   - `/m/v3/user/devices/actions`    (bulk action)
 *   - `/quasar/iot`                   (CSRF page — работает только `/quasar`)
 *
 * Color/CCT (`devices.capabilities.color_setting`) идёт через выделенный
 * endpoint `/color/apply`; обычный `/actions` для color у cloud-ламп отдаёт
 * HTTP 400. См. {@link YandexIotClient.applyColorAction}.
 */

import { net, session } from 'electron';
import log from 'electron-log/main.js';
import WebSocket from 'ws';
import { safeJsonParse } from '@smarthome/shared';
import { YANDEX_OAUTH_PARTITION } from './yandex-oauth.js';

/** Страница с CSRF-токеном `csrfToken2`. */
const QUASAR_CSRF_PAGE_URL = 'https://yandex.ru/quasar';
const IOT_DEVICES_URL = 'https://iot.quasar.yandex.ru/m/v3/user/devices';
/** Список сценариев — без версионного префикса. */
const IOT_SCENARIOS_URL = 'https://iot.quasar.yandex.ru/m/user/scenarios';

/**
 * UA, которому Yandex anti-bot не возражает (≈ Chrome 140 на 2026-04).
 * Не злоупотребляем — Yandex отдаёт 403 + капчу при mismatch headers.
 */
const QUASAR_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * Допустимые host'ы для updates WS-URL — anti-MITM защита.
 * Если Yandex когда-либо вернёт URL вне `*.yandex.ru/.net`, это либо ошибка
 * парсинга, либо подмена ответа: мы отказываемся открывать соединение,
 * потому что cookies партиции уйдут на attacker-host.
 */
const UPDATES_WS_HOST_SUFFIXES = ['.yandex.ru', '.yandex.net'];

function isAllowedUpdatesUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'wss:') return false;
    return UPDATES_WS_HOST_SUFFIXES.some((s) => u.hostname.endsWith(s));
  } catch {
    return false;
  }
}

export interface YandexHomeDevice {
  id: string;
  name: string;
  /** `devices.types.light`, `devices.types.media_device.tv`, … */
  type: string;
  /**
   * Дискриминатор для URL'а действий: `/m/user/{itemType}s/{id}/actions`.
   * Yandex отдаёт `"device"` для обычных устройств и `"group"` для групп. Если поля
   * нет в snapshot'е — считаем `"device"` (обратно-совместимо).
   */
  itemType: 'device' | 'group';
  room?: string;
  roomId?: string;
  householdId?: string;
  skillId?: string;
  capabilities: YandexHomeCapability[];
  properties: YandexHomeProperty[];
  iconUrl?: string;
  online?: boolean;
  /** Glagol-style serial (`L9402030001234567`); совпадает с mDNS deviceId.
   *  Ключ связки cloud-Device ↔ локальная WS-сессия. */
  quasarDeviceId?: string;
  quasarPlatform?: string;
}

export interface YandexHomeCapability {
  type: string;
  retrievable?: boolean;
  reportable?: boolean;
  parameters?: Record<string, unknown>;
  state?: Record<string, unknown> | null;
}

export interface YandexHomeProperty {
  type: string;
  retrievable?: boolean;
  reportable?: boolean;
  parameters?: Record<string, unknown>;
  state?: Record<string, unknown> | null;
}

export interface YandexHomeRoom {
  id: string;
  name: string;
  householdId?: string;
  devices: string[];
}

export interface YandexHomeHousehold {
  id: string;
  name: string;
}

export interface YandexHomeGroup {
  id: string;
  name: string;
  /** `devices.types.light`, `devices.types.thermostat`, … */
  type?: string;
  householdId?: string;
  /** deviceId-ы участников группы. */
  devices: string[];
  /** Агрегированные capabilities группы (что можно вызвать на /m/user/groups/{id}/actions). */
  capabilities: YandexHomeCapability[];
  /** Агрегированные properties группы (для UI отображения). */
  properties: YandexHomeProperty[];
}

export type YandexHomeTriggerType = 'voice' | 'timetable' | 'property' | 'button' | 'other';

export interface YandexHomeTrigger {
  type: YandexHomeTriggerType;
  /** Краткий человеческий текст: «доброе утро», «09:00 ежедневно», … */
  summary: string;
  /** Сырой JSON триггера — для отрисовки в edit-modal без потери данных. */
  raw?: unknown;
}

export interface YandexHomeScenario {
  id: string;
  name: string;
  isActive?: boolean;
  /** Yandex-name иконки (`alice.dot.scenario.morning`) если пришёл. */
  icon?: string;
  iconUrl?: string;
  triggers: YandexHomeTrigger[];
  /** Количество шагов (action items). 0 если не известно. */
  stepCount: number;
  /** ID устройств, участвующих в сценарии. */
  devices: string[];
}

/** Полные детали сценария c шагами + триггерами — для UI редактора. */
export interface YandexHomeScenarioDetails extends YandexHomeScenario {
  /** Сырой `steps[]` из edit-endpoint'а. */
  rawSteps: unknown[];
  /** Сырой `settings` из edit-endpoint'а — для round-trip при PUT. */
  rawSettings?: Record<string, unknown>;
  rawEffectiveTime?: Record<string, unknown>;
}

export interface YandexHomeSnapshot {
  households: YandexHomeHousehold[];
  rooms: YandexHomeRoom[];
  groups: YandexHomeGroup[];
  devices: YandexHomeDevice[];
  scenarios: YandexHomeScenario[];
  fetchedAt: string;
  /** WebSocket-URL для real-time push'а device-state-changes (валиден ~часы). */
  updatesUrl?: string;
}

interface RawDevice {
  id: string;
  name: string;
  type: string;
  /** `"device"` либо `"group"` — нужно для URL `/m/user/{item_type}s/{id}`. */
  item_type?: 'device' | 'group';
  /** Yandex отдаёт roomId именно в `room`; редкие схемы используют `room_id`. */
  room?: string;
  room_id?: string;
  household_id?: string;
  skill_id?: string;
  external_id?: string;
  icon_url?: string;
  state?: string;
  capabilities?: YandexHomeCapability[];
  properties?: YandexHomeProperty[];
  /** Meta Yandex-колонок: `device_id` совпадает с glagol mDNS,
   *  `platform` — `yandexstation_2` и т.п. */
  quasar_info?: { device_id?: string; platform?: string };
}

interface RawRoom {
  id: string;
  name: string;
  household_id?: string;
  /** Legacy v2: список deviceId. */
  devices?: string[];
  /** v3: либо массив deviceId, либо массив объектов device. */
  items?: Array<string | RawDevice>;
}

/**
 * v3 households-первая схема. Все устройства / комнаты / сценарии вложены
 * внутрь household-объектов; top-level содержит только `households[]`.
 */
interface RawGroup {
  id: string;
  name: string;
  type?: string;
  household_id?: string;
  /** Идентификаторы устройств — входят в группу. */
  devices?: Array<string | RawDevice>;
  items?: Array<string | RawDevice>;
  capabilities?: YandexHomeCapability[];
  properties?: YandexHomeProperty[];
}

interface RawHousehold {
  id: string;
  name: string;
  /** Все устройства household'а (плоский список с полным state). */
  all?: RawDevice[];
  rooms?: RawRoom[];
  scenarios?: RawScenario[];
  groups?: RawGroup[];
  unconfigured_devices?: RawDevice[];
  favorites?: { items?: RawDevice[] };
}

interface RawTrigger {
  trigger?: {
    type?: string;
    value?: unknown;
  };
}

interface RawScenario {
  id: string;
  name: string;
  is_active?: boolean;
  icon?: string;
  icon_url?: string;
  triggers?: RawTrigger[];
  /** В list-endpoint бывает отдельно как `devices: string[]`. */
  devices?: string[];
  /** В edit-endpoint раскрывается на steps[]. */
  steps?: unknown[];
}

/** Полные детали сценария — POST /m/v4/user/scenarios/{id}/edit. */
interface RawScenarioEditResponse {
  status?: string;
  message?: string;
  scenario?: {
    id: string;
    name: string;
    icon?: string;
    icon_url?: string;
    is_active?: boolean;
    triggers?: RawTrigger[];
    steps?: unknown[];
    settings?: Record<string, unknown>;
    effective_time?: Record<string, unknown>;
    devices?: string[];
  };
}

interface RawUserDevicesResponse {
  status?: string;
  message?: string;
  /** v3: всё внутри. */
  households?: RawHousehold[];
  /** Legacy v2 fallback. */
  rooms?: RawRoom[];
  devices?: RawDevice[];
  scenarios?: RawScenario[];
  /**
   * WebSocket-URL для real-time push'а device state-changes. Yandex генерирует
   * его на каждый snapshot-запрос (TTL ~ часы). Без него UI обновляется только
   * polling'ом раз в 30s.
   */
  updates_url?: string;
}

interface RawScenariosResponse {
  status?: string;
  message?: string;
  scenarios?: RawScenario[];
}

/** GET через `net.request` c cookies партиции. */
async function fetchTextWithPartitionCookies(
  url: string,
): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const sess = session.fromPartition(YANDEX_OAUTH_PARTITION);
    const req = net.request({
      method: 'GET',
      url,
      session: sess,
      useSessionCookies: true,
      headers: {
        'user-agent': QUASAR_UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    let body = '';
    let status = 0;
    req.on('response', (res) => {
      status = res.statusCode;
      res.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      res.on('end', () => resolve({ body, status }));
      res.on('error', (e: Error) => reject(e));
    });
    req.on('error', (e) => reject(e));
    req.end();
  });
}

/** Минимальный интервал между запросами к iot.quasar. */
const IOT_REQUEST_GAP_MS = 220;
let lastIotRequestAt = 0;
let iotThrottleChain: Promise<void> = Promise.resolve();

/** Сериализует HTTP-вызовы через promise-chain с минимальным gap'ом между ними. */
async function awaitIotRequestGap(): Promise<void> {
  const next = iotThrottleChain.then(async () => {
    const gap = lastIotRequestAt + IOT_REQUEST_GAP_MS - Date.now();
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    lastIotRequestAt = Date.now();
  });
  iotThrottleChain = next.catch(() => undefined);
  await next;
}

async function fetchJsonWithCsrf<T>(url: string, csrfToken: string): Promise<T> {
  await awaitIotRequestGap();
  return new Promise((resolve, reject) => {
    const sess = session.fromPartition(YANDEX_OAUTH_PARTITION);
    const req = net.request({
      method: 'GET',
      url,
      session: sess,
      useSessionCookies: true,
      headers: {
        'user-agent': QUASAR_UA,
        'x-csrf-token': csrfToken,
        accept: 'application/json',
      },
    });

    let body = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`iot.quasar HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body) as T);
        } catch (e) {
          reject(
            new Error(
              `iot.quasar: невалидный JSON (${(e as Error).message}); body=${body.slice(0, 120)}`,
            ),
          );
        }
      });
      res.on('error', (e: Error) => reject(e));
    });
    req.on('error', (e) => reject(e));
    req.end();
  });
}

/** POST JSON c CSRF + session cookies. Возвращает распарсенный body. */
async function postJsonWithCsrf<T>(url: string, csrfToken: string, payload: unknown): Promise<T> {
  await awaitIotRequestGap();
  return new Promise((resolve, reject) => {
    const sess = session.fromPartition(YANDEX_OAUTH_PARTITION);
    const req = net.request({
      method: 'POST',
      url,
      session: sess,
      useSessionCookies: true,
      headers: {
        'user-agent': QUASAR_UA,
        'x-csrf-token': csrfToken,
        accept: 'application/json',
        'content-type': 'application/json',
      },
    });

    let body = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`iot.quasar HTTP ${res.statusCode}: ${body.slice(0, 400)}`));
          return;
        }
        try {
          resolve(body ? (JSON.parse(body) as T) : ({} as T));
        } catch (e) {
          reject(
            new Error(
              `iot.quasar: невалидный JSON (${(e as Error).message}); body=${body.slice(0, 120)}`,
            ),
          );
        }
      });
      res.on('error', (e: Error) => reject(e));
    });
    req.on('error', (e) => reject(e));
    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function putJsonWithCsrf<T>(url: string, csrfToken: string, payload: unknown): Promise<T> {
  return jsonWithBody<T>('PUT', url, csrfToken, payload);
}

async function deleteJsonWithCsrf<T>(url: string, csrfToken: string): Promise<T> {
  return jsonWithBody<T>('DELETE', url, csrfToken, undefined);
}

async function jsonWithBody<T>(
  method: 'PUT' | 'DELETE',
  url: string,
  csrfToken: string,
  payload: unknown,
): Promise<T> {
  await awaitIotRequestGap();
  return new Promise((resolve, reject) => {
    const sess = session.fromPartition(YANDEX_OAUTH_PARTITION);
    const req = net.request({
      method,
      url,
      session: sess,
      useSessionCookies: true,
      headers: {
        'user-agent': QUASAR_UA,
        'x-csrf-token': csrfToken,
        accept: 'application/json',
        'content-type': 'application/json',
      },
    });

    let body = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`iot.quasar HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(body ? (JSON.parse(body) as T) : ({} as T));
        } catch (e) {
          reject(
            new Error(
              `iot.quasar: невалидный JSON (${(e as Error).message}); body=${body.slice(0, 120)}`,
            ),
          );
        }
      });
      res.on('error', (e: Error) => reject(e));
    });
    req.on('error', (e) => reject(e));
    if (payload !== undefined) req.write(JSON.stringify(payload));
    req.end();
  });
}

/** Маппинг `RawScenario` → `YandexHomeScenario` (общий для list / details endpoint'ов). */
function mapScenario(s: RawScenario): YandexHomeScenario {
  const triggers = (s.triggers ?? []).map(parseTrigger);
  return {
    id: s.id,
    name: s.name,
    ...(typeof s.is_active === 'boolean' ? { isActive: s.is_active } : {}),
    ...(s.icon ? { icon: s.icon } : {}),
    ...(s.icon_url ? { iconUrl: s.icon_url } : {}),
    triggers,
    stepCount: Array.isArray(s.steps) ? s.steps.length : 0,
    devices: s.devices ?? [],
  };
}

function parseTrigger(t: RawTrigger): YandexHomeTrigger {
  const type = String(t.trigger?.type ?? '');
  const value = t.trigger?.value;
  if (type === 'scenario.trigger.voice') {
    const phrase =
      typeof value === 'string' ? value : ((value as { phrase?: string })?.phrase ?? '');
    return { type: 'voice', summary: `«${phrase || 'голос'}»`, raw: t };
  }
  if (type === 'scenario.trigger.timetable') {
    return { type: 'timetable', summary: formatTimetable(value), raw: t };
  }
  if (type === 'scenario.trigger.property') {
    return { type: 'property', summary: 'По состоянию устройства', raw: t };
  }
  if (type === 'scenario.trigger.button') {
    return { type: 'button', summary: 'Нажатие кнопки', raw: t };
  }
  return { type: 'other', summary: type.replace('scenario.trigger.', '') || 'Триггер', raw: t };
}

function formatTimetable(value: unknown): string {
  if (!value || typeof value !== 'object') return 'По расписанию';
  const v = value as { time?: string; days_of_week?: string[]; condition?: { type?: string } };
  const time = typeof v.time === 'string' ? v.time : '';
  const days = Array.isArray(v.days_of_week) ? v.days_of_week : [];
  if (time && days.length === 7) return `${time} ежедневно`;
  if (time && days.length > 0) return `${time} ${days.join(', ')}`;
  if (time) return time;
  return 'По расписанию';
}

/** Извлекает `csrfToken2` из HTML quasar/iot (inline-JSON). */
function extractCsrfToken(html: string): string | null {
  const patterns = [
    /"csrfToken2"\s*:\s*"([^"]+)"/,
    /"csrf_token2"\s*:\s*"([^"]+)"/,
    /name="csrf-token"\s+content="([^"]+)"/,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return m[1] ?? null;
  }
  return null;
}

interface RawSingleDeviceResponse extends RawDevice {
  status?: string;
  message?: string;
}

interface RawActionResponse {
  status?: string;
  message?: string;
  request_id?: string;
  /** Per-device endpoint отдаёт `devices[0].capabilities[]` либо `devices[0].actions_results[]`
   *  (формат менялся; парсим оба). Каждый элемент содержит `action_result.status`. */
  devices?: Array<{
    id?: string;
    capabilities?: Array<{
      type?: string;
      state?: { instance?: string; action_result?: { status?: string; error_message?: string } };
    }>;
    actions_results?: Array<{
      status?: string;
      instance?: string;
      action_result?: { status?: string; error_message?: string };
    }>;
  }>;
}

export interface YandexIotActionResult {
  ok: boolean;
  /** SUCCESS / ERROR / DECLINED — приходит от Yandex. */
  status?: string;
  error?: string;
}

export class YandexIotClient {
  /** Закэшированный CSRF — живёт ~5 минут, обновляется при 401/403. */
  private csrfToken: string | null = null;
  private csrfFetchedAt = 0;
  private static readonly CSRF_TTL_MS = 5 * 60 * 1000;

  /** Берёт свежий или закэшированный csrfToken2. */
  private async getCsrf(forceRefresh = false): Promise<string> {
    const fresh =
      !forceRefresh &&
      this.csrfToken &&
      Date.now() - this.csrfFetchedAt < YandexIotClient.CSRF_TTL_MS;
    if (fresh && this.csrfToken) return this.csrfToken;

    const page = await fetchTextWithPartitionCookies(QUASAR_CSRF_PAGE_URL);
    if (page.status === 401 || page.status === 403) {
      throw new Error('Сессия Яндекса истекла. Выйдите и войдите снова.');
    }
    if (page.status >= 400) {
      throw new Error(`Не удалось открыть quasar: HTTP ${page.status}`);
    }
    const csrf = extractCsrfToken(page.body);
    if (!csrf) {
      throw new Error(
        'CSRF-токен не найден на странице quasar — вероятно, вы не залогинены в Яндексе.',
      );
    }
    this.csrfToken = csrf;
    this.csrfFetchedAt = Date.now();
    return csrf;
  }

  /** Сбрасывает закэшированный CSRF — вызывается на любой 401/403. */
  private invalidateCsrf(): void {
    this.csrfToken = null;
    this.csrfFetchedAt = 0;
  }

  /**
   * Вызывает `fn(csrf)` с актуальным CSRF-token.
   *
   * Retry policy:
   *   - HTTP 5xx → один повтор с 250ms backoff на том же CSRF.
   *   - HTTP 401/403 → invalidate CSRF cache + один повтор с force-refresh.
   *   - другие ошибки → throw без retry.
   */
  private async withCsrfRetry<T>(fn: (csrf: string) => Promise<T>): Promise<T> {
    const csrf = await this.getCsrf();
    try {
      return await fn(csrf);
    } catch (e) {
      const msg = (e as Error).message;
      if (/HTTP 5\d\d/.test(msg)) {
        await new Promise((r) => setTimeout(r, 250));
        return await fn(csrf);
      }
      if (!msg.includes('HTTP 401') && !msg.includes('HTTP 403')) throw e;
      this.invalidateCsrf();
      const fresh = await this.getCsrf(true);
      return fn(fresh);
    }
  }

  /** Snapshot устройств / комнат / групп / сценариев пользователя. */
  async fetchUserDevices(): Promise<YandexHomeSnapshot> {
    const [raw, scenariosRaw] = await Promise.all([
      this.withCsrfRetry((csrf) =>
        fetchJsonWithCsrf<RawUserDevicesResponse>(IOT_DEVICES_URL, csrf),
      ),
      this.fetchScenariosRaw().catch((e) => {
        log.warn(`YandexIot: scenarios fetch failed: ${(e as Error).message}`);
        return [] as RawScenario[];
      }),
    ]);
    if (raw.status && raw.status !== 'ok') {
      throw new Error(`iot.quasar status=${raw.status}: ${raw.message ?? 'unknown error'}`);
    }

    const allDevices: RawDevice[] = [];
    const allRooms: RawRoom[] = [];
    const allGroups: RawGroup[] = [];
    const allScenarios: RawScenario[] = [...scenariosRaw];
    const allHouseholds: RawHousehold[] = raw.households ?? [];

    const roomIdByDeviceId = new Map<string, string>();
    for (const h of allHouseholds) {
      if (!Array.isArray(h.rooms)) continue;
      for (const r of h.rooms) {
        for (const item of r.items ?? []) {
          if (typeof item === 'object' && item !== null && 'id' in item && 'type' in item) {
            const embedded = item as RawDevice;
            const rid = embedded.room ?? embedded.room_id ?? r.id;
            if (embedded.id && rid) roomIdByDeviceId.set(embedded.id, rid);
          }
        }
      }
    }

    for (const h of allHouseholds) {
      if (Array.isArray(h.all)) {
        for (const d of h.all) {
          const fallbackRoom = d.room ?? d.room_id ?? roomIdByDeviceId.get(d.id);
          allDevices.push({
            ...d,
            ...(fallbackRoom ? { room: fallbackRoom } : {}),
            ...(h.id ? { household_id: h.id } : {}),
          });
        }
      }
      if (Array.isArray(h.groups)) {
        for (const g of h.groups) {
          allGroups.push({ ...g, ...(h.id ? { household_id: h.id } : {}) });
        }
      }
      if (Array.isArray(h.unconfigured_devices)) {
        for (const d of h.unconfigured_devices) {
          allDevices.push({ ...d, ...(h.id ? { household_id: h.id } : {}) });
        }
      }
      if (Array.isArray(h.rooms)) {
        for (const r of h.rooms) {
          allRooms.push({ ...r, ...(h.id ? { household_id: h.id } : {}) });
          for (const item of r.items ?? []) {
            if (typeof item === 'object' && item !== null && 'id' in item && 'type' in item) {
              const embedded = item as RawDevice;
              const roomId = embedded.room ?? embedded.room_id ?? r.id;
              allDevices.push({
                ...embedded,
                room: roomId,
                ...(h.id ? { household_id: h.id } : {}),
              });
            }
          }
        }
      }
      if (Array.isArray(h.scenarios)) {
        for (const s of h.scenarios) allScenarios.push(s);
      }
    }

    if (allDevices.length === 0 && Array.isArray(raw.devices)) {
      allDevices.push(...raw.devices);
    }
    if (allRooms.length === 0 && Array.isArray(raw.rooms)) {
      allRooms.push(...raw.rooms);
    }
    if (allScenarios.length === 0 && Array.isArray(raw.scenarios)) {
      allScenarios.push(...raw.scenarios);
    }

    const seenDeviceIds = new Set<string>();
    const dedupedDevices: RawDevice[] = [];
    for (const d of allDevices) {
      if (!d.id || seenDeviceIds.has(d.id)) continue;
      seenDeviceIds.add(d.id);
      dedupedDevices.push(d);
    }

    const rooms: YandexHomeRoom[] = allRooms.map((r) => ({
      id: r.id,
      name: r.name,
      ...(r.household_id ? { householdId: r.household_id } : {}),
      devices: r.devices
        ? r.devices
        : (r.items ?? [])
            .map((it) => (typeof it === 'string' ? it : it?.id))
            .filter((x): x is string => typeof x === 'string'),
    }));
    const roomNameById = new Map(rooms.map((r) => [r.id, r.name]));

    const seenGroupIds = new Set<string>();
    const groups: YandexHomeGroup[] = [];
    for (const g of allGroups) {
      if (!g.id || seenGroupIds.has(g.id)) continue;
      seenGroupIds.add(g.id);
      const ids = (g.devices ?? g.items ?? [])
        .map((it) => (typeof it === 'string' ? it : it?.id))
        .filter((x): x is string => typeof x === 'string');
      groups.push({
        id: g.id,
        name: g.name,
        ...(g.type ? { type: g.type } : {}),
        ...(g.household_id ? { householdId: g.household_id } : {}),
        devices: ids,
        capabilities: g.capabilities ?? [],
        properties: g.properties ?? [],
      });
    }

    const devices: YandexHomeDevice[] = dedupedDevices.map((d) => {
      // roomId в большинстве ответов в `room`; в group-вложенных и
      // unconfigured_devices — `room_id`. Нормализуем.
      const roomId = d.room ?? d.room_id;
      return {
        id: d.id,
        name: d.name,
        type: d.type,
        itemType: d.item_type === 'group' ? 'group' : 'device',
        ...(roomId ? { room: roomNameById.get(roomId) ?? roomId, roomId } : {}),
        ...(d.household_id ? { householdId: d.household_id } : {}),
        ...(d.skill_id ? { skillId: d.skill_id } : {}),
        ...(d.icon_url ? { iconUrl: d.icon_url } : {}),
        ...(d.state ? { online: d.state === 'online' } : {}),
        ...(d.quasar_info?.device_id ? { quasarDeviceId: d.quasar_info.device_id } : {}),
        ...(d.quasar_info?.platform ? { quasarPlatform: d.quasar_info.platform } : {}),
        // Дедуп по (type, instance): Я.Станции отдают по 8 одинаковых
        // `devices.capabilities.quasar` с одинаковой `instance`.
        capabilities: dedupCaps(d.capabilities),
        properties: dedupProps(d.properties),
      };
    });

    // Group → виртуальное устройство с `itemType:'group'`. Driver шлёт команду
    // на /m/user/groups/{id}/actions; Yandex broadcast'ит участникам.
    for (const g of groups) {
      if (g.capabilities.length === 0) continue;
      devices.push({
        id: g.id,
        name: `Группа · ${g.name}`,
        type: g.type ?? 'devices.types.other',
        itemType: 'group',
        ...(g.householdId ? { householdId: g.householdId } : {}),
        capabilities: dedupCaps(g.capabilities),
        properties: dedupProps(g.properties),
      });
    }

    const seenScenarioIds = new Set<string>();
    const scenarios: YandexHomeScenario[] = [];
    for (const s of allScenarios) {
      if (!s.id || seenScenarioIds.has(s.id)) continue;
      seenScenarioIds.add(s.id);
      scenarios.push(mapScenario(s));
    }

    const snapshot: YandexHomeSnapshot = {
      households: allHouseholds.map((h) => ({ id: h.id, name: h.name })),
      rooms,
      groups,
      devices,
      scenarios,
      fetchedAt: new Date().toISOString(),
      ...(raw.updates_url ? { updatesUrl: raw.updates_url } : {}),
    };
    log.info(
      `YandexIot: fetched ${snapshot.devices.length} devices, ${snapshot.rooms.length} rooms, ${snapshot.groups.length} groups, ${snapshot.scenarios.length} scenarios across ${allHouseholds.length} households`,
    );
    // OK + 0 устройств → пустой аккаунт либо неизвестная схема. Логируем
    // top-level keys для диагностики.
    if (snapshot.devices.length === 0) {
      log.warn(
        `YandexIot: empty device list. Top-level keys: [${Object.keys(raw).join(', ')}]; ` +
          `households: ${allHouseholds.length}; ` +
          `first household keys: ${
            allHouseholds[0] ? `[${Object.keys(allHouseholds[0]).join(', ')}]` : '—'
          }`,
      );
    }
    return snapshot;
  }

  /**
   * Подписка на real-time push'и device-state-changes.
   * Открывает WS на `updates_url` из последнего snapshot'а, парсит сообщения
   * `update_states` и вызывает onUpdate(externalId, partialDevice).
   * Authentication — session cookies той же партиции, что у REST.
   * Возвращает disconnect-функцию.
   */
  subscribeUpdates(
    updatesUrl: string,
    onUpdate: (externalId: string, partial: RawDevice) => void,
  ): () => void {
    // Anti-MITM: cookies партиции уйдут на любой host из URL — категорически
    // отказываемся открывать non-yandex/non-wss endpoint.
    if (!isAllowedUpdatesUrl(updatesUrl)) {
      log.error(`YandexIot: refusing updates WS to non-yandex URL: ${updatesUrl}`);
      return () => undefined;
    }

    const sess = session.fromPartition(YANDEX_OAUTH_PARTITION);
    let socket: WebSocket | null = null;
    let manuallyClosed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectAttempt = 0;

    const RECONNECT_DELAYS_MS = [1_000, 3_000, 8_000, 20_000, 60_000];
    /** AlexxIT держит keepalive 60s — без него ALB рвёт idle-WS, выглядит как flake. */
    const PING_INTERVAL_MS = 60_000;

    const stopPing = (): void => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const open = (): void => {
      if (manuallyClosed) return;
      // Сброс reconnect-таймера: open() может вызваться по двум путям
      // (initial + scheduleReconnect), не должен оставаться зависший таймер.
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      // `ws` не поддерживает session cookies — собираем Cookie-header вручную
      // через session.cookies.get().
      void sess.cookies
        .get({ url: 'https://iot.quasar.yandex.ru' })
        .then((cookies) => {
          if (manuallyClosed) return;
          const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
          const ws = new WebSocket(updatesUrl, {
            headers: {
              cookie: cookieHeader,
              'user-agent': QUASAR_UA,
            },
            handshakeTimeout: 10_000,
          });
          socket = ws;

          ws.on('open', () => {
            reconnectAttempt = 0;
            log.info(`YandexIot: updates WS connected`);
            stopPing();
            pingTimer = setInterval(() => {
              if (ws.readyState !== WebSocket.OPEN) return;
              try {
                ws.ping();
              } catch (e) {
                log.debug(`YandexIot: updates WS ping failed: ${(e as Error).message}`);
              }
            }, PING_INTERVAL_MS);
          });

          ws.on('message', (raw) => {
            const text = typeof raw === 'string' ? raw : raw.toString('utf8');
            const envelope = safeJsonParse<{ operation?: string; message?: string }>(text);
            if (!envelope || envelope.operation !== 'update_states') return;
            // `message` — JSON-string внутри JSON.
            const payload = safeJsonParse<{ updated_devices?: RawDevice[] }>(
              envelope.message ?? '',
            );
            if (!payload?.updated_devices) return;
            for (const d of payload.updated_devices) {
              if (d?.id) onUpdate(d.id, d);
            }
          });

          ws.on('close', (code) => {
            socket = null;
            stopPing();
            if (manuallyClosed) return;
            log.warn(`YandexIot: updates WS closed (${code}), scheduling reconnect`);
            scheduleReconnect();
          });

          ws.on('error', (err) => {
            log.warn(`YandexIot: updates WS error: ${(err as Error).message}`);
          });
        })
        .catch((e) => {
          log.warn(`YandexIot: updates WS cookie fetch failed: ${(e as Error).message}`);
          scheduleReconnect();
        });
    };

    const scheduleReconnect = (): void => {
      if (manuallyClosed) return;
      if (reconnectTimer) return; // не плодим параллельные таймеры (close→error → дубль)
      const delay =
        RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ??
        RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1]!;
      reconnectAttempt++;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        open();
      }, delay);
    };

    open();

    return () => {
      manuallyClosed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      stopPing();
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        try {
          socket.removeAllListeners();
          socket.close();
        } catch {
          /* already closed */
        }
      }
      socket = null;
    };
  }

  /** GET /m/user/scenarios — без версионного префикса. */
  private async fetchScenariosRaw(): Promise<RawScenario[]> {
    const r = await this.withCsrfRetry((csrf) =>
      fetchJsonWithCsrf<RawScenariosResponse>(IOT_SCENARIOS_URL, csrf),
    );
    if (r.status && r.status !== 'ok') {
      throw new Error(`scenarios status=${r.status}: ${r.message ?? ''}`);
    }
    return r.scenarios ?? [];
  }

  /** Запустить сценарий — POST /m/user/scenarios/{id}/actions. */
  async runScenario(scenarioId: string): Promise<YandexIotActionResult> {
    try {
      const url = `https://iot.quasar.yandex.ru/m/user/scenarios/${encodeURIComponent(scenarioId)}/actions`;
      const raw = await this.withCsrfRetry((csrf) =>
        postJsonWithCsrf<{ status?: string; message?: string }>(url, csrf, {}),
      );
      if (raw.status && raw.status !== 'ok') {
        return {
          ok: false,
          status: raw.status,
          error: raw.message ?? 'iot.quasar отклонил запрос',
        };
      }
      return { ok: true, status: 'DONE' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Полные детали сценария — GET /m/v4/user/scenarios/{id}/edit. */
  async fetchScenarioDetails(scenarioId: string): Promise<YandexHomeScenarioDetails | null> {
    const url = `https://iot.quasar.yandex.ru/m/v4/user/scenarios/${encodeURIComponent(scenarioId)}/edit`;
    const raw = await this.withCsrfRetry((csrf) =>
      fetchJsonWithCsrf<RawScenarioEditResponse>(url, csrf),
    );
    if (raw.status && raw.status !== 'ok') {
      log.warn(`YandexIot.fetchScenarioDetails(${scenarioId}): status=${raw.status}`);
      return null;
    }
    const s = raw.scenario;
    if (!s?.id) return null;
    const base = mapScenario({
      id: s.id,
      name: s.name,
      ...(typeof s.is_active === 'boolean' ? { is_active: s.is_active } : {}),
      ...(s.icon ? { icon: s.icon } : {}),
      ...(s.icon_url ? { icon_url: s.icon_url } : {}),
      ...(s.triggers ? { triggers: s.triggers } : {}),
      ...(s.devices ? { devices: s.devices } : {}),
    });
    return {
      ...base,
      rawSteps: s.steps ?? [],
      ...(s.settings ? { rawSettings: s.settings } : {}),
      ...(s.effective_time ? { rawEffectiveTime: s.effective_time } : {}),
    };
  }

  /**
   * Переименовать сценарий — PUT /m/v4/user/scenarios/{id}.
   * Шаги/триггеры round-trip'ятся из edit-snapshot'а — endpoint требует полное
   * тело сценария.
   */
  async renameScenario(scenarioId: string, name: string): Promise<YandexIotActionResult> {
    try {
      const details = await this.fetchScenarioDetails(scenarioId);
      if (!details) return { ok: false, error: 'Не удалось загрузить сценарий' };
      const url = `https://iot.quasar.yandex.ru/m/v4/user/scenarios/${encodeURIComponent(scenarioId)}`;
      const payload: Record<string, unknown> = {
        name,
        icon: details.icon ?? '',
        triggers: details.triggers.map((t) => t.raw).filter((x) => x !== undefined),
        steps: details.rawSteps,
        ...(details.rawSettings ? { settings: details.rawSettings } : {}),
        ...(details.rawEffectiveTime ? { effective_time: details.rawEffectiveTime } : {}),
        ...(typeof details.isActive === 'boolean' ? { is_active: details.isActive } : {}),
      };
      const raw = await this.withCsrfRetry((csrf) =>
        putJsonWithCsrf<{ status?: string; message?: string }>(url, csrf, payload),
      );
      if (raw.status && raw.status !== 'ok') {
        return {
          ok: false,
          status: raw.status,
          error: raw.message ?? 'iot.quasar отклонил запрос',
        };
      }
      return { ok: true, status: 'DONE' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Удалить сценарий — DELETE /m/v4/user/scenarios/{id}. */
  async deleteScenario(scenarioId: string): Promise<YandexIotActionResult> {
    try {
      const url = `https://iot.quasar.yandex.ru/m/v4/user/scenarios/${encodeURIComponent(scenarioId)}`;
      const raw = await this.withCsrfRetry((csrf) =>
        deleteJsonWithCsrf<{ status?: string; message?: string }>(url, csrf),
      );
      if (raw.status && raw.status !== 'ok') {
        return {
          ok: false,
          status: raw.status,
          error: raw.message ?? 'iot.quasar отклонил запрос',
        };
      }
      return { ok: true, status: 'DONE' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Toggle is_active — round-trip-PUT по той же схеме, что и rename. */
  async setScenarioActive(scenarioId: string, active: boolean): Promise<YandexIotActionResult> {
    try {
      const details = await this.fetchScenarioDetails(scenarioId);
      if (!details) return { ok: false, error: 'Не удалось загрузить сценарий' };
      const url = `https://iot.quasar.yandex.ru/m/v4/user/scenarios/${encodeURIComponent(scenarioId)}`;
      const payload: Record<string, unknown> = {
        name: details.name,
        icon: details.icon ?? '',
        triggers: details.triggers.map((t) => t.raw).filter((x) => x !== undefined),
        steps: details.rawSteps,
        ...(details.rawSettings ? { settings: details.rawSettings } : {}),
        ...(details.rawEffectiveTime ? { effective_time: details.rawEffectiveTime } : {}),
        is_active: active,
      };
      const raw = await this.withCsrfRetry((csrf) =>
        putJsonWithCsrf<{ status?: string; message?: string }>(url, csrf, payload),
      );
      if (raw.status && raw.status !== 'ok') {
        return {
          ok: false,
          status: raw.status,
          error: raw.message ?? 'iot.quasar отклонил запрос',
        };
      }
      return { ok: true, status: 'DONE' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /**
   * Создать новый сценарий — POST /m/v4/user/scenarios.
   * Возвращает id созданного сценария.
   *
   * Минимальное body:
   *   { name, icon, triggers: [], steps: [...] }
   * `triggers` может быть пустым (manual-only сценарий, запускается через
   * /actions). `steps` — массив RawStep (`{type:"scenarios.steps.actions", parameters: {launch_devices: [...]}}`).
   */
  async createScenario(input: {
    name: string;
    icon?: string;
    triggers?: unknown[];
    steps: unknown[];
    settings?: Record<string, unknown>;
    isActive?: boolean;
  }): Promise<{ ok: boolean; scenarioId?: string; error?: string }> {
    try {
      const url = 'https://iot.quasar.yandex.ru/m/v4/user/scenarios';
      const payload: Record<string, unknown> = {
        name: input.name,
        icon: input.icon ?? '',
        triggers: input.triggers ?? [],
        steps: input.steps,
        ...(input.settings ? { settings: input.settings } : {}),
        ...(typeof input.isActive === 'boolean' ? { is_active: input.isActive } : {}),
      };
      const raw = await this.withCsrfRetry((csrf) =>
        postJsonWithCsrf<{ status?: string; message?: string; scenario_id?: string }>(
          url,
          csrf,
          payload,
        ),
      );
      if (raw.status && raw.status !== 'ok') {
        return { ok: false, error: raw.message ?? 'iot.quasar отклонил создание сценария' };
      }
      return { ok: true, ...(raw.scenario_id ? { scenarioId: raw.scenario_id } : {}) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /**
   * Переименовать устройство/группу — POST /m/v3/user/devices/{id}/configuration/quasar.
   *
   * Endpoint специально для name + room rebind. Принимает body
   *   { name, room: <roomId>|"" }
   * Возвращает 200 + { status: 'ok' } если сохранилось.
   */
  async renameDevice(
    itemType: 'device' | 'group',
    deviceId: string,
    name: string,
    roomId?: string,
  ): Promise<YandexIotActionResult> {
    try {
      const collection = itemType === 'group' ? 'groups' : 'devices';
      const url = `https://iot.quasar.yandex.ru/m/v3/user/${collection}/${encodeURIComponent(deviceId)}/configuration/quasar`;
      const payload = {
        name,
        ...(roomId !== undefined ? { room: roomId } : {}),
      };
      const raw = await this.withCsrfRetry((csrf) =>
        postJsonWithCsrf<{ status?: string; message?: string }>(url, csrf, payload),
      );
      if (raw.status && raw.status !== 'ok') {
        return { ok: false, status: raw.status, error: raw.message ?? 'rename отклонён' };
      }
      return { ok: true, status: 'DONE' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /**
   * Configuration устройства — GET /m/user/devices/{id}/configuration.
   * Содержит effects (lighting scenes), schedules, sensor settings — поля,
   * которые не приходят в обычном snapshot'е.
   */
  async fetchDeviceConfiguration(deviceId: string): Promise<{
    effects?: Array<{ id: string; name: string }>;
    schedules?: unknown[];
    raw?: Record<string, unknown>;
  } | null> {
    try {
      const url = `https://iot.quasar.yandex.ru/m/user/devices/${encodeURIComponent(deviceId)}/configuration`;
      const raw = await this.withCsrfRetry((csrf) =>
        fetchJsonWithCsrf<{
          status?: string;
          configuration?: {
            effects?: Array<{ id: string; name: string }>;
            schedules?: unknown[];
          };
        }>(url, csrf),
      );
      if (raw.status && raw.status !== 'ok') return null;
      const cfg = raw.configuration ?? {};
      return {
        ...(cfg.effects ? { effects: cfg.effects } : {}),
        ...(cfg.schedules ? { schedules: cfg.schedules } : {}),
        raw: cfg as Record<string, unknown>,
      };
    } catch (e) {
      log.warn(`YandexIot.fetchDeviceConfiguration(${deviceId}): ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Свежие capabilities/properties одного устройства/группы.
   * GET /m/user/{itemType}s/{id} (без /v3-префикса).
   */
  async fetchDeviceById(
    itemType: 'device' | 'group',
    deviceId: string,
  ): Promise<YandexHomeDevice | null> {
    const itemPath = `${encodeURIComponent(itemType)}s`;
    const url = `https://iot.quasar.yandex.ru/m/user/${itemPath}/${encodeURIComponent(deviceId)}`;
    const raw = await this.withCsrfRetry((csrf) =>
      fetchJsonWithCsrf<RawSingleDeviceResponse>(url, csrf),
    );
    if (raw.status && raw.status !== 'ok') {
      // Устройство отсутствует в «Доме с Алисой» — driver пометит unreachable.
      log.warn(`YandexIot.fetchDeviceById(${itemType}/${deviceId}): status=${raw.status}`);
      return null;
    }
    if (!raw.id) return null;
    return {
      id: raw.id,
      name: raw.name,
      type: raw.type,
      itemType: raw.item_type === 'group' ? 'group' : itemType,
      ...(raw.room ? { room: raw.room, roomId: raw.room } : {}),
      ...(raw.household_id ? { householdId: raw.household_id } : {}),
      ...(raw.skill_id ? { skillId: raw.skill_id } : {}),
      ...(raw.icon_url ? { iconUrl: raw.icon_url } : {}),
      ...(raw.state ? { online: raw.state === 'online' } : {}),
      ...(raw.quasar_info?.device_id ? { quasarDeviceId: raw.quasar_info.device_id } : {}),
      ...(raw.quasar_info?.platform ? { quasarPlatform: raw.quasar_info.platform } : {}),
      capabilities: raw.capabilities ?? [],
      properties: raw.properties ?? [],
    };
  }

  /**
   * Выполнить одну capability-action.
   *
   *   1) `color_setting` + instance ∈ {rgb, hsv, temperature_k} →
   *        POST /m/v3/user/custom/group/color/apply
   *        Body: {"device_ids":[<id>], "<instance>": <value>}
   *      Color/CCT для cloud-ламп идёт только через `/color/apply`; обычный
   *      `/actions` отдаёт HTTP 400.
   *
   *   2) Остальные actions (on_off, range/brightness, toggle, mode,
   *      color_setting/scene-id, …) →
   *        POST /m/user/{item_type}s/{device_id}/actions
   *        Body: {"actions":[{"type":"<cap>","state":{"instance":"<i>","value":<v>}}]}
   *      `item_type` читается литерально из snapshot'а.
   */
  async executeAction(input: {
    /** `"device"` для обычных устройств, `"group"` для групп — определяет URL. */
    itemType: 'device' | 'group';
    deviceId: string;
    capability: string;
    instance: string;
    value: unknown;
  }): Promise<YandexIotActionResult> {
    if (
      input.capability === 'devices.capabilities.color_setting' &&
      (input.instance === 'rgb' || input.instance === 'hsv' || input.instance === 'temperature_k')
    ) {
      return this.applyColorAction(input.itemType, input.deviceId, input.instance, input.value);
    }

    const collection = input.itemType === 'group' ? 'groups' : 'devices';
    const url = `https://iot.quasar.yandex.ru/m/user/${collection}/${encodeURIComponent(input.deviceId)}/actions`;
    const payload = {
      actions: [
        { type: input.capability, state: { instance: input.instance, value: input.value } },
      ],
    };

    let raw: RawActionResponse;
    try {
      raw = await this.withCsrfRetry((csrf) =>
        postJsonWithCsrf<RawActionResponse>(url, csrf, payload),
      );
    } catch (e) {
      log.warn(
        `YandexIot.executeAction HTTP error: url=${url} ` +
          `body=${JSON.stringify(payload)} → ${(e as Error).message}`,
      );
      throw e;
    }

    if (raw.status && raw.status !== 'ok') {
      log.warn(
        `YandexIot.executeAction declined: ${input.capability}/${input.instance} → ` +
          `${raw.status} ${raw.message ?? ''}`,
      );
      return { ok: false, status: raw.status, error: raw.message ?? 'iot.quasar отклонил запрос' };
    }

    // Per-action status: новые версии кладут в `devices[0].actions_results[]`,
    // legacy — в `devices[0].capabilities[0].state.action_result`. Парсим оба.
    const dev = raw.devices?.[0];
    const ar = dev?.actions_results?.[0];
    const cap = dev?.capabilities?.[0];
    const status = ar?.action_result?.status ?? ar?.status ?? cap?.state?.action_result?.status;
    const errMsg = ar?.action_result?.error_message ?? cap?.state?.action_result?.error_message;

    if (!status || status === 'DONE') {
      return { ok: true, ...(status ? { status } : {}) };
    }

    log.warn(
      `YandexIot.executeAction per-action error: ${input.capability}/${input.instance} → ` +
        `status=${status} ${errMsg ?? ''}`,
    );
    return { ok: false, status, ...(errMsg ? { error: errMsg } : {}) };
  }

  /**
   * `POST /m/v3/user/custom/group/color/apply` — endpoint color/CCT для
   * cloud-ламп.
   *
   *   body: {"device_ids":[<id>], "hsv": {h,s,v}}       — color
   *      OR {"device_ids":[<id>], "temperature_k": <K>} — CCT
   *
   * `instance:'rgb'` конвертируется в hsv (ключ `rgb` endpoint не принимает).
   * `device_ids` — broadcast-массив, любой размер.
   */
  private async applyColorAction(
    _itemType: 'device' | 'group',
    deviceId: string,
    instance: 'rgb' | 'hsv' | 'temperature_k',
    value: unknown,
  ): Promise<YandexIotActionResult> {
    const url = 'https://iot.quasar.yandex.ru/m/v3/user/custom/group/color/apply';

    let body: Record<string, unknown>;
    if (instance === 'temperature_k') {
      body = { device_ids: [deviceId], temperature_k: value };
    } else if (instance === 'rgb' && typeof value === 'number') {
      body = { device_ids: [deviceId], hsv: rgbIntToHsv(value) };
    } else if (instance === 'hsv' && value && typeof value === 'object') {
      const v = value as {
        h?: number;
        s?: number;
        v?: number;
        hue?: number;
        saturation?: number;
        value?: number;
      };
      const h = v.h ?? v.hue ?? 0;
      const s = v.s ?? v.saturation ?? 0;
      const vv = v.v ?? v.value ?? 100;
      body = { device_ids: [deviceId], hsv: { h, s, v: vv } };
    } else {
      return {
        ok: false,
        error: `applyColorAction: неподдерживаемый формат ${instance}=${JSON.stringify(value)}`,
      };
    }

    let raw: { status?: string; message?: string };
    try {
      raw = await this.withCsrfRetry((csrf) =>
        postJsonWithCsrf<{ status?: string; message?: string }>(url, csrf, body),
      );
    } catch (e) {
      log.warn(
        `YandexIot.applyColorAction HTTP error: body=${JSON.stringify(body)} → ${(e as Error).message}`,
      );
      throw e;
    }

    if (raw.status && raw.status !== 'ok') {
      log.warn(
        `YandexIot.applyColorAction declined: body=${JSON.stringify(body)} → ` +
          `${raw.status} ${raw.message ?? ''}`,
      );
      return { ok: false, status: raw.status, error: raw.message ?? 'iot.quasar отклонил цвет' };
    }
    return { ok: true, status: 'DONE' };
  }
}

/** RGB-integer (0xRRGGBB) → {h:0..360, s:0..100, v:0..100}. */
function rgbIntToHsv(rgb: number): { h: number; s: number; v: number } {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = Math.round((h * 60 + 360) % 360);
  const s = max === 0 ? 0 : Math.round((d / max) * 100);
  const v = Math.round(max * 100);
  return { h, s, v };
}

/** Ключ для дедупа capability — type + instance (или 'default' если instance нет). */
function capKey(c: Pick<YandexHomeCapability, 'type' | 'parameters' | 'state'>): string {
  const inst =
    (c.parameters as { instance?: string } | undefined)?.instance ??
    (c.state as { instance?: string } | null | undefined)?.instance ??
    'default';
  return `${c.type}::${inst}`;
}

function dedupCaps(caps: YandexHomeCapability[] | undefined): YandexHomeCapability[] {
  if (!Array.isArray(caps) || caps.length === 0) return [];
  const seen = new Set<string>();
  const out: YandexHomeCapability[] = [];
  for (const c of caps) {
    const key = capKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function dedupProps(props: YandexHomeProperty[] | undefined): YandexHomeProperty[] {
  if (!Array.isArray(props) || props.length === 0) return [];
  const seen = new Set<string>();
  const out: YandexHomeProperty[] = [];
  for (const p of props) {
    const key = capKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
