/**
 * @fileoverview Контракты Alice Smart Home Skill bridge — связка
 * «хаб ↔ навык в Я.Диалогах ↔ устройства в приложении Дом с Алисой».
 *
 * Локальная колонка Я.Станция — отдельный домен (см. `yandex-station.ts`).
 * Тут — про cloud-навык: туннель, OAuth-pairing, exposure устройств/сценариев.
 *
 * Сценарий использования:
 *   1. Юзер регистрирует skill в `dialogs.yandex.ru` (получает skillId).
 *   2. Сохраняет {@link AliceSkillConfig} в хабе (id + secret + опционально dialogs token).
 *   3. Поднимает cloudflared-туннель — хаб получает публичный HTTPS-URL.
 *   4. Юзер привязывает аккаунт в Я.Доме → Алиса делает `/v1.0/user/devices`
 *      и видит экспонированные устройства/сценарии.
 *   5. Алиса присылает действия → webhook-server маршрутизирует в drivers.
 */

import type { Device } from './device.js';
import type { YandexStationStatus } from './yandex-station.js';

/** Этап мастера подключения skill — UX-state, а не серверный. */
export type AliceSkillStage =
  | 'idle' // не настроен
  | 'configured' // ID/secret введены, но туннель не запущен
  | 'tunnel-up' // публичный URL получен, ожидаем привязку аккаунта в Я.приложении
  | 'linked' // Алиса хотя бы раз дёрнула /devices с валидным bearer
  | 'error';

/** То, что юзер вводит из dialogs.yandex.ru → ему достаточно. */
export interface AliceSkillConfig {
  /** UUID навыка из dialogs.yandex.ru → раздел «Привязка аккаунтов». Используется для callback/state. */
  skillId: string;
  /** OAuth client_id, который юзер выдумал в консоли навыка. */
  oauthClientId: string;
  /** OAuth client_secret — хранится зашифрованно. */
  oauthClientSecret: string;
  /**
   * OAuth-токен Я.Диалогов для callback URL — выпускается на oauth.yandex.com
   * под client_id `c473ca268cd749d3a8371351a8f2bcbd` (обязательный для callback API).
   * Опциональный: без него skill всё равно работает, просто нет push-обновлений.
   */
  dialogsOauthToken?: string;
  /** Опциональный named-tunnel (cloudflared). Если пусто — quick-tunnel со случайным URL. */
  customDomain?: string;
}

export interface AliceTunnelStatus {
  /** Запущен ли cloudflared (или иной транспорт). */
  running: boolean;
  /** Текущий публичный HTTPS-URL. Подставляется в endpoint навыка. */
  publicUrl: string | null;
  /** Тип туннеля. */
  kind: 'cloudflared-quick' | 'cloudflared-named' | 'manual' | null;
  /** Ошибка последней попытки запуска. */
  lastError?: string;
  /** ISO timestamp последней успешной выдачи публичного URL. */
  lastUpAt?: string;
}

/** Срез последней активности skill webhook'а — для status-панели в UI. */
export interface AliceSkillActivity {
  /** ISO когда последний раз пришёл валидный bearer-запрос от Алисы. */
  lastRequestAt?: string;
  /** Кол-во запросов за последние 24ч (грубый health-индикатор). */
  requestsLast24h: number;
  /** Кол-во ошибочных action'ов за 24ч. */
  errorsLast24h: number;
  /** ISO когда последний push в callback/state ушёл успешно. */
  lastCallbackAt?: string;
}

/** Совокупный статус всей Alice-интеграции — единая правда для UI. */
export interface AliceStatus {
  /** Локальная колонка — re-export для одного хука в UI. */
  station: YandexStationStatus;
  skill: {
    stage: AliceSkillStage;
    /** true если AliceSkillConfig сохранён (даже если туннель не запущен). */
    configured: boolean;
    lastError?: string;
  };
  tunnel: AliceTunnelStatus;
  activity: AliceSkillActivity;
  /** Кол-во устройств, которые сейчас экспонированы в Алису. */
  exposedDeviceCount: number;
  /** Кол-во сценариев, экспонированных в Алису. */
  exposedSceneCount: number;
}

/** Per-device настройка экспозиции. По умолчанию — выдан с canonical именем/комнатой. */
export interface AliceDeviceExposure {
  deviceId: string;
  /** Выдавать ли это устройство Алисе. */
  enabled: boolean;
  /** Переопределение имени (Алиса любит короткие — «лампа», а не «Yeelight Color Bulb 1S»). */
  aliasName?: string;
  /** Переопределение комнаты (по-умолчанию — Device.roomId через rooms-store). */
  aliasRoom?: string;
}

/** Per-scene экспозиция: сценарий = виртуальное `devices.types.other` с on_off. */
export interface AliceSceneExposure {
  sceneId: string;
  enabled: boolean;
  aliasName?: string;
  aliasRoom?: string;
}

/** Glagol-pairing flow: новый embedded OAuth путь. */
export type GlagolPairingStage =
  | 'idle'
  | 'awaiting-passport-login'
  | 'fetching-x-token'
  | 'fetching-station-token'
  | 'success'
  | 'error';

export interface GlagolPairingState {
  stage: GlagolPairingStage;
  /** ISO timestamp обновления стадии — UI показывает «N сек назад». */
  updatedAt: string;
  /** Если на stage=fetching-station-token: для какого deviceId уже получен токен. */
  resolvedDeviceId?: string;
  /** Если stage=success: готовый набор для прямого connect(). */
  result?: {
    deviceId: string;
    token: string;
    platform?: string;
    name?: string;
    host: string;
    port: number;
  };
  error?: string;
}

/**
 * Превью того, как один Device выглядит для Алисы.
 * UI показывает в DeviceExposurePanel — юзер видит «как Алиса узнает эту лампу».
 */
export interface AliceDevicePreview {
  /** Тот же id, что хаб шлёт в /v1.0/user/devices. */
  yandexDeviceId: string;
  /** Имя как покажет Алиса. */
  name: string;
  /** Yandex schema type (devices.types.light, etc.). */
  type: string;
  /** Сводка capability instances в человекочитаемом виде. */
  capabilitiesSummary: string[];
  /** Кол-во property instances (температура, влажность, ...). */
  propertiesCount: number;
  /** Внутренний Device — для дебаг-просмотра. */
  source: Device;
}
