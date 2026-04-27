<template>
  <!-- Stable root: section всегда в DOM, даже до hydration device.
       Transition в App.vue использует Component != null. -->
  <section class="detail" ref="root">
    <template v-if="device">
    <BasePageHeader back :title="device.name" :description="`${driverLabel} · ${device.address}`">
      <template #actions>
        <BaseButton
          variant="ghost"
          size="sm"
          icon-left="refresh"
          :loading="refreshing"
          :class="{ 'is-just-refreshed': justRefreshed }"
          @click="refresh"
        >
          {{ refreshing ? 'Обновляю…' : justRefreshed ? 'Обновлено' : 'Обновить' }}
        </BaseButton>
        <BaseButton variant="danger" size="sm" icon-left="trash" @click="remove">
          Удалить
        </BaseButton>
      </template>
    </BasePageHeader>

    <div class="detail__layout">
      <!-- Speaker hero: AliceStationPanel (now-playing/volume/transport/log)
           + категории команд + PC-stream. -->
      <SpeakerControlSurface
        v-if="isYandexStation"
        :device="device"
        class="detail__speaker-surface"
        data-anim="block"
      />

      <!-- Generic hero для всех остальных устройств. -->
      <div
        v-else
        class="detail__hero card card--gradient"
        :class="{
          'detail__hero--on': isOn,
          'detail__hero--off': hasOnOff && !isOn,
        }"
        :style="heroStyle"
        data-anim="block"
      >
        <div class="detail__hero-icon" v-safe-html="iconFor(device.type)" />
        <div class="detail__hero-text">
          <span class="text--micro">{{ statusLabel }}</span>
          <h2 class="text--display detail__hero-title">{{ device.name }}</h2>
          <span class="detail__hero-status" :data-state="device.status">
            <span class="detail__hero-dot" />
            {{ statusChipLabel }}
          </span>
        </div>
      </div>

      <!-- Capabilities. На станции скрыты quasar.* (TTS/voice — в SpeakerControlSurface).
           Остальное: LED, cloud-volume, режимы. -->
      <div v-if="visibleCapabilities.length" class="card detail__capabilities" data-anim="block">
        <h3 class="text--h2">
          {{ isYandexStation ? 'Дополнительные возможности' : 'Управление' }}
        </h3>
        <p v-if="isYandexStation" class="text--small detail__capabilities-hint">
          Подсветка, режимы и прочие возможности колонки, которых нет в пульте выше.
          Идут через cloud-API «Дома с Алисой».
        </p>
        <div class="detail__caps">
          <div
            v-for="(cap, idx) in visibleCapabilities"
            :key="`${cap.type}::${cap.parameters?.instance ?? cap.state?.instance ?? idx}`"
            class="detail__cap"
          >
            <CapabilityControl :device="device" :capability="cap" />
          </div>
        </div>
      </div>

      <div
        v-if="visibleProperties.length"
        class="card detail__props"
        data-anim="block"
      >
        <h3 class="text--h2">Показания</h3>
        <ul class="detail__props-list">
          <li
            v-for="(p, idx) in visibleProperties"
            :key="`${p.type}::${p.parameters.instance ?? idx}`"
            class="prop"
            :class="{
              'prop--has-bar': hasProgressBar(p.parameters.instance),
              'prop--state': isStateProp(p.parameters.instance),
            }"
            :style="{ '--prop-accent': propAccent(p.parameters.instance) }"
          >
            <span class="prop__icon" v-safe-html="propIcon(p.parameters.instance)" />
            <span class="prop__label">{{ propLabel(p.parameters.instance) }}</span>

            <span
              v-if="isStateProp(p.parameters.instance)"
              class="prop__chip"
              :data-tone="statePropTone(p.parameters.instance, p.state?.value)"
            >
              <span class="prop__chip-dot" />
              {{ statePropLabel(p.parameters.instance, p.state?.value) }}
            </span>

            <strong v-else class="prop__value">
              {{ formatPropValue(p.state?.value) }}{{ unitFor(p.parameters.unit) }}
            </strong>

            <div
              v-if="hasProgressBar(p.parameters.instance)"
              class="prop__bar"
              :style="{ '--progress': `${clamp01(Number(p.state?.value)) * 100}%` }"
            >
              <span class="prop__bar-fill" />
            </div>
          </li>
        </ul>
      </div>

      <div class="card detail__assignment" data-anim="block">
        <h3 class="text--h2">Размещение</h3>
        <p v-if="!isYandexImported" class="text--small detail__assignment-hint">
          Имя и комната — основные поля для голосовых команд через Алису.
        </p>
        <div v-else class="banner banner--warning detail__yandex-banner">
          <span class="banner__icon">
            <BaseIcon name="alice" :size="18" />
          </span>
          <div class="banner__copy">
            <span class="banner__title">Управляется «Домом с Алисой»</span>
            <span class="banner__text">
              Имя и комната синхронизируются из приложения. Меняйте в «Доме с Алисой» — иначе правки
              затрутся при следующей синхронизации.
            </span>
          </div>
        </div>
        <div class="detail__assignment-row">
          <BaseInput
            label="Имя устройства"
            :model-value="device.name"
            :disabled="isYandexImported"
            @change="onRename(String($event))"
          />
          <BaseSelect
            label="Комната"
            :model-value="device.room ?? ''"
            :options="roomOptions"
            :disabled="isYandexImported"
            placeholder="— Без комнаты —"
            @change="onRoomChange(String($event))"
          />
        </div>
        <RouterLink to="/rooms" class="text--small detail__link">
          Управление комнатами
          <BaseIcon name="arrow-right" :size="11" />
        </RouterLink>
      </div>

      <details
        class="card detail__meta"
        data-anim="block"
        @toggle="onMetaToggle"
      >
        <summary class="detail__meta-summary">
          <span class="detail__meta-summary-icon">
            <BaseIcon name="info" :size="14" />
          </span>
          <span class="detail__meta-summary-title">Технические данные</span>
          <span class="detail__meta-summary-hint text--micro">для отладки</span>
          <BaseIcon name="arrow-right" :size="14" class="detail__meta-summary-chevron" />
        </summary>
        <dl class="detail__dl">
          <div>
            <dt>ID</dt>
            <dd>{{ device.id }}</dd>
          </div>
          <div>
            <dt>Внешний ID</dt>
            <dd>{{ device.externalId }}</dd>
          </div>
          <div>
            <dt>Тип</dt>
            <dd>{{ device.type }}</dd>
          </div>
          <div>
            <dt>Драйвер</dt>
            <dd>{{ device.driver }}</dd>
          </div>
          <div>
            <dt>Адрес</dt>
            <dd>{{ device.address }}</dd>
          </div>
          <div v-if="device.lastSeenAt">
            <dt>Последняя связь</dt>
            <dd>{{ formatDate(device.lastSeenAt) }}</dd>
          </div>
        </dl>
      </details>
    </div>

    <ConfirmDialog
      v-model="confirmRemove"
      title="Удалить устройство?"
      :message="`«${device.name}» будет отключено от хаба. Вы сможете снова найти его через сканирование сети.`"
      confirm-label="Удалить"
      confirm-icon="trash"
      tone="danger"
      :loading="removing"
      @confirm="performRemove"
    />
    </template>
    <!-- Loading-shell: skeleton + BasePageHeader до hydration device. -->
    <template v-else>
      <BasePageHeader back title="Загружаем устройство…" description="Тянем актуальное состояние из реестра." />
      <div class="detail__skeleton card" data-anim="block">
        <div class="detail__skeleton-bar detail__skeleton-bar--md" />
        <div class="detail__skeleton-bar detail__skeleton-bar--sm" />
        <div class="detail__skeleton-bar detail__skeleton-bar--lg" />
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices';
import { useRoomsStore } from '@/stores/rooms';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useToasterStore } from '@/stores/toaster';
import { useViewMount } from '@/composables/useViewMount';
import { useGsap } from '@/composables/useGsap';
import CapabilityControl from '@/components/devices/CapabilityControl.vue';
import SpeakerControlSurface from '@/components/devices/SpeakerControlSurface.vue';
import {
  BaseButton,
  BaseIcon,
  BaseInput,
  BaseSelect,
  BasePageHeader,
  ConfirmDialog,
  type SelectOption,
} from '@/components/base';
import type { Device } from '@smarthome/shared';
import { DRIVER_SHORT_LABEL } from '@smarthome/shared';

