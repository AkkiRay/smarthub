<template>
  <div class="toaster">
    <TransitionGroup name="toast">
      <div
        v-for="t in toaster.toasts"
        :key="t.id"
        class="toast"
        :class="`toast--${t.kind}`"
        @click="t.kind !== 'pending' && toaster.dismiss(t.id)"
      >
        <span v-if="t.kind === 'pending'" class="toast__spinner" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="13" stroke="currentColor" stroke-width="3" fill="none" />
          </svg>
        </span>
        <span v-else class="toast__icon" v-safe-html="iconFor(t.kind)" />

        <span class="toast__copy">
          <span class="toast__message">{{ t.message }}</span>
          <span v-if="t.detail" class="toast__detail">{{ t.detail }}</span>
        </span>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import type { ToastKind } from '@/stores/toaster';
import { useToasterStore } from '@/stores/toaster';

const toaster = useToasterStore();

function iconFor(kind: Exclude<ToastKind, 'pending'>): string {
  if (kind === 'success')
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if (kind === 'error')
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v5M12 16.5h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
}
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
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 280px;
  max-width: 420px;
  padding: 14px 18px;
  border-radius: var(--radius-md);
  cursor: pointer;
  @include glass(var(--glass-alpha-strong), var(--glass-blur-medium));
  box-shadow: var(--shadow-elev);
  font-size: 14px;
  font-weight: 500;
  transition:
    transform 260ms var(--ease-spring),
    box-shadow 260ms var(--ease-out);

  &:hover {
    transform: translateX(-3px);
    box-shadow: 0 22px 56px rgba(0, 0, 0, 0.5);
  }

  &__icon,
  &__spinner {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    color: currentColor;
    margin-top: 1px;
    :deep(svg) {
      width: 100%;
      height: 100%;
    }
  }

  &__spinner {
    svg {
      transform-origin: center;
      animation: toastSpin 0.9s linear infinite;
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
    flex: 1;
  }
  &__message {
    line-height: 1.35;
  }
  &__detail {
    font-size: 12px;
    color: var(--color-text-secondary);
    font-weight: 400;
    line-height: 1.35;
  }

  &--success {
    color: #5be3ad;
    border-color: rgba(91, 227, 173, 0.32);
  }
  &--error {
    color: #ff7a92;
    border-color: rgba(255, 122, 146, 0.32);
  }
  &--info {
    color: var(--color-text-primary);
  }
  &--pending {
    color: var(--color-brand-purple);
    border-color: rgba(var(--color-brand-purple-rgb), 0.32);
    cursor: default;
    &:hover {
      transform: none;
    }
  }
}

.toast-enter-active {
  transition: all 320ms var(--ease-spring);
}
.toast-leave-active {
  transition: all 220ms var(--ease-out);
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(48px) scale(0.92);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(48px) scale(0.96);
}

@keyframes toastSpin {
  to {
    transform: rotate(360deg);
  }
}

// ---- Mobile: full-width стек снизу ----
@media (max-width: 720px) {
  .toaster {
    right: 12px;
    left: 12px;
    bottom: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
    width: auto;
    max-width: none;

    // Прячем тосты, когда mobile-drawer открыт — иначе они мешают навигации.
    .app__shell--drawer-open & {
      opacity: 0;
      pointer-events: none;
    }
  }

  .toast {
    width: 100%;
    max-width: 100%;
    padding: 12px 14px;
  }

  .toast-enter-from,
  .toast-leave-to {
    transform: translateY(48px) scale(0.96);
  }
}
</style>
