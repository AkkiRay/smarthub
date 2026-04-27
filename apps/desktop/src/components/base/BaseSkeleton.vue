<template>
  <div
    class="skeleton"
    :class="[variant ? `skeleton--${variant}` : '', rounded ? `skeleton--rounded-${rounded}` : '']"
    :style="style"
    aria-hidden="true"
    role="presentation"
  />
</template>

<script setup lang="ts">
/**
 * Атом-плейсхолдер с shimmer-анимацией. Использует BEM-блок `.skeleton`
 * (см. styles/blocks/_skeleton.scss). Не использует JS — анимация чисто CSS.
 *
 * @example
 * <BaseSkeleton variant="line" width="60%" />
 * <BaseSkeleton variant="card" height="140px" />
 * <BaseSkeleton variant="circle" size="48px" />
 */

import { computed, type CSSProperties } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Семантическая роль плейсхолдера. */
    variant?: 'line' | 'card' | 'circle' | 'pill' | 'tile';
    /** Ширина (CSS-значение `'60%'`, `'120px'`, …). */
    width?: string;
    /** Высота. */
    height?: string;
    /** Размер для `circle`-варианта (ставит и width, и height). */
    size?: string;
    /** Радиус — `sm` / `md` / `lg` / `pill`. */
    rounded?: 'sm' | 'md' | 'lg' | 'pill';
  }>(),
  {},
);

const style = computed<CSSProperties>(() => {
  const out: CSSProperties = {};
  if (props.size) {
    out.width = props.size;
    out.height = props.size;
  }
  if (props.width) out.width = props.width;
  if (props.height) out.height = props.height;
  return out;
});
</script>