const route = useRoute();
const router = useRouter();
const devices = useDevicesStore();
const rooms = useRoomsStore();
const station = useYandexStationStore();
const toaster = useToasterStore();
const root = useTemplateRef<HTMLElement>('root');

// useGsap читает motionLevel из ui store: длительности и stagger масштабируются
// автоматически (off → set, reduced → opacity-only × 0.6, full → × 1.15).
const { from: metaFrom } = useGsap(null);

function onMetaToggle(e: Event): void {
  const el = e.target as HTMLDetailsElement;
  if (!el.open) return;
  const rows = el.querySelectorAll('.detail__dl > div');
  if (!rows.length) return;
  metaFrom(rows, {
    opacity: 0,
    x: -10,
    stagger: 0.045,
    duration: 0.36,
    ease: 'power2.out',
    clearProps: 'opacity,transform',
  });
}

const id = computed(() => String(route.params.id));
const device = computed(() => devices.byId.get(id.value));

/** Yandex-импортированное устройство: name/room read-only (синхронизируется из Алисы). */
const isYandexImported = computed(() => device.value?.driver === 'yandex-iot');

const isYandexStation = computed(() => {
  const d = device.value;
  if (!d) return false;
  if (d.driver !== 'yandex-iot') return false;
  if (d.type.startsWith('devices.types.media_device')) return true;
  // Fallback: capabilities `devices.capabilities.quasar*` — маркер станции.
  return d.capabilities.some((c) => c.type.startsWith('devices.capabilities.quasar'));
});

