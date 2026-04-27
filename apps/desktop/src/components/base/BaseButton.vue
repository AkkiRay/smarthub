<template>
  <button
    ref="buttonEl"
    :type="type"
    :class="classes"
    :disabled="disabled || loading"
    :aria-busy="loading"
    :aria-label="ariaLabel"
    @click="onClick"
    @pointerdown="animatePress"
    @pointerup="animateRelease"
    @pointerleave="animateRelease"
  >
    <span v-if="loading" class="base-button__spinner" aria-hidden="true">
      <BaseIcon name="refresh" spin />
    </span>
    <BaseIcon
      v-else-if="iconLeft"
      :name="iconLeft"
      class="base-button__icon base-button__icon--left"
    />

    <span v-if="$slots.default" class="base-button__label">
      <slot />
    </span>

    <BaseIcon
      v-if="iconRight && !loading"
      :name="iconRight"
      class="base-button__icon base-button__icon--right"
    />
  </button>
</template>

<script setup lang="ts">
// Button primitive. Variant / size / icons + auto-loading при async @click.

import { computed, ref, useTemplateRef } from 'vue';
import { gsap } from 'gsap';
import BaseIcon, { type IconName } from './BaseIcon.vue';
import { useUiStore } from '@/stores/ui';

type Variant = 'primary' | 'ghost' | 'danger' | 'glass' | 'surface';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const props = withDefaults(
  defineProps<{
    variant?: Variant;
    size?: Size;
    iconLeft?: IconName;
    iconRight?: IconName;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    /** Внешний loading от родителя. */
    loading?: boolean;
    /** Auto-loading при async @click. */
    autoLoading?: boolean;
    /** A11y label для icon-only-кнопок. */
    ariaLabel?: string;
    block?: boolean;
  }>(),
  {
    variant: 'surface',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
    autoLoading: true,
    block: false,
  },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const ui = useUiStore();
const buttonEl = useTemplateRef<HTMLButtonElement>('buttonEl');

const internalLoading = ref(false);
const loading = computed(() => props.loading || internalLoading.value);

const classes = computed(() => [
  'base-button',
  `base-button--${props.variant}`,
  `base-button--${props.size}`,
  {
    'base-button--block': props.block,
    'base-button--loading': loading.value,
    'base-button--icon-only': !!props.ariaLabel && !slotsHaveLabel.value,
  },
]);

// Label-флаг определяется в template через v-if на slot.
const slotsHaveLabel = computed(() => false);

async function onClick(event: MouseEvent): Promise<void> {
  if (loading.value || props.disabled) return;
  emit('click', event);
  if (!props.autoLoading) return;
}

// Press feedback: noop, плоский дизайн без scale / elastic.
function animatePress(): void {
  void ui;
  void buttonEl;
}
function animateRelease(): void {
  /* noop */
}
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.base-button {
  // Variant tokens. Idle / hover / active — три отдельных значения.
  --bb-bg: rgba(255, 255, 255, 0.06);
  --bb-bg-hover: rgba(255, 255, 255, 0.1);
  --bb-bg-active: rgba(255, 255, 255, 0.14);
  --bb-fg: var(--color-text-primary);
  --bb-fg-hover: var(--color-text-primary);
  --bb-border: var(--color-border-subtle);
  --bb-border-hover: var(--color-border-soft);

  // Own stacking context над glass-noise ::after.
  position: relative;
  z-index: var(--z-raised);
  isolation: isolate;
  pointer-events: auto;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  padding: 0 16px;
  border: 1px solid var(--bb-border);
  border-radius: var(--radius-pill);
  background: var(--bb-bg);
  color: var(--bb-fg);
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 500;
  letter-spacing: -0.005em;
  white-space: nowrap;
  cursor: pointer !important;
  user-select: none;
  // Все channel'ы через motion-tokens — реагируют на смену motion-level.
  // Transform отдельным caнhannel'ом с soft easing'ом (без spring overshoot'а
  // на hover — раньше combo lift+scale вызывала «дрожь» при быстром mouseover).
  transition:
    background var(--trans-base),
    background-color var(--trans-base),
    border-color var(--trans-base),
    color var(--trans-base),
    transform var(--trans-transform),
    box-shadow var(--trans-medium),
    outline-color var(--trans-base);

  // Hover: только translateY (без scale) — меньше визуального шума при
  // быстром перемещении мыши по ряду кнопок.
  &:hover:not(:disabled) {
    background: var(--bb-bg-hover);
    color: var(--bb-fg-hover);
    border-color: var(--bb-border-hover);
    transform: translate3d(0, var(--lift), 0);
    box-shadow:
      var(--bb-shadow-hover, 0 6px 18px rgba(0, 0, 0, 0.24)),
      0 0 0 1px var(--bb-border-hover);
  }

  &:active:not(:disabled) {
    background: var(--bb-bg-active);
    transform: translate3d(0, 0, 0) scale(var(--press-scale));
    // Active: instant, без inertia — тактильное «прижатие».
    transition-duration: var(--dur-instant);
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-brand-purple) 75%, transparent);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed !important;
    transform: none !important;
    box-shadow: none !important;
  }

  &__icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;

    &--left {
      margin-left: -2px;
    }
    &--right {
      margin-right: -2px;
    }
  }

  &__spinner {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    color: currentColor;
  }

  &__label {
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1;
  }

  // Variants.

  &--primary {
    --bb-bg: var(--color-brand-violet);
    --bb-bg-hover: #7c69ff;
    --bb-bg-active: #5a47e5;
    --bb-border: transparent;
    --bb-border-hover: transparent;
    --bb-fg: #fff;
    --bb-fg-hover: #fff;
  }

  // Ghost: прозрачный idle, brand-tinted fill + видимая рамка на hover.
  &--ghost {
    --bb-bg: transparent;
    --bb-bg-hover: rgba(var(--color-brand-purple-rgb), 0.18);
    --bb-bg-active: rgba(var(--color-brand-purple-rgb), 0.28);
    --bb-border: transparent;
    --bb-border-hover: rgba(var(--color-brand-purple-rgb), 0.55);
    --bb-fg: var(--color-text-secondary);
    --bb-fg-hover: var(--color-text-primary);
    // Ghost hover-glow для периферийной читаемости интерактивности.
    --bb-shadow-hover:
      0 6px 18px rgba(var(--color-brand-purple-rgb), 0.28),
      0 0 0 1px rgba(var(--color-brand-purple-rgb), 0.4);
  }

  &--surface {
    --bb-border-hover: var(--color-border-strong);
  }

  &--glass {
    --bb-bg: rgba(255, 255, 255, 0.04);
    --bb-bg-hover: rgba(255, 255, 255, 0.1);
    --bb-bg-active: rgba(255, 255, 255, 0.14);
    --bb-border: var(--color-border-soft);
    --bb-border-hover: var(--color-border-strong);
  }

  &--danger {
    --bb-bg: transparent;
    --bb-bg-hover: rgba(255, 85, 119, 0.12);
    --bb-bg-active: rgba(255, 85, 119, 0.2);
    --bb-border: rgba(255, 85, 119, 0.3);
    --bb-border-hover: rgba(255, 85, 119, 0.55);
    --bb-fg: #ff7a92;
    --bb-fg-hover: #ff95a8;
  }

  // Sizes.

  &--sm {
    height: 30px;
    padding: 0 12px;
    font-size: 12.5px;
    .base-button__icon {
      width: 14px;
      height: 14px;
    }
  }

  &--lg {
    height: 46px;
    padding: 0 22px;
    font-size: 14.5px;
    .base-button__icon {
      width: 18px;
      height: 18px;
    }
  }

  &--icon {
    width: 36px;
    height: 36px;
    padding: 0;
    .base-button__icon {
      width: 16px;
      height: 16px;
      margin: 0;
    }
    .base-button__label {
      display: none;
    }
  }

  &--icon-sm {
    width: 30px;
    height: 30px;
    padding: 0;
    .base-button__icon {
      width: 14px;
      height: 14px;
      margin: 0;
    }
    .base-button__label {
      display: none;
    }
  }

  &--block {
    width: 100%;
  }

  &--loading {
    pointer-events: none;
  }
}

// Touch: 44px tap target (Apple / Google HIG) на coarse-pointer или узком окне.
@media (hover: none) and (pointer: coarse), (max-width: 720px) {
  .base-button {
    min-height: var(--tap-min);

    &--sm {
      position: relative;
      &::before {
        content: '';
        position: absolute;
        inset: -7px 0;
      }
    }

    &--icon-sm {
      width: 40px;
      height: 40px;
    }
  }
}
</style>
