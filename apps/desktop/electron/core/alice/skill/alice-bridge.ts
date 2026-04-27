/**
 * @fileoverview Composition-root для Alice Smart Home Skill интеграции.
 *
 * Склеивает четыре подсистемы:
 *   - {@link WebhookServer}   — HTTP-listener, принимает запросы от Я.Алисы.
 *   - {@link TunnelManager}   — cloudflared subprocess, выдаёт публичный URL.
 *   - {@link StatePusher}     — push state-updates в Я.Диалоги callback API.
 *   - Activity log            — circular buffer событий для UI status-панели.
 *
 * Один публичный фасад — IPC-handler'ы и {@link SmartHomeHub} дёргают только
 * `AliceBridge`. Подсистемы между собой напрямую не общаются.
 *
 * Lifecycle:
 *   1. `init()` — поднимает webhook на random-порту, не открывает tunnel.
 *   2. `setSkillConfig(config)` — сохраняет creds, разрешает запуск туннеля.
 *   3. `startTunnel()` — запускает cloudflared, ждёт публичный URL.
 *   4. `setExposures(...)` — юзер выбирает что показывать Алисе.
 *   5. (Алиса сама дёргает webhook → действия идут в driver registry).
 *   6. `shutdown()` — graceful: закрывает tunnel, останавливает webhook.
 */

import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import axios from 'axios';
import log from 'electron-log/main.js';
import type {
  AliceDeviceExposure,
  AliceDevicePreview,
  AliceDialogsTokenOwner,
  AliceReachabilityResult,
  AliceSceneExposure,
  AliceSkillActivity,
  AliceSkillConfig,
  AliceSkillStage,
  AliceStatus,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  Room,
  Scene,
  YandexStationStatus,
} from '@smarthome/shared';
import type { SettingsStore } from '../../storage/settings-store.js';
import { buildDevicePreviews } from './device-mapper.js';
import { SkillWebhookServer, type WebhookActivityEvent } from './webhook-server.js';
import { StatePusher } from './state-pusher.js';
import { TunnelManager } from './tunnel-manager.js';
import { probeWebhookReachability } from './reachability-probe.js';
import { CloudflaredInstaller } from './cloudflared-installer.js';
import type { AliceCloudflaredInstall } from '@smarthome/shared';

const ACTIVITY_RETENTION_HOURS = 24;
/** «Свежий» webhook от Алисы — после которого считаем привязку живой. */
const LINK_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;
/** Авто-проба достижимости каждые 90с пока туннель up — кэш для UI. */
const REACHABILITY_REFRESH_MS = 90_000;

export interface AliceBridgeDeps {
  settings: SettingsStore;
  listDevices: () => Device[];
  listScenes: () => Scene[];
  listRooms: () => Room[];
  executeCommand: (cmd: DeviceCommand) => Promise<DeviceCommandResult>;
  runScene: (sceneId: string) => Promise<void>;
  getStationStatus: () => YandexStationStatus;
}

export interface AliceBridgeEvents {
  status: (status: AliceStatus) => void;
  'webhook-activity': (event: WebhookActivityEvent) => void;
  'cloudflared-install': (state: AliceCloudflaredInstall) => void;
}

export class AliceBridge extends EventEmitter {
  private readonly webhook: SkillWebhookServer;
  private readonly tunnel: TunnelManager;
  private readonly statePusher: StatePusher;

  /** Кольцевой лог webhook-вызовов за 24ч — для status-панели. */
  private activityLog: WebhookActivityEvent[] = [];

  /** Последняя внешняя проба достижимости publicUrl. Источник истины для stage. */
  private lastReachability: AliceReachabilityResult | null = null;
  private reachabilityTimer: NodeJS.Timeout | null = null;

  /** Владелец dialogsOauthToken (display_name) — после verifyDialogsToken. */
  private dialogsTokenOwner: AliceDialogsTokenOwner | null = null;