/** Эта станция сейчас управляется через локальный glagol-WS? */
const hasLiveGlagolSession = computed(
  () => isYandexStation.value && station.status?.connection === 'connected',
);

/**
 * Capabilities для рендера ниже SpeakerControlSurface.
 * На станции `devices.capabilities.quasar*` скрыты (TTS/voice — в пульте).
 */
const visibleCapabilities = computed(() => {
  const all = device.value?.capabilities ?? [];
  if (!isYandexStation.value) return all;
  return all.filter((c) => !c.type.startsWith('devices.capabilities.quasar'));
});

/**
 * Real-time aliceState из glagol-WS для подмены `voice_activity` property
 * на станции. Cloud-snapshot не содержит мгновенного playback-state'а.
 */
const liveVoiceActivity = computed<string | null>(() => {
  if (!hasLiveGlagolSession.value) return null;
  for (const e of [...station.events].reverse()) {
    if (e.aliceState) return e.aliceState.toLowerCase();
  }
  return null;
});

/**
 * Properties для рендера:
 *   1. Live `voice_activity` из glagol-WS на станции с открытым WS.
 *   2. Filter: properties без значения скрыты.
 */
const visibleProperties = computed(() => {
  const all = device.value?.properties ?? [];
  return all
    .map((p) => {
      if (
        isYandexStation.value &&
        p.parameters.instance === 'voice_activity' &&
        liveVoiceActivity.value
      ) {
        return {
          ...p,
          state: { instance: 'voice_activity', value: liveVoiceActivity.value },
        };
      }
      return p;
    })
    .filter((p) => p.state?.value !== undefined && p.state?.value !== null && p.state?.value !== '');
});

const driverLabel = computed<string>(
  () => DRIVER_SHORT_LABEL[device.value?.driver ?? 'yeelight'] ?? '—',
);

const statusLabel = computed(
  () =>
    ({
      online: 'В сети',
      offline: 'Не в сети',
      unreachable: 'Недоступно',
      pairing: 'Сопряжение',
    })[device.value?.status ?? 'offline'],
);

const statusChipLabel = computed(
  () =>
    ({
      online: 'Онлайн',
      offline: 'Оффлайн',
      unreachable: 'Недоступно',
      pairing: 'Сопряжение',
    })[device.value?.status ?? 'offline'],
);

// Hero accent: цвет RGB-лампы из color_setting, fallback — gradient-brand.

const onOffCap = computed(() =>
  device.value?.capabilities.find((c) => c.type === 'devices.capabilities.on_off'),
);
const hasOnOff = computed(() => !!onOffCap.value);
const isOn = computed(() => Boolean(onOffCap.value?.state?.value));

const heroAccentRgb = computed<string | null>(() => {
  const colorCap = device.value?.capabilities.find(
    (c) => c.type === 'devices.capabilities.color_setting',
  );
  if (colorCap?.state?.instance === 'rgb' && typeof colorCap.state.value === 'number') {
    return `#${colorCap.state.value.toString(16).padStart(6, '0')}`;
  }
  return null;
});

const heroStyle = computed(() => {
  const accent = heroAccentRgb.value;
  if (!accent) return {};
  return {
    '--hero-accent': accent,
  };
});

