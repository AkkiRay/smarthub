<template>
  <div class="cap" :class="{ 'cap--busy': busy }">
    <div class="cap__head">
      <span class="cap__label">{{ label }}</span>
      <span class="cap__value">{{ valueLabel }}</span>
    </div>

    <!-- on/off toggle. -->
    <BaseSwitch
      v-if="capability.type === 'devices.capabilities.on_off'"
      class="cap__switch"
      size="lg"
      :model-value="isOn"
      :loading="busy"
      @update:model-value="setOnOff"
    />

    <!-- range slider (brightness, volume, …). -->
    <div v-else-if="capability.type === 'devices.capabilities.range'" class="cap__slider">
      <input
        class="cap__range"
        type="range"
        :min="rangeMin"
        :max="rangeMax"
        :step="rangeStep"
        :value="rangeLocal"
        :disabled="busy"
        :style="{ '--progress': `${rangeProgress}%` }"
        @input="onRangeInput(($event.target as HTMLInputElement).valueAsNumber)"
        @change="onRangeChange(($event.target as HTMLInputElement).valueAsNumber)"
      />
      <div class="cap__range-ticks">
        <span v-for="t in rangeTicks" :key="t" :style="{ left: `${t}%` }" />
      </div>
    </div>

    <!-- Color picker: color_model ∈ {rgb, hsv} или наличие temperature_k. -->
    <div
      v-else-if="capability.type === 'devices.capabilities.color_setting' && (acceptsColor || hasTemperature)"
      class="cap__color"
    >
      <BaseSegmented
        v-if="hasTemperature && acceptsColor"
        v-model="colorMode"
        :options="colorTabs"
        size="sm"
        class="cap__color-tabs"
      />

      <!-- HSL color wheel. -->
      <div v-show="colorMode === 'rgb' && acceptsColor" class="cap__hue">
        <input
          class="cap__range cap__range--hue"
          type="range"
          min="0"
          max="360"
          step="1"
          :value="hueLocal"
          :disabled="busy"
          @input="onHueInput(($event.target as HTMLInputElement).valueAsNumber)"
          @change="onHueChange(($event.target as HTMLInputElement).valueAsNumber)"
        />
        <div class="cap__color-preview" :style="{ background: previewColor }" />
      </div>

      <!-- Тёплый / холодный белый. -->
      <div v-show="colorMode === 'temperature'" class="cap__temp">
        <input
          class="cap__range cap__range--temp"
          type="range"
          :min="tempMin"
          :max="tempMax"
          step="50"
          :value="tempLocal"
          :disabled="busy"
          @input="onTempInput(($event.target as HTMLInputElement).valueAsNumber)"
          @change="onTempChange(($event.target as HTMLInputElement).valueAsNumber)"
        />
        <span class="cap__temp-value">{{ tempLocal }} K</span>
      </div>

      <!-- Quick presets. -->
      <div class="cap__color-presets">
        <button
          v-for="c in palette"
          :key="c.value"
          class="cap__color-swatch"
          :class="{ 'is-active': activePreset === c.value }"
          :style="{ background: c.bg }"
          :title="c.label"
          :disabled="busy"
          @click="applyPreset(c)"
        />
      </div>
    </div>

    <!-- Mode selector. -->
    <div v-else-if="capability.type === 'devices.capabilities.mode'" class="cap__modes">
      <button
        v-for="m in modeOptions"
        :key="m.value"
        class="cap__mode"
        :class="{ 'is-active': activeMode === m.value }"
        :disabled="busy"
        @click="setMode(m.value)"
      >
        <span v-if="m.icon" v-safe-html="m.icon" />
        <span>{{ m.label }}</span>
      </button>
    </div>

    <!-- Toggle: mute / pause / backlight / oscillation / … (бинарные). -->
    <BaseSwitch
      v-else-if="capability.type === 'devices.capabilities.toggle'"
      class="cap__switch"
      size="lg"
      :model-value="isToggleOn"
      :loading="busy"
      @update:model-value="setToggle"
    />

    <!-- quasar.server_action / devices.capabilities.quasar: input + send строкового action'а. -->
    <div
      v-else-if="isQuasarTextAction"
      class="cap__action"
    >
      <BaseInput
        v-model="serverActionPhrase"
        :placeholder="serverActionPlaceholder"
        class="cap__action-input"
        @keyup.enter="runServerAction"
      />
      <BaseButton
        variant="primary"
        size="sm"
        icon-right="arrow-right"
        :loading="busy"
        :disabled="!serverActionPhrase.trim()"
        @click="runServerAction"
      >
        Выполнить
      </BaseButton>
    </div>

    <!-- Fallback для unknown capability type: instance + state meta. -->
    <div v-else class="cap__fallback">
      <p class="text--small cap__fallback-msg">
        Прямого UI для этой возможности пока нет — Алиса всё равно её знает,
        используйте голосовую команду или TTS-поле выше.
      </p>
      <dl v-if="fallbackDetails.length" class="cap__fallback-meta">
        <div v-for="d in fallbackDetails" :key="d.k">
          <dt>{{ d.k }}</dt>
          <dd>{{ d.v }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Capability, Device } from '@smarthome/shared';
