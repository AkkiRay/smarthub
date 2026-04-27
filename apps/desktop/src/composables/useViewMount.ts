/**
 * @fileoverview useViewMount — mount-анимация view'ев: header → blocks → items.
 *
 * View помечает элементы `data-anim="header"|"block"|"item"`. Длительности
 * проходят через `useGsap` и масштабируются по `motionLevel`.
 *
 * `scope` резолвится в `onMounted` и ограничивает `querySelectorAll` корнем
 * view'а. `stagger.amount` ограничивает суммарное время волны независимо от
 * количества элементов.
 *
 * Возвращает handle с `runWave(opts?)` — для повторного re-fire после
 * skeleton↔content swap'а (когда элементы появляются в DOM позже onMount'а).
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
  /**
   * Promise, после resolve'а которого запускается mount-волна. Используется
   * вместе с `useBootstrapGate.whenReady()` — анимация ждёт когда skeleton
   * сменится на real-content и `scope` указывает на смонтированный DOM.
   * `nextTick` уже выполнен внутри `useBootstrapGate`, дополнительный
   * `await` не нужен.
   */
  defer?: Promise<void>;
  /**
   * `false` — не запускать волну автоматически на mount. Вызвать вручную
   * через `handle.runWave()`. Полезно когда view сам управляет timing'ом
   * (например через `RevealStage @reveal-done`).
   */
  auto?: boolean;
}

export interface ViewMountHandle {
  /** Принудительный запуск волны. `delay` переопределяет default. */
  runWave: (override?: { delay?: number }) => void;
}

function resolveScope(scope: ViewMountOptions['scope']): Element | null {
  if (typeof scope === 'function') return (scope() as Element | null) ?? null;
  return (unref(scope) as Element | null | undefined) ?? null;
}

function pickAll(scope: Element | null, selector: string): Element[] {
  const root = scope ?? document;
  return Array.from(root.querySelectorAll(selector));
}

export function useViewMount(opts: ViewMountOptions = {}): ViewMountHandle {
  const { from } = useGsap(null);

  function runWave(override?: { delay?: number }): void {
    const scope = resolveScope(opts.scope);
    const CLEAR = 'opacity,transform';
    const baseDelay = override?.delay ?? opts.delay ?? 0;

    const headers = pickAll(scope, '[data-page-header], [data-anim="header"]');
    if (headers.length) {
      from(headers, {
        opacity: 0,
        y: 6,
        duration: 0.36,
        delay: baseDelay,
        ease: 'power2.out',
        clearProps: CLEAR,
      });
    }

    const blocks = pickAll(scope, '[data-anim="block"]');
    if (blocks.length) {
      from(blocks, {
        opacity: 0,
        y: 8,
        stagger: { each: 0.04, amount: 0.26, from: 'start' },
        duration: 0.4,
        delay: baseDelay + 0.06,
        ease: 'power2.out',
        clearProps: CLEAR,
      });
    }

    const items = pickAll(scope, opts.itemsSelector ?? '[data-anim="item"]');
    if (items.length) {
      from(items, {
        opacity: 0,
        y: 6,
        stagger: { each: 0.035, amount: 0.36, from: 'start' },
        duration: 0.32,
        delay: baseDelay + 0.12,
        ease: 'power2.out',
        clearProps: CLEAR,
      });
    }
  }

  if (opts.auto !== false) {
    onMounted(() => {
      if (opts.defer) {
        void opts.defer.then(() => runWave());
        return;
      }
      runWave();
    });
  }

  return { runWave };
}