function iconFor(type: Device['type']): string {
  const ICONS: Record<string, string> = {
    'devices.types.light':
      '<svg viewBox="0 0 24 24" fill="none"><path d="M9 18h6M10 21h4M12 3a6 6 0 016 6c0 2.4-1.4 4.4-3 5.4V17H9v-2.6C7.4 13.4 6 11.4 6 9a6 6 0 016-6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    'devices.types.socket':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.6"/><circle cx="9.5" cy="11" r="1.2" fill="currentColor"/><circle cx="14.5" cy="11" r="1.2" fill="currentColor"/><path d="M8 16h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    'devices.types.switch':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="9" width="18" height="6" rx="3" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="12" r="2" fill="currentColor"/></svg>',
    'devices.types.sensor':
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v8.5M12 16a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" stroke-width="1.6"/><path d="M5 18.5a8 8 0 0114 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    'devices.types.thermostat':
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    'devices.types.media_device':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M10 9l6 3-6 3z" fill="currentColor"/></svg>',
    'devices.types.media_device.tv':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    'devices.types.media_device.tv_box':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="7" width="18" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><circle cx="17.5" cy="12" r="1.2" fill="currentColor"/></svg>',
    'devices.types.vacuum_cleaner':
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/></svg>',
    'devices.types.humidifier':
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3s5 6 5 10a5 5 0 11-10 0c0-4 5-10 5-10z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    'devices.types.purifier':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="14" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M9 7h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    'devices.types.other':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
  };
  return ICONS[type] ?? ICONS['devices.types.other']!;
}

const PROP_LABELS: Record<string, string> = {
  temperature: 'Температура',
  humidity: 'Влажность',
  illumination: 'Освещённость',
  co2_level: 'CO₂',
  pm2_5_density: 'PM2.5',
  power: 'Потребление',
  voltage: 'Напряжение',
  amperage: 'Ток',
  energy: 'Энергия',
  battery_level: 'Заряд батареи',
  link_quality: 'Качество связи',
  voice_activity: 'Голосовой ассистент',
  open: 'Состояние',
  motion: 'Движение',
  vibration: 'Вибрация',
  smoke: 'Задымление',
  gas: 'Утечка газа',
  water_leak: 'Протечка',
  button: 'Кнопка',
};

const PROP_ICONS: Record<string, string> = {
  temperature:
    '<svg viewBox="0 0 16 16" fill="none"><path d="M5 4v6.5a2.8 2.8 0 105.6 0V4a2.8 2.8 0 10-5.6 0z" stroke="currentColor" stroke-width="1.4"/><circle cx="7.8" cy="11.2" r="1.4" fill="currentColor"/></svg>',
  humidity:
    '<svg viewBox="0 0 16 16" fill="none"><path d="M8 1.5s4 4.5 4 7.5a4 4 0 11-8 0c0-3 4-7.5 4-7.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  battery_level:
    '<svg viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="11" height="6" rx="1.4" stroke="currentColor" stroke-width="1.4"/><rect x="13.5" y="6.5" width="1.5" height="3" rx="0.5" fill="currentColor"/><rect x="3.5" y="6.5" width="6" height="3" rx="0.5" fill="currentColor"/></svg>',
  illumination:
    '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  co2_level:
    '<svg viewBox="0 0 16 16" fill="none"><circle cx="5.5" cy="9" r="2.5" stroke="currentColor" stroke-width="1.4"/><circle cx="10.5" cy="9" r="2.5" stroke="currentColor" stroke-width="1.4"/></svg>',
  pm2_5_density:
    '<svg viewBox="0 0 16 16" fill="none"><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="4.5" r="0.7" fill="currentColor"/><circle cx="12" cy="9" r="1.2" fill="currentColor"/><circle cx="6" cy="11" r="0.8" fill="currentColor"/><circle cx="10" cy="12" r="0.9" fill="currentColor"/></svg>',
  power:
    '<svg viewBox="0 0 16 16" fill="none"><path d="M9 1.5L4 9h4l-1 5.5L13 7H9l1-5.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="currentColor" fill-opacity="0.15"/></svg>',
  voltage:
    '<svg viewBox="0 0 16 16" fill="none"><path d="M9 1.5L4 9h4l-1 5.5L13 7H9l1-5.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  amperage:
    '<svg viewBox="0 0 16 16" fill="none"><path d="M5 14L9 2l3 5h-2l1 7H7" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  energy:
    '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 4v4l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  link_quality:
    '<svg viewBox="0 0 16 16" fill="none"><path d="M2 9l3-3 3 2 3-4 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  voice_activity:
    '<svg viewBox="0 0 16 16" fill="none"><rect x="6" y="2" width="4" height="7.5" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 8.5a4.5 4.5 0 009 0M8 13v1.4M5.6 14.4h4.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
};