  /** Авто-инсталлер cloudflared. UI больше не показывает «Скачать» / «Проверить». */
  private readonly installer = new CloudflaredInstaller();
  private installState: AliceCloudflaredInstall = { kind: 'missing' };

  constructor(private readonly deps: AliceBridgeDeps) {
    super();
    this.setMaxListeners(20);

    this.webhook = new SkillWebhookServer({
      settings: deps.settings,
      listDevices: deps.listDevices,
      listScenes: deps.listScenes,
      listRooms: deps.listRooms,
      executeCommand: deps.executeCommand,
      runScene: deps.runScene,
      onActivity: (event) => this.recordActivity(event),
    });

    this.tunnel = new TunnelManager();
    this.tunnel.on('status', (status) => {
      if (status.running && status.publicUrl) {
        // Cold-start window: cloudflared edge регистрирует connection несколько
        // секунд после `Your tunnel URL is ...` в stderr. Первая проба, дёрнутая
        // мгновенно, падает с 502/timeout. Ждём 3с — баланс отзывчивости и accuracy.
        this.scheduleReachabilityProbe(3_000);
      } else {
        this.lastReachability = null;
        this.clearReachabilityTimer();
      }
      this.emitStatus();
    });

    this.statePusher = new StatePusher({
      getConfig: () => {
        const config = deps.settings.getAlice().config;
        if (!config?.skillId || !config?.dialogsOauthToken) return null;
        return { skillId: config.skillId, oauthToken: config.dialogsOauthToken };
      },
      getInternalUserId: () => deps.settings.get('hubId'),
      onSuccess: () => {
        if (this.dialogsTokenOwner?.rejected) {
          this.dialogsTokenOwner = { ...this.dialogsTokenOwner, rejected: false };
        }
        this.emitStatus();
      },
      onUnauthorized: () => {
        // 401 от dialogs.yandex.net = токен отозван или выдан не от того аккаунта.
        // Помечаем — UI поднимет prompt «получите токен заново под владельцем скилла».
        this.dialogsTokenOwner = {
          ...(this.dialogsTokenOwner ?? {}),
          checkedAt: new Date().toISOString(),
          rejected: true,
        };
        this.emitStatus();
      },
    });
  }

  // ============== Lifecycle ==============

  async init(): Promise<void> {
    // Webhook стартуем всегда — слушает 127.0.0.1, ничего не светит без туннеля.
    await this.webhook.start();
    log.info(`[alice] webhook on 127.0.0.1:${this.webhook.getPort()}`);
    this.installState = this.installer.getStatus();
  }

  async shutdown(): Promise<void> {
    this.clearReachabilityTimer();
    await this.tunnel.stop();
    await this.webhook.stop();
  }

  /** Триггерится из device-registry на каждое device:updated. */
  notifyDeviceUpdated(device: Device): void {
    // Если устройство не экспонируется — пропускаем.
    const exposure = this.deps.settings.getAlice().deviceExposures[device.id];
    if (exposure?.enabled === false) return;
    this.statePusher.enqueue(device);
  }

  // ============== Public API ==============

  getStatus(): AliceStatus {
    const alice = this.deps.settings.getAlice();
    const config = alice.config;
    const tunnelStatus = this.tunnel.getStatus();
    const station = this.deps.getStationStatus();
    const activity = this.computeActivity();
    const reachability = this.lastReachability ?? undefined;

    return {
      station,
      skill: {
        stage: this.computeStage({
          config,
          tunnelRunning: tunnelStatus.running,
          reachability,
          activity,
          issuedTokens: alice.issuedTokens,
        }),
        configured: !!config,
        ...(this.dialogsTokenOwner ? { dialogsTokenOwner: this.dialogsTokenOwner } : {}),
      },
      tunnel: { ...tunnelStatus, ...(reachability ? { reachability } : {}) },
      activity,
      cloudflared: this.installState,
      exposedDeviceCount: countExposedDevices(this.deps.listDevices(), alice.deviceExposures),
      exposedSceneCount: countExposedScenes(this.deps.listScenes(), alice.sceneExposures),
    };
  }

