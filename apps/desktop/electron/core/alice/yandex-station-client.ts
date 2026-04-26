/**
 * WebSocket-клиент Яндекс.Станции (glagol-протокол, `wss://host:1961/?token=<jwt>`).
 *
 * Envelope: `{ conversationToken, id, sentTime, payload: { command, ... } }`.
 * Поддерживаемые команды (per AlexxIT/YandexStation):
 *   sendText, play, stop, prev, next, rewind, playMusic, setVolume,
 *   serverAction, ping, softwareVersion.
 *
 * После open: handshake `softwareVersion` + app-level ping каждые `GLAGOL_PING_INTERVAL_MS`.
 * Reconnect: exponential backoff; 401/403 → token refresh.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import log from 'electron-log/main.js';
import type {
  YandexStationCommand,
  YandexStationEvent,
  YandexStationStatus,
  YandexStationConnectionState,
} from '@smarthome/shared';
import { getErrorMessage, safeJsonParse } from '@smarthome/shared';
import type { YandexStationCreds } from '../storage/settings-store.js';
import {
  ALICE_TIMEOUT,
  TOKEN_PREEMPTIVE_REFRESH_SEC,
  WS_RECONNECT_DELAYS_MS,
  YANDEX_STATION_PORT,
} from './constants.js';

type StatusListener = (status: YandexStationStatus) => void;
type EventListener = (event: YandexStationEvent) => void;

export type YandexStationClient = ReturnType<typeof createYandexStationClient>;

/** Колбек, возвращающий свежий per-device JWT (или null если music_token отсутствует). */
export type DeviceTokenRefresher = () => Promise<string | null>;

/** Колбек: hub персистит обновлённые creds (token rotation, cert pin'инг). */
export type CredsPersister = (creds: YandexStationCreds) => void;

/** Сколько событий хранить в ring-buffer'e (UI-снимок при mount). */
const EVENT_BUFFER_SIZE = 80;
/** Если суммарный детальный JSON длиннее — обрезаем (защита от player-state c URL'ами в ответ). */
const EVENT_DETAILS_MAX_CHARS = 1200;

