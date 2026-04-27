/**
 * @fileoverview useBootstrapGate — централизованный bootstrap-pattern для views.
 *
 * Решает паттерн «view зависит от async-stores → пока не готово, показываем
 * skeleton; когда готово, плавный crossfade». Дополнительно гарантирует
 * минимальное время отображения skeleton'а — иначе на быстрых данных шиммер
 * мелькает на 1-2 кадра и пользователь не успевает его заметить.
 *
 * Контракт:
 *  - `tasks` — массив async-источников (store.bootstrap, IPC.list, ...).
 *  - `minDuration` — минимальное время skeleton'а (ms). Дефолт 600ms.
 *  - `timeout` — hard-cap на ожидание задач (ms). Дефолт 1500ms.
 *  - `awaitNextTick` — после flip'а ждём nextTick перед resolve()'ом, чтобы
 *    real-content успел смонтироваться к моменту следующего шага (например,
 *    GSAP entry-animation).
 *
 * Возвращает `ready: Ref<boolean>` для `<Transition>` v-if/v-else binding'а
 * и `whenReady(): Promise<void>` — для запуска entry-animation после flip'а.
 *
 * Применение в view:
 *   const { ready, whenReady } = useBootstrapGate({
 *     tasks: [scenes.bootstrap(), drivers.list()],
 *     minDuration: 700,
 *   });
 *   onMounted(async () => { await whenReady(); runEntryAnimation(); });
 */

import { nextTick, onMounted, ref, type Ref } from 'vue';

export interface BootstrapGateOptions {
  /** Async-источники, дожидаемся через Promise.all с timeout-cap'ом. */
  tasks?: Array<Promise<unknown> | (() => Promise<unknown>)>;
  /** Минимальное время skeleton'а в ms. */
  minDuration?: number;
  /** Hard-cap на ожидание tasks в ms. */
  timeout?: number;
}

export interface BootstrapGateHandle {
  ready: Ref<boolean>;
  /** Resolve'ится в момент когда `ready` стал true и DOM real-content смонтирован. */
  whenReady(): Promise<void>;
}

const DEFAULT_MIN = 600;
const DEFAULT_TIMEOUT = 1500;

export function useBootstrapGate(opts: BootstrapGateOptions = {}): BootstrapGateHandle {
  const ready = ref(false);
  let resolveReady: (() => void) | null = null;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  onMounted(async () => {
    const start = Date.now();
    const min = opts.minDuration ?? DEFAULT_MIN;
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;

    const taskPromises = (opts.tasks ?? []).map((t) =>
      typeof t === 'function' ? t().catch(() => undefined) : (t.catch?.(() => undefined) ?? t),
    );

    await Promise.race([Promise.all(taskPromises), new Promise((r) => setTimeout(r, timeout))]);

    const elapsed = Date.now() - start;
    if (elapsed < min) {
      await new Promise((r) => setTimeout(r, min - elapsed));
    }

    ready.value = true;
    await nextTick();
    resolveReady?.();
  });

  return {
    ready,
    whenReady: () => readyPromise,
  };
}
