/**
 * @fileoverview
 * usePressable — тактильный feedback: scale-down на pointerdown, elastic snap-back на up.
 */

import { onBeforeUnmount } from 'vue';
import { gsap } from 'gsap';

export function usePressable(scale = 0.96) {
  const cleanups: Array<() => void> = [];

  function bind(el: HTMLElement | null): void {
    if (!el) return;
    const onDown = (): gsap.core.Tween =>
      gsap.to(el, { scale, duration: 0.12, ease: 'power2.out' });
    const onUp = (): gsap.core.Tween =>
      gsap.to(el, { scale: 1, duration: 0.32, ease: 'elastic.out(1.1, 0.6)' });

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
