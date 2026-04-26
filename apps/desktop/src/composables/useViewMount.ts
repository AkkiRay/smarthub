/**
 * @fileoverview useViewMount — mount-анимация view'ев: header → blocks → items.
 *
 * View помечает элементы `data-anim="header"|"block"|"item"`. Длительности
 * проходят через `useGsap` и масштабируются по `motionLevel`.
 *
 * `scope` резолвится в `onMounted` и ограничивает `querySelectorAll` корнем
 * view'а. `stagger.amount` ограничивает суммарное время волны независимо от
 * количества элементов.
 */

import { onMounted, unref, type MaybeRefOrGetter } from 'vue';
import { useGsap } from './useGsap';

export interface ViewMountOptions {
  /**
   * Корневой элемент view'а: `ref` / getter / `Element`. Резолвится в onMounted.
   * При `undefined` — селекторы матчатся по `document`.
   */
  scope?: MaybeRefOrGetter<Element | null | undefined>;
  /** Селектор grid/list-элементов; по умолчанию `[data-anim="item"]`. */
  itemsSelector?: string;
  /** Дополнительная задержка — для views с async-bootstrap. */
  delay?: number;
}

function resolveScope(scope: ViewMountOptions['scope']): Element | null {
  if (typeof scope === 'function') return (scope() as Element | null) ?? null;
  return (unref(scope) as Element | null | undefined) ?? null;
}

function pickAll(scope: Element | null, selector: string): Element[] {
  const root = scope ?? document;
  return Array.from(root.querySelectorAll(selector));
}

export function useViewMount(opts: ViewMountOptions = {}): void {
  const { from } = useGsap(null);

  onMounted(() => {
    const scope = resolveScope(opts.scope);
    // clearProps вычищает inline `opacity` / `transform` после tween'а.
    // `will-change` намеренно опущен: `force3D:true` из useGsap.adapt
    // GPU-промоутит через translateZ-trick.
    const CLEAR = 'opacity,transform';

    const headers = pickAll(scope, '[data-page-header], [data-anim="header"]');
    if (headers.length) {
      from(headers, {
        opacity: 0,
        y: 8,
        duration: 0.4,
        delay: opts.delay ?? 0,
        ease: 'power2.out',
        clearProps: CLEAR,
      });
    }

    const blocks = pickAll(scope, '[data-anim="block"]');
    if (blocks.length) {
      from(blocks, {
        opacity: 0,
        y: 12,
        stagger: { each: 0.05, amount: 0.3, from: 'start' },
        duration: 0.45,
        delay: (opts.delay ?? 0) + 0.08,
        ease: 'power2.out',
        clearProps: CLEAR,
      });
    }

    const items = pickAll(scope, opts.itemsSelector ?? '[data-anim="item"]');
    if (items.length) {
      from(items, {
        opacity: 0,
        y: 10,
        stagger: { each: 0.04, amount: 0.45, from: 'start' },
        duration: 0.36,
        delay: (opts.delay ?? 0) + 0.14,
        ease: 'power2.out',
        clearProps: CLEAR,
      });
    }
  });
}