interface PendingRequest {
  resolve: (response: GlagolResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface GlagolResponse {
  status?: string;
  vinsResponse?: { errorCode?: string; errorText?: string } & Record<string, unknown>;
  [key: string]: unknown;
}

interface GlagolStateMessage {
  requestId?: string;
  conversationToken?: string;
  state?: GlagolState;
  vinsResponse?: GlagolVinsResponse;
  [key: string]: unknown;
}

interface GlagolState {
  aliceState?: string;
  volume?: number;
  playerState?: {
    title?: string;
    subtitle?: string;
    extra?: { artist?: string };
  };
  [key: string]: unknown;
}

interface GlagolVinsResponse {
  errorCode?: string;
  errorText?: string;
  /** Алиса отвечает текстом — собираем из cards[].text. */
  cards?: Array<{ type?: string; text?: string }>;
  /** Что услышала Алиса от пользователя. */
  voice_response?: { output_speech?: { text?: string } };
  [key: string]: unknown;
}

export function createYandexStationClient() {
  const emitter = new EventEmitter();
  let socket: WebSocket | null = null;
  let creds: YandexStationCreds | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let tokenRefresher: DeviceTokenRefresher | null = null;
  let credsPersister: CredsPersister | null = null;
  let lastRefreshedAt = 0;
  /** true — disconnect() вызван явно, reconnect-loop отключён. */
  let manualDisconnect = false;
  const pending = new Map<string, PendingRequest>();
  /** ID handshake/ping-сообщений — их ответы НЕ пушим в журнал, иначе он флудит. */
  const internalRequestIds = new Set<string>();
  /** Ring-buffer диагностических событий — UI забирает snapshot при mount. */
  const eventBuffer: YandexStationEvent[] = [];
  /** Подпись последнего state-push'а — чтобы не дублировать одинаковые тики. */
  let lastStateSignature: string | null = null;

  const pushEvent = (input: Omit<YandexStationEvent, 'id' | 'at'>): YandexStationEvent => {
    const evt: YandexStationEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      ...input,
    };
    eventBuffer.push(evt);
    while (eventBuffer.length > EVENT_BUFFER_SIZE) eventBuffer.shift();
    emitter.emit('event', evt);
    return evt;
  };

  /** Отправка handshake/ping — `requestId` регистрируется в `internalRequestIds`. */
  const sendInternal = async (
    ws: WebSocket,
    deviceToken: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    const id = randomUUID();
    internalRequestIds.add(id);
    if (internalRequestIds.size > 64) {
      const first = internalRequestIds.values().next().value;
      if (first) internalRequestIds.delete(first);
    }
    const envelope = buildEnvelope(deviceToken, id, payload);
    await new Promise<void>((resolve, reject) => {
      ws.send(JSON.stringify(envelope), (err) => (err ? reject(err) : resolve()));
    });
  };

  /** JSON-stringify с обрезкой до `EVENT_DETAILS_MAX_CHARS`. */
  const previewJson = (value: unknown): string => {
    try {
      const s = JSON.stringify(value, null, 2);
      return s.length > EVENT_DETAILS_MAX_CHARS ? s.slice(0, EVENT_DETAILS_MAX_CHARS) + '\n…' : s;
    } catch {
      return String(value);
    }
  };

  let status: YandexStationStatus = {
    configured: false,
    connection: 'disconnected',
    station: null,
  };

  const updateStatus = (patch: Partial<YandexStationStatus>): void => {
    status = { ...status, ...patch };
    emitter.emit('status', status);
  };

  const setConnectionState = (
    connection: YandexStationConnectionState,
    extra?: Partial<YandexStationStatus>,
  ): void => {
    updateStatus({ connection, ...extra });
  };

  const clearTimers = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const rejectAllPending = (reason: string): void => {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pending.clear();
  };

  const scheduleReconnect = (): void => {
    if (manualDisconnect || !creds) return;
    const delay =
      WS_RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, WS_RECONNECT_DELAYS_MS.length - 1)] ??
      WS_RECONNECT_DELAYS_MS[WS_RECONNECT_DELAYS_MS.length - 1]!;
    reconnectAttempt++;
    log.info(`YandexStation: reconnect in ${delay}ms (attempt ${reconnectAttempt})`);
    pushEvent({
      kind: 'note',
      summary: `Переподключение через ${delay}ms (попытка ${reconnectAttempt})`,
    });
    reconnectTimer = setTimeout(() => {
      void openSocket(creds!);
    }, delay);
  };

  const openSocket = async (target: YandexStationCreds): Promise<YandexStationStatus> =>
    new Promise((resolve) => {
      manualDisconnect = false;
      pushEvent({
        kind: 'connecting',
        summary: `Подключение к ${target.host}:${target.port}`,
      });
      setConnectionState('connecting', {
        configured: true,
        station: {
          host: target.host,
          port: target.port,
          deviceId: target.deviceId,
          platform: target.platform,
          name: target.name,
        },
        lastError: undefined,
      });

      const url = `wss://${target.host}:${target.port}/?token=${encodeURIComponent(target.token)}`;
      const ws = new WebSocket(url, {
        // Self-signed cert — Web PKI неприменим, защита через TOFU pin ниже.
        rejectUnauthorized: false,
        handshakeTimeout: ALICE_TIMEOUT.WS_HANDSHAKE_MS,
      });

      // TOFU fingerprint pin: pin при первом connect, mismatch → terminate.
      ws.on('upgrade', (response) => {
        const sock = (response as unknown as { socket?: { getPeerCertificate?: () => { fingerprint256?: string } } }).socket;
        const cert = sock?.getPeerCertificate?.();
        const fp = cert?.fingerprint256;
        if (!fp) {
          log.warn(`YandexStation: peer cert fingerprint unavailable for ${target.host}`);
          return;
        }
        if (target.certFingerprint && target.certFingerprint !== fp) {
          log.error(
            `YandexStation: TLS fingerprint MISMATCH for ${target.host} ` +
              `(expected ${target.certFingerprint}, got ${fp}) — terminating connection`,
          );
          pushEvent({
            kind: 'error',
            summary: `TLS отпечаток колонки изменился — возможна атака MITM. Connection отклонено.`,
          });
          try {
            ws.terminate();
          } catch {
            /* already closed */
          }
          return;
        }
        if (!target.certFingerprint) {
          target.certFingerprint = fp;
          if (creds) creds.certFingerprint = fp;
          credsPersister?.(target);
          log.info(`YandexStation: pinned TLS fingerprint for ${target.host}: ${fp}`);
        }
      });

      socket = ws;

      let resolved = false;
      const settle = (s: YandexStationStatus) => {
        if (resolved) return;
        resolved = true;
        resolve(s);
      };

      ws.on('open', () => {
        log.info(`YandexStation: connected to ${target.host}:${target.port}`);
        reconnectAttempt = 0;
        lastStateSignature = null;
        pushEvent({
          kind: 'connected',
          summary: `WS-сессия открыта (${target.host}:${target.port})`,
        });
        setConnectionState('connected', {
          lastSeenAt: new Date().toISOString(),
          lastError: undefined,
        });
        void sendInternal(ws, target.token, { command: 'softwareVersion' }).catch((e) => {
          const msg = getErrorMessage(e);
          log.warn(`YandexStation: handshake softwareVersion failed: ${msg}`);
          pushEvent({ kind: 'note', summary: `Handshake не прошёл: ${msg}` });
        });
        pingTimer = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          // Ping-ошибки тоже логируем (на verbose-уровне) — повторяющийся pattern
          // указывает на сетевую деградацию, важно видеть в main.log.
          void sendInternal(ws, target.token, { command: 'ping' }).catch((e) => {
            log.debug(`YandexStation: ping failed: ${getErrorMessage(e)}`);
          });
        }, ALICE_TIMEOUT.GLAGOL_PING_INTERVAL_MS);
        settle(status);
      });

      ws.on('message', (raw) => {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        const msg = safeJsonParse<GlagolStateMessage & GlagolResponse>(text);
        if (!msg) return;

        const reqId = typeof msg.requestId === 'string' ? msg.requestId : null;
        const isInternal = reqId !== null && internalRequestIds.delete(reqId);
        const isResponse = reqId !== null && pending.has(reqId);

        if (isResponse) {
          const p = pending.get(reqId!)!;
          pending.delete(reqId!);
          clearTimeout(p.timer);
          p.resolve(msg);
        }

        if (msg.status === 'SUCCESS' || msg.state) {
          updateStatus({ lastSeenAt: new Date().toISOString() });
        }

        if (isInternal && !msg.state && !msg.vinsResponse) return;

        const extracted = extractInsights(msg);

        if (!isResponse) {
          const sig = stateSignature(extracted, msg.status);
          if (sig === lastStateSignature) return;
          lastStateSignature = sig;
        }

        const summary = isResponse ? buildResponseSummary(msg, extracted) : buildStateSummary(extracted);
        pushEvent({
          kind: isResponse ? 'response' : 'state',
          summary,
          details: previewJson(msg),
          ...(reqId ? { requestId: reqId } : {}),
          ...(typeof msg.status === 'string' ? { status: msg.status } : {}),
          ...extracted,
        });
      });

      ws.on('error', (err) => {
        const msg = getErrorMessage(err);
        log.warn(`YandexStation: socket error ${msg}`);
        updateStatus({ lastError: msg });
        pushEvent({ kind: 'error', summary: `Ошибка сокета: ${msg}` });
      });

      ws.on('unexpected-response', (_req, res) => {
        if ((res.statusCode === 401 || res.statusCode === 403) && tokenRefresher) {
          const sinceLast = Date.now() - lastRefreshedAt;
          if (sinceLast > ALICE_TIMEOUT.TOKEN_REFRESH_DEBOUNCE_MS) {
            void refreshAndReconnect();
          }
        }
      });

      ws.on('close', (code) => {
        log.info(`YandexStation: socket closed (code ${code})`);
        clearTimers();
        rejectAllPending(`Socket closed (${code})`);
        socket = null;
        const description = describeCloseCode(code);
        pushEvent({ kind: 'closed', summary: description, closeCode: code });
        if (manualDisconnect) {
          setConnectionState('disconnected', { configured: !!creds });
        } else {
          setConnectionState('error', { lastError: description });
          if (shouldPreemptiveRefresh()) {
            void refreshAndReconnect();
          } else {
            scheduleReconnect();
          }
        }
        settle(status);
      });
    });

  const describeCloseCode = (code: number): string => {
    switch (code) {
      case 1000:
        return 'Соединение закрыто колонкой (1000)';
      case 1006:
        return 'Соединение разорвано (1006) — обычно истёкший JWT';
      case 4000:
        return 'Колонка отклонила сессию (4000) — другая сессия Quasar или невалидный device-token';
      default:
        return `Socket closed (${code})`;
    }
  };

  const shouldPreemptiveRefresh = (): boolean => {
    if (!creds || !tokenRefresher) return false;
    const exp = creds.tokenExpiresAt ?? 0;
    if (exp === 0) return false;
    const now = Math.floor(Date.now() / 1000);
    return exp - now < TOKEN_PREEMPTIVE_REFRESH_SEC;
  };

  const refreshAndReconnect = async (): Promise<void> => {
    if (!tokenRefresher || !creds) return;
    lastRefreshedAt = Date.now();
    try {
      const fresh = await tokenRefresher();
      if (!fresh) {
        scheduleReconnect();
        return;
      }
      creds = { ...creds, token: fresh };
      log.info('YandexStation: device token refreshed, reconnecting');
      pushEvent({ kind: 'note', summary: 'Получен свежий device-token, переподключаюсь' });
      void openSocket(creds);
    } catch (e) {
      log.warn(`YandexStation: token refresh failed: ${(e as Error).message}`);
      scheduleReconnect();
    }
  };

  return {
    /** Возвращает unsubscribe. */
    onStatus(listener: StatusListener): () => void {
      emitter.on('status', listener);
      return () => emitter.off('status', listener);
    },

    getStatus: (): YandexStationStatus => status,

    async connect(input: YandexStationCreds): Promise<YandexStationStatus> {
      manualDisconnect = true;
      clearTimers();
      rejectAllPending('Reconnecting');
      if (socket) {
        socket.removeAllListeners();
        if (socket.readyState !== WebSocket.CLOSED) {
          try {
            socket.close();
          } catch {
            /* already closed */
          }
        }
      }
      socket = null;
      reconnectAttempt = 0;
      lastStateSignature = null;
      creds = { ...input, port: input.port || YANDEX_STATION_PORT };
      return openSocket(creds);
    },

    async disconnect(): Promise<void> {
      manualDisconnect = true;
      clearTimers();
      rejectAllPending('Disconnected');
      pushEvent({ kind: 'note', summary: 'Колонка отключена пользователем' });
      if (socket) {
        socket.removeAllListeners();
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.close();
          } catch {
            /* already closed */
          }
        }
      }
      socket = null;
      creds = null;
      setConnectionState('disconnected', { configured: false, station: null });
    },

    /** Hub внедряет refresher после конструирования (избегаем circular dep). */
    setTokenRefresher(fn: DeviceTokenRefresher | null): void {
      tokenRefresher = fn;
    },

    /** Hub передаёт колбэк для persist'а обновлённых creds (token rotation, cert pin'инг). */
    setCredsPersister(fn: CredsPersister | null): void {
      credsPersister = fn;
    },

    async sendCommand(command: YandexStationCommand): Promise<{ ok: boolean; error?: string }> {
      if (!socket || socket.readyState !== WebSocket.OPEN || !creds) {
        const err = 'Колонка не подключена / station offline';
        pushEvent({
          kind: 'error',
          summary: err,
          outgoingKind: command.kind,
          ...(commandText(command) ? { outgoingText: commandText(command)! } : {}),
        });
        return { ok: false, error: err };
      }
      const id = randomUUID();
      const innerPayload = buildInnerPayload(command);

      const envelope = buildEnvelope(creds.token, id, innerPayload);

      const summaryText = describeCommandForLog(command);
      pushEvent({
        kind: 'outgoing',
        summary: `→ ${summaryText}`,
        details: previewJson(envelope),
        requestId: id,
        outgoingKind: command.kind,
        ...(commandText(command) ? { outgoingText: commandText(command)! } : {}),
      });

      const ws = socket;
      try {
        await new Promise<void>((resolve, reject) => {
          ws.send(JSON.stringify(envelope), (err) => (err ? reject(err) : resolve()));
        });
      } catch (e) {
        const errMsg = (e as Error).message;
        pushEvent({ kind: 'error', summary: `Send failed: ${errMsg}`, requestId: id });
        return { ok: false, error: errMsg };
      }

      try {
        const response = await new Promise<GlagolResponse>((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve({ status: 'TIMEOUT' });
          }, ALICE_TIMEOUT.WS_RESPONSE_MS);
          pending.set(id, { resolve, reject, timer });
        });
        if (response.status === 'REFUSED') {
          const vins = response.vinsResponse;
          const detail = vins?.errorText ?? vins?.errorCode ?? 'REFUSED';
          log.warn(`YandexStation: command refused — ${detail}`);
          return { ok: false, error: `Колонка отклонила команду: ${detail}` };
        }
        if (response.status === 'TIMEOUT') {
          pushEvent({
            kind: 'note',
            summary: `Колонка не подтвердила команду за ${ALICE_TIMEOUT.WS_RESPONSE_MS}ms (обычно ОК для TTS)`,
            requestId: id,
            status: 'TIMEOUT',
          });
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    /** Snapshot последних событий (UI вызывает в onMounted, далее — push через onEvent). */
    getRecentEvents(): YandexStationEvent[] {
      return [...eventBuffer];
    },

    clearEvents(): void {
      eventBuffer.length = 0;
    },

    /** Подписка на push диагностических событий. */
    onEvent(listener: EventListener): () => void {
      emitter.on('event', listener);
      return () => emitter.off('event', listener);
    },
  };
}

