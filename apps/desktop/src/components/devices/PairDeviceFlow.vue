<template>
  <BaseModal
    :open="open"
    :closable="!isPairing"
    :dismiss-on-backdrop="!isPairing"
    :dismiss-on-esc="!isPairing"
    size="md"
    :kicker="kicker"
    :title="titleByStep"
    @close="onClose"
  >
    <!-- ШАГ 1 — preview / customize -->
    <Transition :name="reduceMotion ? 'pf-fade' : 'pf-step'" mode="out-in">
      <div v-if="step === 'preview'" key="preview" class="pf">
        <div class="pf__device" :style="{ '--accent': accentColor }">
          <span class="pf__device-glow" />
          <span class="pf__device-icon" v-safe-html="deviceIcon" />
        </div>

        <dl class="pf__meta">
          <div>
            <dt>Драйвер</dt>
            <dd>{{ driverInfo.label }}</dd>
          </div>
          <div>
            <dt>Тип</dt>
            <dd>{{ typeLabel }}</dd>
          </div>
          <div>
            <dt>Адрес</dt>
            <dd>{{ candidate?.address }}</dd>
          </div>
          <div>
            <dt>External ID</dt>
            <dd class="pf__mono">{{ candidate?.externalId }}</dd>
          </div>
        </dl>

        <BaseInput
          v-model="customName"
          label="Имя устройства"
          placeholder="Как будет называться в хабе"
          icon-left="edit"
          autocomplete="off"
        />

        <p v-if="driverInfo.tip" class="pf__tip">
          <span class="pf__tip-icon" v-safe-html="iconBulb" />
          <span>{{ driverInfo.tip }}</span>
        </p>
      </div>

      <!-- ШАГ 2 — pairing in progress -->
      <div v-else-if="step === 'pairing'" key="pairing" class="pf pf--center">
        <div class="pf__pulse">
          <span class="pf__pulse-ring" />
          <span class="pf__pulse-ring pf__pulse-ring--late" />
          <span class="pf__pulse-core">
            <svg viewBox="0 0 24 24">
              <path
                d="M2 9c5.5-5.5 14.5-5.5 20 0M5.5 12.5c3.5-3.5 9.5-3.5 13 0M9 16c1.7-1.7 4.3-1.7 6 0"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                fill="none"
              />
              <circle cx="12" cy="20" r="1.4" fill="currentColor" />
            </svg>
          </span>
        </div>
        <ul class="pf__steps">
          <li v-for="(s, i) in pairSteps" :key="s.label" :class="stepClass(i)">
            <span class="pf__step-dot">
              <svg v-if="i < pairCursor" viewBox="0 0 16 16">
                <path
                  d="M3 8.5l3.5 3.5L13 5"
                  stroke="currentColor"
                  stroke-width="2.2"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span v-else-if="i === pairCursor" class="pf__step-spin" />
            </span>
            <span>{{ s.label }}</span>
          </li>
        </ul>
      </div>

      <!-- ШАГ 3 — done -->
      <div v-else-if="step === 'done'" key="done" class="pf pf--center">
        <div class="pf__success">
          <span class="pf__success-pulse" />
          <span class="pf__success-pulse pf__success-pulse--late" />
          <svg class="pf__success-icon" viewBox="0 0 32 32">
            <path
              d="M8 16.5l5 5L24 11"
              stroke="currentColor"
              stroke-width="2.6"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <p class="pf__done-name">{{ pairedDevice?.name ?? customName }}</p>
        <p class="pf__done-text">Устройство добавлено и готово к работе.</p>
      </div>

      <!-- ШАГ 4 — error -->
      <div v-else key="error" class="pf pf--center">
        <div class="pf__error">
          <svg viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="2.2" fill="none" />
            <path
              d="M16 9v8M16 21.5v.01"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <p class="pf__done-name">Не удалось подключить</p>
        <p class="pf__done-text">{{ errorMessage || 'Неизвестная ошибка' }}</p>
        <p v-if="driverInfo.errorHint" class="pf__tip">
          <span class="pf__tip-icon" v-safe-html="iconBulb" />
          <span>{{ driverInfo.errorHint }}</span>
        </p>
      </div>
    </Transition>

    <template #footer>
      <template v-if="step === 'preview'">
        <BaseButton variant="ghost" @click="onClose">Отмена</BaseButton>
        <BaseButton
          variant="primary"
          icon-left="plus"
          :disabled="!customName.trim()"
          @click="startPairing"
        >
          Подключить
        </BaseButton>
      </template>

      <template v-else-if="step === 'done'">
        <BaseButton variant="ghost" @click="onClose">Закрыть</BaseButton>
        <BaseButton variant="primary" icon-right="arrow-right" @click="openDevice">
          Открыть устройство
        </BaseButton>
      </template>

      <template v-else-if="step === 'error'">
        <BaseButton variant="ghost" @click="onClose">Отмена</BaseButton>
        <BaseButton variant="primary" icon-left="refresh" @click="resetToPreview">
          Попробовать снова
        </BaseButton>
      </template>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import BaseButton from '@/components/base/BaseButton.vue';
