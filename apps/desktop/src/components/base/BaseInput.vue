<template>
  <label
    class="input"
    :class="[`input--${size}`, { 'has-icon': iconLeft, 'is-disabled': disabled }]"
  >
    <span v-if="label" class="input__label">{{ label }}</span>
    <span class="input__field">
      <BaseIcon v-if="iconLeft" :name="iconLeft" class="input__icon input__icon--left" />
      <input
        ref="inputEl"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :spellcheck="spellcheck"
        :autocomplete="autocomplete"
        :inputmode="inputmode"
        @input="onInput"
        @change="onChange"
        @focus="$emit('focus', $event)"
        @blur="$emit('blur', $event)"
      />
      <BaseIcon v-if="iconRight" :name="iconRight" class="input__icon input__icon--right" />
    </span>
    <span v-if="hint" class="input__hint">{{ hint }}</span>
  </label>
</template>

<script setup lang="ts">
// Текстовое поле с label, иконками, hint. Native input — accessibility и autofill сохранены.

import { useTemplateRef } from 'vue';
import BaseIcon, { type IconName } from './BaseIcon.vue';

const props = withDefaults(
  defineProps<{
    modelValue: string | number | null | undefined;
    type?: 'text' | 'number' | 'password' | 'email' | 'tel' | 'url' | 'search';
    label?: string;
    hint?: string;
    placeholder?: string;
    iconLeft?: IconName;
    iconRight?: IconName;
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    readonly?: boolean;
    spellcheck?: boolean;
    autocomplete?: string;
    inputmode?: 'text' | 'numeric' | 'decimal' | 'url' | 'email' | 'tel' | 'search';
  }>(),
  { type: 'text', size: 'md', disabled: false, readonly: false, spellcheck: false },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  change: [value: string];
  focus: [event: FocusEvent];
  blur: [event: FocusEvent];
}>();

const inputEl = useTemplateRef<HTMLInputElement>('inputEl');

defineExpose({ focus: () => inputEl.value?.focus() });

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).value);
}
function onChange(e: Event): void {
  emit('change', (e.target as HTMLInputElement).value);
}
</script>

<style scoped lang="scss">
.input {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;

  // Mobile: tighter gap + touch-height (44px) для удобного тапа.
  // На coarse-pointer токены `--control-h-md` уже 44px, но `<input>` тут
  // hardcoded 40px — обновим через media-query.
  @media (max-width: 720px) {
    gap: 4px;
  }

  &__label {
    font-size: 12px;
    color: var(--color-text-secondary);
    letter-spacing: 0.01em;
  }

  &__field {
    position: relative;
    display: flex;
    align-items: center;

    input {
      flex: 1;
      width: 100%;
      height: 40px;
      padding: 0 14px;
      @media (hover: none) and (pointer: coarse) {
        height: 44px;
        font-size: 16px; // 16px+ запрещает iOS auto-zoom при focus'е
      }
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border-soft);
      background: rgba(255, 255, 255, 0.04);
      color: var(--color-text-primary);
      font-family: inherit;
      font-size: 14px;
      transition:
        border-color 200ms var(--ease-out),
        background 200ms var(--ease-out),
        box-shadow 220ms var(--ease-out);

      &::placeholder {
        color: var(--color-text-muted);
      }
      &:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.06);
      }
      &:focus {
        outline: none;
        border-color: rgba(var(--color-brand-purple-rgb), 0.6);
        background: rgba(255, 255, 255, 0.06);
        box-shadow: 0 0 0 3px rgba(var(--color-brand-violet-rgb), 0.18);
      }
      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }

  &__icon {
    position: absolute;
    width: 16px;
    height: 16px;
    pointer-events: none;
    color: var(--color-text-muted);

    &--left {
      left: 12px;
    }
    &--right {
      right: 12px;
    }
  }

  &.has-icon input {
    padding-left: 36px;
  }

  &__hint {
    font-size: 12px;
    color: var(--color-text-muted);
  }

  &--sm input {
    height: 32px;
    padding: 0 12px;
    font-size: 13px;
  }
  &--lg input {
    height: 48px;
    padding: 0 16px;
    font-size: 15px;
  }
  &--sm.has-icon input {
    padding-left: 32px;
  }
  &--lg.has-icon input {
    padding-left: 40px;
  }
}
</style>
