// Single source of truth для UI-лейблов: DriverId → human-readable, DeviceType → русское название.
// Используется одновременно в DeviceCard, DeviceDetailView, ManualDeviceFlow, Tray и т.д. —
// при добавлении нового драйвера/типа обновляется только этот файл.

import type { DriverId } from '../types/device.js';
import { DEVICE_TYPE } from './capabilities.js';

/** Краткое имя драйвера для chip'а в карточке устройства. */
export const DRIVER_SHORT_LABEL: Record<DriverId, string> = {
  // LAN
  yeelight: 'Yeelight',
  shelly: 'Shelly',
  wiz: 'WiZ',
  lifx: 'LIFX',
  hue: 'Hue',
  'tplink-kasa': 'Kasa',
  'tplink-tapo': 'Tapo',
  miio: 'Mi Home',
  wemo: 'WeMo',
  dirigera: 'DIRIGERA',
  // Protocol
  matter: 'Matter',
  homekit: 'HomeKit',
  mqtt: 'MQTT',
  'generic-http': 'HTTP',
  // Cloud РФ
  'sber-home': 'Сбер Дом',
  'salute-home': 'SaluteHome',
  rubetek: 'Rubetek',
  // Cloud глобал
  tuya: 'Tuya',
  'mihome-cloud': 'Mi Cloud',
  'aqara-cloud': 'Aqara',
  ewelink: 'eWeLink',
  govee: 'Govee',
  switchbot: 'SwitchBot',
  'tplink-cloud': 'TP-Link',
  'lifx-cloud': 'LIFX Cloud',
  // Bridges
  'home-assistant': 'Home Assistant',
  zwavejs: 'Z-Wave',
  // Прочее
  mock: 'Mock',
  'yandex-station': 'Яндекс.Станция',
  'yandex-iot': 'Дом с Алисой',
  'yandex-lamp': 'Яндекс Лампочка',
};

type DeviceTypeValue = (typeof DEVICE_TYPE)[keyof typeof DEVICE_TYPE];

/** Русское название типа устройства. */
export const DEVICE_TYPE_LABEL_RU: Record<DeviceTypeValue, string> = {
  [DEVICE_TYPE.LIGHT]: 'Лампа',
  [DEVICE_TYPE.SOCKET]: 'Розетка',
  [DEVICE_TYPE.SWITCH]: 'Выключатель',
  [DEVICE_TYPE.SENSOR]: 'Датчик',
  [DEVICE_TYPE.THERMOSTAT]: 'Термостат',
  [DEVICE_TYPE.MEDIA]: 'Медиа',
  [DEVICE_TYPE.TV]: 'Телевизор',
  [DEVICE_TYPE.TV_BOX]: 'ТВ-приставка',
  [DEVICE_TYPE.RECEIVER]: 'Ресивер',
  [DEVICE_TYPE.VACUUM]: 'Пылесос',
  [DEVICE_TYPE.HUMIDIFIER]: 'Увлажнитель',
  [DEVICE_TYPE.DEHUMIDIFIER]: 'Осушитель',
  [DEVICE_TYPE.PURIFIER]: 'Очиститель',
  [DEVICE_TYPE.KETTLE]: 'Чайник',
  [DEVICE_TYPE.COOKING]: 'Прибор',
  [DEVICE_TYPE.COFFEE_MAKER]: 'Кофеварка',
  [DEVICE_TYPE.COOKING_KETTLE]: 'Чайник',
  [DEVICE_TYPE.MULTICOOKER]: 'Мультиварка',
  [DEVICE_TYPE.OPENABLE]: 'Привод',
  [DEVICE_TYPE.CURTAIN]: 'Шторы',
  [DEVICE_TYPE.VALVE]: 'Кран',
  [DEVICE_TYPE.FAN]: 'Вентилятор',
  [DEVICE_TYPE.WASHING_MACHINE]: 'Стиральная машина',
  [DEVICE_TYPE.DISHWASHER]: 'Посудомойка',
  [DEVICE_TYPE.IRON]: 'Утюг',
  [DEVICE_TYPE.CAMERA]: 'Камера',
  [DEVICE_TYPE.LOCK]: 'Замок',
  [DEVICE_TYPE.OTHER]: 'Устройство',
};

/** SVG-иконка типа устройства (inline для DeviceCard). */
export const DEVICE_TYPE_ICON_SVG: Partial<Record<DeviceTypeValue, string>> = {
  [DEVICE_TYPE.LIGHT]:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M9 18h6M10 21h4M12 3a6 6 0 016 6c0 2.4-1.4 4.4-3 5.4V17H9v-2.6C7.4 13.4 6 11.4 6 9a6 6 0 016-6z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  [DEVICE_TYPE.SOCKET]:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.7"/><circle cx="9.5" cy="11" r="1.2" fill="currentColor"/><circle cx="14.5" cy="11" r="1.2" fill="currentColor"/><path d="M8 16h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  [DEVICE_TYPE.SWITCH]:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="9" width="18" height="6" rx="3" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="12" r="2" fill="currentColor"/></svg>',
  [DEVICE_TYPE.SENSOR]:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v8.5M12 16a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" stroke-width="1.7"/><path d="M5 18.5a8 8 0 0114 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  [DEVICE_TYPE.THERMOSTAT]:
    '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  [DEVICE_TYPE.MEDIA]:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M10 9l6 3-6 3z" fill="currentColor"/></svg>',
  [DEVICE_TYPE.TV]:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M9 21h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  [DEVICE_TYPE.VACUUM]:
    '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
  [DEVICE_TYPE.HUMIDIFIER]:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3c4 6 6 9 6 12a6 6 0 11-12 0c0-3 2-6 6-12z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  [DEVICE_TYPE.PURIFIER]:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M9 8h6M9 12h6M9 16h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  [DEVICE_TYPE.FAN]:
    '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 4c2 2 2 5 0 8M12 20c-2-2-2-5 0-8M4 12c2-2 5-2 8 0M20 12c-2 2-5 2-8 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  [DEVICE_TYPE.CURTAIN]:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M3 4h18M5 4v16M19 4v16M5 20l4-2M19 20l-4-2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  [DEVICE_TYPE.LOCK]:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" stroke-width="1.7"/></svg>',
  [DEVICE_TYPE.CAMERA]:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7"/></svg>',
};

/** Утилита: достаёт SVG для типа, fallback — switch icon. */
export function deviceIconFor(type: DeviceTypeValue): string {
  return DEVICE_TYPE_ICON_SVG[type] ?? DEVICE_TYPE_ICON_SVG[DEVICE_TYPE.SWITCH] ?? '';
}