const PROGRESS_BAR_INSTANCES = new Set(['humidity', 'battery_level']);

const PROP_ACCENTS: Record<string, string> = {
  temperature: '#ff9a6e',
  humidity: '#5bd8ff',
  battery_level: '#5eea89',
  illumination: '#ffd27d',
  co2_level: '#a961ff',
  power: '#ff61e6',
  voltage: '#ffd27d',
  amperage: '#ff7a8a',
  voice_activity: 'var(--color-text-secondary)',
};

// State-style props (вместо number/value — chip с dot и human-label).
const STATE_PROP_INSTANCES = new Set(['voice_activity', 'open', 'motion', 'vibration', 'smoke', 'gas', 'water_leak', 'button']);

interface VoiceState {
  label: string;
  tone: 'idle' | 'active' | 'processing';
}
const VOICE_ACTIVITY_STATES: Record<string, VoiceState> = {
  idle: { label: 'Ожидает команду', tone: 'idle' },
  listening: { label: 'Слушает', tone: 'active' },
  recognizing: { label: 'Распознаёт речь', tone: 'processing' },
  speaking: { label: 'Говорит', tone: 'active' },
  thinking: { label: 'Думает', tone: 'processing' },
  shazam: { label: 'Распознаёт музыку', tone: 'processing' },
};

function isStateProp(instance: string): boolean {
  return STATE_PROP_INSTANCES.has(instance);
}

function statePropLabel(instance: string, value: unknown): string {
  const v = String(value ?? '').toLowerCase();
  if (instance === 'voice_activity') return VOICE_ACTIVITY_STATES[v]?.label ?? (v || '—');
  if (instance === 'open') return v === 'true' || v === 'opened' ? 'Открыто' : 'Закрыто';
  if (instance === 'motion') return v === 'true' || v === 'detected' ? 'Движение' : 'Покой';
  if (instance === 'vibration') return v === 'true' || v === 'detected' ? 'Вибрация' : 'Покой';
  if (instance === 'smoke') return v === 'true' || v === 'detected' ? 'Задымление' : 'Норма';
  if (instance === 'gas') return v === 'true' || v === 'detected' ? 'Утечка' : 'Норма';
  if (instance === 'water_leak') return v === 'true' || v === 'leak' ? 'Протечка' : 'Сухо';
  return v || '—';
}

function statePropTone(instance: string, value: unknown): 'idle' | 'active' | 'alert' | 'processing' {
  const v = String(value ?? '').toLowerCase();
  if (instance === 'voice_activity') {
    const tone = VOICE_ACTIVITY_STATES[v]?.tone;
    if (tone === 'active') return 'active';
    if (tone === 'processing') return 'processing';
    return 'idle';
  }
  const triggered = v === 'true' || v === 'detected' || v === 'opened' || v === 'leak';
  if (instance === 'smoke' || instance === 'gas' || instance === 'water_leak') {
    return triggered ? 'alert' : 'idle';
  }
  return triggered ? 'active' : 'idle';
}

function propLabel(instance: string): string {
  return PROP_LABELS[instance] ?? instance;
}
function propIcon(instance: string): string {
  return (
    PROP_ICONS[instance] ??
    '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/></svg>'
  );
}
function propAccent(instance: string): string {
  return PROP_ACCENTS[instance] ?? 'var(--color-brand-purple)';
}
function hasProgressBar(instance: string): boolean {
  return PROGRESS_BAR_INSTANCES.has(instance);
}
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v / 100));
}
function formatPropValue(value: unknown): string {
  if (value == null) return '—';
  const n = Number(value);
  if (Number.isFinite(n)) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  return String(value);
}

const unitFor = (unit?: string) =>
  unit === 'unit.temperature.celsius'
    ? '°C'
    : unit === 'unit.percent'
      ? '%'
      : unit === 'unit.watt'
        ? ' Вт'
        : '';

const formatDate = (iso: string) => new Date(iso).toLocaleString('ru-RU');

const confirmRemove = ref(false);
const refreshing = ref(false);
const removing = ref(false);
const justRefreshed = ref(false);

async function refresh(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await devices.refresh(id.value);
    justRefreshed.value = true;
    setTimeout(() => {
      justRefreshed.value = false;
    }, 1400);
  } finally {
    refreshing.value = false;
  }
}
function remove(): void {
  confirmRemove.value = true;
}
async function performRemove(): Promise<void> {
  if (removing.value) return;
  const name = device.value?.name ?? 'Устройство';
  removing.value = true;
  try {
    await devices.remove(id.value);
    confirmRemove.value = false;
    toaster.push({ kind: 'info', message: `«${name}» удалено` });
    router.replace('/devices');
  } finally {
    removing.value = false;
  }
}

