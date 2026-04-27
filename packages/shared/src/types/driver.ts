/**
 * @fileoverview Driver-contract: каждый протокольный driver (Yeelight, Tuya,
 * MQTT, Yandex и т.д.) реализует {@link DeviceDriver}.
 *
 * Renderer воспринимает драйверы как stateless: TCP/UDP-сокеты, WebSocket'ы
 * и OAuth-flow'ы живут целиком за API в main process'е, IPC-граница пропускает
 * только typed JSON-payload'ы.
 *
 * Дополнительно тут описаны:
 *   - {@link DriverDescriptor}      — метадата для UI integration marketplace;
 *   - {@link DriverCredentialField} — schema полей credentials формы (renderer
 *                                      авто-генерит UI по этой схеме);
 *   - {@link DriverCategory}        — группировка в маркетплейсе;
 *   - {@link DriverCredentialFieldKind} — типы полей формы credentials.
 */

import type {
  DiscoveredDevice,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DriverId,
} from './device.js';

/**
 * Контракт driver'а. Реализуется наследником `BaseDriver`
 * (см. `apps/desktop/electron/core/drivers/_shared/base-driver.ts`).
 */
export interface DeviceDriver {
  /** Driver id — должен совпадать с одним из {@link DriverId}. */
  readonly id: DriverId;

  /** Локализованное имя для marketplace и логов. */
  readonly displayName: string;

  /**
   * Active discovery cycle — один проход поиска устройств.
   *
   * ОБЯЗАН уважать `AbortSignal`: иначе бесконечные таймауты заблокируют
   * следующий цикл хаба и истощат socket-pool. Имплементация должна
   * подписаться на `signal.aborted` и закрыть все pending I/O.
   *
   * @param signal - Хаб abort'ит при cancel'е discovery со стороны юзера.
   * @returns Список найденных кандидатов (могут быть дубли — registry дедуп'ит).
   */
  discover(signal: AbortSignal): Promise<DiscoveredDevice[]>;

  /**
   * Probe одного кандидата: проверка reachability + сбор полной capability-меты.
   *
   * Вызывается при подтверждении pair'а юзером. Возвращает `null` если
   * кандидат недоступен или unsupported (тогда pair-flow в UI отдаёт ошибку).
   */
  probe(candidate: DiscoveredDevice): Promise<Device | null>;

  /**
   * Прочитать актуальный state (capabilities + properties) для уже сопряжённого
   * устройства. При network failure — возвращает device со
   * `status: 'unreachable'` (НЕ throw).
   */
  readState(device: Device): Promise<Device>;

  /**
   * Применить команду. Driver сам решает, batch'ит ли он несколько capabilities
   * в один HTTP-call или шлёт отдельные запросы.
   */
  execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult>;

  /**
   * Опциональный push-channel: driver получает state-changes из своего
   * транспорта (WS, SSE, MQTT, UDP-broadcast) и нотифицирует registry.
   * Listener вызывается с `externalId` и `Partial<Device>` (только изменённые
   * поля). Registry мержит и эмитит `device:updated` в общую event-шину.
   *
   * Драйверы без push (poll-only) этот метод НЕ реализуют.
   *
   * @returns Unsubscribe-функция; вызывается при `shutdown()` registry.
   */
  subscribePush?(listener: (externalId: string, partial: Partial<Device>) => void): () => void;

  /**
   * Cleanup при shutdown'е приложения: закрыть sockets, снять timer'ы,
   * остановить watcher'ы. Вызывается с 5-секундным grace-period в
   * graceful-shutdown sequence хаба.
   */
  shutdown(): Promise<void>;
}

/**
 * Группа драйверов в UI «Маркетплейсе интеграций».
 *
 * Используется для группировки карточек в Settings → Интеграции и для
 * фильтрации в search-bar.
 */
export type DriverCategory =
  | 'lan-russian' // российские бренды с локальным протоколом
  | 'lan-global' // зарубежные с локальным протоколом (Hue, LIFX, WiZ)
  | 'cloud-russian' // российские облачные API (Sber, Rubetek)
  | 'cloud-global' // зарубежные облачные (Tuya, eWeLink, Govee)
  | 'protocol' // универсальные протоколы (MQTT, Matter, HomeKit)
  | 'bridge' // мосты к чужим хабам (Home Assistant, Z-Wave-JS)
  | 'misc'; // generic-http, mock, …

