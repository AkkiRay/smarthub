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
  | 'tunnel-up' // cloudflared subprocess живой, но достижимость снаружи ещё не подтверждена
  | 'reachable' // публичный URL отвечает на HEAD /v1.0 — Алиса физически может постучаться
  | 'awaiting-link' // достижимы, но Алиса ещё ни разу не дёргала webhook (юзер не закончил привязку)
  | 'linked' // webhook от Алисы был ≤ 7 дней назад
  | 'linked-stale' // токен есть, но webhook'ов нет > 7 дней — привязка скорее всего отозвана
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
  /** Результат последней внешней пробы достижимости публичного URL. */
  reachability?: AliceReachabilityResult;
}

/** Snapshot последней проверки достижимости webhook'а из внешнего интернета. */
export interface AliceReachabilityResult {
  /** ISO timestamp пробы. */
  at: string;
  /** true — HEAD /v1.0 ответил 2xx; false — таймаут / 4xx / 5xx. */
  ok: boolean;
  /** HTTP-код, который вернулся. 0 если соединение не установилось. */
  status: number;
  /** Round-trip ms. */
  latencyMs: number;
  /** Человекочитаемая ошибка для UI. */
  error?: string;
}

/** Состояние управляемого хабом бинарника cloudflared. */
export type AliceCloudflaredInstall =
  | { kind: 'missing' }
  | { kind: 'managed'; path: string; sizeKb?: number }
  | {
      kind: 'downloading';
      ratio: number | null;
      bytesDone: number;
      bytesTotal: number | null;
    }
  | { kind: 'error'; error: string };

/** Информация о владельце dialogsOauthToken — анти-foot-gun для callback API. */
export interface AliceDialogsTokenOwner {
  /** display_name из login.yandex.ru/info — UI показывает «токен принадлежит Х». */
  displayName?: string;
  /** Логин аккаунта (login). */
  login?: string;
  /** ISO timestamp последней успешной валидации (или попытки). */
  checkedAt: string;
  /** true если последний state-callback вернул 401 — токен отозван/не от того аккаунта. */
  rejected?: boolean;
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
    /** Информация о владельце push-токена — UI показывает «выдан для Х». */
    dialogsTokenOwner?: AliceDialogsTokenOwner;
  };
  tunnel: AliceTunnelStatus;
  activity: AliceSkillActivity;
  /** Состояние managed-бинарника cloudflared — UI рендерит прогресс при `downloading`. */
  cloudflared: AliceCloudflaredInstall;
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
