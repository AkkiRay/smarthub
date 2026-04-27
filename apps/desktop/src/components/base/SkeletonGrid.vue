<template>
  <div class="skeleton-grid shine-load" :style="gridStyle" aria-busy="true">
    <BaseSkeleton
      v-for="i in count"
      :key="i"
      variant="tile"
      :style="{ '--_delay': `${(i - 1) * 0.06}s` }"
      class="skeleton-grid__cell"
      :height="cellHeight"
      data-skeleton-tile
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Сетка skeleton-плиток для bento-вёрсток (Devices/Rooms/Scenes/Home).
 * Поддерживает auto-fit grid через CSS-vars без рекомпиляции.
 *
 * @example
 * <SkeletonGrid :count="6" cell-min="220px" cell-height="160px" />
 */

import { computed, type CSSProperties } from 'vue';
import BaseSkeleton from './BaseSkeleton.vue';

const props = withDefaults(
  defineProps<{
    /** Сколько плиток отрисовать. */
    count?: number;
    /** Min-ширина плитки (для grid-template-columns auto-fit). */
    cellMin?: string;
    /** Высота каждой плитки. */
    cellHeight?: string;
    /** Gap между плитками. */
    gap?: string;
  }>(),
  {
    count: 6,
    cellMin: '220px',
    cellHeight: '140px',
    gap: 'var(--space-3)',
  },
);

const gridStyle = computed<CSSProperties>(() => ({
  '--_skeleton-cell-min': props.cellMin,
  '--_skeleton-gap': props.gap,
}));
</script>

<style scoped lang="scss">
.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--_skeleton-cell-min), 1fr));
  gap: var(--_skeleton-gap);
  width: 100%;

  &__cell {
    animation-delay: var(--_delay, 0s);
  }
}
</style>
