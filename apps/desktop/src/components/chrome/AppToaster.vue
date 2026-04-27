<template>
  <TransitionGroup
    tag="div"
    class="toaster"
    name="toast"
    move-class="toast--moving"
  >
    <div
      v-for="t in toaster.toasts"
      :key="t.id"
      class="toast"
      :class="`toast--${t.kind}`"
      role="status"
      @click="t.kind !== 'pending' && toaster.dismiss(t.id)"
      @mouseenter="onPause(t.id)"
      @mouseleave="onResume(t.id)"
      @focusin="onPause(t.id)"
      @focusout="onResume(t.id)"
    >
      <span v-if="t.kind === 'pending'" class="toast__spinner" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="13" stroke="currentColor" stroke-width="3" fill="none" />
        </svg>
      </span>
      <span v-else class="toast__icon" aria-hidden="true" v-safe-html="iconFor(t.kind)" />

      <span class="toast__copy">
        <span class="toast__message">{{ t.message }}</span>
        <span v-if="t.detail" class="toast__detail">{{ t.detail }}</span>
      </span>

      <button
        v-if="t.kind !== 'pending'"
        type="button"
        class="toast__close"
        aria-label="Закрыть"
        @click.stop="toaster.dismiss(t.id)"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import type { ToastKind } from '@/stores/toaster';
import { useToasterStore } from '@/stores/toaster';

const toaster = useToasterStore();
const router = useRouter();

function iconFor(kind: Exclude<ToastKind, 'pending'>): string {
  if (kind === 'success')
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if (kind === 'error')
    return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v5M12 16.5h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v5M12 16.5h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
}

function onPause(id: number): void {
  toaster.pause(id);
}

function onResume(id: number): void {
  toaster.resume(id);
}

// Route change: транзиентные toasts (success/info/error) снимаются.
// Pending остаётся — он представляет активную операцию, не привязанную к view.
const stopAfterEach = router.afterEach(() => {
  toaster.clearTransient();
});

onBeforeUnmount(() => {
  stopAfterEach();
});
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.toaster {
  position: fixed;
  right: 24px;
  bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: var(--z-toast);
  pointer-events: none;
  max-height: calc(100vh - 96px);
  width: 360px;
  max-width: calc(100vw - 48px);
}

.toast {
  --toast-tone: var(--color-text-primary);
  --toast-tone-rgb: 245, 243, 247;

  position: relative;
  pointer-events: auto;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: flex-start;
  gap: 12px;
  padding: 13px 14px 13px 18px;
  border-radius: var(--radius-md);
  cursor: pointer;
  background: rgba(var(--color-bg-rgb), 0.92);
  backdrop-filter: blur(var(--glass-blur-medium)) saturate(var(--glass-saturation));
  -webkit-backdrop-filter: blur(var(--glass-blur-medium)) saturate(var(--glass-saturation));
  border: var(--border-thin) solid rgba(var(--toast-tone-rgb), 0.22);
  box-shadow: var(--shadow-elev);
  font-size: 13.5px;
  font-weight: 500;
  color: var(--color-text-primary);
  isolation: isolate;
  overflow: hidden;
  // Will-change для smooth opacity / transform — GPU-layer на время animation.
  will-change: opacity, transform;

  // Tone accent bar слева — brand-tinted vertical stripe.
  &::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: var(--toast-tone);
    opacity: 0.85;
  }

  // Tone-tinted bg overlay — layered поверх bg, behind content.
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      rgba(var(--toast-tone-rgb), 0.1) 0%,
      transparent 40%
    );
    pointer-events: none;
    z-index: -1;
  }

  &:hover {
    border-color: rgba(var(--toast-tone-rgb), 0.36);
    box-shadow:
      var(--shadow-elev),
      0 0 0 1px rgba(var(--toast-tone-rgb), 0.12);
  }

  &__icon,
  &__spinner {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    color: var(--toast-tone);
    margin-top: 1px;
    pointer-events: none;
    :deep(svg) {
      width: 100%;
      height: 100%;
    }
  }

  &__spinner {
    svg {
      transform-origin: center;
      animation: toastSpin calc(0.9s * (1 / max(var(--motion-scale, 1), 0.001))) linear infinite;
    }
    circle {
      stroke-dasharray: 60;
      stroke-dashoffset: 30;
      stroke-linecap: round;
    }
  }

  &__copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    pointer-events: none;
  }

  &__message {
    line-height: 1.4;
    color: var(--color-text-primary);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  &__detail {
    font-size: 12px;
    color: var(--color-text-secondary);
    font-weight: 400;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  // Close button: 24×24 tap-target, glyph 14×14. Dismiss explicitly через click.stop.
  &__close {
    width: 24px;
    height: 24px;
    margin-top: -2px;
    margin-right: -4px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--color-text-muted);
    opacity: 0.6;
    cursor: pointer;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);

    svg {
      width: 14px;
      height: 14px;
    }

    &:hover {
      opacity: 1;
      color: var(--toast-tone);
      background: rgba(var(--toast-tone-rgb), 0.12);
    }

    &:focus-visible {
      outline: none;
      opacity: 1;
      background: rgba(var(--toast-tone-rgb), 0.16);
    }
  }

  &:hover &__close {
    opacity: 0.85;
  }

  &--success {
    --toast-tone: var(--color-success);
    --toast-tone-rgb: var(--color-success-rgb);
  }

  &--error {
    --toast-tone: var(--color-danger);
    --toast-tone-rgb: var(--color-danger-rgb);
  }

  &--info {
    --toast-tone: var(--color-brand-violet);
    --toast-tone-rgb: var(--color-brand-violet-rgb);
  }

  &--pending {
    --toast-tone: var(--color-brand-violet);
    --toast-tone-rgb: var(--color-brand-violet-rgb);
    cursor: default;
  }
}

