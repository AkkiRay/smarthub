<template>
  <span
    class="brand-mark"
    :class="[`brand-mark--${size}`, { 'brand-mark--filled': filled }]"
    :style="filled ? { '--brand-tone': accent } : null"
    :aria-label="label"
    role="img"
  >
    <span class="brand-mark__svg" v-safe-html="svg" />
  </span>
</template>

<script setup lang="ts">
/**
 * @fileoverview
 * Реестр brand-SVG для всех поддерживаемых интеграций (31 driver).
 * Марки лежат в `@/assets/brand-logos/<driver-id>.svg`, подхватываются
 * eager-glob'ом Vite в стартовый chunk. SVG рендерятся в `currentColor`,
 * accent задаётся родителем из driverPalette.
 * Fallback для отсутствующих ID — neutral circle-mark с «!» внутри.
 */

import { computed } from 'vue';
import type { DriverId } from '@smarthome/shared';
import { driverAccent } from '@/constants/driverPalette';

interface Props {
  /** ID драйвера (yeelight / hue / tuya / ...) или произвольный brand-id. */
  brand: DriverId | string;
  /** sm = 16, md = 20, lg = 28, xl = 40. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Filled-rounded background с brand-accent (для chip/orbital). */
  filled?: boolean;
  /** Aria-label override. По умолчанию = brand-id. */
  label?: string;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  filled: false,
  label: undefined,
});

const accent = computed(() => driverAccent(props.brand as DriverId));
const label = computed(() => props.label ?? String(props.brand));

// Eager-glob: все SVG в стартовый chunk на build-time (~+45KB raw для 31 brand-mark).
const modules = import.meta.glob('@/assets/brand-logos/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const REGISTRY: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [path, raw] of Object.entries(modules)) {
    const id = path.split('/').pop()?.replace('.svg', '');
    if (id) map[id] = raw;
  }
  return map;
})();

// Marker-attribute `data-mono="1"` отличает fallback от brand-SVG;
// CSS-override на shape-fill пропускает monogram (см. styles).
const FALLBACK = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" data-mono="1">
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <path d="M12 7v5M12 16v.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
</svg>`;

const svg = computed(() => {
  const id = String(props.brand);
  return REGISTRY[id] ?? FALLBACK;
});
</script>

<style scoped lang="scss">
.brand-mark {
  --mark-size: 20px;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--mark-size);
  height: var(--mark-size);
  flex-shrink: 0;
  color: currentColor;

  &--sm  { --mark-size: 16px; }
  &--md  { --mark-size: 20px; }
  &--lg  { --mark-size: 28px; }
  &--xl  { --mark-size: 40px; }

  // Filled: марка в скруглённом квадрате с brand-tone fill.
  // Используется в DriverIcon, DriversMarketplace, Discovery.
  &--filled {
    --brand-tone: var(--color-brand-violet);
    --pad: calc(var(--mark-size) * 0.32);
    background: color-mix(in srgb, var(--brand-tone) 14%, transparent);
    color: var(--brand-tone);
    width: calc(var(--mark-size) + var(--pad) * 2);
    height: calc(var(--mark-size) + var(--pad) * 2);
    border-radius: calc((var(--mark-size) + var(--pad) * 2) * 0.27);

    .brand-mark__svg {
      width: var(--mark-size);
      height: var(--mark-size);
    }
  }

  &__svg {
    display: inline-flex;
    width: 100%;
    height: 100%;
    // Mount-fade: 0→1 opacity + scale-ease. `both` фиксирует opacity:0 до старта.
    animation: brand-mark-reveal var(--dur-medium) var(--ease-out) both;
    // Плавный transition accent'а (active-state в DriverIcon).
    transition: color var(--dur-medium) var(--ease-out);

    :deep(svg) {
      width: 100%;
      height: 100%;
    }

    // Simple-icons SVG: shape-fill в currentColor. Monogram (data-mono) исключён —
    // там `fill="none"` явный.
    :deep(svg:not([data-mono]) path),
    :deep(svg:not([data-mono]) rect),
    :deep(svg:not([data-mono]) circle),
    :deep(svg:not([data-mono]) polygon) {
      fill: currentColor;
      transition: fill var(--dur-medium) var(--ease-out);
    }
  }
}

@keyframes brand-mark-reveal {
  from {
    opacity: 0;
    transform: scale(0.88);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

// Motion off/reduced: fade без scale.
[data-motion='off'] .brand-mark__svg,
[data-motion='reduced'] .brand-mark__svg {
  animation-name: brand-mark-reveal-flat;
}

@keyframes brand-mark-reveal-flat {
  from { opacity: 0; }
  to   { opacity: 1; }
}
</style>