async function onRename(next: string): Promise<void> {
  const trimmed = next.trim();
  if (!trimmed || trimmed === device.value?.name) return;
  await devices.rename(id.value, trimmed);
  toaster.push({ kind: 'success', message: 'Имя обновлено' });
}

async function onRoomChange(next: string): Promise<void> {
  const roomId = next || null;
  await window.smarthome.devices.setRoom(id.value, roomId);
  toaster.push({
    kind: 'success',
    message: roomId
      ? `Перемещено в «${rooms.rooms.find((r) => r.id === roomId)?.name ?? '…'}»`
      : 'Убрано из комнаты',
  });
}

const roomOptions = computed<SelectOption[]>(() => [
  { value: '', label: '— Без комнаты —' },
  ...rooms.rooms.map((r) => ({ value: r.id, label: r.name })),
]);

onMounted(async () => {
  if (!rooms.rooms.length) await rooms.bootstrap();
  if (id.value && devices.byId.get(id.value)) {
    void devices.refresh(id.value).catch(() => {
      /* best-effort: errors logged в registry/driver */
    });
  }
});

useViewMount({ scope: root });
</script>

<style scoped lang="scss">
// Success-feedback после refresh: success-rim + glow + icon-flash. Класс снимается через 1.4с.
:deep(.base-button.is-just-refreshed) {
  border-color: rgba(var(--color-success-rgb), 0.55) !important;
  color: var(--color-success) !important;
  box-shadow:
    0 0 0 1px rgba(var(--color-success-rgb), 0.4),
    0 6px 18px rgba(var(--color-success-rgb), 0.22) !important;
  transition:
    border-color 240ms var(--ease-out),
    color 240ms var(--ease-out),
    box-shadow 240ms var(--ease-out);

  .base-button__icon--left {
    animation: refreshTickPulse 0.6s var(--ease-spring);
  }
}

@keyframes refreshTickPulse {
  0% {
    transform: rotate(-180deg) scale(0.6);
    opacity: 0.5;
  }
  60% {
    transform: rotate(15deg) scale(1.18);
    opacity: 1;
  }
  100% {
    transform: rotate(0) scale(1);
    opacity: 1;
  }
}

