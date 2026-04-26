<template>
  <BaseModal
    :model-value="true"
    :title="mode === 'create' ? 'Новый сценарий' : 'Редактировать сценарий'"
    size="lg"
    @update:model-value="(v) => v || $emit('cancel')"
    @close="$emit('cancel')"
  >
    <div class="editor">
      <BaseInput v-model="form.name" label="Название" placeholder="Например: «Доброе утро»" />

      <div class="editor__swatches">
        <span class="text--small">Цвет</span>
        <div class="editor__swatches-row" role="radiogroup" aria-label="Цвет сценария">
          <button
            v-for="c in palette"
            :key="c"
            type="button"
            role="radio"
            :aria-checked="isSameColor(form.accent, c)"
            :aria-label="c"
            class="swatch"
            :class="{ 'is-selected': isSameColor(form.accent, c) }"
            :style="{ '--swatch-color': c }"
            @click="form.accent = c"
          />
          <label
            class="swatch swatch--custom"
            :class="{ 'is-selected': !palette.some((c) => isSameColor(form.accent, c)) }"
            :style="{ '--swatch-color': form.accent }"
            :aria-label="`Свой цвет: ${form.accent}`"
          >
            <input
              type="color"
              class="swatch__native"
              :value="form.accent"
              @input="form.accent = ($event.target as HTMLInputElement).value"
            />
            <svg viewBox="0 0 16 16" class="swatch__custom-icon" aria-hidden="true">
              <path
                d="M3 13.5l1-3.5L11 3l2.5 2.5L6.5 12.5 3 13.5z"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linejoin="round"
                fill="none"
              />
            </svg>
          </label>
        </div>
      </div>

      <BaseSwitch
        v-model="form.exposeToStation"
        label="Доступно через Алису"
        description="Озвучить запуск как server-action"
      />

      <div class="editor__icons">
        <span class="text--small">Иконка</span>
        <div class="editor__icons-grid">
          <button
            v-for="(svg, key) in iconCatalog"
            :key="key"
            type="button"
            class="editor__icon-btn"
            :class="{ 'is-selected': form.icon === svg }"
            v-safe-html="svg"
            @click="form.icon = svg"
          />
        </div>
      </div>

      <div class="editor__actions-section">
        <header class="editor__actions-head">
          <h3 class="text--h2">Действия</h3>
          <span class="text--small">
            {{ form.actions.length }} {{ pluralize(form.actions.length, ['шаг', 'шага', 'шагов']) }}
          </span>
        </header>

        <div v-if="form.actions.length" class="editor__actions">
          <article v-for="(action, idx) in form.actions" :key="idx" class="action-card">
            <header class="action-card__head">
              <span class="action-card__num">{{ idx + 1 }}</span>
              <span class="action-card__title">Шаг {{ idx + 1 }}</span>
              <button
                type="button"
                class="action-card__remove"
                @click="removeAction(idx)"
                aria-label="Удалить шаг"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
                  <path
                    d="M6 6l12 12M18 6l-12 12"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
            </header>

            <div class="action-card__grid">
              <BaseSelect
                label="Устройство"
                :model-value="action.deviceId"
                :options="deviceOptions"
                placeholder="Выберите устройство…"
                size="sm"
                @update:model-value="(v) => onActionDevice(idx, String(v))"
              />
              <BaseSelect
                label="Действие"
                :model-value="`${action.capability}::${action.instance ?? ''}`"
                :options="capabilityOptionsFor(action.deviceId)"
                placeholder="Что сделать…"
                size="sm"
                :disabled="!action.deviceId"
                @update:model-value="(v) => onActionCapability(idx, String(v))"
              />

              <!-- Value-editor подменяется по capability-type. -->

              <BaseSelect
                v-if="action.capability === 'devices.capabilities.on_off'"
                label="Значение"
                :model-value="String(Boolean(action.value))"
                :options="ON_OFF_OPTIONS"
                size="sm"
                @update:model-value="(v) => (action.value = v === 'true')"
              />
              <BaseInput
                v-else-if="action.capability === 'devices.capabilities.range'"
                label="Значение"
                type="number"
                size="sm"
                placeholder="0–100"
                :model-value="Number(action.value ?? 0)"
                @update:model-value="(v) => (action.value = Number(v))"
              />
              <label
                v-else-if="action.capability === 'devices.capabilities.color_setting'"
                class="action-card__color"
              >
                <span class="action-card__color-label">Значение</span>
                <span
                  class="action-card__color-swatch"
                  :style="{ '--swatch-color': hexFromInt(Number(action.value ?? 0xb85dff)) }"
                >
                  <input
                    type="color"
                    class="action-card__color-native"
                    :value="hexFromInt(Number(action.value ?? 0xb85dff))"
                    @input="
                      (e) => (action.value = intFromHex((e.target as HTMLInputElement).value))
                    "
                  />
                  <span class="action-card__color-hex">
                    {{ hexFromInt(Number(action.value ?? 0xb85dff)).toUpperCase() }}
                  </span>
                </span>
              </label>
              <BaseInput
                v-else
                label="Значение"
                size="sm"
                :model-value="String(action.value ?? '')"
                @update:model-value="(v) => (action.value = v)"
              />

              <BaseInput
                label="Задержка, мс"
                type="number"
                size="sm"
                placeholder="0"
                :model-value="action.delayMs ?? ''"
                @update:model-value="(v) => (action.delayMs = v === '' ? undefined : Number(v))"
              />
            </div>
          </article>
        </div>
        <div v-else class="editor__actions-empty">
          <p class="text--small">Сценарий ещё пуст. Добавьте первый шаг.</p>
        </div>

        <BaseButton variant="ghost" icon-left="plus" @click="addAction"> Добавить шаг </BaseButton>
      </div>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="$emit('cancel')">Отмена</BaseButton>
      <BaseButton
        variant="primary"
        :icon-left="mode === 'create' ? 'plus' : 'check'"
        :disabled="!canSave"
        @click="onSave"
      >
        {{ mode === 'create' ? 'Создать сценарий' : 'Сохранить' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import {
  BaseButton,
  BaseInput,
  BaseModal,
  BaseSelect,
  BaseSwitch,
  type SelectOption,
} from '@/components/base';
import type { Capability, CapabilityType, Device, Scene, SceneAction } from '@smarthome/shared';
import { useDevicesStore } from '@/stores/devices';

const props = defineProps<{
  mode: 'create' | 'edit';
  initial?: Scene;
}>();
const emit = defineEmits<{
  save: [draft: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'>];
  cancel: [];
}>();

const devices = useDevicesStore();

// Brand-токены + тёплые/нейтральные акценты под бытовые сценарии. Последний
// свотч — нативный custom-picker.
const palette = [
  '#B85DFF', // brand-purple
  '#FF5B9E', // brand-pink (coral)
  '#FFB866', // brand-amber (warm finish)
  '#5BE3AD', // mint
  '#FFD27D', // warm-yellow (закат)
  '#FF9A6E', // peach (morning)
  '#FF6E66', // coral (party)
  '#7C5BFF', // brand-violet (sleep)
] as const;

function isSameColor(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const ON_OFF_OPTIONS: SelectOption[] = [
  { value: 'true', label: 'Включить' },
  { value: 'false', label: 'Выключить' },
];

function hexFromInt(n: number): string {
  const safe = Number.isFinite(n) ? n & 0xffffff : 0xb85dff;
  return '#' + safe.toString(16).padStart(6, '0');
}
function intFromHex(hex: string): number {
  return parseInt(hex.replace('#', ''), 16) || 0;
}

// Русские pluralize-формы: 1 / 2-4 / 5+.
function pluralize(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

const iconCatalog: Record<string, string> = {
  morning:
    '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  movie:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="13" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M10 10l5 3-5 3v-6z" fill="currentColor"/></svg>',
  sleep:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M21 13.5A9 9 0 1110.5 3a7 7 0 0010.5 10.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  away: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 21V9l9-6 9 6v12M3 21h18M9 14a3 3 0 016 0v7H9z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  party:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M5 21l4-13M11 21l-2-13M15 21l4-13M3 8c5 0 9-2 9-5M21 8c-5 0-9-2-9-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  workout:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M2 12h2m16 0h2M5 7v10M19 7v10M8 6v12M16 6v12M8 12h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  reading:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M3 5a2 2 0 012-2h6v18H5a2 2 0 01-2-2V5zM21 5a2 2 0 00-2-2h-6v18h6a2 2 0 002-2V5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  custom:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2l2.5 6.5L21 11l-5 4.5 1.5 6.5L12 18.5 6.5 22 8 15.5 3 11l6.5-2.5L12 2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};

interface DraftAction extends SceneAction {
  /** Локальное поле для UI; не уходит в БД. */
  _key?: number;
}

const form = reactive<{
  name: string;
  icon: string;
  accent: string;
  exposeToStation: boolean;
  actions: DraftAction[];
}>({
  name: props.initial?.name ?? '',
  icon: props.initial?.icon ?? iconCatalog['morning']!,
  accent: props.initial?.accent ?? '#B85DFF',
  exposeToStation: props.initial?.exposeToStation ?? false,
  actions: props.initial?.actions
    ? props.initial.actions.map((a) => ({ ...a }) as DraftAction)
    : [],
});

const availableDevices = computed(() =>
  devices.devices.filter((d) => !d.hidden && d.capabilities.length > 0),
);

interface CapabilityOption {
  value: CapabilityType;
  instance: string;
  label: string;
  cap: Capability;
}

const deviceOptions = computed<SelectOption[]>(() =>
  availableDevices.value.map((d) => ({
    value: d.id,
    label: `${d.name} · ${deviceTypeLabel(d.type)}`,
  })),
);

function capabilitiesFor(deviceId: string): Array<{ value: string; label: string }> {
  const device = devices.byId.get(deviceId);
  if (!device) return [];
  return device.capabilities.map((c) => {
    const instance = c.state?.instance ?? (c.parameters?.['instance'] as string | undefined) ?? '';
    return {
      value: `${c.type}::${instance}`,
      label: capabilityLabel(c.type, instance),
    };
  });
}

function capabilityOptionsFor(deviceId: string): SelectOption[] {
  return capabilitiesFor(deviceId).map((c) => ({ value: c.value, label: c.label }));
}

function onActionDevice(idx: number, value: string): void {
  const action = form.actions[idx];
  if (!action) return;
  action.deviceId = value;
  // При смене device — сбрасываем capability на первую доступную.
  const caps = capabilitiesFor(value);
  if (!caps.length) return;
  const first = caps[0]!;
  const { type, instance } = splitKey(first.value);
  action.capability = type;
  action.instance = instance;
  action.value = type === 'devices.capabilities.on_off' ? true : 0;
}

function onActionCapability(idx: number, compositeKey: string): void {
  const action = form.actions[idx];
  if (!action) return;
  const { type, instance } = splitKey(compositeKey);
  action.capability = type;
  action.instance = instance;
  action.value = type === 'devices.capabilities.on_off' ? true : 0;
}

function capabilityLabel(type: CapabilityType, instance: string): string {
  if (type === 'devices.capabilities.on_off') return 'Включить / выключить';
  if (type === 'devices.capabilities.range') {
    if (instance === 'brightness') return 'Установить яркость';
    if (instance === 'volume') return 'Установить громкость';
    if (instance === 'temperature') return 'Установить температуру';
    return `Установить ${instance}`;
  }
  if (type === 'devices.capabilities.color_setting') return 'Установить цвет';
  return `${type} (${instance})`;
}

function deviceTypeLabel(type: Device['type']): string {
  return (
    (
      {
        'devices.types.light': 'Свет',
        'devices.types.socket': 'Розетка',
        'devices.types.switch': 'Выключатель',
        'devices.types.sensor': 'Датчик',
        'devices.types.thermostat': 'Термостат',
        'devices.types.media_device': 'Медиа',
        'devices.types.media_device.tv': 'ТВ',
        'devices.types.media_device.tv_box': 'ТВ-приставка',
        'devices.types.vacuum_cleaner': 'Пылесос',
        'devices.types.humidifier': 'Увлажнитель',
        'devices.types.purifier': 'Очиститель',
        'devices.types.other': 'Устройство',
      } as Record<string, string>
    )[type] ?? type
  );
}

// Composite-key `type::instance` → раскладываем перед save.
function splitKey(key: string): { type: CapabilityType; instance: string } {
  const [type, instance] = key.split('::') as [CapabilityType, string | undefined];
  return { type, instance: instance ?? '' };
}

function addAction(): void {
  const first = availableDevices.value[0];
  form.actions.push({
    deviceId: first?.id ?? '',
    capability: 'devices.capabilities.on_off' as CapabilityType,
    instance: 'on',
    value: true,
    delayMs: 0,
    _key: Date.now() + Math.random(),
  });
}

function removeAction(idx: number): void {
  form.actions.splice(idx, 1);
}

const canSave = computed(
  () =>
    form.name.trim().length > 0 &&
    form.actions.every((a) => a.deviceId && a.capability && a.instance !== ''),
);

// watch composite-key в action.capability → распиливаем обратно.
watch(
  () => form.actions.map((a) => a.capability),
  () => {
    for (const a of form.actions) {
      if (typeof a.capability === 'string' && a.capability.includes('::')) {
        const { type, instance } = splitKey(a.capability);
        a.capability = type;
        a.instance = instance;
      }
    }
  },
  { deep: false },
);

function onSave(): void {
  if (!canSave.value) return;
  emit('save', {
    name: form.name.trim(),
    icon: form.icon,
    accent: form.accent,
    exposeToStation: form.exposeToStation,
    actions: form.actions.map((a) => {
      const out: SceneAction = {
        deviceId: a.deviceId,
        capability: a.capability,
        instance: a.instance,
        value: a.value,
      };
      if (a.delayMs && a.delayMs > 0) out.delayMs = a.delayMs;
      return out;
    }),
  });
}

// CapabilityOption удерживается для линтера, наружу не экспортируется.
void ((): CapabilityOption[] => []);
</script>

<style scoped lang="scss">
/** Body сценарий-редактора. Modal chrome — в BaseModal. */
.editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;

  &__check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  &__swatches {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  &__swatches-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  /** Icon picker grid. Spec общий с RoomsView. */
  &__icons-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(44px, 52px));
    justify-content: start;
    gap: 8px;
    margin-top: 6px;
  }
  &__icon-btn {
    width: 100%;
    aspect-ratio: 1;
    border: 0;
    background: rgba(255, 255, 255, 0.035);
    color: var(--color-text-secondary);
    display: grid;
    place-items: center;
    cursor: pointer;
    position: relative;
    border-radius: 12px;
    padding: 0;
    box-shadow: inset 0 0 0 1px var(--color-border-subtle);
    transition:
      color 180ms var(--ease-out),
      background 180ms var(--ease-out),
      box-shadow 200ms var(--ease-out);

    :deep(svg) {
      width: 22px;
      height: 22px;
    }

    &:hover {
      color: var(--color-text-primary);
      background: rgba(255, 255, 255, 0.07);
      box-shadow: inset 0 0 0 1px var(--color-border-soft);
    }
    &.is-selected {
      color: var(--color-brand-purple);
      background: rgba(var(--color-brand-purple-rgb), 0.18);
      box-shadow:
        inset 0 0 0 1.5px rgba(var(--color-brand-purple-rgb), 0.7),
        inset 0 0 12px rgba(var(--color-brand-purple-rgb), 0.35);
    }
    &:focus-visible {
      outline: none;
      box-shadow: inset 0 0 0 2px rgba(var(--color-brand-purple-rgb), 0.7);
    }
  }

  &__actions-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  &__actions-empty {
    padding: 24px;
    text-align: center;
    border: 1px dashed var(--color-border-soft);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
  }
}

.swatch {
  --swatch-color: #a961ff;
  --swatch-size: 36px;
  position: relative;
  width: var(--swatch-size);
  height: var(--swatch-size);
  border: 0;
  border-radius: 50%;
  background: var(--swatch-color);
  cursor: pointer;
  padding: 0;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.92);
  transition:
    transform 220ms var(--ease-spring),
    box-shadow 220ms var(--ease-out);
  // Hairline-обводка для контраста — белые свотчи не сливаются с modal-background.
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    0 4px 12px -4px color-mix(in srgb, var(--swatch-color) 60%, transparent);

  &:hover {
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.2),
      inset 0 0 0 3px rgba(0, 0, 0, 0.18);
  }

  // Selected state: двойной inset ring (тёмный gap + светлая обводка). Inset, а не
  // outline, чтобы крайние свотчи в строке не обрезались краем модалки.
  &.is-selected {
    box-shadow:
      inset 0 0 0 2px #fff,
      inset 0 0 0 4px rgba(0, 0, 0, 0.4);
  }

  &:focus-visible {
    outline: none;
    box-shadow:
      inset 0 0 0 2px var(--color-brand-purple),
      inset 0 0 0 4px #fff;
  }

  // Custom: native input[type=color] лежит прозрачным сверху — клик открывает
  // системный picker, не ломая стиль свотча.
  &--custom {
    background: conic-gradient(from 90deg, #ff61e6, #ffd27d, #5eea89, #5bd8ff, #a961ff, #ff61e6);
    color: #fff;
    overflow: hidden;
  }
  &--custom.is-selected {
    // Active custom: свотч принимает выбранный цвет поверх gradient'а.
    background: var(--swatch-color);
    background-image: none;
  }
  &__custom-icon {
    width: 16px;
    height: 16px;
    pointer-events: none;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.5));
  }
  &__native {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    border: 0;
    padding: 0;
  }
}

