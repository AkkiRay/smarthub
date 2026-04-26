<template>
  <article
    class="device-card"
    :class="{
      'device-card--on': isOn,
      'device-card--offline': device.status !== 'online',
      'device-card--rgb': hasRgb,
    }"
    :style="{ '--device-accent': accentColor }"
    @click="$emit('click')"
  >
    <div class="device-card__top">
      <div class="device-card__icon">
        <span v-safe-html="iconSvg" />
      </div>
      <span class="chip" :class="device.status === 'online' ? 'chip--online' : 'chip--offline'">
        {{ device.status === 'online' ? 'Онлайн' : 'Оффлайн' }}
      </span>
    </div>

    <div class="device-card__body">
      <h3 class="device-card__name">{{ device.name }}</h3>
      <div class="device-card__tags">
        <span v-if="roomName" class="device-card__tag device-card__tag--room" :title="`Комната: ${roomName}`">
          <BaseIcon name="rooms" :size="11" />
          {{ roomName }}
        </span>
        <span
          v-if="hasRgb"
          class="device-card__swatch"
          :style="{ background: accentColor }"
          :title="`Цвет: ${accentColor.toUpperCase()}`"
        />
        <span class="device-card__tag device-card__tag--meta">{{ typeName }}</span>
        <span
          v-if="device.driver === 'yandex-iot'"
          class="device-card__tag device-card__tag--yandex"
          title="Импортировано из «Дома с Алисой»"
        >
          <BaseIcon name="alice" :size="10" />
          Yandex
        </span>
        <!-- Alice-чип: один тап выдаёт/отзывает устройство в skill «Дома с Алисой».
             Скрываем для yandex-iot (они уже видны Алисе как родные облачные устройства)
             и пока skill не привязан — иначе чип бесполезный. -->
        <button
          v-if="canToggleAliceExposure"
          type="button"
          class="device-card__alice-chip"
          :class="{ 'is-on': aliceExposed }"
          :title="aliceExposed ? 'Алиса видит это устройство — клик скроет' : 'Выдать в Алису одним кликом'"
          @click.stop="onToggleAliceExposure"
        >
          <BaseIcon name="alice" :size="11" />
          {{ aliceExposed ? 'В Алисе' : 'В Алису' }}
        </button>
      </div>
      <p v-if="primaryReading" class="device-card__reading">
        <BaseIcon :name="primaryReading.icon" :size="12" />
        <span>{{ primaryReading.label }}: <strong>{{ primaryReading.value }}</strong></span>
      </p>
    </div>

    <div class="device-card__controls" @click.stop>
      <BaseSwitch
        v-if="onOffCap"
        class="device-card__switch"
        size="sm"
        :model-value="isOn"
        :loading="busy"
        :disabled="device.status !== 'online'"
        @update:model-value="togglePower"
      />

      <!-- Inline brightness — без захода в DeviceDetailView. -->
      <div v-if="brightness !== null" class="device-card__bright">
        <input
          class="device-card__range"
          type="range"
          :min="brightnessRange.min"
          :max="brightnessRange.max"
          :step="brightnessRange.precision"
          :value="brightnessLocal"
          :disabled="device.status !== 'online' || !isOn"
          :style="{ '--progress': `${brightnessProgress}%` }"
          @input="onBrightnessInput(($event.target as HTMLInputElement).valueAsNumber)"
          @change="onBrightnessChange(($event.target as HTMLInputElement).valueAsNumber)"
        />
        <span class="device-card__bright-value">{{ brightnessLocal }}%</span>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Device } from '@smarthome/shared';
import {
  CAPABILITY,
  DEVICE_TYPE_LABEL_RU,
  INSTANCE,
  PROPERTY,
  RANGE,
  deviceIconFor,
  findCapability,
  intToHex,
} from '@smarthome/shared';
import { useDevicesStore } from '@/stores/devices';
import { useRoomsStore } from '@/stores/rooms';
import { useAliceStore } from '@/stores/alice';
import BaseSwitch from '@/components/base/BaseSwitch.vue';
import BaseIcon, { type IconName } from '@/components/base/BaseIcon.vue';

const props = defineProps<{ device: Device }>();
defineEmits<{ click: [] }>();

const devices = useDevicesStore();
const rooms = useRoomsStore();
const alice = useAliceStore();

// busy-flag блокирует двойные клики во время выполнения команды.
const busy = ref(false);

const onOffCap = computed(() =>
  findCapability(props.device.capabilities, CAPABILITY.ON_OFF, INSTANCE.ON),
);
const isOn = computed(() => Boolean(onOffCap.value?.state?.value));

const brightnessCap = computed(() =>
  findCapability(props.device.capabilities, CAPABILITY.RANGE, INSTANCE.BRIGHTNESS),
);

