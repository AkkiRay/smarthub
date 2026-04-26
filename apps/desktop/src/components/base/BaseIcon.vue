<template>
  <span
    class="icon"
    :class="{ 'icon--spinning': spin }"
    :style="{ width: sizePx, height: sizePx }"
    :aria-hidden="!ariaLabel"
    :aria-label="ariaLabel"
    role="img"
    v-safe-html="content"
  />
</template>

<script setup lang="ts">
// Единая точка отрисовки SVG-иконок. Plain-SVG с stroke=currentColor наследуют
// цвет от родителя; Vite `?raw` инлайнит в bundle — нет runtime-запросов.

import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    name: IconName;
    /** Размер квадратной иконки (px). По умолчанию наследуется из CSS. */
    size?: number | string;
    /** Анимация вращения (loading-state). */
    spin?: boolean;
    /** A11y-метка. Без неё иконка считается декоративной. */
    ariaLabel?: string;
  }>(),
  { size: undefined, spin: false, ariaLabel: undefined },
);

// Eager-glob — все SVG в стартовый chunk: ~15-20 КБ raw, зато нет flickering
// при первой отрисовке.
const modules = import.meta.glob('@/assets/icons/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const registry = (() => {
  const map = new Map<string, string>();
  for (const [path, raw] of Object.entries(modules)) {
    const name = path.split('/').pop()?.replace('.svg', '');
    if (name) map.set(name, raw);
  }
  return map;
})();

export type IconName =
  | 'home'
  | 'devices'
  | 'rooms'
  | 'scenes'
  | 'search'
  | 'alice'
  | 'settings'
  | 'light'
  | 'socket'
  | 'switch'
  | 'sensor'
  | 'thermostat'
  | 'color'
  | 'temperature'
  | 'media'
  | 'speaker'
  | 'music'
  | 'volume'
  | 'play'
  | 'pause'
  | 'clock'
  | 'timer'
  | 'equalizer'
  | 'bluetooth'
  | 'info'
  | 'weather'
  | 'news'
  | 'plus'
  | 'close'
  | 'check'
  | 'arrow-right'
  | 'arrow-left'
  | 'trash'
  | 'edit'
  | 'refresh'
  | 'logo'
  | 'window-minimize'
  | 'window-maximize'
  | 'window-restore'
  | 'scene-all-on'
  | 'scene-all-off'
  | 'scene-movie'
  | 'scene-sleep';

const content = computed<string>(() => {
  const raw = registry.get(props.name);
  if (!raw) {
    // Fallback в dev — сразу видно опечатку имени.
    if (import.meta.env.DEV) console.warn(`[BaseIcon] unknown icon: ${props.name}`);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9 9h6v6H9z" fill="currentColor"/></svg>';
  }
  return raw;
});

const sizePx = computed<string | undefined>(() => {
  if (props.size === undefined) return undefined;
  return typeof props.size === 'number' ? `${props.size}px` : props.size;
});
</script>

<style scoped lang="scss">
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 0;
  color: inherit;

  :deep(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }

  &--spinning :deep(svg) {
    animation: icon-spin 1s linear infinite;
  }
}

@keyframes icon-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
