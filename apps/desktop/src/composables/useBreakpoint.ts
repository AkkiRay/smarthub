/**
 * @fileoverview
 * useBreakpoint — реактивные media-query хуки. Single source of truth для adaptive UI.
 */

import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue';

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface BreakpointAPI {
  width: Ref<number>;
  height: Ref<number>;
  bp: ComputedRef<Breakpoint>;
  /** < 720: sidebar в drawer-режиме. */
  isMobile: ComputedRef<boolean>;
  /** < 1100: sidebar compact. */
  isTablet: ComputedRef<boolean>;
  isDesktop: ComputedRef<boolean>;
  isTouch: ComputedRef<boolean>;
  isLandscape: ComputedRef<boolean>;
}

// Глобальные refs: один resize-listener на всё приложение.
const width = ref<number>(typeof window !== 'undefined' ? window.innerWidth : 1440);
const height = ref<number>(typeof window !== 'undefined' ? window.innerHeight : 900);
const isTouchEnv = ref<boolean>(detectTouch());

let listenersAttached = 0;

function detectTouch(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function onResize(): void {
  width.value = window.innerWidth;
  height.value = window.innerHeight;
}

function attachListeners(): void {
  if (listenersAttached === 0) {
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
    const mq = window.matchMedia('(hover: none) and (pointer: coarse)');
    mq.addEventListener('change', () => (isTouchEnv.value = mq.matches));
  }
  listenersAttached++;
}

function detachListeners(): void {
  listenersAttached--;
  if (listenersAttached === 0) {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
  }
}

export function useBreakpoint(): BreakpointAPI {
  if (typeof window !== 'undefined') {
    attachListeners();
    onBeforeUnmount(detachListeners);
  }

  const bp = computed<Breakpoint>(() => {
    const w = width.value;
    if (w < 480) return 'xs';
    if (w < 720) return 'sm';
    if (w < 1100) return 'md';
    if (w < 1440) return 'lg';
    return 'xl';
  });

  return {
    width,
    height,
    bp,
    isMobile: computed(() => width.value < 720),
    isTablet: computed(() => width.value >= 720 && width.value < 1100),
    isDesktop: computed(() => width.value >= 1100),
    isTouch: computed(() => isTouchEnv.value),
    isLandscape: computed(() => width.value > height.value),
  };
}
