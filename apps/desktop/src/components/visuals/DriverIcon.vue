<template>
  <BrandMark
    :brand="driver"
    :size="markSize"
    filled
    :class="['driver-icon', `driver-icon--${size}`, { 'is-active': active }]"
  />
</template>

<script setup lang="ts">
/**
 * DriverIcon: filled brand-mark с accent-цветом из driverPalette.
 * Wrapper над BrandMark — мапит внешний `size` на `markSize` BrandMark
 * и пробрасывает active-state через CSS-class.
 */

import { computed } from 'vue';
import type { DriverId } from '@smarthome/shared';
import BrandMark from './BrandMark.vue';

const props = withDefaults(
  defineProps<{
    driver: DriverId;
    /** sm = 32, md = 44, lg = 56. */
    size?: 'sm' | 'md' | 'lg';
    /** «Активный» state — насыщеннее tone. */
    active?: boolean;
  }>(),
  { size: 'md', active: false },
);

// BrandMark sizes (16/20/28/40) под выходной wrap-size DriverIcon.
const markSize = computed<'sm' | 'md' | 'lg' | 'xl'>(() => {
  switch (props.size) {
    case 'sm':
      return 'md'; // 20px mark, ~32px filled-кнопка
    case 'lg':
      return 'xl'; // 40px mark, ~56px filled-кнопка
    case 'md':
    default:
      return 'lg'; // 28px mark, ~44px filled-кнопка
  }
});
</script>

<style scoped lang="scss">
// Transition фона: `is-active` toggle меняет alpha 14% → 22%.
// --dur-medium синхронизирован с BrandMark color-fade — tint и glow едут вместе.
.driver-icon {
  transition: background-color var(--dur-medium) var(--ease-out);

  :deep(.brand-mark__svg) {
    // Baseline filter для transition'а; реальный drop-shadow — в is-active.
    filter: drop-shadow(0 0 0 transparent);
    transition: filter var(--dur-medium) var(--ease-out);
  }
}

// `is-active`: усиливает tint (BrandMark.filled держит alpha 14%).
.driver-icon.is-active :deep(.brand-mark__svg) {
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--brand-tone) 45%, transparent));
}

.driver-icon.is-active {
  background: color-mix(in srgb, var(--brand-tone) 22%, transparent) !important;
}
</style>