// ---- Transitions ----------------------------------------------------------
// CSS-driven enter/leave + move; durations через var(--motion-scale).
// Spring approximation: cubic-bezier(0.34, 1.56, 0.64, 1) для bounce-in.

.toast-enter-active {
  transition:
    opacity calc(420ms * var(--motion-scale, 1)) cubic-bezier(0.34, 1.56, 0.64, 1),
    transform calc(420ms * var(--motion-scale, 1)) cubic-bezier(0.34, 1.56, 0.64, 1);
}

.toast-leave-active {
  transition:
    opacity calc(260ms * var(--motion-scale, 1)) ease-in,
    transform calc(260ms * var(--motion-scale, 1)) ease-in;
  // Removed-toast выходит из flow → соседи slide через `move-class`.
  position: absolute;
  right: 0;
  width: 100%;
}

.toast-enter-from {
  opacity: 0;
  transform: translate3d(56px, 0, 0) scale(0.92);
}

.toast-leave-to {
  opacity: 0;
  transform: translate3d(40px, 0, 0) scale(0.96);
}

// Move: соседи плавно сдвигаются при удалении/вставке.
.toast--moving {
  transition: transform calc(380ms * var(--motion-scale, 1)) cubic-bezier(0.34, 1.56, 0.64, 1);
}

// Reduce motion: убираем scale + сокращаем translate, оставляем opacity-fade.
[data-motion='reduced'] {
  .toast-enter-from,
  .toast-leave-to {
    transform: translate3d(20px, 0, 0);
  }
}

// Spinner анимация останавливается на off (motion-scale 0 даёт деление на ~Infinity).
[data-motion='off'] {
  .toast__spinner svg {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
  }
  .toast-enter-active,
  .toast-leave-active,
  .toast--moving {
    transition-duration: 0.001ms !important;
  }
}

@keyframes toastSpin {
  to {
    transform: rotate(360deg);
  }
}

// Mobile: full-width стек снизу над AppBottomNav'ом + slide-from-bottom.
@media (max-width: 720px) {
  .toaster {
    right: 12px;
    left: 12px;
    width: auto;
    max-width: none;
    bottom: calc(var(--bottom-nav-height, 64px) + env(safe-area-inset-bottom, 0px) + 12px);
  }

  .toast {
    padding: 12px 12px 12px 16px;
    font-size: 13px;
  }

  .toast-enter-from {
    transform: translate3d(0, 56px, 0) scale(0.92);
  }
  .toast-leave-to {
    transform: translate3d(0, 40px, 0) scale(0.96);
  }

  [data-motion='reduced'] {
    .toast-enter-from,
    .toast-leave-to {
      transform: translate3d(0, 20px, 0);
    }
  }
}
</style>
