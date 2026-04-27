<template>
  <div ref="root" class="reveal-stage">
    <Transition :css="false" appear @enter="onSkelEnter" @leave="onSkelLeave">
      <div
        v-if="!ready"
        key="skel"
        ref="skelLayer"
        class="reveal-stage__layer reveal-stage__layer--skel"
        aria-hidden="true"
      >
        <slot name="skeleton" />
      </div>
    </Transition>
    <Transition :css="false" appear @enter="onContentEnter" @leave="onContentLeave">
      <div
        v-if="ready"
        key="content"
        ref="contentLayer"
        class="reveal-stage__layer reveal-stage__layer--content"
      >
        <slot />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
/**
 * RevealStage — GSAP-managed seamless skeleton ↔ content swap.
 *
 * Контракт:
 *  - `ready=false` → шиммер-плейсхолдер из `#skeleton`-slot, тайл-стаггер на enter.
 *  - `ready` flips true → одновременно (overlapping crossfade): skeleton fade-out + lift,
 *    content fade-in + rise, потом stagger по `[data-anim="block"]` и `[data-anim="item"]`.
 *  - `ready` flips false (reload-after-error) → reverse-crossfade обратно.
 *
 * Layout: grid-stack — оба layer'а живут в одной grid-cell (1, 1), height
 * берётся max из mounted children. `<Transition :css="false">` отдаёт
 * enter/leave полностью под GSAP — без gap'а `mode="out-in"`.
 *
 * Stagger items внутри content slot'а — `[data-anim="block"]` / `[data-anim="item"]`.
 * Skeleton tiles (`[data-skeleton-tile]` или `.skeleton`) — staggered enter с
 * shimmer-микропаузой 80ms между плитками.
 */

import { ref, useTemplateRef } from 'vue';
import { gsap } from 'gsap';
import { useUiStore } from '@/stores/ui';
import type { MotionLevel } from '@/stores/ui';

const props = withDefaults(
  defineProps<{
    /** Готов ли реальный контент. false → показываем skeleton-layer. */
    ready: boolean;
    /** Селектор детей контента, анимируемых волной (block-волна). */
    blocksSelector?: string;
    /** Селектор детей контента, анимируемых волной (item-волна, идёт за блоками). */
    itemsSelector?: string;
    /** Длительность skeleton-fade-out (s). Масштабируется по motionLevel. */
    skelExitDuration?: number;
    /** Длительность content-fade-in (s). */
    contentEnterDuration?: number;
    /** Stagger.amount cap для items (s) — потолок суммарного времени волны. */
    staggerAmount?: number;
    /** Y-offset для content-rise (px). На `reduced` сводится к 0. */
    contentRise?: number;
    /** Начальная задержка перед start'ом stagger-волны (s). */
    staggerDelay?: number;
    /**
     * Отключить внутренний header/blocks/items-stagger. Используется views'ами
     * с собственной timeline (HomeView.runEntryAnimation) — RevealStage делает
     * только layer-crossfade, остальное owns view.
     */
    disableStagger?: boolean;
  }>(),
  {
    blocksSelector: '[data-anim="block"]',
    itemsSelector: '[data-anim="item"]',
    skelExitDuration: 0.32,
    contentEnterDuration: 0.5,
    staggerAmount: 0.42,
    contentRise: 10,
    staggerDelay: 0.18,
    disableStagger: false,
  },
);

const emit = defineEmits<{
  (e: 'reveal-done'): void;
}>();

const root = useTemplateRef<HTMLElement>('root');
const skelLayer = useTemplateRef<HTMLElement>('skelLayer');
const contentLayer = useTemplateRef<HTMLElement>('contentLayer');

function getMotionLevel(): MotionLevel {
  try {
    return useUiStore().motionLevel;
  } catch {
    return 'standard';
  }
}

const SCALE: Record<MotionLevel, number> = {
  off: 0,
  reduced: 0.6,
  standard: 1,
  full: 1.15,
};

function dur(base: number, lvl: MotionLevel): number {
  return base * SCALE[lvl];
}

function onSkelEnter(el: Element, done: () => void): void {
  const lvl = getMotionLevel();
  if (lvl === 'off') {
    gsap.set(el, { clearProps: 'all' });
    done();
    return;
  }
  const tiles = (el as HTMLElement).querySelectorAll(
    '[data-skeleton-tile], .skeleton-grid__cell, .skeleton',
  );
  // Skeleton-fade-in: layer + tiles staggered. Tiles используют CSS-shimmer,
  // GSAP отвечает только за entrance.
  gsap.set(el, { opacity: 0 });
  const tl = gsap.timeline({ onComplete: done });
  tl.to(el, {
    opacity: 1,
    duration: dur(0.28, lvl),
    ease: 'power2.out',
  });
  if (tiles.length) {
    tl.from(
      tiles,
      {
        opacity: 0,
        y: lvl === 'reduced' ? 0 : 6,
        scale: lvl === 'reduced' ? 1 : 0.97,
        duration: dur(0.36, lvl),
        stagger: { each: 0.045, amount: dur(0.32, lvl), from: 'start' },
        ease: 'power2.out',
        clearProps: 'opacity,transform',
      },
      0,
    );
  }
}