.detail {
  display: flex;
  flex-direction: column;
  gap: var(--content-gap);

  // Loading-skeleton bars — shimmer placeholder до hydration device.
  // Размеры выровнены с реальной картой.
  &__skeleton {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: clamp(20px, 2vw, 28px);
    min-height: 220px;
  }
  &__skeleton-bar {
    height: 14px;
    border-radius: 8px;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.085) 50%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: detailSkelShimmer 1.6s linear infinite;

    &--sm { width: 35%; }
    &--md { width: 60%; }
    &--lg { width: 90%; }
  }

  @keyframes detailSkelShimmer {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }

  &__layout {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 16px;

    @media (max-width: 960px) {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  // ---- Hero ----------------------------------------------------------------

  &__hero {
    --hero-accent: var(--color-brand-purple);
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 24px;
    padding: 32px;
    min-height: 200px;
    position: relative;
    overflow: hidden;
    transition:
      box-shadow 360ms var(--ease-out),
      background-color 360ms var(--ease-out);

    &--on {
      box-shadow:
        0 0 60px -10px color-mix(in srgb, var(--hero-accent) 45%, transparent),
        inset 0 0 60px -20px color-mix(in srgb, var(--hero-accent) 30%, transparent);
    }
    &--off {
      filter: saturate(0.7);
      opacity: 0.92;
    }

    @media (max-width: 720px) {
      gap: 14px;
      padding: 18px;
      min-height: 0;
      flex-direction: column;
      align-items: flex-start;
      text-align: left;
    }
  }

  &__hero-icon {
    width: 96px;
    height: 96px;
    flex-shrink: 0;
    border-radius: 28px;
    display: grid;
    @media (max-width: 720px) {
      width: 64px;
      height: 64px;
      border-radius: 20px;
    }
    place-items: center;
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
    transition:
      background 360ms var(--ease-out),
      box-shadow 360ms var(--ease-out),
      transform 480ms var(--ease-spring);

    :deep(svg) {
      width: 56px;
      height: 56px;
      transition: filter 360ms var(--ease-out);
    }
  }

  &__hero--on &__hero-icon {
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--hero-accent) 80%, white 0%) 0%,
      color-mix(in srgb, var(--hero-accent) 50%, transparent) 100%
    );
    box-shadow:
      0 14px 36px -8px color-mix(in srgb, var(--hero-accent) 60%, transparent),
      inset 0 0 0 1px rgba(255, 255, 255, 0.12);
    transform: translateY(-1px);

    :deep(svg) {
      filter: drop-shadow(0 0 8px color-mix(in srgb, var(--hero-accent) 50%, transparent));
    }
  }

  &__hero-text {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  &__hero-title {
    overflow-wrap: anywhere;
  }

  &__hero-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px 5px 10px;
    border-radius: var(--radius-pill);
    font-size: 12.5px;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.06);
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border-subtle);
    align-self: flex-start;
    transition:
      background 200ms var(--ease-out),
      color 200ms var(--ease-out),
      border-color 200ms var(--ease-out);

    &[data-state='online'] {
      background: rgba(94, 234, 137, 0.12);
      color: #5eea89;
      border-color: rgba(94, 234, 137, 0.32);
    }
    &[data-state='offline'],
    &[data-state='unreachable'] {
      background: rgba(255, 122, 138, 0.1);
      color: #ff7a8a;
      border-color: rgba(255, 122, 138, 0.28);
    }
  }

  &__hero-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 0 0 currentColor;
    flex-shrink: 0;
  }

  &__hero-status[data-state='online'] &__hero-dot {
    animation: heroDotPulse 2s ease-out infinite;
  }

  &__caps {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  &__capabilities-hint {
    color: var(--color-text-muted);
    margin-top: 4px;
    margin-bottom: 4px;
    line-height: 1.5;
    text-wrap: pretty;
    max-width: 64ch;
  }

  // ---- Speaker surface mount -----------------------------------------------
  // Кастомный пульт колонки занимает всю ширину layout-grid'а.
  &__speaker-surface {
    grid-column: 1 / -1;
  }

  &__props-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    list-style: none;
    margin-top: 14px;
    padding: 0;
  }

  &__assignment {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  &__assignment-hint {
    color: var(--color-text-secondary);
    line-height: 1.5;
    margin: 0;
    max-width: 60ch;
  }

  // Yandex-import warning: brand-amber tint, icon-box с alice-glyph.
  &__yandex-banner {
    --banner-tone: #ffcc00;
    --banner-tone-rgb: 255, 204, 0;
    --banner-bg: rgba(255, 204, 0, 0.08);
    --banner-edge: rgba(255, 204, 0, 0.28);

    :deep(.banner__icon) {
      --icon-tone: #ffcc00;
      --icon-tone-rgb: 255, 204, 0;
    }
  }

  &__assignment-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;

    @media (max-width: 720px) {
      grid-template-columns: 1fr;
    }
  }

  &__link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-brand-violet);
    align-self: flex-start;
    font-weight: 500;
    transition: color 160ms var(--ease-out), gap 160ms var(--ease-out);

    &:hover {
      color: var(--color-text-primary);
      gap: 8px;
    }
  }

  // Метаданные: collapsible <details> с brand-styled summary.
  &__meta {
    padding: 0;
    overflow: hidden;

    &[open] {
      .detail__meta-summary-chevron {
        transform: rotate(90deg);
      }
    }
  }

  &__meta-summary {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 12px;
    padding: clamp(16px, 2vw, 24px);
    cursor: pointer;
    user-select: none;
    list-style: none;
    transition: background 200ms var(--ease-out);

    &::-webkit-details-marker {
      display: none;
    }

    &:hover {
      background: rgba(255, 255, 255, 0.025);
    }

    &-icon {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      background: rgba(255, 255, 255, 0.05);
      color: var(--color-text-muted);
      flex-shrink: 0;
    }

    &-title {
      font-family: var(--font-family-display);
      font-size: var(--font-size-h2);
      font-weight: 600;
      color: var(--color-text-primary);
      letter-spacing: var(--tracking-h2);
    }

    &-hint {
      color: var(--color-text-muted);
    }

    &-chevron {
      color: var(--color-text-muted);
      transition: transform 240ms var(--ease-spring);
      flex-shrink: 0;
    }
  }

  // Property-inspector pattern: hairline-разделители между строк, no per-row
  // chips. Label fixed 130px (alignment column), value mono right of it.
  &__dl {
    display: flex;
    flex-direction: column;
    padding: 0 clamp(16px, 2vw, 24px) clamp(16px, 2vw, 24px);
    margin: 0;

    div {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 20px;
      padding: 12px 8px;
      transition: background var(--dur-fast) var(--ease-out);
      position: relative;
    }

    div + div {
      border-top: var(--border-thin) solid var(--color-border-subtle);
    }

    div:hover {
      background: rgba(var(--color-brand-violet-rgb), 0.05);
    }

    // Brand-accent left bar при hover — тонкий violet→pink stripe слева.
    div::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%) scaleY(0);
      transform-origin: center;
      width: 2px;
      height: 60%;
      border-radius: 2px;
      background: var(--gradient-brand);
      transition: transform var(--dur-medium) var(--ease-spring);
    }

    div:hover::before {
      transform: translateY(-50%) scaleY(1);
    }

    dt {
      flex: 0 0 130px;
      max-width: 130px;
      color: var(--color-text-muted);
      font-weight: 600;
      font-size: 10.5px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding-left: 8px;
    }

    dd {
      flex: 1 1 200px;
      margin: 0;
      color: var(--color-text-primary);
      font-family: var(--font-family-mono);
      font-size: 12.5px;
      overflow-wrap: anywhere;
      word-break: break-word;
      min-width: 0;
      line-height: 1.55;
    }
  }
}