/** Glagol envelope. `conversationToken` = device-JWT из URL `?token=`. */
function buildEnvelope(deviceToken: string, id: string, payload: Record<string, unknown>) {
  return {
    conversationToken: deviceToken,
    id,
    sentTime: Date.now(),
    payload,
  };
}

function labelForCommandKind(kind: YandexStationCommand['kind']): string {
  switch (kind) {
    case 'sendText':
      return 'TTS';
    case 'voiceCommand':
      return 'Голосовая команда';
    case 'serverAction':
      return 'Server action';
    case 'setVolume':
      return 'Громкость';
    case 'play':
      return 'Play';
    case 'stop':
      return 'Pause';
    case 'next':
      return 'Next';
    case 'prev':
      return 'Prev';
    default:
      return kind;
  }
}

/** Текст команды (для sendText/voiceCommand/serverAction). */
function commandText(cmd: YandexStationCommand): string | null {
  if (cmd.kind === 'sendText' || cmd.kind === 'voiceCommand' || cmd.kind === 'serverAction') {
    return cmd.payload;
  }
  return null;
}

/** Однострочное описание команды для UI-журнала. */
function describeCommandForLog(cmd: YandexStationCommand): string {
  const label = labelForCommandKind(cmd.kind);
  if (cmd.kind === 'setVolume') {
    return `${label}: ${Math.round(cmd.volume * 100)}%`;
  }
  const text = commandText(cmd);
  return text ? `${label}: ${truncate(text, 80)}` : label;
}