const brightness = computed<number | null>(() => {
  const cap = brightnessCap.value;
  return cap?.state?.value != null ? Number(cap.state.value) : null;
});

const brightnessRange = computed(() => {
  const params = brightnessCap.value?.parameters as
    | { range?: { min?: number; max?: number; precision?: number } }
    | undefined;
  return {
    min: params?.range?.min ?? RANGE.PERCENT.min,
    max: params?.range?.max ?? RANGE.PERCENT.max,
    precision: params?.range?.precision ?? RANGE.PERCENT.precision,
  };
});

// Оптимистичный state: drag двигает локально, IPC уходит только на @change;
// dragLock блокирует внешние updates, чтобы значение не дёргалось.
const brightnessLocal = ref<number>(brightness.value ?? brightnessRange.value.min);
const dragLock = ref(false);
watch(
  () => brightness.value,
  (v) => {
    if (!dragLock.value && v != null) brightnessLocal.value = v;
  },
);

const brightnessProgress = computed(() => {
  const { min, max } = brightnessRange.value;
  if (max <= min) return 0;
  return ((brightnessLocal.value - min) / (max - min)) * 100;
});

// Accent для --device-accent: реальный цвет лампы (rgb / hsv / temperature_k)
// или brand-purple fallback. Yandex IoT отдаёт state в одном из трёх форматов
// в зависимости от того, в каком режиме лампа сейчас. Все три обрабатываем,
// иначе hsv-only Лампочка показывает дефолтный фиолетовый вместо своего цвета.
const ACCENT_FALLBACK = 'var(--color-brand-purple)';

const colorCap = computed(() =>
  findCapability(props.device.capabilities, CAPABILITY.COLOR_SETTING),
);

/** State.value лампы конвертируется в hex `#RRGGBB` для CSS-переменной accent'а. */
const accentColor = computed<string>(() => {
  const state = colorCap.value?.state;
  if (!state) return ACCENT_FALLBACK;
  if (state.instance === INSTANCE.RGB && typeof state.value === 'number') {
    return intToHex(state.value);
  }
  if (state.instance === INSTANCE.HSV && typeof state.value === 'object' && state.value) {
    const v = state.value as { h?: number; s?: number; v?: number };
    if (typeof v.h === 'number' && typeof v.s === 'number' && typeof v.v === 'number') {
      return intToHex(hsvToRgbInt(v.h, v.s, v.v));
    }
  }
  if (state.instance === INSTANCE.TEMPERATURE_K && typeof state.value === 'number') {
    return intToHex(kelvinToRgbInt(state.value));
  }
  return ACCENT_FALLBACK;
});

/**
 * Карточка показывает RGB-каплю когда у лампы есть какой-то "цвет" (включая HSV
 * и CCT-mode). Capability должна быть, и иметь активный state — иначе клякса
 * показывала бы фолбэк-purple, что вводит в заблуждение.
 */
const hasRgb = computed(() => {
  const state = colorCap.value?.state;
  if (!state) return false;
  return (
    (state.instance === INSTANCE.RGB && typeof state.value === 'number') ||
    (state.instance === INSTANCE.HSV && typeof state.value === 'object' && state.value !== null) ||
    (state.instance === INSTANCE.TEMPERATURE_K && typeof state.value === 'number')
  );
});

/**
 * HSV (h:0..360, s:0..100, v:0..100) → 24-битный RGB-int.
 * Стандартный алгоритм из W3C CSS Color Module L4. Используется для отображения
 * текущего цвета hsv-лампы — отправлять в Yandex всё равно надо `instance:'rgb'`.
 */
function hsvToRgbInt(h: number, s: number, v: number): number {
  const sn = Math.max(0, Math.min(1, s / 100));
  const vn = Math.max(0, Math.min(1, v / 100));
  const c = vn * sn;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = vn - c;
  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);
  return (ri << 16) | (gi << 8) | bi;
}

/**
 * Цветовая температура в Кельвинах → приближённый RGB-int. Алгоритм Tanner Helland
 * (упрощённый): тёплый белый ~2700K → жёлто-оранжевый, дневной ~6500K → белый,
 * холодный ~9000K+ → голубоватый. Не идеально точно, но визуально достаточно
 * для swatch'а размером 14px.
 */