  saveSkillConfig(config: AliceSkillConfig): AliceStatus {
    this.deps.settings.patchAlice({ config });
    this.emitStatus();
    return this.getStatus();
  }

  getSkillConfig(): AliceSkillConfig | null {
    return this.deps.settings.getAlice().config;
  }

  /**
   * Сгенерировать пару OAuth-кредов за юзера. Криптографически случайные —
   * client_id = UUIDv4 (Я.Диалогам подходит любой непустой ASCII), client_secret = 32 байта base64url.
   * Возвращает значения, чтобы UI показал «вставьте в консоль навыка».
   */
  generateOauthCredentials(): { oauthClientId: string; oauthClientSecret: string } {
    return {
      oauthClientId: randomUUID(),
      oauthClientSecret: randomBytes(32).toString('base64url'),
    };
  }

  /**
   * Возвращает путь к cloudflared, который мы будем использовать.
   * Приоритет: managed (userData/bin) → PATH-версия (`brew`/`winget` юзер уже поставил).
   * `null` — нигде нет, нужен `ensureCloudflared()`.
   */
  resolveCloudflaredBinary(): string | null {
    const managed = this.installer.getStatus();
    if (managed.kind === 'managed') return managed.path;
    if (this.isPathBinaryUsable()) {
      return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    }
    return null;
  }

  /** Текущее состояние managed-бинарника — UI показывает inline-прогресс при downloading. */
  getCloudflaredInstall(): AliceCloudflaredInstall {
    return this.installState;
  }

  /**
   * Гарантирует, что cloudflared можно вызвать. Если PATH-версия есть — оставляет;
   * иначе скачивает managed-бинарник в userData/bin/. Эмитит progress-events.
   */
  async ensureCloudflared(): Promise<string> {
    if (this.isPathBinaryUsable()) {
      return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    }
    const current = this.installer.getStatus();
    if (current.kind === 'managed') {
      this.installState = current;
      return current.path;
    }
    // Скачиваем — UI будет получать события через `cloudflared-install`.
    this.setInstallState({ kind: 'downloading', ratio: 0, bytesDone: 0, bytesTotal: null });
    try {
      const finalPath = await this.installer.ensureInstalled({
        onProgress: (p) => {
          this.setInstallState({
            kind: 'downloading',
            ratio: p.ratio,
            bytesDone: p.bytesDone,
            bytesTotal: p.bytesTotal,
          });
        },
      });
      this.setInstallState({ kind: 'managed', path: finalPath });
      return finalPath;
    } catch (e) {
      const msg = (e as Error).message;
      this.setInstallState({ kind: 'error', error: msg });
      throw new Error(`Не удалось скачать cloudflared: ${msg}`);
    }
  }

  private setInstallState(state: AliceCloudflaredInstall): void {
    this.installState = state;
    this.emit('cloudflared-install', state);
    this.emitStatus();
  }

