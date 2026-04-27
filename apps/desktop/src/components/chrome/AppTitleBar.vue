<template>
  <header
    class="title-bar"
    :class="{ 'title-bar--blurred': !windowFocused, 'title-bar--maximized': isMaximized }"
  >
    <!-- Lead: brand. Mobile-навигация — в фиксированном bottom-nav. -->
    <div class="title-bar__lead">
      <div class="title-bar__brand">
        <BaseIcon name="logo" :size="24" class="title-bar__mark" aria-label="SmartHome" />
        <span class="title-bar__wordmark">
          <span class="title-bar__wordmark-name">SmartHome</span>
          <span class="title-bar__wordmark-suffix">Hub</span>
        </span>
      </div>
    </div>

    <!-- Drag-area + live-status pill по центру. -->
    <div class="title-bar__center">
      <Transition name="title-pill" mode="out-in">
        <div
          :key="hubState"
          class="title-bar__status"
          :class="`title-bar__status--${hubState}`"
          data-tour="titlebar-status"
        >
          <span class="title-bar__status-dot" />
          <span class="title-bar__status-label">{{ statusCopy.label }}</span>
          <span class="title-bar__status-sep" aria-hidden="true">·</span>
          <span class="title-bar__status-detail">{{ statusCopy.detail }}</span>
        </div>
      </Transition>
    </div>

    <!-- Window controls. -->
    <div class="title-bar__controls">
      <button class="title-bar__btn" aria-label="Свернуть окно" type="button" @click="minimize">
        <BaseIcon name="window-minimize" :size="11" />
      </button>
      <button
        class="title-bar__btn"
        :aria-label="isMaximized ? 'Восстановить размер' : 'Развернуть на весь экран'"
        type="button"
        @click="toggleMaximize"
      >
        <BaseIcon :name="isMaximized ? 'window-restore' : 'window-maximize'" :size="11" />
      </button>
      <button
        class="title-bar__btn title-bar__btn--close"
        aria-label="Закрыть"
        type="button"
        @click="closeWindow"
      >
        <BaseIcon name="close" :size="11" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
// Custom chrome для frameless BrowserWindow (`frame: false`).

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { gsap } from 'gsap';
import { useDevicesStore } from '@/stores/devices';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useUiStore } from '@/stores/ui';
import BaseIcon from '@/components/base/BaseIcon.vue';

const devices = useDevicesStore();
const station = useYandexStationStore();
const ui = useUiStore();

const isMaximized = ref(false);
const windowFocused = ref(true);

// Window controls bridge: `smarthome.window.*` (DevTools API занимает `window.chrome`).
const minimize = (): Promise<void> => window.smarthome.window.minimize();
const toggleMaximize = async (): Promise<void> => {
  await window.smarthome.window.toggleMaximize();
  isMaximized.value = !isMaximized.value;
};
const closeWindow = (): Promise<void> => window.smarthome.window.close();

// Live hub status.

type HubState = 'online' | 'syncing' | 'offline';

const hubState = computed<HubState>(() => {
  if (devices.isLoading) return 'syncing';
  return 'online';
});

const aliceLabel = computed(() => {
  const c = station.status?.connection;
  if (c === 'connected') return 'Алиса в сети';
  if (c === 'connecting' || c === 'authenticating') return 'Алиса подключается';
  return null;
});

const statusCopy = computed(() => {
  if (hubState.value === 'syncing') {
    return { label: 'Синхронизация', detail: 'Опрашиваем устройства' };
  }
  const total = devices.devices.length;
  const onlineN = devices.onlineCount;
  const offlineN = devices.offlineCount;

  let detail: string;
  if (total === 0) detail = aliceLabel.value ?? 'Готов к подключению устройств';
  else if (offlineN === 0) detail = `${onlineN} ${pluralizeDevice(onlineN)} в сети`;
  else detail = `${onlineN} в сети · ${offlineN} оффлайн`;

  return { label: 'Хаб онлайн', detail };
});

function pluralizeDevice(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'устройств';
  if (m10 === 1) return 'устройство';
  if (m10 >= 2 && m10 <= 4) return 'устройства';
  return 'устройств';
}

// Window focus listeners.

function onFocus(): void {
  windowFocused.value = true;
}
function onBlur(): void {
  windowFocused.value = false;
}

onMounted(() => {
  if (!ui.reduceMotion) {
    // СИНХРОННО: immediateRender (default для from()) ставит FROM-state
    // sync'но ДО первого browser-paint'а — fade-in полностью видим.
    gsap.from('.title-bar__mark', {
      scale: 0.5,
      opacity: 0,
      duration: 0.4,
      ease: 'power2.out',
      force3D: true,
      clearProps: 'scale,opacity',
    });
    gsap.from('.title-bar__wordmark > *', {
      x: -6,
      opacity: 0,
      stagger: 0.05,
      duration: 0.32,
      delay: 0.08,
      force3D: true,
      clearProps: 'x,opacity',
    });
  }

  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
});

onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus);
  window.removeEventListener('blur', onBlur);
});
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.title-bar {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: stretch;
  height: var(--titlebar-height);
  background: rgba(var(--color-bg-rgb), 0.78);
  backdrop-filter: blur(var(--glass-blur-medium)) saturate(var(--glass-saturation));
  -webkit-backdrop-filter: blur(var(--glass-blur-medium)) saturate(var(--glass-saturation));
  // Separator строится разницей яркости + blur, без border-bottom.
  -webkit-app-region: drag;
  z-index: var(--z-sticky);
  transition: background var(--trans-medium);

  // Window blur: dimmed bg.
  &--blurred {
    background: rgba(var(--color-bg-rgb), 0.55);
    .title-bar__wordmark-name {
      color: var(--color-text-secondary);
    }
    .title-bar__status {
      opacity: 0.55;
    }
  }

  // Lead: brand.
  &__lead {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px 0 12px;
    -webkit-app-region: no-drag;

    @media (max-width: 720px) {
      padding-left: 8px;
      gap: 8px;
    }
  }

  // Brand: mark + wordmark.
  &__brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__mark {
    flex-shrink: 0;
    border-radius: 6px;
    overflow: hidden;
  }

  &__wordmark {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-family: var(--font-family-display);
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: -0.012em;
    line-height: 1;
    user-select: none;

    @media (max-width: 720px) {
      display: none; // mark identify-нет brand на mobile
    }
  }

  &__wordmark-name {
    color: var(--color-text-primary);
    transition: color var(--trans-medium);
  }
  &__wordmark-suffix {
    color: var(--color-text-secondary);
    font-weight: 400;
  }

  // Center: status pill.
  &__center {
    display: flex;
    justify-content: center;
    align-items: center;
    min-width: 0;
    padding: 0 14px;

    @media (max-width: 720px) {
      padding: 0 6px;
      justify-content: flex-start;
    }
  }

  &__status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 24px;
    padding: 0 12px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.04);
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-secondary);
    -webkit-app-region: no-drag;
    transition:
      background var(--trans-base),
      opacity var(--trans-medium);
    max-width: 360px;
    min-width: 0;

    &:hover {
      background: rgba(255, 255, 255, 0.07);
    }

    &-dot {
      flex-shrink: 0;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    &-label {
      font-weight: 600;
      letter-spacing: 0.005em;
      flex-shrink: 0;
      color: var(--color-text-primary);
    }

    &-sep {
      color: var(--color-text-muted);
      flex-shrink: 0;
      margin: 0 -2px;
    }

    &-detail {
      color: var(--color-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;

      @media (max-width: 720px) {
        display: none;
      }
    }

    @media (max-width: 720px) {
      .title-bar__status-sep {
        display: none;
      }
    }

    &--online {
      color: var(--color-success);
    }
    &--syncing {
      color: var(--color-brand-purple);
      .title-bar__status-dot {
        animation: titleBarDotPulse calc(1.4s / max(var(--motion-scale, 1), 0.001)) ease-in-out
          infinite;
      }
    }
    &--offline {
      color: var(--color-danger);
    }
  }

  // Window controls (Windows style).
  &__controls {
    display: flex;
    align-items: stretch;
    -webkit-app-region: no-drag;
  }

  &__btn {
    width: 46px;
    height: 100%;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      background var(--trans-base),
      color var(--trans-base);

    svg {
      width: 11px;
      height: 11px;
    }

    &:hover {
      background: rgba(255, 255, 255, 0.06);
      color: var(--color-text-primary);
    }

    &:active {
      background: rgba(255, 255, 255, 0.1);
    }

    &:focus-visible {
      outline: none;
      background: rgba(255, 255, 255, 0.08);
    }

    // Close: 8px corner radius под Windows 11 window.
    &--close {
      border-top-right-radius: 8px;

      &:hover {
        background: var(--color-danger);
        color: var(--color-text-primary);
      }
      &:active {
        background: color-mix(in srgb, var(--color-danger) 80%, #000 20%);
      }
    }
  }

  // Maximized: square corner на close button.
  &--maximized &__btn--close {
    border-top-right-radius: 0;
  }
}

// Pill transition: fast, без spring. Через motion-scale.
.title-pill-enter-active,
.title-pill-leave-active {
  transition: opacity var(--trans-base);
}
.title-pill-enter-from,
.title-pill-leave-to {
  opacity: 0;
}

@keyframes titleBarDotPulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

// Reduce-motion: pulse off.
.app--reduce-motion .title-bar {
  &__status-dot {
    animation: none !important;
  }
}

// Mobile.
@media (max-width: 720px) {
  .title-bar {
    grid-template-columns: auto minmax(0, 1fr) auto;

    &__lead {
      padding-left: 8px;
      gap: 0;
    }

    // Wordmark скрыт: место отдано status-pill.
    &__wordmark {
      display: none;
    }

    &__center {
      padding: 0 8px;
    }

    &__status {
      padding: 0 10px;
      max-width: none;
      // Mobile: только label, без detail / separator.
      &-sep,
      &-detail {
        display: none;
      }
    }

    &__btn {
      width: 40px;
    }
  }
}

// Tablet sm: status-pill detail truncated.
@media (min-width: 721px) and (max-width: 900px) {
  .title-bar__status {
    max-width: 240px;
  }
}
</style>
