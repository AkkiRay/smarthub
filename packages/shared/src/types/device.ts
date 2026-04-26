/**
 * @fileoverview Каноническая domain-схема SmartHome — devices, capabilities,
 * rooms и command-result envelope. Это единый source of truth, который
 * импортируют:
 *
 *   - Electron main process (driver registry, device store, IPC handlers)
 *   - Vue 3 renderer (Pinia stores, components, composables)
 *   - Yandex Alice bridge (skill webhook → action mapper)
 *
 * Имена capability/property совпадают со схемой Yandex Smart Home
 * (`devices.capabilities.*`, `devices.properties.*`) — поэтому payload'ы от
 * Алисы можно проксировать в драйверы без промежуточного маппинга.
 *
 * @see {@link https://yandex.ru/dev/dialogs/smart-home/doc/concepts/device-types}
 */

import type { CAPABILITY, DEVICE_TYPE, PROPERTY } from '../constants/capabilities.js';

/**
 * Whitelist driver-идентификаторов, у которых есть реальная реализация
 * в `apps/desktop/electron/core/drivers/<id>/`.
 *
 * Используется:
 *   - валидаторами конфига (отвергают unknown driver в settings.json);
 *   - IPC-слоем (typed dispatch по driver id);
 *   - UI-фильтрами (Discovery view, integration marketplace).
 *
 * Как добавить новый driver:
 *   1. Добавить id в этот массив.
 *   2. Реализовать `DriverModule` в `electron/core/drivers/<id>/module.ts`.
 *   3. Зарегистрировать его в `driver-registry.ts` (`DRIVER_MODULES`).
 *
 * @remarks
 * Группировка ниже — чисто организационная (LAN → протоколы → cloud →
 * bridges → misc), порядок load'а определяется driver registry в runtime.
 */
export const KNOWN_DRIVER_IDS = [
  // ── Локальные LAN-драйверы (без cloud-roundtrip) ──────────────────────────
  'yeelight',
  'shelly',
  'wiz',
  'lifx',
  'hue',
  'tplink-kasa',
  'tplink-tapo',
  'miio',
  'wemo',
  'dirigera',

  // ── Универсальные протоколы ───────────────────────────────────────────────
  'matter',
  'homekit',
  'mqtt',
  'generic-http',

  // ── Cloud РФ/СНГ ──────────────────────────────────────────────────────────
  'sber-home',
  'salute-home',
  'rubetek',

  // ── Cloud глобальные ──────────────────────────────────────────────────────
  'tuya',
  'mihome-cloud',
  'aqara-cloud',
  'ewelink',
  'govee',
  'switchbot',
  'tplink-cloud',
  'lifx-cloud',

  // ── Bridges (один driver раскрывает множество устройств) ──────────────────
  'home-assistant',
  'zwavejs',

  // ── Прочее / first-party ──────────────────────────────────────────────────
  'mock',
  'yandex-station',
  'yandex-iot',

  /**
   * Yandex-лампочки (модель `YNDX-*`, Tuya OEM прошивка, локальный UDP-broadcast
   * на порту :6667). Detection-only driver: показывает их в Discovery с
   * подсказкой что нужно привязать через приложение «Дом с Алисой» — после
   * этого они подтянутся через cloud-driver `yandex-iot` полноценно.
   *
   * TODO(yandex-lamp): когда появится локальное управление через Tuya local
   * key extraction, апгрейднуть до полного driver'а (pair + readState + execute).
   */
  'yandex-lamp',
] as const;

/** Tagged union из всех валидных driver-идентификаторов. */
export type DriverId = (typeof KNOWN_DRIVER_IDS)[number];

/**
 * Тип устройства (`devices.types.*`) по схеме Yandex Smart Home.
 *
 * Драйверы маппят свою native-таксономию на этот enum в `probe()`. Unknown /
 * unsupported типы fallback'ятся в `devices.types.other`.
 */
export type DeviceType = (typeof DEVICE_TYPE)[keyof typeof DEVICE_TYPE];

/**
 * Идентификатор управляемой capability (`devices.capabilities.*`).
 *
 * @example `devices.capabilities.on_off`, `devices.capabilities.color_setting`
 */
