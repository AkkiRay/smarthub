// useViewMount — единая mount-анимация views: header → blocks (stagger 0.05) → items (stagger 0.04).
// View помечает элементы `data-anim="block"` / `data-anim="item"` для входа в общую волну.

import { onMounted } from 'vue';
import { useGsap } from './useGsap';

export interface ViewMountOptions {
  /** root.value компонента; селекторы резолвятся относительно него. */
  scope?: Element | null | undefined;
  /** Селектор grid/list-элементов; по умолчанию `[data-anim="item"]`. */
  itemsSelector?: string;
  /** Дополнительная задержка — для views с async-bootstrap. */
  delay?: number;
}

export function useViewMount(opts: ViewMountOptions = {}): void {
  const { from } = useGsap(opts.scope ?? null);

  onMounted(() => {
    // `clearProps` — после animation GSAP вычищает inline-стили (opacity/transform),
    // оставляя только CSS-управление. Без этого новые reactive-инcерции в тот же
    // grid (например, async-загруженные `.scene--alice` после fetchHome) могли
    // унаследовать «застрявшую» opacity:0 от sibling-tween'а.
    const CLEAR = 'opacity,transform';

    from('[data-page-header], [data-anim="header"]', {
      opacity: 0,
      y: 8,
      duration: 0.4,
      delay: opts.delay ?? 0,
      ease: 'power2.out',
      clearProps: CLEAR,
    });

    from('[data-anim="block"]', {
      opacity: 0,
      y: 12,
      stagger: 0.05,
      duration: 0.45,
      delay: (opts.delay ?? 0) + 0.08,
      ease: 'power2.out',
      clearProps: CLEAR,
    });

    const items = opts.itemsSelector ?? '[data-anim="item"]';
    from(items, {
      opacity: 0,
      y: 10,
      stagger: 0.04,
      duration: 0.4,
      delay: (opts.delay ?? 0) + 0.14,
      ease: 'power2.out',
      clearProps: CLEAR,
    });
  });
}
