// Composition root для всей skill-интеграции: webhook + tunnel + state-pusher + activity log.
// Один публичный фасад — IPC-handlers и smart-home-hub дёргают только его.

import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import log from 'electron-log/main.js';
import type {
  AliceDeviceExposure,
  AliceDevicePreview,
  AliceSceneExposure,
  AliceSkillActivity,
  AliceSkillConfig,
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

const ACTIVITY_RETENTION_HOURS = 24;

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
}

export class AliceBridge extends EventEmitter {
  private readonly webhook: SkillWebhookServer;
  private readonly tunnel: TunnelManager;
  private readonly statePusher: StatePusher;

  /** Кольцевой лог webhook-вызовов за 24ч — для status-панели. */
  private activityLog: WebhookActivityEvent[] = [];

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
    this.tunnel.on('status', () => this.emitStatus());

    this.statePusher = new StatePusher({
      getConfig: () => {
        const config = deps.settings.getAlice().config;
        if (!config?.skillId || !config?.dialogsOauthToken) return null;
        return { skillId: config.skillId, oauthToken: config.dialogsOauthToken };
      },
      getInternalUserId: () => deps.settings.get('hubId'),
      onSuccess: () => {
        // Активность не логируем — только пометим last callback at в getStatus().
        this.emitStatus();
      },
    });
  }

  // ============== Lifecycle ==============

  async init(): Promise<void> {
    // Webhook стартуем всегда — слушает 127.0.0.1, ничего не светит без туннеля.
    await this.webhook.start();
    log.info(`[alice] webhook on 127.0.0.1:${this.webhook.getPort()}`);
  }

  async shutdown(): Promise<void> {
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

    return {
      station,
      skill: {
        stage: this.computeStage(config, tunnelStatus.running, alice.issuedTokens),
        configured: !!config,
      },
      tunnel: tunnelStatus,
      activity: this.computeActivity(),
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
   * Однократная проверка наличия cloudflared в PATH. Дёшево (sync exec --version),
   * вызывается из IPC при mount AliceView. Не кешируем — юзер мог установить пока хаб работал.
   */
  probeCloudflared(): { installed: boolean; version?: string; error?: string } {
    const binary = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    try {
      const result = spawnSync(binary, ['--version'], {
        timeout: 3_000,
        windowsHide: true,
        encoding: 'utf8',
      });
      if (result.error) {
        return { installed: false, error: result.error.message };
      }
      if (result.status !== 0) {
        return { installed: false, error: `exit code ${result.status}` };
      }
      // Output: «cloudflared version 2024.x.x (...)» — берём первую строку.
      const versionLine = (result.stdout || result.stderr || '').split('\n')[0]?.trim();
      return { installed: true, version: versionLine };
    } catch (e) {
      return { installed: false, error: (e as Error).message };
    }
  }

  clearSkillConfig(): AliceStatus {
    this.deps.settings.patchAlice({
      config: null,
      issuedTokens: {},
    });
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
    await this.tunnel.start({
      localPort: this.webhook.getPort(),
      customDomain: config.customDomain,
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
    // Push discovery в Алису fire-and-forget — UI не ждёт результата (оптимистичный toggle).
    // Но если push падает (нет интернета / skill отвязан), логируем явно: иначе у юзера
    // toggle обновился, а Алиса ещё минут 5 показывает старое — без объяснения причины.
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

  private computeStage(
    config: AliceSkillConfig | null,
    tunnelRunning: boolean,
    issuedTokens: Record<string, unknown>,
  ): AliceStatus['skill']['stage'] {
    if (!config) return 'idle';
    if (Object.keys(issuedTokens).length > 0) return 'linked';
    if (tunnelRunning) return 'tunnel-up';
    return 'configured';
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
