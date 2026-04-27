<template>
  <nav class="bottom-nav" aria-label="Главная навигация" ref="root">
    <!-- Sliding pill: translateX / width активного item'а (как в BaseSegmented). -->
    <span
      class="bottom-nav__pill"
      :class="{ 'is-ready': pillReady, 'is-active': pillActive }"
      :style="pillStyle"
      aria-hidden="true"
    />

    <RouterLink
      v-for="item in bottomItems"
      :key="item.to"
      ref="itemRefs"
      :to="item.to"
      class="bottom-nav__item"
      active-class="is-active"
    >
      <span class="bottom-nav__icon-wrap">
        <BaseIcon :name="item.icon" :size="22" class="bottom-nav__icon" />
        <span v-if="item.badge" class="bottom-nav__badge">{{ item.badge }}</span>
      </span>
      <span class="bottom-nav__label">{{ item.shortLabel }}</span>
    </RouterLink>
  </nav>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import BaseIcon from '@/components/base/BaseIcon.vue';
import { useNavItems } from '@/composables/useNavItems';

const route = useRoute();
const root = useTemplateRef<HTMLElement>('root');
const itemRefs = ref<Array<{ $el: HTMLElement } | HTMLElement>>([]);

const items = useNavItems();
const bottomItems = computed(() => items.value.filter((i) => i.inBottomNav));

const activeIndex = computed(() =>
  bottomItems.value.findIndex((i) => route.path === i.to || route.path.startsWith(`${i.to}/`)),
);

const pillStyle = ref<Record<string, string>>({});
const pillReady = ref(false);
const pillActive = ref(false);

function getEl(refEntry: { $el: HTMLElement } | HTMLElement): HTMLElement {
  return (refEntry as { $el: HTMLElement }).$el ?? (refEntry as HTMLElement);
}

async function syncPill(): Promise<void> {
  await nextTick();
  if (!root.value) return;
  const idx = activeIndex.value;
  if (idx < 0) {
    pillActive.value = false;
    return;
  }
  const entry = itemRefs.value[idx];
  if (!entry) return;
  const item = getEl(entry);
  const itemRect = item.getBoundingClientRect();
  const rootRect = root.value.getBoundingClientRect();
  pillStyle.value = {
    transform: `translateX(${Math.round(itemRect.left - rootRect.left)}px)`,
    width: `${Math.round(itemRect.width)}px`,
  };
  pillActive.value = true;
  if (!pillReady.value) {
    requestAnimationFrame(() => {
      pillReady.value = true;
    });
  }
}

watch(() => route.path, () => syncPill());

let resizeObs: ResizeObserver | null = null;
onMounted(() => {
  void syncPill();
  if (root.value) {
    resizeObs = new ResizeObserver(() => syncPill());
    resizeObs.observe(root.value);
  }
});
onBeforeUnmount(() => resizeObs?.disconnect());
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

// Fixed bottom nav: glass-bar у нижнего края viewport.
// `safe-area-inset-bottom` уважает iOS home-indicator / Android gesture-bar.
.bottom-nav {
  position: fixed;
  inset: auto 0 0 0;
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-drawer);
  isolation: isolate;
  // Glass + top brand-tint hairline.
  background: rgba(var(--color-bg-rgb), 0.78);
  backdrop-filter: blur(var(--glass-blur-medium)) saturate(var(--glass-saturation));
  -webkit-backdrop-filter: blur(var(--glass-blur-medium)) saturate(var(--glass-saturation));
  border-top: 1px solid var(--color-border-subtle);
  // Brand accent line over top edge.
  &::before {
    content: '';
    position: absolute;
    inset: -1px 0 auto 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(var(--color-brand-violet-rgb), 0.4) 35%,
      rgba(var(--color-brand-pink-rgb), 0.5) 65%,
      transparent 100%
    );
    opacity: 0.7;
    pointer-events: none;
  }

  // Sliding pill: soft brand-tint под активным item'ом.
  &__pill {
    position: absolute;
    top: 4px;
    bottom: calc(4px + env(safe-area-inset-bottom, 0px));
    left: 0;
    border-radius: var(--radius-md);
    background: var(--gradient-brand-soft);
    border: 1px solid rgba(var(--color-brand-violet-rgb), 0.32);
    box-shadow: 0 4px 14px rgba(var(--color-brand-violet-rgb), 0.18);
    pointer-events: none;
    z-index: 0;
    opacity: 0;
    will-change: transform, width, opacity;
    // Initial mount без animation, transition включается через `is-ready`.
    transition: none;

    &.is-ready {
      transition:
        transform calc(320ms * var(--motion-scale)) var(--ease-emphasis),
        width calc(320ms * var(--motion-scale)) var(--ease-emphasis),
        opacity calc(220ms * var(--motion-scale)) var(--ease-out);
    }

    &.is-active {
      opacity: 1;
    }
  }

  &__item {
    position: relative;
    z-index: 1;
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    // 56px tap target (выше Apple HIG 44pt / Material 48dp).
    height: 56px;
    padding: 4px 2px;
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    text-decoration: none;
    transition:
      color calc(180ms * var(--motion-scale)) var(--ease-out);
    -webkit-tap-highlight-color: transparent;

    &:active:not(.is-active) {
      // Tap feedback: subtle icon scale.
      .bottom-nav__icon {
        transform: scale(0.92);
      }
    }

    &.is-active {
      color: var(--color-text-primary);

      .bottom-nav__icon {
        color: var(--color-brand-purple);
      }
      .bottom-nav__label {
        color: var(--color-text-primary);
        font-weight: 600;
      }
    }
  }

  &__icon-wrap {
    position: relative;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
  }

  &__icon {
    color: inherit;
    transition:
      color calc(180ms * var(--motion-scale)) var(--ease-out),
      transform calc(160ms * var(--motion-scale)) var(--ease-out);
  }

  &__badge {
    @include numeric-badge(4px);
    position: absolute;
    top: -4px;
    right: -8px;
    min-width: 16px;
    height: 16px;
    border-radius: var(--radius-pill);
    background: var(--gradient-brand);
    color: #fff;
    font-size: 9.5px;
    font-weight: 700;
    border: 1.5px solid var(--color-bg-base);
    line-height: 1;
  }

  &__label {
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.005em;
    line-height: 1;
    color: inherit;
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color calc(180ms * var(--motion-scale)) var(--ease-out);
  }
}

// Narrow screens (<360px): icon-only.
@media (max-width: 359px) {
  .bottom-nav__label {
    display: none;
  }
  .bottom-nav__item {
    height: 48px;
  }
}
</style>