/**
 * Тип поля credentials в форме marketplace'а.
 *
 * Renderer рендерит подходящий control:
 * - `text`           — обычный input;
 * - `password`       — masked input с toggle-show;
 * - `select`         — dropdown с {@link DriverCredentialField.options};
 * - `oauth`          — кнопка «Войти через провайдера», открывает popup;
 * - `discover-host`  — input + кнопка «Найти на сети» (mDNS/SSDP scan);
 * - `pairing-code`   — 6-8 цифровое поле (HomeKit setup code);
 * - `register-link`  — deep-link tile «Открыть портал разработчика» (без input'а);
 * - `test-button`    — кнопка «Проверить подключение» (probe текущих values).
 */
export type DriverCredentialFieldKind =
  | 'text'
  | 'password'
  | 'select'
  | 'oauth'
  | 'discover-host'
  | 'pairing-code'
  | 'register-link'
  | 'test-button';

/**
 * Описание одного поля формы credentials.
 *
 * Driver декларирует массив таких полей в {@link DriverDescriptor.credentialsSchema},
 * UI рендерит форму автоматически (никакой ручной HTML на стороне renderer'а).
 */
export interface DriverCredentialField {
  /** Имя ключа в credentials object (snake_case либо camelCase — на усмотрение driver'а). */
  key: string;
  /** Лейбл, который видит юзер. */
  label: string;
  /** Тип control'а — см. {@link DriverCredentialFieldKind}. */
  kind: DriverCredentialFieldKind;
  /** Placeholder в input'е. */
  placeholder?: string;
  /** Подсказка под полем (например «Найти ключ можно в Настройки → API»). */
  hint?: string;
  /** Обязательно ли поле; по умолчанию `false`. */
  required?: boolean;
  /** Опции для `kind: 'select'`. Игнорируется для других типов. */
  options?: Array<{ value: string; label: string }>;
  /** Default-значение (обычно пустая строка либо `null`). */
  defaultValue?: string;
  /** URL для `kind: 'register-link'`. Открывается через `shell.openExternal`. */
  url?: string;
}

/**
 * Результат light-probe (`drivers.testCredentials`). Используется UI-кнопкой
 * «Проверить подключение» в credentials-форме.
 */
export interface DriverProbeResult {
  /** true → endpoint провайдера ответил ожидаемо, creds валидны. */
  ok: boolean;
  /** Краткое сообщение для тоста: либо «Найдено N устройств», либо причина ошибки. */
  message?: string;
}

/**
 * Полный descriptor driver'а — метадата для marketplace, validation,
 * и runtime registry. Driver сам экспортирует `descriptor` в `module.ts`.
 */
export interface DriverDescriptor {
  /** Driver id — соответствует папке `electron/core/drivers/<id>/`. */
  id: DriverId;
  /** Имя в marketplace. */
  displayName: string;
  /** Короткий маркетинговый текст под именем (1-2 строки). */
  description: string;
  /** Логическая категория — см. {@link DriverCategory}. */
  category: DriverCategory;
  /** Регион/аудитория — для UI-бейджа («РФ», «Global», «РФ+СНГ»). */
  region: 'ru' | 'global' | 'ru-cis';
  /** Брендовый цвет hex (для DriverIcon-композита). */
  brandColor?: string;
  /** Slug в `/assets/icons/drivers/<slug>.svg`; default = `id`. */
  iconSlug?: string;
  /** Требует ли driver user-supplied credentials до pair'а. */
  requiresCredentials: boolean;
  /** Какие `devices.types.*` driver умеет создавать. */
  supportedTypes: string[];
  /** Зарегистрирован ли сейчас в driver-registry (loaded + initialized). */
  active: boolean;
  /** Schema формы credentials — см. {@link DriverCredentialField}. */
  credentialsSchema?: DriverCredentialField[];
  /** URL документации «где взять ключи / как настроить». */
  docsUrl?: string;
  /**
   * UI-статус разработки:
   *   - `stable`   — production-ready, проверено на реальном железе.
   *   - `beta`     — реализовано, но без e2e-тестов на железе.
   *   - `planned`  — descriptor есть, реализация ещё stub.
   */
  maturity: 'stable' | 'beta' | 'planned';
}
