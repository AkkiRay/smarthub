// Yandex Station: локальный JSONRPC по WebSocket на порту 1961, без облака.
// mDNS: `_yandexio._tcp.local`; WS: wss://<ip>:1961/?token=<glagol-token>;
// команды: { id, sentTime, command: 'sendText'|'serverAction'|'ping', text, ... }
// Reference: community reverse-engineering.

export interface YandexStationCandidate {
  /** Уникальный device_id (он же hostname-сегмент). */
  deviceId: string;
  /** yandexstation, yandexmidi, yandexmini, yandexmicro, ... */
  platform: string;
  /** Имя из mDNS TXT, если есть. */
  name: string;
  host: string;
  port: number;
}

// Yandex Smart Home («Дом с Алисой»): iot.quasar.yandex.ru/m/v3/user/devices.

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

export interface YandexHomeDevice {
  id: string;
  name: string;
  /** `devices.types.light`, `devices.types.media_device.tv`, … */
  type: string;
  /**
   * Дискриминатор Yandex IoT URL'ов: `/m/user/{itemType}s/{id}/actions`.
   * Snapshot отдаёт `"device"` либо `"group"`. Если поля нет — Hub считает `"device"`.
   */
  itemType: 'device' | 'group';
  room?: string;
  roomId?: string;
  householdId?: string;
  skillId?: string;
  iconUrl?: string;
  online?: boolean;
  capabilities: YandexHomeCapability[];
  properties: YandexHomeProperty[];
}

export interface YandexHomeRoom {
  id: string;
  name: string;
  householdId?: string;
  /** deviceId-ы, принадлежащие комнате. */
  devices: string[];
}

export interface YandexHomeHousehold {
  id: string;
  name: string;
}

export interface YandexHomeGroup {
  id: string;
  name: string;
  type?: string;
  householdId?: string;
  devices: string[];
  capabilities: YandexHomeCapability[];
  properties: YandexHomeProperty[];
}

export type YandexHomeTriggerType = 'voice' | 'timetable' | 'property' | 'button' | 'other';

export interface YandexHomeTrigger {
  type: YandexHomeTriggerType;
  summary: string;
  raw?: unknown;
}

export interface YandexHomeScenario {
  id: string;
  name: string;
  isActive?: boolean;
  /** Yandex-name иконки (`alice.dot.scenario.morning`). */
  icon?: string;
  iconUrl?: string;
  triggers: YandexHomeTrigger[];
  stepCount: number;
  /** ID устройств, участвующих в сценарии. */
  devices: string[];
}

export interface YandexHomeScenarioDetails extends YandexHomeScenario {
  rawSteps: unknown[];
  rawSettings?: Record<string, unknown>;
  rawEffectiveTime?: Record<string, unknown>;
}

export interface YandexHomeSnapshot {
  households: YandexHomeHousehold[];
  rooms: YandexHomeRoom[];
  groups: YandexHomeGroup[];
  devices: YandexHomeDevice[];
  scenarios: YandexHomeScenario[];
  /** ISO timestamp когда сделали запрос. */
  fetchedAt: string;
  /** WebSocket-URL для real-time push'а device-state-changes (валиден ~часы). */
  updatesUrl?: string;
}

/** Колонка из quasar.yandex.net/glagol/device_list, обогащённая mDNS-результатом. */
export interface YandexStationOnAccount {
  deviceId: string;
  name: string;
  platform: string;
  /** Из mDNS, если найдена в LAN. undefined если ещё не отсканирована. */
  host?: string;
  port?: number;
  /** Найдена ли локально сейчас (mDNS up). */
  reachableLan: boolean;
}

/** Состояние OAuth-привязки к Я.Музыке (обёртка над quasar API). */
export interface YandexAuthStatus {
  authorized: boolean;
  /** ISO timestamp истечения music_token (если известен). */
  expiresAt?: string;
}

export type YandexStationConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error';

export interface YandexStationStatus {
  /** Сохранены ли credentials (host + token + deviceId). */
  configured: boolean;
  connection: YandexStationConnectionState;
  station: {
    host: string;
    port: number;
    deviceId: string;
    platform?: string;
    name?: string;
  } | null;
  /** Последняя ошибка если connection === 'error'. */
  lastError?: string;
  /** ISO timestamp последнего pong'а. */
  lastSeenAt?: string;
}

export type YandexStationCommandKind =
  | 'sendText' // TTS произвольного текста
  | 'voiceCommand' // произнести от лица пользователя
  | 'serverAction' // skill-команда
  | 'setVolume' // громкость 0..1
  | 'play'
  | 'stop'
  | 'next'
  | 'prev';

export type YandexStationCommand =
  | { kind: 'sendText' | 'voiceCommand' | 'serverAction'; payload: string }
  | { kind: 'setVolume'; volume: number }
  | { kind: 'play' | 'stop' | 'next' | 'prev' };

/** Категория события glagol-сессии. */
export type YandexStationEventKind =
  | 'connecting'
  | 'connected'
  | 'closed'
  | 'error'
  | 'outgoing'
  | 'response'
  | 'state'
  | 'note';

/** Состояние Алисы из state-push'а. */
export type AliceVoiceState = 'IDLE' | 'BUSY' | 'LISTENING' | 'SPEAKING' | 'SHAZAM' | string;

/** Запись live-журнала glagol-сессии. */
export interface YandexStationEvent {
  /** UUID для `:key` в renderer. */
  id: string;
  /** ISO timestamp в main. */
  at: string;
  kind: YandexStationEventKind;
  /** Однострочное summary. */
  summary: string;
  /** Pretty-printed raw payload. */
  details?: string;
  /** WS close code (kind='closed'). */
  closeCode?: number;
  /** Glagol `requestId` команды (kind='outgoing'/'response'). */
  requestId?: string;
  /** Текст команды (kind='outgoing'). */
  outgoingText?: string;
  /** Тип команды (kind='outgoing'). */
  outgoingKind?: YandexStationCommandKind;
  /** state.aliceState. */
  aliceState?: AliceVoiceState;
  /** vinsResponse.cards[0].text ∪ voice_response. */
  aliceText?: string;
  /** vinsResponse.requestText. */
  userText?: string;
  /** state.playerState.title + artist. */
  trackTitle?: string;
  /** Громкость 0..1. */
  volume?: number;
  /** SUCCESS / REFUSED / TIMEOUT / UNSUPPORTED. */
  status?: string;
}