/** Маппинг `YandexStationCommand` → glagol payload. */
function buildInnerPayload(cmd: YandexStationCommand): Record<string, unknown> {
  switch (cmd.kind) {
    case 'sendText':
    case 'voiceCommand':
      return { command: 'sendText', text: cmd.payload };
    case 'serverAction':
      return {
        command: 'serverAction',
        serverActionEventPayload: { type: 'server_action', name: cmd.payload },
      };
    case 'setVolume':
      return { command: 'setVolume', volume: cmd.volume };
    case 'play':
    case 'stop':
    case 'next':
    case 'prev':
      return { command: cmd.kind };
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Тянет интересные поля из state/vinsResponse — для summary-рендера и отдельных колонок UI. */
function extractInsights(msg: GlagolStateMessage & GlagolResponse): {
  aliceState?: string;
  aliceText?: string;
  userText?: string;
  trackTitle?: string;
  volume?: number;
} {
  const out: ReturnType<typeof extractInsights> = {};
  const state = msg.state;
  if (state) {
    if (typeof state.aliceState === 'string') out.aliceState = state.aliceState;
    if (typeof state.volume === 'number') out.volume = state.volume;
    const player = state.playerState;
    if (player && (player.title || player.subtitle)) {
      const artist = player.extra?.artist ?? player.subtitle ?? '';
      out.trackTitle = artist ? `${player.title ?? ''} — ${artist}` : (player.title ?? '');
    }
  }

  const vins = msg.vinsResponse;
  if (vins) {
    const cardText = vins.cards?.map((c) => c.text).filter(Boolean).join(' ');
    if (cardText) out.aliceText = cardText;
    else if (vins.voice_response?.output_speech?.text) {
      out.aliceText = vins.voice_response.output_speech.text;
    }
    const userText = (vins as Record<string, unknown>)['requestText'];
    if (typeof userText === 'string' && userText.length > 0) out.userText = userText;
  }
  return out;
}

/** Сигнатура state-push'а для dedup'а (volume округлён до процентов). */
function stateSignature(
  insights: ReturnType<typeof extractInsights>,
  status: string | undefined,
): string {
  const volPct = typeof insights.volume === 'number' ? Math.round(insights.volume * 100) : null;
  return [
    insights.aliceState ?? '',
    insights.trackTitle ?? '',
    volPct ?? '',
    insights.aliceText ?? '',
    insights.userText ?? '',
    status ?? '',
  ].join('|');
}

function buildStateSummary(insights: ReturnType<typeof extractInsights>): string {
  if (insights.aliceText) return `Алиса: «${truncate(insights.aliceText, 90)}»`;
  if (insights.userText) return `Пользователь: «${truncate(insights.userText, 90)}»`;
  if (insights.trackTitle) return `Играет: ${truncate(insights.trackTitle, 90)}`;
  if (insights.aliceState) return `state: ${insights.aliceState}`;
  return 'state push';
}

function buildResponseSummary(
  msg: GlagolStateMessage & GlagolResponse,
  insights: ReturnType<typeof extractInsights>,
): string {
  if (insights.aliceText) return `Ответ Алисы: «${truncate(insights.aliceText, 90)}»`;
  if (msg.status === 'REFUSED') {
    const detail = msg.vinsResponse?.errorText ?? msg.vinsResponse?.errorCode ?? 'REFUSED';
    return `Команда отклонена: ${detail}`;
  }
  return msg.status ? `Ответ: ${msg.status}` : 'Ответ колонки';
}
