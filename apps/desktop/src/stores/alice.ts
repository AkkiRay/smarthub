/**
 * @fileoverview
 * Alice Smart Home Skill bridge: store для UI разделов «Связка с Алисой» и «Что видит Алиса».
 * Локальная колонка живёт в useYandexStationStore — пересечение состояний только в AliceStatus.station.
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  AliceCloudflaredInstall,
  AliceDeviceExposure,
  AliceDevicePreview,
  AliceSceneExposure,
  AliceSkillConfig,
  AliceStatus,
} from '@smarthome/shared';
import { useToasterStore } from './toaster';

const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const useAliceStore = defineStore('alice', () => {
  // === State ===
  const status = ref<AliceStatus | null>(null);
  const skillConfig = ref<AliceSkillConfig | null>(null);
  const previews = ref<AliceDevicePreview[]>([]);
  const deviceExposures = ref<AliceDeviceExposure[]>([]);
  const sceneExposures = ref<AliceSceneExposure[]>([]);
  const tunnelStarting = ref(false);
  const previewsLoading = ref(false);

  // === Derived ===
  /** Map deviceId → exposure для быстрого lookup'а в DeviceExposurePanel. */
  const deviceExposureById = computed(() => {
    const map = new Map<string, AliceDeviceExposure>();
    for (const e of deviceExposures.value) map.set(e.deviceId, e);
    return map;
  });
  const sceneExposureById = computed(() => {
    const map = new Map<string, AliceSceneExposure>();
    for (const e of sceneExposures.value) map.set(e.sceneId, e);
    return map;
  });

  /** UI-driver для основной CTA: какой именно шаг сейчас нужен пользователю. */
  const nextActionHint = computed<string>(() => {
    const s = status.value;
    if (!s) return '';
    switch (s.skill.stage) {
      case 'idle':
        return 'Заполните поля ниже — хаб сгенерирует креды и сам откроет консоль навыка';
      case 'configured':
        return 'Запустите туннель — хаб получит публичный HTTPS-URL';
      case 'tunnel-up':
        return 'Туннель поднят, но достижимость ещё не подтверждена. Нажмите «Проверить достижимость»';
      case 'awaiting-link':
        return 'Алиса может достучаться. Откройте «Дом с Алисой» → Добавить → По производителю';
      case 'linked':
        return 'Алиса видит ваш хаб. Управляйте устройствами голосом или из приложения';
      case 'linked-stale':
        return 'Алиса не дёргала хаб > 7 дней. Возможно, привязка отозвана — переподключите';
      case 'error':
        return s.skill.lastError ?? 'Что-то пошло не так. Перезапустите туннель';
      default:
        return '';
    }
  });

  const isLinked = computed(() => status.value?.skill.stage === 'linked');
  const isReachable = computed(() => status.value?.tunnel.reachability?.ok === true);
  const isConfigured = computed(() => status.value?.skill.configured ?? false);
  const tunnelRunning = computed(() => status.value?.tunnel.running ?? false);
  const publicUrl = computed(() => status.value?.tunnel.publicUrl ?? null);
  const reachability = computed(() => status.value?.tunnel.reachability ?? null);
  const dialogsTokenOwner = computed(() => status.value?.skill.dialogsTokenOwner ?? null);
  const stage = computed(() => status.value?.skill.stage ?? 'idle');

  // === Actions ===
  // HMR-safe guard: App.vue:onMounted может вызвать bootstrap повторно при
  // Vite-перезапуске — без guard'а alice:status пушится в renderer N раз.
  let subscribed = false;

  async function bootstrap(): Promise<void> {
    [status.value, skillConfig.value] = await Promise.all([
      window.smarthome.alice.getStatus(),
      window.smarthome.alice.getSkillConfig(),
    ]);
    if (status.value?.cloudflared) cloudflaredInstall.value = status.value.cloudflared;
    const exposures = await window.smarthome.alice.getExposures();
    deviceExposures.value = exposures.devices;
    sceneExposures.value = exposures.scenes;
    if (subscribed) return;
    subscribed = true;
    // Push-апдейты статуса прилетают на каждый webhook-hit и tunnel-state-change.
    window.smarthome.events.on('alice:status', (s) => {
      status.value = s;
    });
    // Прогресс авто-инсталляции cloudflared — летит fire-hose'ом во время скачивания.
    window.smarthome.events.on('alice:cloudflared-install', (state) => {
      cloudflaredInstall.value = state;
      // Когда скачка завершилась — обновим статус, чтобы кнопка «Запустить туннель» оживилась.
      if (state.kind === 'managed' && status.value) {
        status.value = { ...status.value, cloudflared: state };
      }
    });
  }

  async function loadPreviews(): Promise<void> {
    previewsLoading.value = true;
    try {
      previews.value = await window.smarthome.alice.listDevicePreviews();
    } finally {
      previewsLoading.value = false;
    }
  }

  async function saveSkillConfig(config: AliceSkillConfig): Promise<void> {
    const toaster = useToasterStore();
    await toaster.run(
      async () => {
        status.value = await window.smarthome.alice.saveSkillConfig(toPlain(config));
        skillConfig.value = config;
      },
      { success: 'Креды skill сохранены', error: 'Не удалось сохранить' },
    );
  }

  async function clearSkillConfig(): Promise<void> {
    const toaster = useToasterStore();
    await toaster.run(
      async () => {
        status.value = await window.smarthome.alice.clearSkillConfig();
        skillConfig.value = null;
      },
      { success: 'Skill отвязан', error: 'Не удалось отвязать' },
    );
  }

  async function startTunnel(): Promise<void> {
    const toaster = useToasterStore();
    tunnelStarting.value = true;
    try {
      // Прозрачная авто-инсталляция: если cloudflared нет, скачиваем сначала.
      // Юзер видит inline-прогресс через cloudflaredInstall, без отдельной кнопки.
      if (cloudflaredInstall.value.kind !== 'managed') {
        await ensureCloudflared();
      }
      await toaster.run(
        async () => {
          status.value = await window.smarthome.alice.startTunnel();
          if (!status.value.tunnel.running) {
            throw new Error(status.value.tunnel.lastError ?? 'Туннель не поднялся');
          }
        },
        { success: 'Туннель запущен', error: 'Не удалось запустить туннель' },
      );
    } finally {
      tunnelStarting.value = false;
    }
  }

  async function stopTunnel(): Promise<void> {
    status.value = await window.smarthome.alice.stopTunnel();
  }

  async function setDeviceExposure(exposure: AliceDeviceExposure): Promise<void> {
    deviceExposures.value = await window.smarthome.alice.setDeviceExposure(toPlain(exposure));
    // Не ждём callback — UI уже обновлён, push-cb идёт в фон.
  }

  async function setSceneExposure(exposure: AliceSceneExposure): Promise<void> {
    sceneExposures.value = await window.smarthome.alice.setSceneExposure(toPlain(exposure));
  }

  async function triggerDiscoveryCallback(): Promise<void> {
    const toaster = useToasterStore();
    const result = await window.smarthome.alice.triggerDiscoveryCallback();
    if (result.ok) {
      toaster.push({ kind: 'success', message: 'Алиса перечитает список устройств' });
    } else {
      toaster.push({
        kind: 'error',
        message: result.error ?? 'Не удалось пушнуть discovery',
      });
    }
  }

  // === Quality-of-life ===
  const cloudflaredStatus = ref<{
    installed: boolean;
    version?: string;
    error?: string;
  } | null>(null);
  /** Состояние авто-инсталлера. Источник истины для UI «Запустить туннель»-кнопки. */
  const cloudflaredInstall = ref<AliceCloudflaredInstall>({ kind: 'missing' });

  async function probeCloudflared(): Promise<void> {
    cloudflaredStatus.value = await window.smarthome.alice.probeCloudflared();
  }

  /** Запустить авто-инсталляцию cloudflared. Возвращается, когда managed-бинарник готов. */
  async function ensureCloudflared(): Promise<void> {
    const toaster = useToasterStore();
    try {
      cloudflaredInstall.value = await window.smarthome.alice.ensureCloudflared();
    } catch (e) {
      cloudflaredInstall.value = { kind: 'error', error: (e as Error).message };
      toaster.push({
        kind: 'error',
        message: `Не удалось скачать cloudflared: ${(e as Error).message}`,
      });
      throw e;
    }
  }

  async function generateOauthCredentials(): Promise<{
    oauthClientId: string;
    oauthClientSecret: string;
  }> {
    return window.smarthome.alice.generateOauthCredentials();
  }

  async function fetchDialogsCallbackToken(): Promise<void> {
    const toaster = useToasterStore();
    const result = await window.smarthome.alice.fetchDialogsCallbackToken();
    if (result.ok) {
      // Re-load skill config — backend сам сохранил.
      skillConfig.value = await window.smarthome.alice.getSkillConfig();
      // Backend уже дёрнул verifyDialogsToken — owner появится в alice:status push.
      const owner = status.value?.skill.dialogsTokenOwner;
      toaster.push({
        kind: 'success',
        message: owner?.displayName
          ? `Токен получен для ${owner.displayName}. Убедитесь, что это владелец скилла`
          : 'Токен получен — push-обновления Алисы включены',
        ttlMs: 5500,
      });
    } else {
      toaster.push({
        kind: 'error',
        message: result.error ?? 'Не удалось получить токен',
      });
    }
  }

  /** Forced reachability-probe — UI кнопка «Проверить достижимость». */
  async function probeReachability(): Promise<void> {
    const toaster = useToasterStore();
    status.value = await window.smarthome.alice.probeReachability();
    const r = status.value.tunnel.reachability;
    if (!r) {
      toaster.push({ kind: 'error', message: 'Туннель не запущен — нечего проверять' });
      return;
    }
    if (r.ok) {
      toaster.push({
        kind: 'success',
        message: `Алиса достучится — HEAD /v1.0 ответил ${r.status} за ${r.latencyMs}мс`,
        ttlMs: 4000,
      });
    } else {
      toaster.push({
        kind: 'error',
        message: r.error ?? `HEAD /v1.0 вернул ${r.status}`,
        ttlMs: 6000,
      });
    }
  }

  /** Сверить владельца dialogsOauthToken — display_name из login.yandex.ru/info. */
  async function verifyDialogsToken(): Promise<void> {
    const toaster = useToasterStore();
    status.value = await window.smarthome.alice.verifyDialogsToken();
    const owner = status.value.skill.dialogsTokenOwner;
    if (owner?.rejected) {
      toaster.push({
        kind: 'error',
        message: 'Токен отозван или принадлежит другому аккаунту. Получите заново',
      });
    } else if (owner?.displayName) {
      toaster.push({ kind: 'success', message: `Токен валиден · ${owner.displayName}` });
    }
  }

  /**
   * Один-клик: открыть консоль навыка в браузере + положить в clipboard все
   * URL'ы, которые юзер должен вставить (endpoint, /authorize, /token).
   * Вместо «скопируй три раза», юзер копирует один раз и вставляет в три поля.
   */
  async function copyConsoleConfig(): Promise<void> {
    const toaster = useToasterStore();
    const url = publicUrl.value;
    if (!url) {
      toaster.push({ kind: 'error', message: 'Сначала запустите туннель' });
      return;
    }
    const config = skillConfig.value;
    const lines: string[] = [
      `Endpoint URL:    ${url}/v1.0`,
      `Authorize URL:   ${url}/oauth/authorize`,
      `Token URL:       ${url}/oauth/token`,
      `Refresh URL:     ${url}/oauth/token`,
    ];
    if (config?.oauthClientId) lines.push(`client_id:       ${config.oauthClientId}`);
    if (config?.oauthClientSecret) lines.push(`client_secret:   ${config.oauthClientSecret}`);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      await window.smarthome.app.openExternal('https://dialogs.yandex.ru/developer/skills');
      toaster.push({
        kind: 'success',
        message: 'Все 4 URL и креды скопированы — вставьте в консоль навыка',
        ttlMs: 5000,
      });
    } catch {
      toaster.push({ kind: 'error', message: 'Не удалось скопировать в буфер' });
    }
  }

  return {
    // state
    status,
    skillConfig,
    previews,
    deviceExposures,
    sceneExposures,
    tunnelStarting,
    previewsLoading,
    cloudflaredStatus,
    cloudflaredInstall,
    // derived
    deviceExposureById,
    sceneExposureById,
    nextActionHint,
    isLinked,
    isReachable,
    isConfigured,
    tunnelRunning,
    publicUrl,
    reachability,
    dialogsTokenOwner,
    stage,
    // actions
    bootstrap,
    loadPreviews,
    saveSkillConfig,
    clearSkillConfig,
    startTunnel,
    stopTunnel,
    setDeviceExposure,
    setSceneExposure,
    triggerDiscoveryCallback,
    probeCloudflared,
    ensureCloudflared,
    generateOauthCredentials,
    fetchDialogsCallbackToken,
    probeReachability,
    verifyDialogsToken,
    copyConsoleConfig,
  };
});