// Property tile — icon + label + value + опциональный progress-bar.
.prop {
  --prop-accent: var(--color-brand-purple);
  position: relative;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  grid-template-areas:
    'icon label value'
    'icon label value';
  align-items: center;
  gap: 4px 12px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-subtle);
  transition:
    background 200ms var(--ease-out),
    border-color 200ms var(--ease-out),
    transform 240ms var(--ease-spring);

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: var(--color-border-soft);
    transform: translateY(-1px);
  }

  &--has-bar {
    grid-template-areas:
      'icon label value'
      'icon bar bar';
    row-gap: 8px;
    padding-bottom: 12px;
  }

  &__icon {
    grid-area: icon;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    display: grid;
    place-items: center;
    color: var(--prop-accent);
    background: color-mix(in srgb, var(--prop-accent) 14%, transparent);
    flex-shrink: 0;

    :deep(svg) {
      width: 18px;
      height: 18px;
    }
  }

  &__label {
    grid-area: label;
    font-size: 12px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__value {
    grid-area: value;
    font-family: var(--font-family-display);
    font-size: 22px;
    font-weight: 700;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  // State chip: idle / active / processing / alert tone.
  &__chip {
    grid-area: value;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 11px 5px 9px;
    border-radius: var(--radius-pill);
    font-size: 12.5px;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
    justify-self: end;
    line-height: 1;
    white-space: nowrap;

    &-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      flex-shrink: 0;
    }

    &[data-tone='idle'] {
      color: var(--color-text-muted);
    }

    &[data-tone='active'] {
      color: var(--color-success);
      background: rgba(var(--color-success-rgb), 0.12);
      border-color: rgba(var(--color-success-rgb), 0.3);

      .prop__chip-dot {
        animation: heroDotPulse 2s ease-out infinite;
      }
    }

    &[data-tone='processing'] {
      color: var(--color-brand-purple);
      background: rgba(var(--color-brand-purple-rgb), 0.1);
      border-color: rgba(var(--color-brand-purple-rgb), 0.28);

      .prop__chip-dot {
        animation: heroDotPulse 1.4s ease-out infinite;
      }
    }

    &[data-tone='alert'] {
      color: var(--color-danger);
      background: rgba(var(--color-danger-rgb), 0.12);
      border-color: rgba(var(--color-danger-rgb), 0.32);

      .prop__chip-dot {
        animation: heroDotPulse 1s ease-out infinite;
      }
    }
  }

  &--state {
    grid-template-areas:
      'icon label value'
      'icon label value';
  }

  &__bar {
    grid-area: bar;
    height: 4px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
  }

  &__bar-fill {
    display: block;
    width: var(--progress, 0%);
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--color-brand-violet) 0%, var(--color-brand-pink) 100%);
    transition: width 480ms var(--ease-out);
  }
}

@keyframes heroDotPulse {
  0% {
    box-shadow: 0 0 0 0 currentColor;
  }
  70% {
    box-shadow: 0 0 0 6px color-mix(in srgb, currentColor 0%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 0%, transparent);
  }
}

:global(.app--reduce-motion) {
  .detail__hero-status[data-state='online'] .detail__hero-dot,
  .prop__chip-dot {
    animation: none;
  }
  .detail__hero,
  .detail__hero-icon,
  .detail__meta-summary-chevron {
    transition-duration: 0ms;
  }
}
</style>
