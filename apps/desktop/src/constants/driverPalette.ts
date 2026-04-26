// Single source of truth для driver-визуала. Hex-зеркало brand-токенов для inline-styles
// (где CSS var() нельзя). При смене палитры синхронизировать с _tokens.scss и shared/constants/colors.ts.

import type { DriverId } from '@smarthome/shared';
import { BRAND_HEX } from '@smarthome/shared';

export interface DriverPaletteEntry {
  label: string;
  /** Зеркало одного из --color-brand-* токенов. */
  accent: string;
  /** Подсказка для pairing-флоу. */
  pairingTip: string;
  /** Текст error-state. */
  errorHint: string;
}

const FALLBACK: DriverPaletteEntry = {
  label: 'Интеграция',
  accent: BRAND_HEX.purpleSoft,
  pairingTip: 'Описание для этой интеграции пока не задано.',
  errorHint: 'Проверьте логи хаба и доступ к устройству.',
};

const ENTRIES: Partial<Record<DriverId, DriverPaletteEntry>> = {
  yeelight: {
    label: 'Yeelight',
    accent: BRAND_HEX.amber,
    pairingTip:
      'В приложении Yeelight убедитесь, что включён режим LAN Control — без него хаб не сможет управлять лампой.',
    errorHint:
      'Чаще всего ошибка означает, что LAN Control выключен или порт 55443 закрыт фаерволом.',
  },
  shelly: {
    label: 'Shelly',
    accent: BRAND_HEX.cyan,
    pairingTip: 'Подключение прямое по локальной сети — хаб использует HTTP RPC API устройства.',
    errorHint: 'Проверьте, что устройство в той же подсети и его IP не сменился.',
  },
  hue: {
    label: 'Philips Hue',
    accent: BRAND_HEX.amber,
    pairingTip: 'Нажмите центральную кнопку на мосту Hue в течение 30 секунд после старта pairing.',
    errorHint:
      'Если получили "link button not pressed" — попробуйте ещё раз сразу после нажатия кнопки.',
  },
  lifx: {
    label: 'LIFX',
    accent: BRAND_HEX.orange,
    pairingTip: 'LIFX отвечает на UDP-broadcast — лампа должна быть в той же VLAN.',
    errorHint: 'Mesh- и Bridge-VLAN могут блокировать UDP 56700. Проверьте сетевую изоляцию.',
  },
  wiz: {
    label: 'WiZ',
    accent: BRAND_HEX.amber,
    pairingTip: 'WiZ-лампы отвечают на UDP-broadcast 38899. Хаб найдёт их сам в локальной сети.',
    errorHint: 'Если лампа не находится — переподключите её в WiZ App и проверьте Wi-Fi.',
  },
  'tplink-kasa': {
    label: 'TP-Link Kasa',
    accent: BRAND_HEX.mint,
    pairingTip: 'Для Kasa нужно открыть TCP 9999. Hub шлёт XOR-обфусцированные команды.',
    errorHint: 'На новых прошивках возможно потребуется TP-Link Cloud вместо локального.',
  },
  'tplink-tapo': {
    label: 'TP-Link Tapo',
    accent: BRAND_HEX.blue,
    pairingTip: 'Tapo требует TP-Link ID. Hub использует secure-passthrough или KLAP-handshake.',
    errorHint: 'Старые прошивки используют SP, новые — KLAP. Если не работает — обновите прошивку.',
  },
  miio: {
    label: 'Mi Home (Local)',
    accent: BRAND_HEX.orange,
    pairingTip: 'Извлеките device token (32 hex) через Xiaomi-cloud-tokens-extractor или Mi Home.',
    errorHint: 'Если token устарел — пересохраните устройство в Mi Home App.',
  },
  dirigera: {
    label: 'IKEA DIRIGERA',
    accent: BRAND_HEX.blue,
    pairingTip: 'PKCE-pairing: нажмите кнопку на DIRIGERA в течение 30 секунд после запроса.',
    errorHint: 'Проверьте, что хаб и DIRIGERA в одной подсети.',
  },
  wemo: {
    label: 'Belkin WeMo',
    accent: BRAND_HEX.cyan,
    pairingTip: 'WeMo использует SSDP — хаб найдёт устройство сам, если оно в той же подсети.',
    errorHint: 'Старые прошивки WeMo (<2.0) могут не отвечать — обновите устройство.',
  },
  tuya: {
    label: 'Tuya Cloud',
    accent: BRAND_HEX.coral,
    pairingTip:
      'Tuya работает через облако — для управления нужен интернет на хабе. Креды настраиваются на странице настроек.',
    errorHint: 'Проверьте API-ключ, регион и подпись запроса в настройках Tuya.',
  },
  ewelink: {
    label: 'eWeLink (Sonoff)',
    accent: BRAND_HEX.cyan,
    pairingTip: 'Введите email/пароль eWeLink + appId/appSecret разработчика.',
    errorHint: 'Регион должен совпадать с регистрацией аккаунта (eu/us/cn/as).',
  },
  govee: {
    label: 'Govee',
    accent: BRAND_HEX.pink,
    pairingTip: 'Получите API-ключ в Govee Home App → Профиль → "Apply for API Key".',
    errorHint: 'Лимит API: 60 запросов/мин — не делайте слишком частый polling.',
  },
  switchbot: {
    label: 'SwitchBot',
    accent: BRAND_HEX.cyan,
    pairingTip: 'Token + Secret из SwitchBot App → Профиль → "Developer Options".',
    errorHint: 'Hub Mini обязателен для cloud-API устройств.',
  },
  'mihome-cloud': {
    label: 'Mi Home Cloud',
    accent: BRAND_HEX.orange,
    pairingTip: 'Логин Xiaomi ID. Регион (cn/de/i2/ru/sg/us) определяет endpoint API.',
    errorHint: 'Если устройств не видно — проверьте регион и пересохраните в Mi Home.',
  },
  'aqara-cloud': {
    label: 'Aqara Cloud',
    accent: BRAND_HEX.cyan,
    pairingTip: 'OAuth: appId + keyId + appKey + access/refresh token.',
    errorHint: 'Срок жизни access token ограничен — refresh token обновляется автоматически.',
  },
  'sber-home': {
    label: 'SberHome',
    accent: BRAND_HEX.success,
    pairingTip: 'OAuth через Сбер ID. Hub получит token автоматически после авторизации.',
    errorHint: 'Если устройств не видно — добавьте их в SmartHome SberDevices сначала.',
  },
  'salute-home': {
    label: 'SaluteHome',
    accent: BRAND_HEX.violet,
    pairingTip: 'OAuth через Сбер ID — Salute и SberHome используют один аккаунт.',
    errorHint: 'Token и SberHome обычно делятся — если один работает, другой тоже.',
  },
  mqtt: {
    label: 'MQTT / Zigbee2MQTT',
    accent: BRAND_HEX.purple,
    pairingTip: 'Хаб слушает retained-топики Zigbee2MQTT. Команды публикуются в `<topic>/set`.',
    errorHint: 'Проверьте URL брокера и креды на странице настроек драйвера MQTT.',
  },
  homekit: {
    label: 'HomeKit',
    accent: BRAND_HEX.cyan,
    pairingTip: 'Введите 8-значный setup-код с устройства HomeKit.',
    errorHint: 'Если устройство уже сопряжено с iOS-домом — выполните Reset перед pairing.',
  },
  matter: {
    label: 'Matter / Thread',
    accent: BRAND_HEX.mint,
    pairingTip: 'Сканируйте Matter QR-код или введите 11-значный setup-код.',
    errorHint: 'Для Thread-устройств нужен Border Router в сети.',
  },
  'generic-http': {
    label: 'Generic HTTP',
    accent: BRAND_HEX.mint,
    pairingTip: 'Кастомный HTTP-эндпоинт. URL onUrl/offUrl задаются в meta устройства.',
    errorHint: 'Проверьте, что URL endpoint`ов отвечают на запросы хаба.',
  },
  mock: {
    label: 'Mock-симулятор',
    accent: BRAND_HEX.purple,
    pairingTip:
      'Виртуальные устройства для отладки UI без железа. Включается переменной HUB_ENABLE_MOCK=true.',
    errorHint: 'Mock-driver не должен падать — если упало, это баг в самом приложении.',
  },
  'yandex-station': {
    label: 'Яндекс.Станция',
    accent: BRAND_HEX.pink,
    pairingTip: 'Колонка добавляется через раздел «Алиса», а не отсюда.',
    errorHint: 'Используйте раздел «Алиса» для подключения колонки.',
  },
};

export const DRIVER_PALETTE: Readonly<Record<DriverId, DriverPaletteEntry>> = new Proxy(
  ENTRIES as Record<DriverId, DriverPaletteEntry>,
  {
    get(target, prop) {
      return target[prop as DriverId] ?? FALLBACK;
    },
  },
);

export const driverEntry = (id: DriverId): DriverPaletteEntry => ENTRIES[id] ?? FALLBACK;
export const driverAccent = (id: DriverId): string => driverEntry(id).accent;
export const driverLabel = (id: DriverId): string => driverEntry(id).label;
