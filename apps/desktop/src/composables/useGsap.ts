/**
 * @fileoverview useGsap — обёртка над `gsap.context()` с auto-cleanup на unmount
 * и motion-level-aware tween'ами.
 *
 * Контракт по `MotionLevel` (см. `stores/ui.ts`):
 *  - `off`      — `set` с `duration: 0`, мгновенный финальный кадр.
 *  - `reduced`  — `to`/`from` без translate/scale/rotate, длительности × 0.6.
 *  - `standard` — × 1.
 *  - `full`     — × 1.15.
 *
 * Все tween'ы получают `force3D: true` → GPU-композит через translateZ-trick.
 */

import { onBeforeUnmount, isRef, type Ref } from 'vue';
import { gsap } from 'gsap';
import { useUiStore } from '@/stores/ui';
import type { MotionLevel } from '@/stores/ui';

type GsapScope = Element | Ref<Element | null | undefined> | (() => Element | null | undefined) | null | undefined;

// Transform-свойства, блокируемые на `reduced` — пропускаем только opacity и
// color-tween'ы.
const TRANSFORM_PROPS = new Set([
  'x',
  'y',
  'z',
  'xPercent',
  'yPercent',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'rotation',
  'rotateX',
  'rotateY',
  'rotationX',
  'rotationY',
  'skewX',
  'skewY',
]);

function stripTransforms(vars: gsap.TweenVars): gsap.TweenVars {
  const out: gsap.TweenVars = {};
  for (const [k, v] of Object.entries(vars)) {
    if (TRANSFORM_PROPS.has(k)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function scaleDuration(vars: gsap.TweenVars, scale: number): gsap.TweenVars {
  if (scale === 1) return vars;
  const next: gsap.TweenVars = { ...vars };
  if (typeof next.duration === 'number') next.duration *= scale;
  if (typeof next.delay === 'number') next.delay *= scale;
  if (typeof next.stagger === 'number') next.stagger *= scale;
  else if (next.stagger && typeof next.stagger === 'object' && 'amount' in next.stagger) {
    const s = { ...(next.stagger as gsap.StaggerVars) };
    if (typeof s.amount === 'number') s.amount *= scale;
    if (typeof s.each === 'number') s.each *= scale;
    next.stagger = s;
  }
  return next;
}

function adapt(vars: gsap.TweenVars, level: MotionLevel): gsap.TweenVars {
  // `force3D` ставится на всех уровнях кроме `off` — GPU-слой для concurrent
  // tween'ов (route transition + view mount).
  const base = level === 'reduced' ? stripTransforms(vars) : { ...vars };
  if (!('force3D' in base)) base.force3D = true;
  const scale =
    level === 'off' ? 0 : level === 'reduced' ? 0.6 : level === 'full' ? 1.15 : 1;
  return scaleDuration(base, scale);
}

export function useGsap(scope?: GsapScope) {
  // Pinia может быть не готова при HMR-mount — fallback на `standard`.
  let getLevel: () => MotionLevel = () => 'standard';
  try {
    const ui = useUiStore();
    getLevel = () => ui.motionLevel as MotionLevel;
  } catch {
    /* store недоступен */
  }

  // Scope резолвим лениво: setup() запускается ДО mount'а, root.value === null,
  // tween'ы вызываются обычно из onMounted — к этому моменту scope готов.
  const resolveScope = (): Element | undefined => {
    if (!scope) return undefined;
    if (scope instanceof Element) return scope;
    if (isRef(scope)) return scope.value ?? undefined;
    if (typeof scope === 'function') return scope() ?? undefined;
    return undefined;
  };

  // Lazy-init: ctx создаётся при первом tween-вызове, чтобы захватить mounted
  // scope element. `gsap.context(fn, scope)` сам ставит правильный selector
  // через `gsap.utils.selector(scope)` — строки → `scope.querySelectorAll`,
  // Element/NodeList/Array — pass-through. Раньше самописный selector валился
  // на staggered child-tween'ах: GSAP при создании per-element Tween вызывает
  // selector(target), наш override не различал тип и слепо звал
  // `el.querySelectorAll(target)`, который через `Element.toString()` получал
  // либо `[object HTMLDivElement]`, либо href anchor'а — невалидный CSS.
  let ctx: gsap.Context | null = null;
  const ensureCtx = (): gsap.Context => {
    if (ctx) return ctx;
    const el = resolveScope();
    ctx = el ? gsap.context(() => {}, el) : gsap.context(() => {});
    return ctx;
  };

  onBeforeUnmount(() => ctx?.revert());

  function animate(targets: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween {
    const level = getLevel();
    if (level === 'off') {
      return gsap.set(targets, { ...vars, duration: 0 }) as unknown as gsap.core.Tween;
    }
    return ensureCtx().add(() => gsap.to(targets, adapt(vars, level))) as gsap.core.Tween;
  }

  function from(targets: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween {
    const level = getLevel();
    if (level === 'off') {
      return gsap.set(targets, { clearProps: 'all' }) as unknown as gsap.core.Tween;
    }
    return ensureCtx().add(() => gsap.from(targets, adapt(vars, level))) as gsap.core.Tween;
  }

  function timeline(vars?: gsap.TimelineVars): gsap.core.Timeline {
    const level = getLevel();
    if (level === 'off') {
      // Timeline в finished-state без проигрывания.
      const t = gsap.timeline({ ...vars, paused: true });
      t.totalProgress(1);
      return t;
    }
    return ensureCtx().add(() => gsap.timeline(vars)) as gsap.core.Timeline;
  }

  return {
    animate,
    from,
    timeline,
    get ctx() {
      return ensureCtx();
    },
  };
}
