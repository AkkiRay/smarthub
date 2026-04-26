// Alice Smart Home Skill bridge: store для UI разделов «Связка с Алисой» и «Что видит Алиса».
// Локальная колонка живёт в useYandexStationStore — пересечение состояний только в AliceStatus.station.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
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
    if (!s.skill.configured) return 'Создайте skill в dialogs.yandex.ru и вставьте 3 поля ниже';
    if (!s.tunnel.running) return 'Запустите туннель — хаб получит публичный HTTPS-URL';
    if (s.skill.stage !== 'linked')
      return 'Откройте «Дом с Алисой» → Добавить → По производителю → ваш skill';
    return 'Алиса подключена и видит ваш хаб';
  });

  const isLinked = computed(() => status.value?.skill.stage === 'linked');
  const isConfigured = computed(() => status.value?.skill.configured ?? false);
  const tunnelRunning = computed(() => status.value?.tunnel.running ?? false);
  const publicUrl = computed(() => status.value?.tunnel.publicUrl ?? null);

  // === Actions ===
  // HMR-safe guard: App.vue:onMounted может вызвать bootstrap повторно при
  // Vite-перезапуске — без guard'а alice:status пушится в renderer N раз.
  let subscribed = false;

  async function bootstrap(): Promise<void> {
    [status.value, skillConfig.value] = await Promise.all([
      window.smarthome.alice.getStatus(),
      window.smarthome.alice.getSkillConfig(),
    ]);
    const exposures = await window.smarthome.alice.getExposures();
    deviceExposures.value = exposures.devices;
    sceneExposures.value = exposures.scenes;
    if (subscribed) return;
    subscribed = true;
    // Push-апдейты статуса прилетают на каждый webhook-hit и tunnel-state-change.
    window.smarthome.events.on('alice:status', (s) => {
      status.value = s;
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

  async function probeCloudflared(): Promise<void> {
    cloudflaredStatus.value = await window.smarthome.alice.probeCloudflared();
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
      toaster.push({
        kind: 'success',
        message: 'Токен получен — push-обновления Алисы включены',
      });
    } else {
      toaster.push({
        kind: 'error',
        message: result.error ?? 'Не удалось получить токен',
      });
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
    // derived
    deviceExposureById,
    sceneExposureById,
    nextActionHint,
    isLinked,
    isConfigured,
    tunnelRunning,
    publicUrl,
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
    generateOauthCredentials,
    fetchDialogsCallbackToken,
  };
});
