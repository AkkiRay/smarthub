/**
 * @fileoverview useDeferredMount — `Ref<boolean>` который флипается `true`
 * после первого idle / двойного RAF / timeout с момента mount'а.
 *
 * Применяется для гейта `v-if` тяжёлого child-компонента: parent держит
 * skeleton фиксированной высоты, child рендерится во второй task'е.
 */

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

export type DeferMode = 'idle' | 'raf' | 'timeout';

export interface DeferredMountOptions {
  /** `idle` — requestIdleCallback (default); `raf` — двойной RAF; `timeout` — setTimeout. */
  mode?: DeferMode;
  /** Для `idle` — `timeout` опция IdleRequestOptions; для `timeout` — задержка в мс. */
  delayMs?: number;
}

const HAS_IDLE = typeof window !== 'undefined' && 'requestIdleCallback' in window;

/** Возвращает `Ref<boolean>` который флипается `true` после первого tick'а выбранного mode. */
export function useDeferredMount(opts: DeferredMountOptions = {}): Ref<boolean> {
  const mounted = ref(false);
  const mode: DeferMode = opts.mode ?? (HAS_IDLE ? 'idle' : 'raf');
  let cancel: (() => void) | null = null;

  onMounted(() => {
    if (mode === 'idle' && HAS_IDLE) {
      const id = window.requestIdleCallback(() => { mounted.value = true; }, {
        timeout: opts.delayMs ?? 250,
      });
      cancel = () => window.cancelIdleCallback(id);
    } else if (mode === 'raf') {
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => { mounted.value = true; });
      });
      cancel = () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    } else {
      const id = window.setTimeout(() => { mounted.value = true; }, opts.delayMs ?? 0);
      cancel = () => window.clearTimeout(id);
    }
  });

  onBeforeUnmount(() => {
    cancel?.();
    cancel = null;
  });

  return mounted;
}
