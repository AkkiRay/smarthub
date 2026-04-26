/**
 * @fileoverview usePressable — тактильный feedback: scale-down на `pointerdown`,
 * elastic snap-back на `pointerup` / `pointerleave`.
 *
 * Поведение по `motionLevel` из ui store:
 *  - `off`               — no-op, scale всегда 1.
 *  - `reduced`           — non-elastic snap без overshoot.
 *  - `standard` / `full` — elastic snap.
 */

import { onBeforeUnmount } from 'vue';
import { gsap } from 'gsap';
import { useUiStore } from '@/stores/ui';
import type { MotionLevel } from '@/stores/ui';

export function usePressable(scale = 0.96) {
  const cleanups: Array<() => void> = [];

  let getLevel: () => MotionLevel = () => 'standard';
  try {
    const ui = useUiStore();
    getLevel = () => ui.motionLevel as MotionLevel;
  } catch {
    /* pinia недоступна */
  }

  function bind(el: HTMLElement | null): void {
    if (!el) return;
    const onDown = (): gsap.core.Tween | void => {
      const lvl = getLevel();
      if (lvl === 'off') return;
      return gsap.to(el, { scale, duration: 0.12, ease: 'power2.out', force3D: true });
    };
    const onUp = (): gsap.core.Tween | void => {
      const lvl = getLevel();
      if (lvl === 'off') {
        gsap.set(el, { scale: 1 });
        return;
      }
      // На `reduced` — `power2.out` без overshoot.
      const ease = lvl === 'reduced' ? 'power2.out' : 'elastic.out(1.1, 0.6)';
      const duration = lvl === 'reduced' ? 0.18 : 0.32;
      return gsap.to(el, { scale: 1, duration, ease, force3D: true });
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onUp);
    cleanups.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onUp);
    });
  }

  onBeforeUnmount(() => cleanups.splice(0).forEach((fn) => fn()));
  return { bind };
}
