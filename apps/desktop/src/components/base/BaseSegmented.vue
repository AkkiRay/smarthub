<template>
  <div class="segmented" :class="`segmented--${size}`" role="tablist" ref="root">
    <!-- Pill следит за активной кнопкой через translateX + width. -->
    <span v-if="activeIndex >= 0" class="segmented__pill" :style="pillStyle" aria-hidden="true" />
    <button
      v-for="(opt, idx) in options"
      :key="String(opt.value)"
      ref="itemRefs"
      type="button"
      role="tab"
      class="segmented__item"
      :class="{ 'is-active': isActive(opt.value) }"
      :aria-selected="isActive(opt.value)"
      :data-tour="opt.tour"
      @click="onSelect(opt.value, idx)"
      @pointerdown="animatePress($event.currentTarget as HTMLElement)"
      @pointerup="animateRelease($event.currentTarget as HTMLElement)"
      @pointerleave="animateRelease($event.currentTarget as HTMLElement)"
    >
      <BaseIcon v-if="opt.icon" :name="opt.icon" class="segmented__icon" />
      <span class="segmented__label">{{ opt.label }}</span>
      <span v-if="opt.count !== undefined" class="segmented__count">{{ opt.count }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
// Segmented-control. Pill переезжает между табами, ResizeObserver следит
// за позицией при resize/смене языка.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { gsap } from 'gsap';
import BaseIcon, { type IconName } from './BaseIcon.vue';
import { useUiStore } from '@/stores/ui';

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

const ui = useUiStore();
const root = useTemplateRef<HTMLElement>('root');
const itemRefs = ref<HTMLElement[]>([]);

const activeIndex = computed(() => props.options.findIndex((o) => o.value === props.modelValue));

function isActive(value: string | number): boolean {
  return props.modelValue === value;
}

function onSelect(value: string | number, index: number): void {
  if (props.modelValue === value) return;
  emit('update:modelValue', value);
  void index;
}

// ---- Pill positioning ------------------------------------------------------
// Геометрия из getBoundingClientRect() — pill совпадает с табом при любой
// длине текста.

const pillStyle = ref<Record<string, string>>({});

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

// Press/release-feedback отключён — плоский дизайн.
function animatePress(_el: HTMLElement): void {
  void ui;
}
function animateRelease(_el: HTMLElement): void {
  /* noop */
}
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.segmented {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-subtle);
  isolation: isolate; // pill живёт под кнопками
  flex-wrap: wrap;
  max-width: 100%;

  &__pill {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 0;
    border-radius: var(--radius-pill);
    background: var(--color-brand-violet);
    transition:
      transform 280ms var(--ease-out),
      width 280ms var(--ease-out);
    z-index: 0;
    pointer-events: none;
  }

  &__item {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 14px;
    border: 0;
    background: transparent;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: color 240ms var(--ease-out);
    white-space: nowrap;

    &:hover {
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
  }

  // На active-табе count прозрачнее — тёмный пузырь поверх pill плохо читается.
  &__item.is-active &__count {
    background: rgba(255, 255, 255, 0.22);
  }

  &--sm &__item {
    height: 26px;
    padding: 0 12px;
    font-size: 12px;
  }
}
</style>
