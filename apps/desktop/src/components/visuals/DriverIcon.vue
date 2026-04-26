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
 * Driver-icon: brand-recognizable filled-mark с accent-цветом из driverPalette.
 * Тонкий wrapper над BrandMark (он держит SVG-реестр всех 31 интеграции) —
 * единственная задача компонента это маппинг внешнего `size` на `markSize`
 * BrandMark и пробрасывание active-стейта через CSS-class.
 *
 * Раньше тут жили абстрактные animated SVG (yellight-rays, mqtt-arcs и т.п.) —
 * они вытеснены в пользу настоящих brand-marks: бренды не должны «дышать».
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

// BrandMark sizes (16/20/28/40) — выбираем под выходной wrap-size DriverIcon.
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
// Базовый transition фона — `is-active` toggle меняет alpha 14% → 22%,
// плавно вместо абрупт-flash'а. Тот же --dur-medium что и BrandMark color-fade,
// чтобы tint и glow ехали синхронно.
.driver-icon {
  transition: background-color var(--dur-medium) var(--ease-out);

  :deep(.brand-mark__svg) {
    // Filter ставится только в active-state (см. ниже) — пустой baseline нужен,
    // чтобы `transition` имел `from`-состояние, иначе drop-shadow появляется
    // мгновенно (поп-эффект) при первом active-toggle.
    filter: drop-shadow(0 0 0 transparent);
    transition: filter var(--dur-medium) var(--ease-out);
  }
}

// `is-active` усиливает tint (BrandMark.filled держит alpha 14%, тут поднимаем).
.driver-icon.is-active :deep(.brand-mark__svg) {
  // Чуть ярче currentColor — тонко, без объёма.
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--brand-tone) 45%, transparent));
}

.driver-icon.is-active {
  background: color-mix(in srgb, var(--brand-tone) 22%, transparent) !important;
}
</style>
