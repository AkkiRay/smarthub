<template>
  <Teleport to="body">
    <Transition name="modal" :duration="320" appear>
      <div v-if="modelValue" class="modal" @click.self="onBackdrop">
        <div
          ref="panel"
          class="modal__panel glass--strong"
          :class="[`modal__panel--${size}`]"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="title ? `${dialogId}-title` : undefined"
        >
          <header v-if="title || kicker || $slots.header" class="modal__header">
            <div class="modal__heading">
              <span v-if="kicker" class="modal__kicker">{{ kicker }}</span>
              <h2 v-if="title" :id="`${dialogId}-title`" class="modal__title">{{ title }}</h2>
              <slot name="header" />
            </div>
            <button
              v-if="closable"
              type="button"
              class="modal__close"
              aria-label="Закрыть"
              @click="onClose"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </header>

          <div class="modal__body">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="modal__footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * Базовый modal primitive. Используется для всех диалогов приложения
 * (ConfirmDialog, SceneEditor, PairDeviceFlow и т.д.).
 *
 * Поддерживает заголовок, kicker, footer-slot, ESC и backdrop-dismiss,
 * lock body-scroll, focus-management через template ref.
 */

import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';

/**
 * Module-level стек ESC-handler'ов. ESC закрывает только TOP-модалку.
 * Без stack'а nested-confirm + parent-modal схлопывались одним нажатием —
 * `e.stopPropagation()` не помогает между siblings'ами на одном target'е.
 */
const modalStack: Array<(e: KeyboardEvent) => void> = [];

interface Props {
  /** v-model: открыта ли модалка. */
  modelValue: boolean;
  /** Заголовок в header. */
  title?: string;
  /** Brand-coloured eyebrow над title. */
  kicker?: string;
  /** Закрывать ли по клику на backdrop. */
  closeOnBackdrop?: boolean;
  /** Закрывать ли по ESC. False — для блокирующих pairing/upload-флоу. */
  closeOnEsc?: boolean;
  /** Рендерить ли close-button в header. */
  closable?: boolean;
  /** Max-width панели. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const props = withDefaults(defineProps<Props>(), {
  closeOnBackdrop: true,
  closeOnEsc: true,
  closable: true,
  size: 'md',
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  close: [];
}>();

const panel = useTemplateRef<HTMLElement>('panel');
const dialogId = `modal-${Math.random().toString(36).slice(2, 8)}`;

/** Закрывает модалку: эмитит update:modelValue=false и close. */
function onClose(): void {
  emit('update:modelValue', false);
  emit('close');
}

/** Handler для клика на backdrop. */
function onBackdrop(): void {
  if (props.closeOnBackdrop) onClose();
}

/**
 * Keyboard handler: ESC закрывает модалку.
 * Stack-aware: при nested-modal'ах ESC закрывает только TOP-модалку, иначе
 * стек модалок схлопывается одним нажатием.
 */
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !props.modelValue || !props.closeOnEsc) return;
  if (modalStack[modalStack.length - 1] !== onKey) return;
  e.stopPropagation();
  onClose();
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  modalStack.push(onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  const idx = modalStack.lastIndexOf(onKey);
  if (idx !== -1) modalStack.splice(idx, 1);
});

/** Body-scroll lock пока модалка mounted. */
watch(
  () => props.modelValue,
  (open) => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = open ? 'hidden' : '';
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.body.style.overflow = '';
});
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

// Scroll-container — overlay (.modal). Panel и body без overflow.

// ---- Overlay -------------------------------------------------------------
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  z-index: var(--z-modal);
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;

  &::-webkit-scrollbar {
    width: 10px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
  }

  // ---- Panel -------------------------------------------------------------
  &__panel {
    width: 100%;
    margin: auto;
    padding: 24px 26px;
    border-radius: var(--radius-xl);
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 32px 80px rgba(0, 0, 0, 0.55);
    flex-shrink: 0;
    // Override `.glass { overflow: hidden }` (styles/blocks/_glass.scss).
    overflow: visible;

    &--sm {
      max-width: 420px;
    }
    &--md {
      max-width: 560px;
    }
    &--lg {
      max-width: 760px;
    }
    &--xl {
      max-width: 1080px;
    }
  }

  // ---- Header ------------------------------------------------------------
  &__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  &__heading {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__kicker {
    font-family: var(--font-family-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-brand-purple);
  }

  &__title {
    font-family: var(--font-family-display);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0;
    line-height: 1.2;
  }

  &__close {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    color: var(--color-text-secondary);
    border: 0;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition:
      background var(--trans-base),
      color var(--trans-base),
      transform var(--trans-transform);

    svg {
      width: 14px;
      height: 14px;
    }

    &:hover {
      background: rgba(255, 255, 255, 0.12);
      color: var(--color-text-primary);
      transform: scale(1.04);
    }
    &:focus-visible {
      outline: 2px solid var(--color-brand-purple);
      outline-offset: 2px;
    }
  }

  // ---- Body --------------------------------------------------------------
  &__body {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  // ---- Footer ------------------------------------------------------------
  &__footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 0 4px;
    border-top: 1px solid var(--color-border-subtle);
  }
}

// ---- Transitions ---------------------------------------------------------
// Durations через --motion-scale → off motion-level моментально гасит модалку
// без задержки. Panel-shift уменьшен (16px→10px, scale 0.96→0.985) — мягче.
.modal-enter-active,
.modal-leave-active {
  transition: opacity calc(220ms * var(--motion-scale, 1)) var(--ease-out);

  .modal__panel {
    transition:
      transform calc(280ms * var(--motion-scale, 1)) var(--ease-soft),
      opacity calc(220ms * var(--motion-scale, 1)) var(--ease-out);
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
  .modal__panel {
    transform: translateY(10px) scale(0.985);
    opacity: 0;
  }
}

// ---- Mobile: full-bleed bottom-sheet style ----
@media (max-width: 720px) {
  .modal {
    padding: 0;
    align-items: flex-end;

    &__panel,
    &__panel--sm,
    &__panel--md,
    &__panel--lg,
    &__panel--xl {
      max-width: 100%;
      width: 100%;
      margin: 0;
      padding: 18px 16px 24px;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      // viewport - title-bar (46px) - safe-top — резерв под notch и swipe-zone.
      max-height: calc(100dvh - 46px - var(--safe-top, 0px));
      overflow-y: auto;
      overscroll-behavior: contain;
      padding-bottom: max(24px, var(--safe-bottom, 0px));
    }

    &__title {
      font-size: 18px;
    }

    &__footer {
      flex-direction: column-reverse;
      gap: 8px;
      padding-top: 10px;

      :deep(.btn) {
        width: 100%;
      }
    }
  }

  // Bottom-sheet анимация: вверх вместо центра.
  .modal-enter-from,
  .modal-leave-to {
    .modal__panel {
      transform: translateY(100%) scale(1);
    }
  }
}
</style>
