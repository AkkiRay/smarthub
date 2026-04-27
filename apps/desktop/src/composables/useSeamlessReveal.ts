/**
 * @fileoverview useSeamlessReveal — orchestrator skeleton↔content swap'а.
 *
 * Объединяет `useBootstrapGate` (gate с min-duration) и handle для запуска
 * page-header-волны, не дублируя stagger детей grid'а — за внутренний
 * stagger отвечает `<RevealStage>`.
 *
 * Применение в view:
 *   const reveal = useSeamlessReveal({
 *     tasks: [() => store.bootstrap()],
 *     minDuration: 600,
 *     scope: rootRef,
 *   });
 *   <BasePageHeader data-page-header />
 *   <RevealStage :ready="reveal.ready.value" @reveal-done="reveal.onRevealDone">
 *     <template #skeleton><SkeletonGrid /></template>
 *     <Card v-for="..." data-anim="item" />
 *   </RevealStage>
 *
 * Header-волна (`data-page-header` снаружи RevealStage) запускается на mount —
 * заголовок появляется одновременно с шиммером, без ожидания gate.
 */

import { onMounted, type MaybeRefOrGetter } from 'vue';
import { useBootstrapGate, type BootstrapGateOptions } from './useBootstrapGate';
import { useViewMount } from './useViewMount';
import type { Ref } from 'vue';

export interface SeamlessRevealOptions extends BootstrapGateOptions {
  /** Корень view'а — для scoped-querySelector header'а. */
  scope?: MaybeRefOrGetter<Element | null | undefined>;
}

export interface SeamlessRevealHandle {
  /** Reactive flag для биндинга `<RevealStage :ready>`. */
  ready: Ref<boolean>;
  /** Resolve'ится когда контент смонтирован — для async-callers. */
  whenReady: () => Promise<void>;
  /** `<RevealStage @reveal-done>` колбек. */
  onRevealDone: () => void;
}

export function useSeamlessReveal(opts: SeamlessRevealOptions = {}): SeamlessRevealHandle {
  const gate = useBootstrapGate(opts);

  // Header-волна — запускается сразу после mount'а: pageHeader снаружи
  // RevealStage и существует ещё до gate.ready, его ждать нельзя.
  const headerWave = useViewMount({
    scope: opts.scope,
    auto: false,
  });

  onMounted(() => {
    requestAnimationFrame(() => headerWave.runWave());
  });

  return {
    ready: gate.ready,
    whenReady: gate.whenReady,
    onRevealDone: () => {
      /* GSAP timeline в RevealStage уже финализировал children — hook оставлен
         как extension-point для view-specific actions (analytics, focus). */
    },
  };
}
