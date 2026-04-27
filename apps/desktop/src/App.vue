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
          :class="{ 'app__shell--mobile': bp.isMobile.value }"
        >
          <!-- Sidebar: только desktop/tablet. На mobile (<720px) её заменяет AppBottomNav. -->
          <AppSidebar v-if="!bp.isMobile.value" class="app__sidebar" />

          <main ref="contentEl" class="app__content">
            <!-- Route stage: relative + min-height держат высоту контейнера
                 на время transition (leave-active в absolute).
                 simultaneous mode: leave-active абсолютен, enter сразу в flow. -->
            <div class="app__route-stage">
              <Transition :name="prefersMotion ? 'fade-slide' : 'fade'">
                <component :is="Component" :key="route.fullPath" class="app__route-view" />
              </Transition>
            </div>
          </main>
        </div>

        <!-- Mobile bottom navigation: фикс к нижнему краю окна, всегда видим
             поверх любого view (z-drawer). На desktop / tablet полностью скрыт. -->
        <AppBottomNav v-if="bp.isMobile.value" class="app__bottom-nav" />
      </template>
    </RouterView>
    <AppToaster />
    <BackgroundAura />
    <TourOverlay />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices';
import { useUiStore } from '@/stores/ui';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useAliceStore } from '@/stores/alice';
import { useUpdaterStore } from '@/stores/updater';
import { useTourStore } from '@/stores/tour';
import { useBreakpoint } from '@/composables/useBreakpoint';
import AppTitleBar from '@/components/chrome/AppTitleBar.vue';
import AppSidebar from '@/components/chrome/AppSidebar.vue';
import AppBottomNav from '@/components/chrome/AppBottomNav.vue';
import AppToaster from '@/components/chrome/AppToaster.vue';
import BackgroundAura from '@/components/visuals/BackgroundAura.vue';
import TourOverlay from '@/components/tour/TourOverlay.vue';

const ui = useUiStore();
const devices = useDevicesStore();
const station = useYandexStationStore();
const updater = useUpdaterStore();
const alice = useAliceStore();
const tour = useTourStore();
const route = useRoute();
const router = useRouter();
const bp = useBreakpoint();
const { reduceMotion, motionLevel } = storeToRefs(ui);

// `fade-slide` (transform + opacity) — на motionLevel standard/full.
// `fade` — чистый opacity, использует --motion-scale (на 'off' = 0ms).
const prefersMotion = computed(
  () => motionLevel.value === 'standard' || motionLevel.value === 'full',
);

const contentEl = useTemplateRef<HTMLElement>('contentEl');

// Scroll-to-top при смене route.fullPath. Скроллится `.app__content`
// (на body overflow:hidden). nextTick ждёт mount нового view внутри Transition.
// reduceMotion → instant, иначе smooth.
watch(
  () => route.fullPath,
  () => {
    void nextTick(() => {
      contentEl.value?.scrollTo({
        top: 0,
        left: 0,
        behavior: reduceMotion.value ? 'auto' : 'smooth',
      });
    });
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
    updater.bootstrap().catch(() => {
      /* disabled / dev */
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
  updater.dispose();
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

    // Mobile: sidebar скрыт (заменён на AppBottomNav), контент на всю ширину.
    &--mobile {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  &__sidebar {
    // На desktop/tablet sidebar — статичная колонка, без drawer-режима.
    // Mobile (< 720px) рендерит вместо неё фиксированный AppBottomNav.
  }

  // Bottom-nav висит на --z-drawer поверх контента, padding-bottom у контента
  // компенсирует высоту bar'а так, чтобы последний блок не уходил под него.
  &__bottom-nav {
    position: fixed;
  }

  &__content {
    min-width: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--content-pad-y) var(--content-pad-x) calc(var(--content-pad-y) + 16px);
    scroll-behavior: smooth;
    // Block-flow: content стартует с верха, не центрируется по vertical axis.
    display: block;
    // Резерв gutter под scrollbar постоянный — стабильная ширина content rail'а.
    scrollbar-gutter: stable;
    // overscroll contain: останавливает scroll-chain на trackpad/touch.
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

    // Touch: scrollbar-gutter не нужен (overlay scrollbar), отдаём ширину контенту.
    @media (hover: none) and (pointer: coarse) {
      scrollbar-gutter: auto;
      &::-webkit-scrollbar {
        width: 0;
      }
    }
  }

  // Mobile: bottom-padding = высота bottom-nav + safe-area-inset-bottom.
  &__shell--mobile &__content {
    padding-bottom: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px) + 16px);
  }

  // Flex column-stack для router-view: leaving-view absolute
  // (см. .fade-leave-active), entering-view top-anchored via flex-start.
  &__route-stage {
    position: relative;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
  }

  // flex: 1 0 auto — main-axis fill, align-self: stretch — cross-axis full-width
  // в пределах max-width content-rail'а.
  &__route-view {
    width: 100%;
    max-width: var(--content-max);
    margin-inline: auto;
    flex: 1 0 auto;
    align-self: stretch;
  }

  &__fullscreen {
    flex: 1;
    min-height: 0;
    position: relative;
    z-index: var(--z-raised);
    overflow: hidden;
  }
}

// Route-transition: opacity-only на root view. Inner useViewMount stagger —
// единственный источник translate-tween'а. translate3d(0,0,0) промоутит
// entering/leaving view в отдельный compositor layer.
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity calc(200ms * var(--motion-scale)) var(--ease-out);
  will-change: opacity;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
}
.fade-slide-leave-active {
  position: absolute;
  inset: 0;
  width: 100%;
}
.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity calc(180ms * var(--motion-scale)) var(--ease-out);
  will-change: opacity;
  transform: translate3d(0, 0, 0);
}
.fade-leave-active {
  position: absolute;
  inset: 0;
  width: 100%;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.backdrop-enter-active,
.backdrop-leave-active {
  transition: opacity calc(280ms * var(--motion-scale)) var(--ease-out);
  will-change: opacity;
}
.backdrop-enter-from,
.backdrop-leave-to {
  opacity: 0;
}
</style>
