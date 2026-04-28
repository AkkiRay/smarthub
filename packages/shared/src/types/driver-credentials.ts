/**
 * @fileoverview Per-driver credentials schema — единая точка истины для всех
 * driver'ов, требующих ввода учётных данных.
 *
 * Архитектурные инварианты:
 *   1. {@link DriverModule.create} принимает `settings` и вызывает
 *      `settings.getDriverCredentials<'tuya'>('tuya')` — получает строго
 *      типизированный {@link TuyaCredentials}.
 *   2. {@link IpcApi.drivers.setCredentials}/`getCredentials` параметризованы
 *      `DriverId` — compile-time проверка соответствия creds-типа драйверу.
 *   3. Driver'ы без формы credentials (mock, yeelight, lifx, wiz, shelly,
 *      generic-http, wemo, yandex-station) маппятся на `Record<string, never>` —
 *      это пустой объект, типы не позволяют передать туда поля.
 *
 * Хранение: `electron-store` с шифрованием через `safeStorage` (DPAPI на
 * Windows, Keychain на macOS, libsecret на Linux). См.
 * `electron/core/storage/settings-store.ts`.
 */

import type { DriverId } from './device.js';

// ---- Cloud REST API ----------------------------------------------------------

export interface TuyaCredentials {
  apiKey: string;
  apiSecret: string;
  uid?: string;
  region?: string;
}

export interface MqttCredentials {
  url: string;
  username?: string;
  password?: string;
  /** Для подписки за пределами zigbee2mqtt/* (Tasmota, ESPHome, ...). */
  extraTopicPrefix?: string;
}

export interface HueCredentials {
  /** JSON-строка массива bridges. После «Найти мост» UI её сам обновляет. */
  bridges: string;
}

export interface MiioCredentials {
  /** JSON-строка массива {did, token, model?, name?, ip?}. */
  devices: string;
}

export interface DirigeraCredentials {
  host: string;
  accessToken: string;
}

export interface TplinkTapoCredentials {
  email: string;
  password: string;
  /** Comma-separated IP-list — Tapo не отвечает на UDP-broadcast. */
  hosts?: string;
}

export interface EWeLinkCredentials {
  email: string;
  password: string;
  appId: string;
  appSecret: string;
  region: 'eu' | 'us' | 'cn' | 'as';
}

export interface GoveeCredentials {
  apiKey: string;
}

export interface SwitchBotCredentials {
  token: string;
  secret: string;
}

export interface MihomeCloudCredentials {
  /** Optional: legacy password-flow для аккаунтов БЕЗ 2FA. */
  username?: string;
  password?: string;
  /**
   * Pre-fetched session из embedded BrowserWindow OAuth.
   * Заполняется через `drivers.signInOauth('mihome-cloud', { region })`.
   * Когда session есть — driver использует её и password не нужен.
   */
  session?: {
    userId: string;
    ssecurity: string;
    serviceToken: string;
  };
  /** Mi Cloud region: cn, de, i2, ru, sg, us. */
  region?: string;
}

export interface AqaraCloudCredentials {
  appId: string;
  appKey: string;
  keyId: string;
  accessToken: string;
  refreshToken?: string;
  region?: 'cn' | 'usa' | 'eu' | 'sg' | 'kr' | 'ru';
}

export interface SberHomeCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface SaluteHomeCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface RubetekCredentials {
  email: string;
  password: string;
}

export interface TplinkCloudCredentials {
  email: string;
  password: string;
  /** Term ID — обновляется автоматически после login. */
  termId?: string;
  token?: string;
}

export interface LifxCloudCredentials {
  /** Personal access token из cloud.lifx.com/settings. */
  apiKey: string;
}

export interface HomeAssistantCredentials {
  /** http(s)://host:port. */
  url: string;
  /** Long-lived access token. */
  accessToken: string;
}

export interface ZWaveJsCredentials {
  /** ws://host:3000 → zwave-js-server. */
  url: string;
}

export interface HomekitCredentials {
  /** 8-значный setup-code, форма `XXX-XX-XXX`. */
  setupCode?: string;
}

export interface MatterCredentials {
  /** 11-значный manual pairing code или payload из QR. */
  setupCode?: string;
}

// ---- Карта DriverId → Credentials -------------------------------------------

/**
 * Per-driver creds типизация. Драйверы без формы (mock, yeelight, lifx, wiz, shelly,
 * generic-http, wemo, yandex-station) маппятся на `Record<string, never>`.
 */
export interface DriverCredentialsMap {
  // LAN — без creds
  yeelight: Record<string, never>;
  shelly: Record<string, never>;
  wiz: Record<string, never>;
  lifx: Record<string, never>;
  wemo: Record<string, never>;
  // LAN — с creds
  hue: HueCredentials;
  'tplink-kasa': Record<string, never>;
  'tplink-tapo': TplinkTapoCredentials;
  miio: MiioCredentials;
  dirigera: DirigeraCredentials;
  // Protocol bridges
  mqtt: MqttCredentials;
  homekit: HomekitCredentials;
  matter: MatterCredentials;
  'home-assistant': HomeAssistantCredentials;
  zwavejs: ZWaveJsCredentials;
  // Cloud РФ
  'sber-home': SberHomeCredentials;
  'salute-home': SaluteHomeCredentials;
  rubetek: RubetekCredentials;
  // Cloud глобал
  tuya: TuyaCredentials;
  ewelink: EWeLinkCredentials;
  govee: GoveeCredentials;
  switchbot: SwitchBotCredentials;
  'mihome-cloud': MihomeCloudCredentials;
  'aqara-cloud': AqaraCloudCredentials;
  'tplink-cloud': TplinkCloudCredentials;
  'lifx-cloud': LifxCloudCredentials;
  // Misc
  'generic-http': Record<string, never>;
  mock: Record<string, never>;
  'yandex-station': Record<string, never>;
}

/** Утилита: достать тип creds по DriverId. */
export type DriverCredentials<D extends DriverId> = D extends keyof DriverCredentialsMap
  ? DriverCredentialsMap[D]
  : Record<string, unknown>;

/** Универсальный тип для callers, не знающих конкретный driver на compile-time. */
export type AnyDriverCredentials = DriverCredentialsMap[keyof DriverCredentialsMap];