import { useDevicesStore } from '@/stores/devices';
import { RGB_PRESETS, TEMPERATURE_PRESETS, type ColorPreset } from '@/constants/colorPresets';
import BaseSwitch from '@/components/base/BaseSwitch.vue';
import BaseSegmented, { type SegmentedOption } from '@/components/base/BaseSegmented.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseInput from '@/components/base/BaseInput.vue';

const props = defineProps<{ device: Device; capability: Capability }>();
const devices = useDevicesStore();

const busy = ref(false);

/** Canonical instance из parameters / state; пустая строка при отсутствии. */
const instanceName = computed(() =>
  String(
    props.capability.parameters?.instance ??
      props.capability.state?.instance ??
      '',
  ),
);

const label = computed(() => {
  const t = props.capability.type;
  if (t === 'devices.capabilities.on_off') return 'Питание';
  if (t === 'devices.capabilities.range') {
    return RANGE_LABELS[instanceName.value] ?? 'Уровень';
  }
  if (t === 'devices.capabilities.color_setting') return 'Цвет';
  if (t === 'devices.capabilities.mode') {
    return MODE_LABELS[instanceName.value] ?? 'Режим';
  }
  if (t === 'devices.capabilities.toggle') {
    return (
      TOGGLE_LABELS[instanceName.value] ??
      (instanceName.value.replace(/_/g, ' ') || 'Переключатель')
    );
  }
  if (
    t === 'devices.capabilities.quasar.server_action' ||
    (t as string) === 'devices.capabilities.quasar'
  ) {
    // Известный instance → человеческое имя; иначе instance + technical type.
    return (
      SERVER_ACTION_LABELS[instanceName.value] ??
      (instanceName.value ? `Quasar · ${instanceName.value}` : 'Команда Алисы')
    );
  }
  // Generic fallback: type без префикса + instance.
  const short = t.replace(/^devices\.capabilities\./, '');
  return instanceName.value ? `${short} · ${instanceName.value}` : short;
});

// Toggle instances Yandex Smart Home.
const TOGGLE_LABELS: Record<string, string> = {
  mute: 'Звук выключен',
  pause: 'Пауза',
  backlight: 'Подсветка',
  controls_locked: 'Блокировка от детей',
  ionization: 'Ионизация',
  keep_warm: 'Подогрев',
  oscillation: 'Качание',
};

// quasar phrase / text instances (both `quasar` и `quasar.server_action`).
const SERVER_ACTION_LABELS: Record<string, string> = {
  phrase_action: 'Произнести фразу',
  text_action: 'Голосовая команда',
  tts: 'TTS-фраза',
  voice_action: 'Голосовая команда',
  sound_command: 'Звук',
};

/** Placeholder hint по instance'у. */
const SERVER_ACTION_HINTS: Record<string, string> = {
  phrase_action: 'Например: «доброе утро»',
  text_action: 'Например: «включи свет на кухне»',
  tts: 'Текст для синтеза речи',
  voice_action: 'Текст голосовой команды',
  sound_command: 'Название звука',
};

const RANGE_LABELS: Record<string, string> = {
  brightness: 'Яркость',
  volume: 'Громкость',
  temperature: 'Температура',
  channel: 'Канал',
  humidity: 'Влажность',
};

const MODE_LABELS: Record<string, string> = {
  thermostat: 'Режим работы',
  fan_speed: 'Скорость вентилятора',
  work_speed: 'Скорость',
  program: 'Программа',
  scene: 'Сцена',
  swing: 'Качание',
};

