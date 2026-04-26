// Канонический Device — единый source of truth для renderer и main, без double DTO.
// Имена capability/property совместимы со схемой Yandex Smart Home (devices.capabilities.*)
// → команды транслируются от/к колонке Алисы напрямую.

import type { CAPABILITY, DEVICE_TYPE, PROPERTY } from '../constants/capabilities.js';

/**
 * Реально реализованные драйверы. Список валидирует конфиги, IPC и UI-фильтры.
 * Добавление нового драйвера = новая запись здесь + DriverModule + регистрация в driver-registry.
 */
export const KNOWN_DRIVER_IDS = [
  // Локальные (LAN)
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
  // Универсальные/протокольные
  'matter',
  'homekit',
  'mqtt',
  'generic-http',
  // Cloud РФ/СНГ
  'sber-home',
  'salute-home',
  'rubetek',
  // Cloud глобал
  'tuya',
  'mihome-cloud',
  'aqara-cloud',
  'ewelink',
  'govee',
  'switchbot',
  'tplink-cloud',
  'lifx-cloud',
  // Bridges
  'home-assistant',
  'zwavejs',
  // Прочее
  'mock',
  'yandex-station',
  'yandex-iot',
  // Yandex Лампочки YNDX-XXXXX (Tuya OEM, локальный UDP-broadcast 6667).
  // Detection-only: показывает их в Discovery с подсказкой что нужно
  // привязать через приложение «Дом с Алисой» — и тогда они подтянутся
  // через yandex-iot driver полноценно.
  'yandex-lamp',
] as const;

export type DriverId = (typeof KNOWN_DRIVER_IDS)[number];

/** Тип устройства (Yandex Smart Home schema). */
export type DeviceType = (typeof DEVICE_TYPE)[keyof typeof DEVICE_TYPE];

/** Capability — управляемая возможность устройства. */
export type CapabilityType = (typeof CAPABILITY)[keyof typeof CAPABILITY];

/** Property — read-only sensor reading. */
export type PropertyType = (typeof PROPERTY)[keyof typeof PROPERTY];

/** Управляемое свойство (вкл/выкл, яркость, цвет, ...). */
export interface Capability {
  type: CapabilityType;
  retrievable: boolean;
  reportable: boolean;
  parameters?: Record<string, unknown>;
  state?: {
    instance: string;
    value: unknown;
  };
}

/** Измеряемое свойство (температура, влажность, мощность). */
export interface DeviceProperty {
  type: PropertyType;
  retrievable: boolean;
  reportable: boolean;
  parameters: {
    instance: string;
    unit?: string;
  };
  state?: {
    instance: string;
    value: number | string | boolean;
  };
}

export type DeviceStatus = 'online' | 'offline' | 'unreachable' | 'pairing';

export interface Device {
  /** Внутренний UUID, выдаётся хабом при сопряжении. */
  id: string;
  /** ID, выдаваемый самим устройством или driver'ом. */
  externalId: string;
  driver: DriverId;
  type: DeviceType;
  name: string;
  description?: string;
  room?: string;
  /** Скрыто ли в основной сетке. */
  hidden: boolean;
  /** LAN: `host` либо `host:port`. */
  address: string;
  /** Driver-specific метаданные (token, model, IDs). */
  meta: Record<string, unknown>;
  status: DeviceStatus;
  capabilities: Capability[];
  properties: DeviceProperty[];
  /** ISO timestamp последнего успешного state-read'а. */
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Кандидат discovery, ещё не сопряжённый. */
export interface DiscoveredDevice {
  driver: DriverId;
  externalId: string;
  type: DeviceType;
  name: string;
  address: string;
  meta: Record<string, unknown>;
  /** ID уже сопряжённого устройства, если совпало по externalId. */
  knownDeviceId?: string;
}

export interface DeviceCommand {
  deviceId: string;
  capability: CapabilityType;
  instance: string;
  value: unknown;
}

export interface DeviceCommandResult {
  deviceId: string;
  capability: CapabilityType;
  instance: string;
  status: 'DONE' | 'ERROR';
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Откуда комната — локально создана пользователем или импортирована из «Дома с Алисой».
 * Yandex-комнаты переzаписываются при каждом sync'е, поэтому UI блокирует rename/delete
 * (изменения всё равно будут затёрты).
 */
export type RoomOrigin = 'local' | 'yandex';

export interface Room {
  id: string;
  name: string;
  icon: string;
  /** Порядок сортировки в UI. */
  order: number;
  deviceIds: string[];
  /** 'yandex' — комната синхронизируется из iot.quasar; 'local' — создана юзером. */
  origin?: RoomOrigin;
}