import type { Device, DiscoveredDevice, DriverId } from '@smarthome/shared';
import BaseModal from '@/components/chrome/BaseModal.vue';
import { BaseInput } from '@/components/base';
import { useDevicesStore } from '@/stores/devices';
import { useToasterStore } from '@/stores/toaster';
import { useUiStore } from '@/stores/ui';
import { driverEntry } from '@/constants/driverPalette';

const props = defineProps<{
  open: boolean;
  candidate: DiscoveredDevice | null;
}>();
const emit = defineEmits<{ close: [] }>();

const devices = useDevicesStore();
const toaster = useToasterStore();
const router = useRouter();
const { reduceMotion } = storeToRefs(useUiStore());

type Step = 'preview' | 'pairing' | 'done' | 'error';
const step = ref<Step>('preview');
const customName = ref('');
const pairedDevice = ref<Device | null>(null);
const errorMessage = ref('');

// Pair-этапы быстры и последовательны — cursor двигается синтетически,
// чтобы пользователь видел осмысленные шаги, а не один спиннер.
const pairCursor = ref(0);
const pairSteps = computed(() => [
  { label: 'Соединяемся с устройством' },
  { label: 'Считываем возможности' },
  { label: 'Сохраняем в хабе' },
]);
const isPairing = computed(() => step.value === 'pairing');

const candidate = computed(() => props.candidate);

const kicker = computed(() => {
  if (step.value === 'pairing') return 'Подключение';
  if (step.value === 'done') return 'Готово';
  if (step.value === 'error') return 'Ошибка';
  return 'Новое устройство';
});

const titleByStep = computed(() => {
  switch (step.value) {
    case 'pairing':
      return 'Связываем хаб и устройство';
    case 'done':
      return 'Устройство добавлено';
    case 'error':
      return 'Что-то пошло не так';
    default:
      return candidate.value?.name ?? 'Устройство';
  }
});

const accentColor = computed(() => driverInfo.value.accent);
const deviceIcon = computed(() => iconForType(candidate.value?.type ?? 'devices.types.other'));

const typeLabel = computed(() => {
  const map: Record<string, string> = {
    'devices.types.light': 'Лампа',
    'devices.types.socket': 'Розетка',
    'devices.types.switch': 'Выключатель',
    'devices.types.sensor': 'Датчик',
    'devices.types.thermostat': 'Термостат',
    'devices.types.media_device': 'Медиа',
    'devices.types.other': 'Устройство',
  };
  return map[candidate.value?.type ?? 'devices.types.other'] ?? 'Устройство';
});

interface DriverInfo {
  label: string;
  tip: string;
  errorHint: string;
  accent: string;
}

// Палитра/описания живут в constants/driverPalette — здесь компактные алиасы.
// driverEntry безопасен для неизвестных driver-id: backend может прислать новый драйвер до релиза UI.
const driverInfo = computed<DriverInfo>(() => {
  const entry = driverEntry(candidate.value?.driver as DriverId);
  return {
    label: entry.label,
    accent: entry.accent,
    tip: entry.pairingTip,
    errorHint: entry.errorHint,
  };
});

// Auto-fill имени при открытии modal-а.
watch(
  () => [props.open, candidate.value?.name] as const,
  ([open, name]) => {
    if (open && name) customName.value = name;
    if (open) {
      step.value = 'preview';
      pairCursor.value = 0;
      pairedDevice.value = null;
      errorMessage.value = '';
    }
  },
  { immediate: true },
);

function onClose(): void {
  if (isPairing.value) return;
  emit('close');
}

function resetToPreview(): void {
  step.value = 'preview';
  pairCursor.value = 0;
  errorMessage.value = '';
}

