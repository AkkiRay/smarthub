/**
 * @fileoverview useReveal — IntersectionObserver-based scroll reveal.
 *
 * Раз-появление элементов при первом попадании в viewport: opacity:0→1
 * + slight translateY. Подходит для below-the-fold секций (Home/Devices/
 * Settings), где мount-волна useViewMount не «дотягивается» до scroll'а.
 *
 * Контракт по `MotionLevel`:
 *  - `off`      — без tween'а, элементы сразу финал-state.
 *  - `reduced`  — opacity-only, без y-сдвига.
 *  - standard/full — opacity + y, длительность ×0.6/×1/×1.15 (через useGsap).
 *
 * Применение:
 *   const { rootRef } = useReveal();
 *   <section ref="rootRef" data-reveal>...</section>
 *
 * Селекторы по умолчанию: `[data-reveal]`. Каждый элемент анимируется один раз;
 * после первого reveal observer перестаёт за ним следить.
 */

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { useGsap } from './useGsap';
import { useUiStore } from '@/stores/ui';
import type { MotionLevel } from '@/stores/ui';

export interface RevealOptions {
  /** CSS-селектор внутри scope, по которому ищутся reveal-цели. */
  selector?: string;
  /** Threshold для IntersectionObserver — доля видимости ∈ [0..1]. */
  threshold?: number;
  /** Margin вокруг root'а observer'а (CSS shorthand). */
  rootMargin?: string;
}

export interface RevealHandle {
  rootRef: Ref<HTMLElement | null>;
  /** Принудительный reveal всех целей (на случай programmatic append'а). */
  refresh(): void;
}

/** Возвращает `rootRef` для прикрепления к scope-элементу. */
export function useReveal(opts: RevealOptions = {}): RevealHandle {
  const rootRef = ref<HTMLElement | null>(null);
  const selector = opts.selector ?? '[data-reveal]';
  const threshold = opts.threshold ?? 0.12;
  const rootMargin = opts.rootMargin ?? '0px 0px -8% 0px';
  const { from } = useGsap(rootRef);

  let getLevel: () => MotionLevel = () => 'standard';
  try {
    const ui = useUiStore();
    getLevel = () => ui.motionLevel as MotionLevel;
  } catch {
    /* pinia недоступна */
  }

  let observer: IntersectionObserver | null = null;
  const seen = new WeakSet<Element>();

  function reveal(el: Element): void {
    if (seen.has(el)) return;
    seen.add(el);
    const lvl = getLevel();
    if (lvl === 'off') return;
    from(el as HTMLElement, {
      opacity: 0,
      y: lvl === 'reduced' ? 0 : 8,
      duration: 0.42,
      ease: 'power2.out',
      clearProps: 'opacity,transform',
    });
  }

  function observeTargets(): void {
    if (!observer || !rootRef.value) return;
    rootRef.value.querySelectorAll(selector).forEach((el) => {
      if (seen.has(el)) return;
      observer!.observe(el);
    });
  }

  onMounted(() => {
    if (typeof IntersectionObserver === 'undefined') {
      // Fallback: без observer'а сразу всё видно (no-op tween'ы — opacity = 1
      // — natural state).
      rootRef.value?.querySelectorAll(selector).forEach((el) => seen.add(el));
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveal(entry.target);
          observer!.unobserve(entry.target);
        });
      },
      { threshold, rootMargin },
    );
    observeTargets();
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });

  return {
    rootRef,
    refresh: observeTargets,
  };
}