const isOn = computed(() => Boolean(props.capability.state?.value));
const valueLabel = computed(() => {
  const t = props.capability.type;
  if (t === 'devices.capabilities.on_off') return isOn.value ? 'Вкл' : 'Выкл';
  if (t === 'devices.capabilities.range') {
    return `${rangeLocal.value}${unitSuffix.value}`;
  }
  if (t === 'devices.capabilities.color_setting') {
    if (colorMode.value === 'temperature') return `${tempLocal.value} K`;
    return `#${rgbValue.value.toString(16).padStart(6, '0').toUpperCase()}`;
  }
  if (t === 'devices.capabilities.mode') {
    return modeOptions.value.find((m) => m.value === activeMode.value)?.label ?? '';
  }
  if (t === 'devices.capabilities.toggle') return isToggleOn.value ? 'Вкл' : 'Выкл';
  if (t === 'devices.capabilities.quasar.server_action') {
    const last = props.capability.state?.value;
    if (typeof last === 'string' && last) return `«${last.slice(0, 24)}…»`;
    return '';
  }
  return '';
});

async function setOnOff(value: boolean): Promise<void> {
  busy.value = true;
  try {
    await devices.execute({
      deviceId: props.device.id,
      capability: 'devices.capabilities.on_off',
      instance: 'on',
      value,
    });
  } finally {
    busy.value = false;
  }
}

const rangeMin = computed(() =>
  Number((props.capability.parameters as { range?: { min: number } } | undefined)?.range?.min ?? 0),
);
const rangeMax = computed(() =>
  Number(
    (props.capability.parameters as { range?: { max: number } } | undefined)?.range?.max ?? 100,
  ),
);
const rangeStep = computed(() =>
  Number(
    (props.capability.parameters as { range?: { precision: number } } | undefined)?.range
      ?.precision ?? 1,
  ),
);
const rangeStateValue = computed(() => Number(props.capability.state?.value ?? rangeMin.value));

const unitSuffix = computed(() =>
  (props.capability.parameters as { unit?: string } | undefined)?.unit === 'unit.percent'
    ? '%'
    : '',
);

const rangeLocal = ref(rangeStateValue.value);
const dragLock = ref(false);
watch(rangeStateValue, (v) => {
  if (!dragLock.value) rangeLocal.value = v;
});

const rangeProgress = computed(() => {
  const min = rangeMin.value;
  const max = rangeMax.value;
  if (max <= min) return 0;
  return ((rangeLocal.value - min) / (max - min)) * 100;
});

const rangeTicks = computed(() => [25, 50, 75]);

function onRangeInput(v: number): void {
  dragLock.value = true;
  rangeLocal.value = v;
}

async function onRangeChange(v: number): Promise<void> {
  rangeLocal.value = v;
  busy.value = true;
  try {
    await devices.execute({
      deviceId: props.device.id,
      capability: 'devices.capabilities.range',
      instance: String(props.capability.parameters?.instance ?? 'brightness'),
      value: v,
    });
  } finally {
    busy.value = false;
    dragLock.value = false;
  }
}

type ColorMode = 'rgb' | 'temperature';
const colorTabs: SegmentedOption[] = [
  { value: 'rgb', label: 'Цвет', icon: 'color' },
  { value: 'temperature', label: 'Тепло', icon: 'temperature' },
];

const colorParams = computed(() => {
  return props.capability.parameters as
    | { color_model?: string; temperature_k?: { min: number; max: number } }
    | undefined;
});
const hasTemperature = computed(() => Boolean(colorParams.value?.temperature_k));
/** True если color_model ∈ {rgb, hsv}. */
const acceptsColor = computed(
  () => colorParams.value?.color_model === 'rgb' || colorParams.value?.color_model === 'hsv',
);
const tempMin = computed(() => Number(colorParams.value?.temperature_k?.min ?? 1700));
const tempMax = computed(() => Number(colorParams.value?.temperature_k?.max ?? 6500));

/** Initial tab: `temperature` для CCT-only либо если state.instance = temperature_k. */
const colorMode = ref<ColorMode>(
  !acceptsColor.value || props.capability.state?.instance === 'temperature_k'
    ? 'temperature'
    : 'rgb',
);

const rgbValue = computed(() => {
  const st = props.capability.state;
  if (st?.instance === 'rgb') {
    return Number(st.value ?? 0);
  }
  if (st?.instance === 'hsv' && st.value && typeof st.value === 'object') {
    const v = st.value as { h?: number; s?: number; v?: number };
    return hsvToRgbInt(v.h ?? 0, v.s ?? 90, v.v ?? 90);
  }
  return 0xb85dff;
});