function kelvinToRgbInt(k: number): number {
  const t = Math.max(1000, Math.min(40000, k)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
  return (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
}

const iconSvg = computed(() => deviceIconFor(props.device.type));
const typeName = computed(() => DEVICE_TYPE_LABEL_RU[props.device.type]);

/**
 * Alice-exposure quick-toggle:
 *   - чип виден только когда skill связан (`alice.isLinked`) — иначе нет смысла
 *   - НЕ показываем для yandex-iot устройств: они УЖЕ в Алисе как облачные родные
 *     (выдавать их повторно в наш skill = дублирование)
 *   - default state — `enabled: true` (см. `device-mapper.ts:buildExposedDeviceList`)
 */
const canToggleAliceExposure = computed(
  () => alice.isLinked && props.device.driver !== 'yandex-iot',
);
const aliceExposed = computed(() => {
  const exp = alice.deviceExposureById.get(props.device.id);
  return exp?.enabled !== false;
});

async function onToggleAliceExposure(): Promise<void> {
  await alice.setDeviceExposure({
    deviceId: props.device.id,
    enabled: !aliceExposed.value,
  });
}

/**
 * Имя комнаты — резолвим по цепочке fallback'ов, чтобы tag отрисовался даже
 * когда часть данных ещё не подъехала:
 *   1. device.room (id) → rooms-store.find    — основной join
 *   2. meta.roomId → rooms-store.find          — для девайсов, где room пока не
 *      перезаписан после нашего room-фикса (старые записи в БД).
 *   3. meta.roomName                           — последний оплот: snapshot из Yandex
 *      хранит читаемое имя, его хватает до загрузки rooms-store'а.
 */
const roomName = computed<string | null>(() => {
  const direct = props.device.room
    ? rooms.rooms.find((x) => x.id === props.device.room)?.name
    : null;
  if (direct) return direct;
  const metaRoomId = props.device.meta?.['roomId'];
  if (typeof metaRoomId === 'string') {
    const viaMeta = rooms.rooms.find((x) => x.id === metaRoomId)?.name;
    if (viaMeta) return viaMeta;
  }
  const fallback = props.device.meta?.['roomName'];
  return typeof fallback === 'string' ? fallback : null;
});

/**
 * Самый интересный read-only показатель — выбираем по приоритету: температура
 * → влажность → CO₂ → power → battery. Один показатель в карточке достаточно;
 * остальные видны на DeviceDetailView.
 */
interface Reading {
  icon: IconName;
  label: string;
  value: string;
}
const READING_PRIORITY: ReadonlyArray<{ instance: string; icon: IconName; label: string }> = [
  { instance: INSTANCE.TEMPERATURE, icon: 'temperature', label: 'Температура' },
  { instance: INSTANCE.HUMIDITY, icon: 'sensor', label: 'Влажность' },
  { instance: INSTANCE.CO2_LEVEL, icon: 'sensor', label: 'CO₂' },
  { instance: INSTANCE.POWER, icon: 'sensor', label: 'Мощность' },
  { instance: INSTANCE.BATTERY_LEVEL, icon: 'sensor', label: 'Батарея' },
];
const UNIT_SUFFIX: Record<string, string> = {
  'unit.percent': '%',
  'unit.temperature.celsius': '°C',
  'unit.watt': ' Вт',
  'unit.ppm': ' ppm',
};
const primaryReading = computed<Reading | null>(() => {
  for (const cfg of READING_PRIORITY) {
    const prop = props.device.properties.find(
      (p) => p.type === PROPERTY.FLOAT && p.parameters.instance === cfg.instance,
    );
    if (!prop || prop.state?.value == null) continue;
    const raw = Number(prop.state.value);
    const value = Number.isFinite(raw)
      ? Number.isInteger(raw)
        ? String(raw)
        : raw.toFixed(1)
      : String(prop.state.value);
    const suffix = (prop.parameters.unit && UNIT_SUFFIX[prop.parameters.unit]) ?? '';
    return { icon: cfg.icon, label: cfg.label, value: `${value}${suffix}` };
  }
  return null;
});

async function togglePower(next: boolean): Promise<void> {
  if (!onOffCap.value || busy.value) return;
  busy.value = true;
  try {
    await devices.execute({
      deviceId: props.device.id,
      capability: CAPABILITY.ON_OFF,
      instance: INSTANCE.ON,
      value: next,
    });
  } finally {
    busy.value = false;
  }
}

function onBrightnessInput(v: number): void {
  dragLock.value = true;
  brightnessLocal.value = v;
}

async function onBrightnessChange(v: number): Promise<void> {
  brightnessLocal.value = v;
  busy.value = true;
  try {
    await devices.execute({
      deviceId: props.device.id,
      capability: CAPABILITY.RANGE,
      instance: INSTANCE.BRIGHTNESS,
      value: v,
    });
  } finally {
    busy.value = false;
    dragLock.value = false;
  }
}
</script>

<style scoped lang="scss">
.device-card {
  --device-accent: #6852ff;
  // container-queries: адаптация под колонку, не viewport.
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: clamp(14px, 1.4vw, 18px);
  min-width: 0;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  cursor: pointer;
  transition:
    background 160ms var(--ease-out),
    border-color 160ms var(--ease-out);

  @container (max-width: 220px) {
    gap: 10px;
    padding: 12px;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: var(--color-border-soft);
  }

  &--on {
    background: rgba(255, 255, 255, 0.05);
    border-color: color-mix(in srgb, var(--device-accent) 45%, var(--color-border-soft));
  }

  &--offline {
    opacity: 0.55;
  }

  &__top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  &__icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--device-accent) 14%, transparent);
    color: var(--device-accent);
    display: grid;
    place-items: center;
    :deep(svg) {
      width: 18px;
      height: 18px;
    }
  }

  &__body {
  }

  &__name {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 4px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  // Бейджи под именем — комната, цвет, тип. Одна линия, переноса не делаем,
  // лишние теги срезает контейнер. RGB-капля показывается только когда лампа
  // в RGB-режиме (для CCT-only ламп её нет, чтобы не врать про цвет).
  &__tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 22px;
    margin-bottom: 6px;
  }

  &__tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    border-radius: var(--radius-pill);
    font-size: 11px;
    font-weight: 500;
    color: var(--color-text-secondary);
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(255, 255, 255, 0.06);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &--room {
      background: rgba(var(--color-brand-purple-rgb), 0.12);
      color: color-mix(in srgb, var(--color-brand-purple) 80%, white 20%);
      border-color: rgba(var(--color-brand-purple-rgb), 0.22);
    }

    &--meta {
      color: var(--color-text-muted);
    }

    &--yandex {
      background: rgba(255, 204, 0, 0.14);
      border-color: rgba(255, 204, 0, 0.3);
      color: #ffcc00;
    }
  }

  // RGB-капля — диаметр 14px, чтобы не доминировать над текстом. Бэкграунд
  // подаётся через inline-style из computed accentColor.
  &__swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.18);
    box-shadow:
      0 0 0 2px rgba(0, 0, 0, 0.25),
      0 0 8px var(--device-accent);
    flex-shrink: 0;
  }

  &--rgb &__swatch {
    // Чуть ярче glow, когда лампа реально цветная — показывает «живой» state.
    box-shadow:
      0 0 0 2px rgba(0, 0, 0, 0.25),
      0 0 14px var(--device-accent);
  }

  // Alice quick-exposure chip: пилюля с brand-tint в active-state.
  // Активный чип — full purple→pink градиент; outline-вариант для opt-out.
  &__alice-chip {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 9px;
    border-radius: var(--radius-pill);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--color-text-muted);
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed rgba(255, 255, 255, 0.12);
    transition:
      background-color 180ms var(--ease-out),
      border-color 180ms var(--ease-out),
      color 180ms var(--ease-out);

    &:hover {
      color: var(--color-text-primary);
      border-color: color-mix(in srgb, var(--color-brand-purple) 45%, transparent);
      background: rgba(var(--color-brand-purple-rgb), 0.08);
    }
    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--color-brand-purple) 60%, transparent);
      outline-offset: 2px;
    }

    &.is-on {
      color: #fff;
      background: var(--gradient-brand);
      border-color: transparent;
      border-style: solid;
      box-shadow: 0 0 12px rgba(var(--color-brand-purple-rgb), 0.35);

      &:hover {
        filter: brightness(1.08);
      }
    }
  }

  // Read-only показатель — одна строка, один показатель максимум. Для сенсоров
  // и розеток с power-monitoring главная инфа — на карточке без захода в детали.
  &__reading {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 12px;
    color: var(--color-text-secondary);

    strong {
      color: var(--color-text-primary);
      font-variant-numeric: tabular-nums;
    }
  }

  &__controls {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  // BaseSwitch — здесь только align в колонке controls.
  &__switch {
    align-self: flex-start;
  }

  &__bright {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
  }

  &__bright-value {
    flex-shrink: 0;
    width: 40px;
    text-align: right;
    font-size: 12px;
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  &__range {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    border-radius: var(--radius-pill);
    background: linear-gradient(
      90deg,
      var(--device-accent) 0%,
      color-mix(in srgb, var(--device-accent) 70%, #ff61e6) var(--progress),
      rgba(255, 255, 255, 0.08) var(--progress),
      rgba(255, 255, 255, 0.08) 100%
    );
    outline: none;
    transition: opacity 200ms var(--ease-out);

    &:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      box-shadow:
        0 0 0 4px rgba(255, 255, 255, 0.04),
        0 4px 10px rgba(0, 0, 0, 0.4);
      cursor: pointer;
      transition: transform 200ms var(--ease-spring);
    }
    &::-webkit-slider-thumb:hover {
      transform: scale(1.2);
    }
    &::-webkit-slider-thumb:active {
      transform: scale(1.3);
    }
  }
}
</style>