.editor__actions-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}

// Карточка одного шага сценария: header + 2x2 grid (Устройство/Действие/Значение/Задержка).
.action-card {
  // container-query: узкие modal'ы → grid в одну колонку.
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px 16px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid var(--color-border-subtle);
  min-width: 0;
  transition:
    background 200ms var(--ease-out),
    border-color 200ms var(--ease-out);

  &:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: var(--color-border-soft);
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__num {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--gradient-brand);
    color: #fff;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }

  &__title {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary);
    letter-spacing: -0.005em;
  }

  &__remove {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 0;
    color: var(--color-text-muted);
    display: grid;
    place-items: center;
    cursor: pointer;
    transition:
      background 180ms var(--ease-out),
      color 180ms var(--ease-out);
    flex-shrink: 0;

    &:hover {
      background: rgba(255, 85, 119, 0.14);
      color: #ff7a92;
    }
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 12px;
    min-width: 0;

    @container (max-width: 480px) {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  // Стилем совпадает с BaseInput/BaseSelect — для ровного ряда.
  &__color {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  &__color-label {
    font-size: 12px;
    color: var(--color-text-secondary);
    letter-spacing: 0.01em;
  }
  &__color-swatch {
    position: relative;
    height: 32px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-soft);
    background: rgba(255, 255, 255, 0.04);
    cursor: pointer;
    transition:
      border-color 200ms var(--ease-out),
      background 200ms var(--ease-out);

    &::before {
      content: '';
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--swatch-color, #a961ff);
      box-shadow:
        inset 0 0 0 1px rgba(255, 255, 255, 0.18),
        0 2px 6px -2px color-mix(in srgb, var(--swatch-color, #a961ff) 70%, transparent);
      flex-shrink: 0;
    }

    &:hover {
      border-color: rgba(var(--color-brand-purple-rgb), 0.4);
      background: rgba(255, 255, 255, 0.06);
    }
  }
  &__color-hex {
    font-family: var(--font-family-mono);
    font-size: 12px;
    color: var(--color-text-secondary);
    letter-spacing: 0.04em;
  }
  &__color-native {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    border: 0;
    padding: 0;
  }
}
</style>