export type CapabilityType = (typeof CAPABILITY)[keyof typeof CAPABILITY];

/**
 * Идентификатор read-only sensor-показания (`devices.properties.*`).
 *
 * @example `devices.properties.float` (numeric), `devices.properties.event`
 */
export type PropertyType = (typeof PROPERTY)[keyof typeof PROPERTY];

/**
 * Управляемая capability — on/off, brightness, RGB color, mode selector и т.д.
 * Shape повторяет capability descriptor из Yandex Smart Home, поэтому payload
 * из renderer'а можно форвардить Алисе без преобразований.
 */
export interface Capability {
  /** Идентификатор capability — см. {@link CapabilityType}. */
  type: CapabilityType;

  /** Можно ли запрашивать текущее значение (vs. только пушить команды). */
  retrievable: boolean;

  /** Пушит ли устройство state-changes само (или нужен polling). */
  reportable: boolean;

  /**
   * Capability-specific конфигурация: например `{ split: false }` для
   * `on_off`, `{ color_model: 'rgb' }` для `color_setting`,
   * `{ unit: 'celsius', range: { min, max, precision } }` для `range`.
   */
  parameters?: Record<string, unknown>;

  /**
   * Last-known state. `instance` выбирает sub-capability к которой относится
   * value (например `'rgb'` vs `'temperature_k'` для color_setting).
   */
  state?: {
    instance: string;
    value: unknown;
  };
}

/**
 * Read-only sensor-property — температура, влажность, потребление и т.д.
 * Свойства не управляемы; команды отправляются только на capability.
 */
export interface DeviceProperty {
  /** Идентификатор property — см. {@link PropertyType}. */
  type: PropertyType;

  /** Можно ли читать `state` по запросу. */
  retrievable: boolean;

  /** Пушит ли устройство state-changes. */
  reportable: boolean;

  /** Обязательные метаданные; `instance` нужен для display unit'а в UI. */
  parameters: {
    /** Имя sub-property: `'temperature'`, `'humidity'`, … */
    instance: string;
    /** Display unit: `'celsius'`, `'percent'`, `'watt'`. */
    unit?: string;
  };

  /** Last-known reading. */
  state?: {
    instance: string;
    value: number | string | boolean;
  };
}

/**
 * Lifecycle-статус сопряжённого устройства.
 *
 * - `online`      — последний `readState()` прошёл успешно.
 * - `offline`     — устройство явно ответило что выключено (например cloud
 *                   `online: false`).
 * - `unreachable` — последний `readState()` бросил исключение (network,
 *                   auth, gone-from-cloud). Polling продолжается с 4× reduced
 *                   cadence чтобы не флудить LAN.
 * - `pairing`     — сейчас добавляется; ещё не виден в основном UI.
 */
export type DeviceStatus = 'online' | 'offline' | 'unreachable' | 'pairing';

/**
 * Сопряжённое устройство, persist'ится в `hub.sqlite` и рендерится в UI.
 *
 * Lifecycle: `DiscoveredDevice` → `probe()` → `Device` (saved) → updates от
 * polling-сервиса / push-subscription / explicit user-actions.
 */
export interface Device {
  /** Внутренний UUID, выдаётся хабом при первом pair'е. Стабильный на весь lifetime. */
  id: string;

  /** Идентификатор который выдало само устройство или driver — cloud GUID, MAC, serial. */
  externalId: string;

  /** Driver, который владеет устройством — см. {@link DriverId}. */
  driver: DriverId;

  /** Тип (свет, термостат, сенсор, …) — см. {@link DeviceType}. */
  type: DeviceType;

  /** Human-readable имя. Изначально ставит driver, юзер может переименовать. */
  name: string;

  /** Опциональное free-text описание (пока не используется в UI). */
  description?: string;

  /** ID комнаты к которой устройство привязано. Empty/undefined = unassigned. */
  room?: string;

  /** При `true` — скрыто из основной сетки (но остаётся в IPC-выдаче). */
  hidden: boolean;

