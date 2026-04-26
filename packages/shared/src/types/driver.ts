// Driver contract: каждый протокольный driver (Yeelight, Tuya, MQTT, ...) реализует этот интерфейс.
// Для renderer'а драйверы stateless — TCP/WebSocket/OAuth живут за API.

import type {
  DiscoveredDevice,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DriverId,
} from './device.js';

export interface DeviceDriver {
  readonly id: DriverId;
  readonly displayName: string;

  /** Active discovery cycle. ОБЯЗАН уважать AbortSignal — иначе цикл хаба зависнет на таймаутах. */
  discover(signal: AbortSignal): Promise<DiscoveredDevice[]>;

  /** Probe кандидата: reachability + capabilities. */
  probe(candidate: DiscoveredDevice): Promise<Device | null>;

  /** State-read (capabilities + properties). */
  readState(device: Device): Promise<Device>;

  /** Драйвер batch'ит внутренне если умеет. */
  execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult>;

  /**
   * Optional push-channel: драйвер может слать частичные device-state-changes
   * по мере получения событий из WS/SSE/MQTT. Listener вызывается с externalId
   * и partial-Device (только изменённые поля). Driver-registry мержит и эмитит
   * `device:updated` в общую шину. Возвращает unsubscribe.
   * Драйверы без push (LAN-poll only) этот метод не реализуют.
   */
  subscribePush?(
    listener: (externalId: string, partial: Partial<Device>) => void,
  ): () => void;

  /** Cleanup на shutdown'е приложения. */
  shutdown(): Promise<void>;
}

/** Группа драйверов в UI «Маркетплейсе интеграций». */
export type DriverCategory =
  | 'lan-russian' // российские бренды с локальным протоколом
  | 'lan-global' // зарубежные с локальным протоколом (Hue, LIFX, WiZ)
  | 'cloud-russian' // российские облачные API (Sber, Rubetek)
  | 'cloud-global' // зарубежные облачные (Tuya, eWeLink, Govee)
  | 'protocol' // универсальные протоколы (MQTT, Matter, HomeKit)
  | 'bridge' // мосты к чужим хабам (Home Assistant, Z-Wave-JS)
  | 'misc'; // generic-http, mock, ...

/** Тип поля credentials для авто-рендера формы в UI. */
export type DriverCredentialFieldKind =
  | 'text'
  | 'password'
  | 'select'
  | 'oauth' // показывает кнопку «Войти через провайдера»
  | 'discover-host' // подсказывает кнопку «Найти на сети»
  | 'pairing-code'; // 6-8 цифр (HomeKit setup code)

export interface DriverCredentialField {
  /** Имя ключа в credentials object. */
  key: string;
  label: string;
  kind: DriverCredentialFieldKind;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  /** Только для kind='select'. */
  options?: Array<{ value: string; label: string }>;
  /** Defaults: '' / null. */
  defaultValue?: string;
}

export interface DriverDescriptor {
  id: DriverId;
  displayName: string;
  description: string;
  /** Логическая категория для группировки в UI. */
  category: DriverCategory;
  /** Регион/целевая аудитория — для UI бейджа («РФ», «Global», «РФ+СНГ»). */
  region: 'ru' | 'global' | 'ru-cis';
  /** Цвет бренда для DriverIcon (hex). */
  brandColor?: string;
  /** Slug в /assets/icons/drivers/<vendor>.svg, если отличается от id. */
  iconSlug?: string;
  /** Нужны ли user-supplied credentials до сопряжения. */
  requiresCredentials: boolean;
  /** Какие capability/property типы драйвер умеет маппить. */
  supportedTypes: string[];
  /** Зарегистрирован ли driver сейчас в registry (loaded и инициализирован). */
  active: boolean;
  /** Структура полей формы credentials для UI. */
  credentialsSchema?: DriverCredentialField[];
  /** URL документации «где взять ключи». */
  docsUrl?: string;
  /** UI-статус разработки. 'stable' — production-ready, 'beta' — работает но без тестов на реальном железе, 'planned' — descriptor есть, реализация stub. */
  maturity: 'stable' | 'beta' | 'planned';
}
