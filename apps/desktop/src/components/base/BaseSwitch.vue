<template>
  <button
    ref="root"
    type="button"
    role="switch"
    class="switch"
    :class="[
      `switch--${size}`,
      { 'is-on': modelValue, 'is-loading': loading, 'is-disabled': disabled },
    ]"
    :aria-checked="modelValue"
    :disabled="disabled || loading"
    @click="onToggle"
  >
    <span class="switch__track" aria-hidden="true">
      <span class="switch__track-glow" />
    </span>
    <span class="switch__thumb" aria-hidden="true">
      <span v-if="loading" class="switch__spinner">
        <BaseIcon name="refresh" spin />
      </span>
      <!-- On-state: gradient-dot внутри thumb («лампочка горит»). -->
      <span v-else-if="modelValue" class="switch__thumb-glow" />
    </span>
  </button>
</template>

<script setup lang="ts">
/**
 * BaseSwitch
 *
 * Toggle primitive с поддержкой loading-state (spinner внутри thumb)
 * для async-команд (например, IPC к устройствам).
 *
 * @example
 * <BaseSwitch v-model="isOn" :loading="busy" size="lg" />
 */

import { useTemplateRef } from 'vue';
import BaseIcon from './BaseIcon.vue';

interface Props {
  /** v-model: state свича. */
  modelValue: boolean;
  /** Размер. */
  size?: 'sm' | 'md' | 'lg';
  /** Disable клики и затемнить контрол. */
  disabled?: boolean;
  /** Spinner внутри thumb, клики игнорируются. */
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  disabled: false,
  loading: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const root = useTemplateRef<HTMLButtonElement>('root');

/** Toggle handler: эмитит update:modelValue с инвертированным значением. */
function onToggle(): void {
  if (props.disabled || props.loading) return;
  emit('update:modelValue', !props.modelValue);
}

/** Programmatic .focus() для form-навигации. */
defineExpose({ focus: () => root.value?.focus() });
</script>

<style scoped lang="scss">
.switch {
  // ---- Sizing tokens ------------------------------------------------------
  --sw-w: 52px;
  --sw-h: 30px;
  --sw-thumb: 24px;
  --sw-pad: 3px;

  position: relative;
  width: var(--sw-w);
  height: var(--sw-h);
  border: 0;
  outline: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
  // border-radius на самом button — custom focus-ring не торчит за pill.
  border-radius: var(--radius-pill);
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 200ms var(--ease-out);

  &:active:not(:disabled) {
    transform: scale(0.96);
  }

  // focus-visible — только при keyboard-nav.
  &:focus-visible {
    box-shadow: 0 0 0 3px rgba(var(--color-brand-violet-rgb), 0.4);
  }

  // ---- Track ---------------------------------------------------------------
  &__track {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.06);
    overflow: hidden;
    transition:
      background 280ms var(--ease-out),
      border-color 280ms var(--ease-out);
  }

  // On-state: brand-gradient заливает track («свечение лампочки»).
  &__track-glow {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--gradient-brand);
    opacity: 0;
    transition: opacity 280ms var(--ease-out);
  }

  // Hover off-state — track светлее. On-state — glow усиливается ниже.
  &:hover:not(:disabled):not(.is-on) .switch__track {
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.1);
  }

  // ---- Thumb ---------------------------------------------------------------
  &__thumb {
    position: absolute;
    top: var(--sw-pad);
    left: var(--sw-pad);
    width: var(--sw-thumb);
    height: var(--sw-thumb);
    border-radius: 50%;
    background: #fff;
    display: grid;
    place-items: center;
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.2),
      0 0 0 1px rgba(0, 0, 0, 0.06);
    transition:
      transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
      background 200ms var(--ease-out),
      box-shadow 240ms var(--ease-out);
  }

  // Gradient-dot внутри thumb в on-state.
  &__thumb-glow {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gradient-brand);
    box-shadow: 0 0 6px rgba(var(--color-brand-purple-rgb), 0.7);
  }

  &__spinner {
    width: 14px;
    height: 14px;
    color: var(--color-brand-violet);
    display: inline-flex;
  }

  // ---- ON-state ------------------------------------------------------------
  &.is-on {
    .switch__track {
      background: transparent;
      border-color: transparent;
    }
    .switch__track-glow {
      opacity: 1;
    }

    .switch__thumb {
      transform: translateX(calc(var(--sw-w) - var(--sw-thumb) - var(--sw-pad) * 2));
      box-shadow:
        0 2px 6px rgba(0, 0, 0, 0.28),
        0 0 0 1px rgba(0, 0, 0, 0.08);
    }
  }

  // Hover on-state — soft halo вокруг toggle.
  &.is-on:hover:not(:disabled) {
    box-shadow: 0 0 18px rgba(var(--color-brand-purple-rgb), 0.45);
  }

  // ---- Loading -------------------------------------------------------------
  &.is-loading {
    cursor: progress;
    .switch__thumb {
      background: rgba(255, 255, 255, 0.94);
    }
  }

  // ---- Disabled ------------------------------------------------------------
  &:disabled,
  &.is-disabled {
    cursor: not-allowed;
    opacity: 0.45;

    &:hover .switch__track {
      background: rgba(255, 255, 255, 0.1);
    }
  }

  // ---- Sizes ---------------------------------------------------------------
  &--sm {
    --sw-w: 40px;
    --sw-h: 24px;
    --sw-thumb: 18px;
    --sw-pad: 3px;

    .switch__thumb-glow {
      width: 6px;
      height: 6px;
    }
    .switch__spinner {
      width: 12px;
      height: 12px;
    }
  }

  &--lg {
    --sw-w: 64px;
    --sw-h: 36px;
    --sw-thumb: 28px;
    --sw-pad: 4px;

    .switch__thumb-glow {
      width: 10px;
      height: 10px;
    }
    .switch__spinner {
      width: 16px;
      height: 16px;
    }
  }
}
</style>
