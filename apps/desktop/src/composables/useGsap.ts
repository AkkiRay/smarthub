/**
 * @fileoverview
 * useGsap — обёртка над gsap.context(): auto-cleanup и respect prefers-reduced-motion.
 */

import { onBeforeUnmount } from 'vue';
import { gsap } from 'gsap';
import { useUiStore } from '@/stores/ui';

export function useGsap(scope?: Element | null) {
  // Defensive: HMR-edge-case с не-инициализированной Pinia не должен ронять mount-анимацию.
  let getReduceMotion: () => boolean = () => false;
  try {
    const ui = useUiStore();
    getReduceMotion = () => ui.reduceMotion;
  } catch {
    /* store ещё не готов — fallback на motion-on */
  }

  const ctx = gsap.context(() => {}, scope ?? undefined);

  onBeforeUnmount(() => ctx.revert());

  function animate(targets: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween {
    if (getReduceMotion()) {
      return gsap.set(targets, { ...vars, duration: 0 }) as unknown as gsap.core.Tween;
    }
    return ctx.add(() => gsap.to(targets, vars)) as gsap.core.Tween;
  }

  function from(targets: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween {
    if (getReduceMotion()) {
      return gsap.set(targets, { clearProps: 'all' }) as unknown as gsap.core.Tween;
    }
    return ctx.add(() => gsap.from(targets, vars)) as gsap.core.Tween;
  }

  function timeline(vars?: gsap.TimelineVars): gsap.core.Timeline {
    if (getReduceMotion()) {
      // Timeline в finished-state — конечный вид без проигрывания.
      const t = gsap.timeline({ ...vars, paused: true });
      t.totalProgress(1);
      return t;
    }
    return ctx.add(() => gsap.timeline(vars)) as gsap.core.Timeline;
  }

  return { animate, from, timeline, ctx };
}
