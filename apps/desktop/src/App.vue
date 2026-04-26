<template>
  <div class="app" :class="{ 'app--reduce-motion': reduceMotion }">
    <AppTitleBar />
    <RouterView v-slot="{ Component, route }">
      <!-- Fullscreen-сцены (welcome) — без sidebar. -->
      <template v-if="route.meta?.chrome === false">
        <Transition :name="prefersMotion ? 'fade-slide' : 'fade'" mode="out-in">
          <component :is="Component" :key="route.fullPath" class="app__fullscreen" />
        </Transition>
      </template>
      <template v-else>
        <div
          class="app__shell"
          :class="{
            'app__shell--mobile': bp.isMobile.value,
            'app__shell--drawer-open': bp.isMobile.value && ui.mobileDrawerOpen,
          }"
        >
          <!-- Sidebar: mobile — drawer (transform), desktop — постоянная колонка. -->
          <AppSidebar class="app__sidebar" :class="{ 'app__sidebar--drawer': bp.isMobile.value }" />

          <!-- Backdrop drawer-mode — клик закрывает. -->
          <Transition name="backdrop">
            <div
              v-if="bp.isMobile.value && ui.mobileDrawerOpen"
              class="app__backdrop"
              @click="ui.closeMobileDrawer()"
            />
          </Transition>

          <main class="app__content">
            <Transition :name="prefersMotion ? 'fade-slide' : 'fade'" mode="out-in">
              <component :is="Component" :key="route.fullPath" />
            </Transition>
          </main>
        </div>
      </template>
    </RouterView>
    <AppToaster />
    <BackgroundAura />
    <TourOverlay />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices';
import { useUiStore } from '@/stores/ui';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useAliceStore } from '@/stores/alice';
import { useTourStore } from '@/stores/tour';
import { useBreakpoint } from '@/composables/useBreakpoint';
import AppTitleBar from '@/components/chrome/AppTitleBar.vue';
import AppSidebar from '@/components/chrome/AppSidebar.vue';
import AppToaster from '@/components/chrome/AppToaster.vue';
import BackgroundAura from '@/components/visuals/BackgroundAura.vue';
import TourOverlay from '@/components/tour/TourOverlay.vue';

const ui = useUiStore();
const devices = useDevicesStore();
const station = useYandexStationStore();
const alice = useAliceStore();
const tour = useTourStore();
const route = useRoute();
const router = useRouter();
const bp = useBreakpoint();
const { reduceMotion } = storeToRefs(ui);

const prefersMotion = computed(() => !reduceMotion.value);

// Mobile: смена route закрывает drawer.
watch(
  () => route.fullPath,
  () => {
    if (bp.isMobile.value && ui.mobileDrawerOpen) ui.closeMobileDrawer();
  },
);

// Resize mobile → desktop: drawer закрываем, иначе ловит focus в фоне.
watch(
  () => bp.isMobile.value,
  (mobile) => {
    if (!mobile && ui.mobileDrawerOpen) ui.closeMobileDrawer();
  },
);

/** Unsubscribe от push-navigation event'ов из main process'а (tray-меню). */
let unsubscribeTrayNav: (() => void) | null = null;

/**
 * Глобальный tour-trigger: при наличии `?tour=1` в любом route запускает
 * onboarding-тур (если ещё не пройден и не активен) и удаляет query-параметр,
 * чтобы reload страницы не перезапускал тур. Остальные query-параметры
 * сохраняются.
 */
watch(
  () => route.query['tour'],
  (q) => {
    if (q !== '1') return;
    if (ui.tourCompleted || tour.isActive) return;
    setTimeout(() => {
      tour.start();
      const { tour: _tour, ...rest } = route.query;
      void router.replace({ path: route.path, query: rest });
    }, 700);
  },
  { immediate: true },
);

onMounted(async () => {
  await Promise.all([
    devices.bootstrap(),
    ui.bootstrap(),
    station.bootstrap(),
    // Alice optional — при отсутствии backend / skill creds store остаётся в idle.
    alice.bootstrap().catch(() => {
      /* idle */
    }),
  ]);
  devices.subscribeRealtime();

  unsubscribeTrayNav = window.smarthome.events.on('tray:navigate', ({ path }) => {
    if (!path) return;
    void router.push(path);
  });
});

onBeforeUnmount(() => {
  unsubscribeTrayNav?.();
});
</script>

<style lang="scss">
.app {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--color-bg-base);
  color: var(--color-text-primary);

  &__shell {
    flex: 1;
    display: grid;
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
    overflow: hidden;
    position: relative;
    z-index: var(--z-raised);
    min-height: 0;

    // Mobile: sidebar absolute, slide via transform, контент на всю ширину.
    &--mobile {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  &__sidebar {
    transition: transform 360ms cubic-bezier(0.22, 1, 0.36, 1);

    // Drawer спрятан слева, выезжает при mobileDrawerOpen. Background opaque,
    // чтобы content под drawer'ом не просвечивал сквозь glass-эффект sidebar'а.
    &--drawer {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      z-index: var(--z-drawer);
      transform: translateX(-100%);
      width: min(82vw, 320px);
      box-shadow: 24px 0 48px rgba(0, 0, 0, 0.55);
      background: var(--color-bg-base);
    }
  }

  &__shell--drawer-open &__sidebar--drawer {
    transform: translateX(0);
  }

  &__backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: var(--z-backdrop);
  }

  &__content {
    min-width: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--content-pad-y) var(--content-pad-x) calc(var(--content-pad-y) + 16px);
    scroll-behavior: smooth;
    // Block-flow: content стартует с верха, не центрируется по vertical axis.
    display: block;

    // Writing rail: каждый view получает max-width:var(--content-max) и
    // центруется — на 4K не «утопает» в широком aura-фоне.
    > * {
      max-width: var(--content-max);
      margin-inline: auto;
      width: 100%;
    }
    // overscroll contain: стопит «резинку» на trackpad/touch.
    overscroll-behavior: contain;

    &::-webkit-scrollbar {
      width: 10px;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 8px;
    }
    &::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.16);
    }

    // Touch: скрываем scrollbar — крадёт ширину контента.
    @media (hover: none) and (pointer: coarse) {
      &::-webkit-scrollbar {
        width: 0;
      }
    }
  }

  &__fullscreen {
    flex: 1;
    min-height: 0;
    position: relative;
    z-index: var(--z-raised);
    overflow: hidden;
  }
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 240ms ease,
    transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 200ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.backdrop-enter-active,
.backdrop-leave-active {
  transition: opacity 280ms var(--ease-out);
}
.backdrop-enter-from,
.backdrop-leave-to {
  opacity: 0;
}
</style>