const tempStateValue = computed(() => {
  if (props.capability.state?.instance === 'temperature_k') {
    return Number(props.capability.state.value ?? tempMin.value);
  }
  return tempMin.value;
});

// hue 0..360 для UI колеса.
const hueLocal = ref(rgbToHue(rgbValue.value));
const tempLocal = ref(tempStateValue.value);
const previewColor = computed(() => `hsl(${hueLocal.value}, 90%, 60%)`);
const activePreset = ref<number | null>(null);

watch(rgbValue, (v) => {
  if (!dragLock.value) hueLocal.value = rgbToHue(v);
});
watch(tempStateValue, (v) => {
  if (!dragLock.value) tempLocal.value = v;
});

function onHueInput(v: number): void {
  dragLock.value = true;
  hueLocal.value = v;
  activePreset.value = null;
}
async function onHueChange(v: number): Promise<void> {
  hueLocal.value = v;
  await sendRgb(hueToRgbInt(v));
}

function onTempInput(v: number): void {
  dragLock.value = true;
  tempLocal.value = v;
  activePreset.value = null;
}
async function onTempChange(v: number): Promise<void> {
  tempLocal.value = v;
  await sendTemperature(v);
}

/** Preset palette: RGB при acceptsColor, CCT при hasTemperature. */
const palette = computed<ColorPreset[]>(() => {
  const out: ColorPreset[] = [];
  if (acceptsColor.value) out.push(...RGB_PRESETS);
  if (hasTemperature.value) out.push(...TEMPERATURE_PRESETS);
  return out;
});

async function applyPreset(p: ColorPreset): Promise<void> {
  activePreset.value = p.value;
  if (p.temperature) {
    colorMode.value = 'temperature';
    tempLocal.value = p.temperature;
    await sendTemperature(p.temperature);
  } else {
    colorMode.value = 'rgb';
    hueLocal.value = rgbToHue(p.value);
    await sendRgb(p.value);
  }
}

async function sendRgb(rgb: number): Promise<void> {
  busy.value = true;
  try {
    // Driver маппит color_setting → /m/v3/user/custom/group/color/apply (yandex-iot-api.ts).
    // UI отдаёт rgb-int, color_model resolution — на стороне драйвера.
    await devices.execute({
      deviceId: props.device.id,
      capability: 'devices.capabilities.color_setting',
      instance: 'rgb',
      value: rgb & 0xffffff,
    });
  } finally {
    busy.value = false;
    dragLock.value = false;
  }
}

async function sendTemperature(k: number): Promise<void> {
  busy.value = true;
  try {
    await devices.execute({
      deviceId: props.device.id,
      capability: 'devices.capabilities.color_setting',
      instance: 'temperature_k',
      value: k,
    });
  } finally {
    busy.value = false;
    dragLock.value = false;
  }
}

interface ModeOption {
  value: string;
  label: string;
  icon?: string;
}

const modeOptions = computed<ModeOption[]>(() => {
  const params = props.capability.parameters as { modes?: Array<{ value: string }> } | undefined;
  const modes = params?.modes ?? [];
  return modes.map((m) => ({
    value: m.value,
    label: HUMAN_MODE_LABELS[m.value] ?? m.value,
  }));
});

const HUMAN_MODE_LABELS: Record<string, string> = {
  auto: 'Авто',
  cool: 'Охлаждение',
  heat: 'Обогрев',
  dry: 'Осушение',
  fan_only: 'Вентилятор',
  off: 'Выкл',
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
  turbo: 'Турбо',
  quiet: 'Тихий',
  eco: 'Эко',
  sleep: 'Сон',
  one: '1',
  two: '2',
  three: '3',
};

const activeMode = computed(() => String(props.capability.state?.value ?? ''));

async function setMode(value: string): Promise<void> {
  busy.value = true;
  try {
    await devices.execute({
      deviceId: props.device.id,
      capability: 'devices.capabilities.mode',
      instance: String(props.capability.parameters?.instance ?? 'mode'),
      value,
    });
  } finally {
    busy.value = false;
  }
}

// Toggle.

const isToggleOn = computed(() => Boolean(props.capability.state?.value));

async function setToggle(next: boolean): Promise<void> {
  busy.value = true;
  try {
    await devices.execute({
      deviceId: props.device.id,
      capability: 'devices.capabilities.toggle',
      instance: String(props.capability.parameters?.instance ?? 'toggle'),
      value: next,
    });
  } finally {
    busy.value = false;
  }
}

// quasar.server_action / devices.capabilities.quasar.