function onSkelLeave(el: Element, done: () => void): void {
  const lvl = getMotionLevel();
  if (lvl === 'off') {
    gsap.set(el, { autoAlpha: 0 });
    done();
    return;
  }
  // Tiles разлетаются волной + основной layer fade-out + slight upward float.
  const tiles = (el as HTMLElement).querySelectorAll(
    '[data-skeleton-tile], .skeleton-grid__cell, .skeleton',
  );
  const tl = gsap.timeline({ onComplete: done });
  if (tiles.length) {
    tl.to(
      tiles,
      {
        opacity: 0,
        y: lvl === 'reduced' ? 0 : -4,
        scale: lvl === 'reduced' ? 1 : 0.985,
        duration: dur(props.skelExitDuration * 0.7, lvl),
        stagger: { each: 0.02, amount: dur(0.18, lvl), from: 'end' },
        ease: 'power2.in',
      },
      0,
    );
  }
  tl.to(
    el,
    {
      opacity: 0,
      duration: dur(props.skelExitDuration, lvl),
      ease: 'power2.in',
    },
    0,
  );
}

function onContentEnter(el: Element, done: () => void): void {
  const lvl = getMotionLevel();
  if (lvl === 'off') {
    gsap.set(el, { clearProps: 'all' });
    emit('reveal-done');
    done();
    return;
  }
  const layer = el as HTMLElement;
  const blocks = props.disableStagger
    ? ([] as HTMLElement[])
    : layer.querySelectorAll<HTMLElement>(props.blocksSelector);
  const items = props.disableStagger
    ? ([] as HTMLElement[])
    : layer.querySelectorAll<HTMLElement>(props.itemsSelector);
  const headers = props.disableStagger
    ? ([] as HTMLElement[])
    : layer.querySelectorAll<HTMLElement>('[data-page-header], [data-anim="header"]');

  gsap.set(layer, {
    opacity: 0,
    y: lvl === 'reduced' ? 0 : props.contentRise,
  });

  const tl = gsap.timeline({
    onComplete: () => {
      emit('reveal-done');
      done();
    },
  });

  tl.to(
    layer,
    {
      opacity: 1,
      y: 0,
      duration: dur(props.contentEnterDuration, lvl),
      ease: 'power3.out',
      clearProps: 'transform',
    },
    0.05,
  );

  if (headers.length) {
    tl.from(
      headers,
      {
        opacity: 0,
        y: lvl === 'reduced' ? 0 : 8,
        duration: dur(0.4, lvl),
        ease: 'power2.out',
        clearProps: 'opacity,transform',
      },
      props.staggerDelay * 0.55,
    );
  }

  if (blocks.length) {
    tl.from(
      blocks,
      {
        opacity: 0,
        y: lvl === 'reduced' ? 0 : 10,
        duration: dur(0.42, lvl),
        stagger: { each: 0.055, amount: dur(0.3, lvl), from: 'start' },
        ease: 'power2.out',
        clearProps: 'opacity,transform',
      },
      props.staggerDelay,
    );
  }

  if (items.length) {
    tl.from(
      items,
      {
        opacity: 0,
        y: lvl === 'reduced' ? 0 : 8,
        scale: lvl === 'reduced' ? 1 : 0.98,
        duration: dur(0.36, lvl),
        stagger: { each: 0.04, amount: dur(props.staggerAmount, lvl), from: 'start' },
        ease: 'power2.out',
        clearProps: 'opacity,transform,scale',
      },
      props.staggerDelay + 0.06,
    );
  }
}

function onContentLeave(el: Element, done: () => void): void {
  const lvl = getMotionLevel();
  if (lvl === 'off') {
    gsap.set(el, { autoAlpha: 0 });
    done();
    return;
  }
  gsap.to(el, {
    opacity: 0,
    y: lvl === 'reduced' ? 0 : -6,
    duration: dur(0.26, lvl),
    ease: 'power2.in',
    onComplete: done,
  });
}
</script>

<style scoped lang="scss">
.reveal-stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  position: relative;
  width: 100%;
  min-width: 0;

  // Stack pattern: оба layer'а в одной grid-cell — overlap во время crossfade.
  // Когда один из <Transition>'ов finished + v-if=false, layer удалён из DOM,
  // grid-row схлопывается в 1 элемент → height без скачка.
  &__layer {
    grid-column: 1;
    grid-row: 1;
    width: 100%;
    min-width: 0;
  }

  &__layer--content {
    z-index: 1;
  }

  &__layer--skel {
    z-index: 0;
  }
}
</style>