  private isPathBinaryUsable(): boolean {
    const binary = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    try {
      const result = spawnSync(binary, ['--version'], {
        timeout: 3_000,
        windowsHide: true,
        encoding: 'utf8',
      });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  /** @deprecated UI больше не вызывает — оставлен для обратной совместимости IPC. */
  probeCloudflared(): { installed: boolean; version?: string; error?: string } {
    if (this.isPathBinaryUsable()) return { installed: true };
    const managed = this.installer.getStatus();
    if (managed.kind === 'managed') return { installed: true, version: 'managed' };
    return { installed: false };
  }

  clearSkillConfig(): AliceStatus {
    this.deps.settings.patchAlice({
      config: null,
      issuedTokens: {},
    });
    // Сброс in-memory state — иначе при переподключении другого юзера
    // UI покажет display_name предыдущего владельца и старую достижимость.
    this.dialogsTokenOwner = null;
    this.lastReachability = null;
    this.activityLog = [];
    void this.tunnel.stop();
    this.emitStatus();
    return this.getStatus();
  }

  async startTunnel(): Promise<AliceStatus> {
    const config = this.deps.settings.getAlice().config;
    if (!config) {
      log.warn('[alice] startTunnel without skill config — refusing');
      return this.getStatus();
    }
    // Гарантия наличия бинарника — если его нет, скачаем сначала.
    const binaryPath = await this.ensureCloudflared();
    await this.tunnel.start({
      localPort: this.webhook.getPort(),
      ...(config.customDomain ? { customDomain: config.customDomain } : {}),
      binaryPath,
    });
    return this.getStatus();
  }

  async stopTunnel(): Promise<AliceStatus> {
    await this.tunnel.stop();
    return this.getStatus();
  }

  // ===== Exposure =====

  setDeviceExposure(exposure: AliceDeviceExposure): AliceDeviceExposure[] {
    this.deps.settings.setDeviceExposure(exposure);
    this.emitStatus();
    this.pushDiscoveryAsync('device-exposure');
    return Object.values(this.deps.settings.getAlice().deviceExposures);
  }

  setSceneExposure(exposure: AliceSceneExposure): AliceSceneExposure[] {
    this.deps.settings.setSceneExposure(exposure);
    this.emitStatus();
    this.pushDiscoveryAsync('scene-exposure');
    return Object.values(this.deps.settings.getAlice().sceneExposures);
  }

  /** Catch-all wrapper для pushDiscovery — логирует ошибки + ре-эмитит статус. */
  private pushDiscoveryAsync(reason: string): void {
    void this.statePusher
      .pushDiscovery()
      .then((res) => {
        if (!res.ok) {
          log.warn(`[alice] pushDiscovery (${reason}) refused: ${res.error ?? 'unknown'}`);
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn(`[alice] pushDiscovery (${reason}) failed: ${msg}`);
      });
  }

  getExposures(): {
    devices: AliceDeviceExposure[];
    scenes: AliceSceneExposure[];
  } {
    const alice = this.deps.settings.getAlice();
    return {
      devices: Object.values(alice.deviceExposures),
      scenes: Object.values(alice.sceneExposures),
    };
  }

  listDevicePreviews(): AliceDevicePreview[] {
    const alice = this.deps.settings.getAlice();
    return buildDevicePreviews({
      devices: this.deps.listDevices(),
      rooms: this.deps.listRooms(),
      deviceExposures: alice.deviceExposures,
    });
  }

  triggerDiscoveryCallback(): Promise<{ ok: boolean; error?: string }> {
    return this.statePusher.pushDiscovery();
  }

  // ============== Internals ==============

  private recordActivity(event: WebhookActivityEvent): void {
    this.activityLog.push(event);
    const cutoff = Date.now() - ACTIVITY_RETENTION_HOURS * 3_600_000;
    this.activityLog = this.activityLog.filter((e) => Date.parse(e.at) >= cutoff);
    this.emit('webhook-activity', event);
    this.emitStatus();
  }

  private computeActivity(): AliceSkillActivity {
    const last = this.activityLog[this.activityLog.length - 1];
    const errors = this.activityLog.filter((e) => !e.ok).length;
    return {
      lastRequestAt: last?.at,
      requestsLast24h: this.activityLog.length,
      errorsLast24h: errors,
    };
  }

  /**
   * Честный stage-resolver. Источник истины — внешняя проба и lastRequestAt,
   * а НЕ сам факт «issuedTokens непустые» (так оно остаётся «linked» вечно
   * после первого OAuth, даже если юзер давно отвязал в приложении).
   */
  private computeStage(args: {
    config: AliceSkillConfig | null;
    tunnelRunning: boolean;
    reachability: AliceReachabilityResult | undefined;
    activity: AliceSkillActivity;
    issuedTokens: Record<string, unknown>;
  }): AliceSkillStage {
    if (!args.config) return 'idle';
    if (!args.tunnelRunning) return 'configured';

    const lastRequestAge = args.activity.lastRequestAt
      ? Date.now() - Date.parse(args.activity.lastRequestAt)
      : Number.POSITIVE_INFINITY;
    const fresh = lastRequestAge <= LINK_FRESHNESS_MS;
    const hasTokens = Object.keys(args.issuedTokens).length > 0;

    if (fresh) return 'linked';
    if (hasTokens) return 'linked-stale';
    if (!args.reachability) return 'tunnel-up';
    if (!args.reachability.ok) return 'tunnel-up';
    return 'awaiting-link';
  }

  // ===== Reachability =====

  /** Forced probe + cache. UI вызывает на каждый клик «Проверить». */
  async probeReachability(): Promise<AliceReachabilityResult | null> {
    const tunnel = this.tunnel.getStatus();
    if (!tunnel.running || !tunnel.publicUrl) return null;
    const config = this.deps.settings.getAlice().config;
    const result = await probeWebhookReachability({
      publicUrl: tunnel.publicUrl,
      ...(config?.customDomain ? { customDomain: config.customDomain } : {}),
    });
    this.lastReachability = result;
    this.emitStatus();
    return result;
  }

  private scheduleReachabilityProbe(delay: number): void {
    this.clearReachabilityTimer();
    this.reachabilityTimer = setTimeout(() => {
      void this.probeReachability().finally(() => {
        // Перезапланировать только если туннель всё ещё up.
        if (this.tunnel.getStatus().running) {
          this.scheduleReachabilityProbe(REACHABILITY_REFRESH_MS);
        }
      });
    }, delay);
    this.reachabilityTimer.unref?.();
  }

  private clearReachabilityTimer(): void {
    if (this.reachabilityTimer) {
      clearTimeout(this.reachabilityTimer);
      this.reachabilityTimer = null;
    }
  }

  // ===== Dialogs token verification =====

  /** Дёргает login.yandex.ru/info — display_name владельца dialogs-токена. */
  async verifyDialogsToken(): Promise<AliceDialogsTokenOwner | null> {
    const config = this.deps.settings.getAlice().config;
    if (!config?.dialogsOauthToken) {
      this.dialogsTokenOwner = null;
      this.emitStatus();
      return null;
    }
    try {
      const response = await axios.get<{ display_name?: string; login?: string }>(
        'https://login.yandex.ru/info',
        {
          params: { format: 'json' },
          headers: { Authorization: `OAuth ${config.dialogsOauthToken}` },
          timeout: 5_000,
        },
      );
      this.dialogsTokenOwner = {
        ...(response.data.display_name ? { displayName: response.data.display_name } : {}),
        ...(response.data.login ? { login: response.data.login } : {}),
        checkedAt: new Date().toISOString(),
        rejected: false,
      };
    } catch (e) {
      const err = e as { response?: { status?: number }; message?: string };
      const status = err.response?.status;
      this.dialogsTokenOwner = {
        ...(this.dialogsTokenOwner ?? {}),
        checkedAt: new Date().toISOString(),
        rejected: status === 401,
      };
      log.warn(`[alice] verifyDialogsToken failed: ${status ?? err.message ?? 'network'}`);
    }
    this.emitStatus();
    return this.dialogsTokenOwner;
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }
}

function countExposedDevices(
  devices: Device[],
  exposures: Record<string, AliceDeviceExposure>,
): number {
  let count = 0;
  for (const d of devices) {
    if (exposures[d.id]?.enabled === false) continue;
    if (d.status === 'pairing') continue;
    count += 1;
  }
  return count;
}

function countExposedScenes(
  scenes: Scene[],
  exposures: Record<string, AliceSceneExposure>,
): number {
  let count = 0;
  for (const s of scenes) {
    const enabled = exposures[s.id]?.enabled ?? s.exposeToStation;
    if (enabled) count += 1;
  }
  return count;
}
