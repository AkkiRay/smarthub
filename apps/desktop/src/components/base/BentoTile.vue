<template>
  <component
    :is="as"
    ref="root"
    class="bento"
    :class="[
      `bento--${tone}`,
      {
        'bento--clickable': interactive,
        [`bento--span-${span}`]: span !== 1,
        [`bento--span-row-${spanRows}`]: spanRows > 1,
      },
    ]"
    :style="cssVars"
    @click="onClick"
  >
    <header v-if="$slots.header || label || icon" class="bento__head">
      <span v-if="icon || $slots.icon" class="bento__icon">
        <slot name="icon">
          <BaseIcon v-if="icon" :name="icon" :size="20" />
        </slot>
      </span>
      <span v-if="label" class="bento__label">{{ label }}</span>
      <slot name="header" />
      <span v-if="$slots.action" class="bento__action">
        <slot name="action" />
      </span>
    </header>

    <div class="bento__body" :class="{ 'bento__body--center': centerBody }">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="bento__footer">
      <slot name="footer" />
    </footer>

    <!-- Hover sweep-glow — диагональный CSS-блик. -->
    <span class="bento__sheen" aria-hidden="true" />
  </component>
</template>

<script setup lang="ts">
// Bento-grid тайл. span/spanRows — асимметричная сетка. tone — цвет glow
// в верхнем углу.

import { computed, useTemplateRef } from 'vue';
import BaseIcon, { type IconName } from './BaseIcon.vue';

type Tone = 'neutral' | 'violet' | 'pink' | 'blue' | 'cyan' | 'green' | 'amber';

const props = withDefaults(
  defineProps<{
    /** HTML-тег. По умолчанию <article> для dashboard-семантики. */
    as?: string;
    /** Метка в head (uppercase micro). */
    label?: string;
    icon?: IconName;
    /** Акцентный тон — цвет glow и бордера. */
    tone?: Tone;
    /** Кликабельная плитка (hover-lift + cursor:pointer). */
    interactive?: boolean;
    /** Колонок в grid. */
    span?: 1 | 2 | 3;
    /** Рядов в grid. */
    spanRows?: 1 | 2;
    /** Центрировать body (для KPI-цифр). */
    centerBody?: boolean;
  }>(),
  { as: 'article', tone: 'neutral', interactive: false, span: 1, spanRows: 1, centerBody: false },
);

const emit = defineEmits<{ click: [event: MouseEvent] }>();
const root = useTemplateRef<HTMLElement>('root');

const TONE_COLORS: Record<Tone, { glow: string; edge: string }> = {
  neutral: { glow: 'rgba(255, 255, 255, 0.10)', edge: 'rgba(255, 255, 255, 0.08)' },
  violet: { glow: 'rgba(var(--color-brand-violet-rgb), 0.55)', edge: 'rgba(var(--color-brand-violet-rgb), 0.32)' },
  pink: { glow: 'rgba(var(--color-brand-pink-rgb), 0.50)', edge: 'rgba(var(--color-brand-pink-rgb), 0.30)' },
  blue: { glow: 'rgba(77, 127, 255, 0.50)', edge: 'rgba(77, 127, 255, 0.30)' },
  cyan: { glow: 'rgba(91, 216, 255, 0.50)', edge: 'rgba(91, 216, 255, 0.30)' },
  green: { glow: 'rgba(45, 216, 154, 0.50)', edge: 'rgba(45, 216, 154, 0.30)' },
  amber: { glow: 'rgba(255, 181, 71, 0.50)', edge: 'rgba(255, 181, 71, 0.30)' },
};

const cssVars = computed(() => {
  const c = TONE_COLORS[props.tone];
  return {
    '--bento-glow': c.glow,
    '--bento-edge': c.edge,
  };
});

function onClick(e: MouseEvent): void {
  if (props.interactive) emit('click', e);
}

defineExpose({ root });
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.bento {
  --bento-glow: rgba(255, 255, 255, 0.1);
  --bento-edge: rgba(255, 255, 255, 0.08);

  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: var(--bento-tile-pad);
  border-radius: var(--bento-radius);
  overflow: hidden;
  isolation: isolate;
  @include glass(var(--glass-alpha-medium), var(--glass-blur-medium));
  border-color: var(--bento-edge);
  transition:
    transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 280ms var(--ease-out),
    box-shadow 280ms var(--ease-out);

  // Top-left glow — подсветка тона.
  &::before {
    content: '';
    position: absolute;
    top: -40%;
    left: -20%;
    width: 70%;
    height: 70%;
    border-radius: 50%;
    background: radial-gradient(circle, var(--bento-glow), transparent 65%);
    opacity: 0.55;
    filter: blur(40px);
    pointer-events: none;
    z-index: 0;
    transition: opacity 380ms var(--ease-out);
  }

  // Hover-sweep — диагональный блик стартует за пределами тайла.
  &__sheen {
    position: absolute;
    top: 0;
    left: -120%;
    width: 60%;
    height: 100%;
    background: linear-gradient(
      105deg,
      transparent 35%,
      rgba(255, 255, 255, 0.1) 50%,
      transparent 65%
    );
    transform: skewX(-12deg);
    pointer-events: none;
    z-index: 1;
    transition: left 720ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  &__head {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-secondary);
  }

  &__icon {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    color: var(--color-text-primary);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
  }

  &__label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__action {
    margin-left: auto;
    flex-shrink: 0;
  }

  &__body {
    position: relative;
    z-index: 2;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;

    &--center {
      justify-content: center;
      align-items: flex-start;
    }
  }

  &__footer {
    position: relative;
    z-index: 2;
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  // ---- Interactive ---------------------------------------------------------
  &--clickable {
    cursor: pointer;

    &:hover {
      transform: translateY(-3px);
      border-color: var(--color-border-strong);
      box-shadow:
        0 18px 40px rgba(0, 0, 0, 0.4),
        0 0 0 1px var(--bento-edge);

      &::before {
        opacity: 0.85;
      }
      .bento__sheen {
        left: 120%;
      }
    }

    &:active {
      transform: translateY(-1px);
    }
    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(var(--color-brand-violet-rgb), 0.4);
    }
  }

  // ---- Bento-grid spans ---------------------------------------------------
  &--span-2 {
    grid-column: span 2;
  }
  &--span-3 {
    grid-column: span 3;
  }
  &--span-row-2 {
    grid-row: span 2;
  }

  // На узких контейнерах span сворачивается — иначе тайлы переполняют.
  @container (max-width: 720px) {
    &--span-2,
    &--span-3 {
      grid-column: span 1;
    }
    &--span-row-2 {
      grid-row: span 1;
    }
  }
  @media (max-width: 720px) {
    &--span-2,
    &--span-3 {
      grid-column: span 1;
    }
    &--span-row-2 {
      grid-row: span 1;
    }
  }
}
</style>