/** Принимает ли capability строковый action (phrase_action, text_action, tts, …). */
const isQuasarTextAction = computed(() => {
  const t = props.capability.type as string;
  if (t === 'devices.capabilities.quasar.server_action') return true;
  // `devices.capabilities.quasar` без суффикса: text-action на Я.Станциях.
  return t === 'devices.capabilities.quasar';
});

const serverActionPhrase = ref('');

const serverActionPlaceholder = computed(
  () => SERVER_ACTION_HINTS[instanceName.value] ?? 'Текст команды',
);

async function runServerAction(): Promise<void> {
  const text = serverActionPhrase.value.trim();
  if (!text || busy.value) return;
  busy.value = true;
  try {
    await devices.execute({
      deviceId: props.device.id,
      // type должен совпадать с capability: иначе iot.quasar отклонит action.
      capability: props.capability.type,
      instance: instanceName.value || 'phrase_action',
      value: text,
    });
    serverActionPhrase.value = '';
  } finally {
    busy.value = false;
  }
}

// Generic fallback meta.

interface FallbackEntry {
  k: string;
  v: string;
}

/** Fallback meta: instance, текущее значение, retrievable. */
const fallbackDetails = computed<FallbackEntry[]>(() => {
  const out: FallbackEntry[] = [];
  if (instanceName.value) out.push({ k: 'instance', v: instanceName.value });
  const val = props.capability.state?.value;
  if (val !== undefined && val !== null && val !== '') {
    out.push({ k: 'value', v: typeof val === 'object' ? JSON.stringify(val) : String(val) });
  }
  if (props.capability.retrievable === false) {
    out.push({ k: 'retrievable', v: 'нет (write-only)' });
  }
  return out;
});

function rgbToHue(rgb: number): number {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

function hueToRgbInt(h: number): number {
  // s=0.9, l=0.55 — насыщенные цвета.
  const s = 0.9;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);
  return (ri << 16) | (gi << 8) | bi;
}

/** HSV (Yandex format: 0..360, 0..100, 0..100) → RGB-int для swatch'а. */
function hsvToRgbInt(h: number, s: number, v: number): number {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const vv = Math.max(0, Math.min(100, v)) / 100;
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);
  return (ri << 16) | (gi << 8) | bi;
}