async function startPairing(): Promise<void> {
  if (!candidate.value) return;
  step.value = 'pairing';
  pairCursor.value = 0;

  // Шаг 1: connect (анимация).
  await wait(reduceMotion.value ? 100 : 600);
  pairCursor.value = 1;
  await wait(reduceMotion.value ? 100 : 500);

  try {
    // Реальный pair: probe + save.
    const device = await devices.pairSilent(candidate.value);
    pairCursor.value = 2;
    await wait(reduceMotion.value ? 50 : 350);

    // Применяем custom-name, если отличается от того, что вернул probe.
    if (customName.value.trim() && customName.value.trim() !== device.name) {
      const renamed = await devices.rename(device.id, customName.value.trim());
      pairedDevice.value = renamed ?? device;
    } else {
      pairedDevice.value = device;
    }

    pairCursor.value = pairSteps.value.length;
    await wait(reduceMotion.value ? 0 : 250);
    step.value = 'done';
    toaster.push({
      kind: 'success',
      message: `${pairedDevice.value!.name} подключён`,
      detail: driverInfo.value.label,
    });
  } catch (e) {
    errorMessage.value = (e as Error).message ?? 'Неизвестная ошибка';
    step.value = 'error';
  }
}

function openDevice(): void {
  const id = pairedDevice.value?.id;
  emit('close');
  if (id) void router.push(`/devices/${id}`);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stepClass(i: number): string {
  if (i < pairCursor.value) return 'is-done';
  if (i === pairCursor.value) return 'is-active';
  return 'is-pending';
}

function iconForType(t: string): string {
  const ICONS: Record<string, string> = {
    'devices.types.light':
      '<svg viewBox="0 0 24 24" fill="none"><path d="M9 18h6M10 21h4M12 3a6 6 0 016 6c0 2.4-1.4 4.4-3 5.4V17H9v-2.6C7.4 13.4 6 11.4 6 9a6 6 0 016-6z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    'devices.types.socket':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.7"/><circle cx="9.5" cy="11" r="1.2" fill="currentColor"/><circle cx="14.5" cy="11" r="1.2" fill="currentColor"/><path d="M8 16h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    'devices.types.switch':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="9" width="18" height="6" rx="3" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="12" r="2" fill="currentColor"/></svg>',
    'devices.types.sensor':
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v8.5M12 16a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" stroke-width="1.7"/><path d="M5 18.5a8 8 0 0114 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    'devices.types.thermostat':
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    'devices.types.media_device':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M10 9l6 3-6 3z" fill="currentColor"/></svg>',
  };
  return ICONS[t] ?? ICONS['devices.types.switch']!;
}

const iconBulb =
  '<svg viewBox="0 0 16 16" fill="none"><path d="M5.5 14h5M6.5 16h3M8 1.5a4.5 4.5 0 014.5 4.5c0 1.8-1 3.3-2.3 4v2.2H5.8V10c-1.3-.7-2.3-2.2-2.3-4A4.5 4.5 0 018 1.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.pf {
  display: flex;
  flex-direction: column;
  gap: 18px;

  &--center {
    align-items: center;
    text-align: center;
    padding: 8px 0;
  }

  &__device {
    --accent: #a961ff;
    position: relative;
    align-self: center;
    width: 92px;
    height: 92px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background:
      radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.18), transparent 45%), var(--accent);
    box-shadow:
      0 8px 30px rgba(0, 0, 0, 0.4),
      0 0 40px color-mix(in srgb, var(--accent) 50%, transparent);
    color: #fff;
    overflow: visible;

    &-glow {
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      background: radial-gradient(
        circle,
        color-mix(in srgb, var(--accent) 65%, transparent) 0%,
        transparent 70%
      );
      filter: blur(12px);
      opacity: 0.7;
      animation: pfGlow calc(3.6s / max(var(--motion-scale, 1), 0.001)) ease-in-out infinite;
      z-index: -1;
    }

    &-icon {
      display: grid;
      place-items: center;
      :deep(svg) {
        width: 38px;
        height: 38px;
      }
    }
  }

  &__meta {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px 18px;
    margin: 0;
    padding: 14px 16px;
    border-radius: var(--radius-md);
    @include glass(var(--glass-alpha-soft), var(--glass-blur-soft));

    > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    dt {
      font-size: 11px;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    dd {
      font-size: 13px;
      color: var(--color-text-primary);
      margin: 0;
      overflow-wrap: anywhere;
    }
  }

  &__mono {
    font-family: var(--font-family-mono);
    font-size: 12px !important;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 6px;

    span {
      font-size: 12px;
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
  }

  &__input {
    height: 40px;
    padding: 0 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-soft);
    background: rgba(255, 255, 255, 0.04);
    color: var(--color-text-primary);
    font-size: 14px;
    transition:
      border-color 200ms var(--ease-out),
      box-shadow 200ms var(--ease-out),
      background 200ms var(--ease-out);

    &:hover {
      border-color: var(--color-border-strong);
    }
    &:focus,
    &:focus-visible {
      outline: none;
      border-color: var(--color-brand-purple);
      box-shadow: 0 0 0 3px rgba(var(--color-brand-purple-rgb), 0.18);
      background: rgba(255, 255, 255, 0.06);
    }
  }

  &__tip {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    background: rgba(var(--color-brand-amber-rgb), 0.1);
    color: var(--color-brand-amber);
    font-size: 13px;
    line-height: 1.45;
    border: 1px solid rgba(var(--color-brand-amber-rgb), 0.22);

    &-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      margin-top: 2px;
      :deep(svg) {
        width: 100%;
        height: 100%;
      }
    }
  }

  &__pulse {
    position: relative;
    width: 110px;
    height: 110px;
    margin-top: 8px;
    display: grid;
    place-items: center;

    &-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 1.5px solid var(--color-brand-purple);
      animation: pfPulse calc(2s / max(var(--motion-scale, 1), 0.001)) ease-out infinite;

      &--late {
        animation-delay: calc(1s * var(--motion-scale, 1));
      }
    }

    &-core {
      width: 68px;
      height: 68px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: var(--gradient-brand);
      color: var(--color-text-primary);
      box-shadow: 0 14px 36px rgba(var(--color-brand-purple-rgb), 0.55);

      svg {
        width: 32px;
        height: 32px;
      }
    }
  }

  &__steps {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
    align-self: center;

    li {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 14px;
      color: var(--color-text-secondary);
      transition: color 240ms var(--ease-out);

      &.is-active {
        color: var(--color-text-primary);
      }
      &.is-done {
        color: var(--color-success);
      }
    }
  }

  &__step-dot {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--color-border-soft);
    display: grid;
    place-items: center;
    color: currentColor;
    transition:
      background 240ms var(--ease-out),
      border-color 240ms var(--ease-out);

    .is-done & {
      background: rgba(var(--color-success-rgb), 0.18);
      border-color: rgba(var(--color-success-rgb), 0.45);
    }
    .is-active & {
      border-color: var(--color-brand-purple);
    }
    svg {
      width: 14px;
      height: 14px;
    }
  }

  &__step-spin {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-top-color: transparent;
    animation: pfSpin calc(0.8s / max(var(--motion-scale, 1), 0.001)) linear infinite;
  }

  &__success {
    position: relative;
    width: 110px;
    height: 110px;
    display: grid;
    place-items: center;

    &-pulse {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: var(--gradient-brand);
      opacity: 0.35;
      animation: pfDonePulse calc(2s / max(var(--motion-scale, 1), 0.001)) ease-out infinite;

      &--late {
        animation-delay: 1s;
      }
    }
  }

  &__success-icon {
    position: relative;
    z-index: 1;
    width: 68px;
    height: 68px;
    color: #fff;
    background: var(--gradient-brand);
    border-radius: 50%;
    padding: 14px;
    box-shadow: 0 14px 36px rgba(var(--color-brand-purple-rgb), 0.55);
  }

  &__error {
    width: 92px;
    height: 92px;
    color: var(--color-danger);
    background: rgba(255, 85, 119, 0.08);
    border-radius: 50%;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 85, 119, 0.32);

    svg {
      width: 44px;
      height: 44px;
    }
  }

  &__done-name {
    font-family: var(--font-family-display);
    font-size: 20px;
    font-weight: 700;
    margin: 8px 0 0;
  }
  &__done-text {
    margin: 4px 0 0;
    color: var(--color-text-secondary);
    font-size: 14px;
  }
}

.pf-step-enter-active,
.pf-step-leave-active {
  transition:
    opacity 280ms var(--ease-out),
    transform 360ms var(--ease-spring);
}
.pf-step-enter-from {
  opacity: 0;
  transform: translateY(14px) scale(0.98);
}
.pf-step-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.99);
}

.pf-fade-enter-active,
.pf-fade-leave-active {
  transition: opacity 160ms ease;
}
.pf-fade-enter-from,
.pf-fade-leave-to {
  opacity: 0;
}

@keyframes pfGlow {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(1);
  }
  50% {
    opacity: 0.9;
    transform: scale(1.06);
  }
}
@keyframes pfPulse {
  0% {
    transform: scale(0.55);
    opacity: 0.65;
  }
  100% {
    transform: scale(1.4);
    opacity: 0;
  }
}
@keyframes pfDonePulse {
  0% {
    transform: scale(0.55);
    opacity: 0.55;
  }
  100% {
    transform: scale(1.4);
    opacity: 0;
  }
}
@keyframes pfSpin {
  to {
    transform: rotate(360deg);
  }
}
</style>
