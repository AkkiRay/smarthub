<template>
  <div class="segmented" :class="`segmented--${size}`" role="tablist" ref="root">
    <!-- Pill: translateX + width активного item'а. `is-ready` включает transition после первого syncPill. -->
    <span
      v-if="activeIndex >= 0"
      class="segmented__pill"
      :class="{ 'is-ready': pillReady }"
      :style="pillStyle"
      aria-hidden="true"
    />
    <button
      v-for="opt in options"
      :key="String(opt.value)"
      ref="itemRefs"
      type="button"
      role="tab"
      class="segmented__item"
      :class="{ 'is-active': isActive(opt.value) }"
      :aria-selected="isActive(opt.value)"
      :data-tour="opt.tour"
      @click="onSelect(opt.value)"
    >
      <BaseIcon v-if="opt.icon" :name="opt.icon" class="segmented__icon" />
      <span class="segmented__label">{{ opt.label }}</span>
      <span v-if="opt.count !== undefined" class="segmented__count">{{ opt.count }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
// Segmented control. Pill ездит через CSS transition на translateX / width.
// ResizeObserver пересчитывает позицию при resize / locale change.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import BaseIcon, { type IconName } from './BaseIcon.vue';

export interface SegmentedOption {
  value: string | number;
  label: string;
  icon?: IconName;
  /** Бейдж-счётчик (например, число активных фильтров). */
  count?: number;
  /** ID для tour-coachmark. */
  tour?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number;
    options: SegmentedOption[];
    size?: 'sm' | 'md';
  }>(),
  { size: 'md' },
);

const emit = defineEmits<{
  'update:modelValue': [value: string | number];
}>();

const root = useTemplateRef<HTMLElement>('root');
const itemRefs = ref<HTMLElement[]>([]);

const activeIndex = computed(() => props.options.findIndex((o) => o.value === props.modelValue));

function isActive(value: string | number): boolean {
  return props.modelValue === value;
}

function onSelect(value: string | number): void {
  if (props.modelValue === value) return;
  emit('update:modelValue', value);
}

const pillStyle = ref<Record<string, string>>({});
const pillReady = ref(false);

/** Geometry активного item'а через getBoundingClientRect → pill transform / width. */
async function syncPill(): Promise<void> {
  await nextTick();
  if (!root.value || activeIndex.value < 0) return;
  const item = itemRefs.value[activeIndex.value];
  if (!item) return;
  const itemRect = item.getBoundingClientRect();
  const rootRect = root.value.getBoundingClientRect();
  pillStyle.value = {
    transform: `translateX(${itemRect.left - rootRect.left}px)`,
    width: `${itemRect.width}px`,
  };
  if (!pillReady.value) {
    // Включаем transition на следующем frame после initial positioning.
    requestAnimationFrame(() => {
      pillReady.value = true;
    });
  }
}

watch(
  () => [props.modelValue, props.options.length],
  () => syncPill(),
);

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

.segmented {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.04);
  border: var(--border-thin) solid var(--color-border-subtle);
  isolation: isolate; // pill под кнопками в z-стэке
  flex-wrap: wrap;
  max-width: 100%;

  &__pill {
    position: absolute;
    top: var(--space-1);
    bottom: var(--space-1);
    left: 0;
    border-radius: var(--radius-pill);
    background: var(--color-brand-violet);
    box-shadow: 0 6px 18px rgba(var(--color-brand-violet-rgb), 0.36);
    z-index: 0;
    pointer-events: none;
    will-change: transform, width;
    // Initial mount без animation. После `is-ready` — smooth slide.
    transition: none;

    &.is-ready {
      transition:
        transform var(--dur-medium) var(--ease-emphasis),
        width var(--dur-medium) var(--ease-emphasis),
        box-shadow var(--dur-medium) var(--ease-out);
    }
  }

  &__item {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 30px;
    padding: 0 var(--space-4);
    border: 0;
    background: transparent;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--font-size-small);
    font-weight: 600;
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: color var(--dur-medium) var(--ease-out);
    white-space: nowrap;

    &:hover:not(.is-active) {
      color: var(--color-text-primary);
    }

    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(var(--color-brand-violet-rgb), 0.4);
    }

    &.is-active {
      color: #fff;
    }
  }

  &__icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  &__count {
    @include numeric-badge(6px);
    min-width: 20px;
    height: 18px;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.1);
    color: currentColor;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0;
    flex-shrink: 0;
    transition: background var(--dur-fast) var(--ease-out);
  }

  // Active count: прозрачнее, чтобы badge читался поверх pill'а.
  &__item.is-active &__count {
    background: rgba(255, 255, 255, 0.22);
  }

  &--sm &__item {
    height: 26px;
    padding: 0 var(--space-3);
    font-size: var(--font-size-small);
  }

  // Mobile (≤ 720px): horizontal scroll вместо wrap, hidden scrollbar.
  @media (max-width: 720px) {
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
    -webkit-overflow-scrolling: touch;

    &::-webkit-scrollbar {
      display: none;
    }

    // Compact: padding 12px, gap 6px, flex-shrink: 0 для tap-target.
    &__item {
      padding: 0 12px;
      gap: 6px;
      flex-shrink: 0;
    }
  }

  // Narrow screens: ужимаем font-size и padding.
  @media (max-width: 380px) {
    &__item {
      padding: 0 10px;
      font-size: 12px;
    }
  }
}
</style>