/** RGB-int → `{h:0..360, s:0..100, v:0..100}` для Yandex hsv instance. */
function rgbToHsv(rgb: number): { h: number; s: number; v: number } {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = Math.round((h * 60 + 360) % 360);
  const s = max === 0 ? 0 : Math.round((d / max) * 100);
  const v = Math.round(max * 100);
  return { h, s, v };
}
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.cap {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: var(--radius-md);
  @include glass(var(--glass-alpha-soft), var(--glass-blur-soft));
  min-width: 0;
  transition: opacity 200ms var(--ease-out);

  &--busy {
    opacity: 0.85;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  &__label {
    font-size: 13px;
    font-weight: 600;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  &__value {
    font-size: 13px;
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    font-family: var(--font-family-mono);
  }

  // Visual in BaseSwitch; здесь только align.
  &__switch {
    align-self: flex-start;
  }

  &__slider {
    position: relative;
  }

  &__range {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 8px;
    border-radius: var(--radius-pill);
    background: linear-gradient(
      90deg,
      var(--color-brand-violet) 0%,
      var(--color-brand-pink) var(--progress, 50%),
      rgba(255, 255, 255, 0.08) var(--progress, 50%),
      rgba(255, 255, 255, 0.08) 100%
    );
    outline: none;
    cursor: pointer;
    transition: opacity 200ms var(--ease-out);

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #fff;
      box-shadow:
        0 0 0 4px rgba(255, 255, 255, 0.04),
        0 4px 12px rgba(0, 0, 0, 0.4);
      cursor: pointer;
      transition:
        transform 200ms var(--ease-spring),
        box-shadow 200ms var(--ease-out);
    }
    &::-webkit-slider-thumb:hover {
      transform: scale(1.18);
    }
    &::-webkit-slider-thumb:active {
      transform: scale(1.3);
    }
    &:focus-visible::-webkit-slider-thumb {
      box-shadow:
        0 0 0 4px rgba(var(--color-brand-purple-rgb), 0.45),
        0 4px 12px rgba(0, 0, 0, 0.4);
    }
    // Firefox thumb selector.
    &::-moz-range-thumb {
      width: 22px;
      height: 22px;
      border: 0;
      border-radius: 50%;
      background: #fff;
      box-shadow:
        0 0 0 4px rgba(255, 255, 255, 0.04),
        0 4px 12px rgba(0, 0, 0, 0.4);
      cursor: pointer;
      transition: transform 200ms var(--ease-spring);
    }
    &::-moz-range-thumb:hover {
      transform: scale(1.18);
    }
    &::-moz-range-thumb:active {
      transform: scale(1.3);
    }

    // Hue mode: rainbow gradient.
    &--hue {
      background: linear-gradient(
        90deg,
        #ff5577 0%,
        #ffcc55 16%,
        #aaff55 33%,
        #55ffaa 50%,
        #55aaff 66%,
        #aa55ff 83%,
        #ff5577 100%
      );
    }

    // Temperature: warm → cool gradient.
    &--temp {
      background: linear-gradient(
        90deg,
        #ffb070 0%,
        #ffe6b0 30%,
        #ffffff 55%,
        #d8eaff 80%,
        #aac8ff 100%
      );
    }
  }

  &__range-ticks {
    position: relative;
    height: 8px;
    margin-top: -4px;
    pointer-events: none;

    span {
      position: absolute;
      top: 0;
      width: 1px;
      height: 4px;
      background: rgba(255, 255, 255, 0.18);
    }
  }

  &__color {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__color-tabs {
    align-self: flex-start;
  }

  &__hue,
  &__temp {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__color-preview {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    box-shadow:
      0 0 0 2px rgba(255, 255, 255, 0.08),
      0 6px 16px rgba(0, 0, 0, 0.32);
    transition: background 240ms var(--ease-out);
  }

  &__temp-value {
    flex-shrink: 0;
    width: 64px;
    text-align: right;
    font-size: 13px;
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    font-family: var(--font-family-mono);
  }

  &__color-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__color-swatch {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.12);
    cursor: pointer;
    outline: 0;
    transition:
      transform 200ms var(--ease-spring),
      border-color 200ms var(--ease-out),
      box-shadow 200ms var(--ease-out);
    padding: 0;

    &:hover {
      transform: scale(1.15);
      border-color: rgba(255, 255, 255, 0.4);
    }
    &.is-active {
      transform: scale(1.18);
      border-color: #fff;
      box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1);
    }
    &:focus-visible {
      box-shadow: 0 0 0 4px rgba(var(--color-brand-purple-rgb), 0.45);
    }
    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  }

  &__action {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    &-input {
      flex: 1 1 220px;
      min-width: 0;
    }
  }

  &__fallback {
    display: flex;
    flex-direction: column;
    gap: 8px;

    &-msg {
      color: var(--color-text-muted);
      line-height: 1.5;
      margin: 0;
    }
    &-meta {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;

      div {
        display: grid;
        grid-template-columns: 96px minmax(0, 1fr);
        gap: 8px;
        font-size: 12px;
        font-family: var(--font-family-mono);
      }
      dt {
        color: var(--color-text-muted);
        text-transform: lowercase;
        letter-spacing: 0.04em;
      }
      dd {
        margin: 0;
        color: var(--color-text-secondary);
        word-break: break-all;
        min-width: 0;
      }
    }
  }

  &__modes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  &__mode {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border-soft);
    background: rgba(255, 255, 255, 0.04);
    color: var(--color-text-secondary);
    font-size: 13px;
    cursor: pointer;
    outline: 0;
    transition:
      border-color 200ms var(--ease-out),
      color 200ms var(--ease-out),
      background 200ms var(--ease-out),
      box-shadow 200ms var(--ease-out),
      transform 200ms var(--ease-spring);

    :deep(svg) {
      width: 14px;
      height: 14px;
    }

    &:hover {
      color: var(--color-text-primary);
      transform: translateY(-1px);
    }

    &.is-active {
      background: var(--gradient-brand-soft);
      border-color: rgba(var(--color-brand-purple-rgb), 0.5);
      color: var(--color-text-primary);
    }

    &:focus-visible {
      box-shadow: 0 0 0 3px rgba(var(--color-brand-purple-rgb), 0.35);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  }
}

// reduce-motion: убираем spring-transition. BaseSwitch гасит сам.
:global(.app--reduce-motion) {
  .cap__color-swatch,
  .cap__mode,
  .cap__color-preview,
  .cap__range::-webkit-slider-thumb,
  .cap__range::-moz-range-thumb {
    transition-duration: 0ms;
  }
}
</style>