  /**
   * LAN-адрес (`host` либо `host:port`) для local-драйверов, либо
   * synthetic scheme-маркер вроде `yandex://iot` для cloud-only устройств.
   */
  address: string;

  /**
   * Driver-specific метаданные: токены, model, internal id'ы, raw payload
   * snapshot'ы. Renderer должен трактовать как opaque blob.
   */
  meta: Record<string, unknown>;

  /** Текущий lifecycle-статус — см. {@link DeviceStatus}. */
  status: DeviceStatus;

  /** Управляемые capability — см. {@link Capability}. */
  capabilities: Capability[];

  /** Read-only sensor-показания — см. {@link DeviceProperty}. */
  properties: DeviceProperty[];

  /** ISO 8601 timestamp последнего успешного `readState()`. */
  lastSeenAt?: string;

  /** ISO 8601 момент создания. */
  createdAt: string;

  /** ISO 8601 timestamp последнего изменения. */
  updatedAt: string;
}

/**
 * Discovery-кандидат — найден `driver.discover()`, но ещё не сопряжён.
 *
 * Превращается в {@link Device} после `driver.probe()` (валидирует
 * capabilities) и подтверждения юзером в Discovery view.
 */
export interface DiscoveredDevice {
  driver: DriverId;
  externalId: string;
  type: DeviceType;
  name: string;
  address: string;
  meta: Record<string, unknown>;

  /**
   * Если задан — кандидат соответствует уже сопряжённому устройству.
   * UI рендерит «Already added» вместо кнопки Pair.
   */
  knownDeviceId?: string;
}

/**
 * Команда от пользователя: renderer → IPC → driver registry → driver.execute().
 *
 * @example
 * ```ts
 * const cmd: DeviceCommand = {
 *   deviceId: 'abc-123',
 *   capability: 'devices.capabilities.on_off',
 *   instance: 'on',
 *   value: true,
 * };
 * ```
 */
export interface DeviceCommand {
  /** Внутренний device id (НЕ externalId). */
  deviceId: string;
  /** Capability на которую действуем. */
  capability: CapabilityType;
  /** Sub-capability (`'on'`, `'rgb'`, `'temperature_k'`, …). */
  instance: string;
  /** Новое значение. Тип зависит от пары `capability` + `instance`. */
  value: unknown;
}

/**
 * Результат `driver.execute()`. Передаётся обратно через IPC в renderer.
 *
 * - `status: 'DONE'`  — driver применил команду; UI показывает success-toast.
 * - `status: 'ERROR'` — failure; `errorCode` machine-readable, `errorMessage`
 *                       human-readable. UI решает retry/blacklist по
 *                       `errorCode` (transient `YANDEX_HTTP_ERROR` ретраит,
 *                       логические rejects блек-листит).
 */
export interface DeviceCommandResult {
  deviceId: string;
  capability: CapabilityType;
  instance: string;
  status: 'DONE' | 'ERROR';
  /** Driver-defined error category, например `'YANDEX_HTTP_ERROR'`, `'TIMEOUT'`. */
  errorCode?: string;
  /** Локализованное сообщение, безопасное для показа пользователю. */
  errorMessage?: string;
}

/**
 * Происхождение {@link Room}.
 *
 * - `local`  — создана юзером прямо в хабе.
 * - `yandex` — импортирована из аккаунта «Дом с Алисой»; перезаписывается
 *              на каждом sync'е. UI блокирует rename/delete потому что
 *              изменения всё равно будут затёрты на следующем sync'е.
 */
export type RoomOrigin = 'local' | 'yandex';

/**
 * Комната группирует устройства для bulk-операций (выключить всё, поставить
 * scene-цвет) и для фильтрации в UI.
 */
export interface Room {
  /** Внутренний UUID. */
  id: string;
  /** Display name. */
  name: string;
  /** Ключ иконки (резолвится renderer'ом через icon-registry). */
  icon: string;
  /** Позиция сортировки в UI; меньше = раньше. */
  order: number;
  /** Устройства в этой комнате (значения `Device.id`). */
  deviceIds: string[];
  /** Откуда комната: импорт из cloud или локально создана. */
  origin?: RoomOrigin;
}
