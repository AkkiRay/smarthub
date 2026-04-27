<template>
  <header class="page-head" data-page-header>
    <div class="page-head__lead">
      <!-- Back: emit('back') или fallback router.back(). -->
      <button
        v-if="back"
        type="button"
        class="page-head__back"
        :aria-label="backLabel"
        @click="onBack"
      >
        <BaseIcon name="arrow-left" size="18" />
      </button>

      <div class="page-head__copy">
        <span v-if="eyebrow" class="text--micro page-head__eyebrow">{{ eyebrow }}</span>
        <h1 class="text--h1 page-head__title">
          <slot name="title">{{ title }}</slot>
        </h1>
        <p v-if="$slots.description || description" class="text--small page-head__desc">
          <slot name="description">{{ description }}</slot>
        </p>
      </div>
    </div>

    <div v-if="$slots.actions" class="page-head__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
// Page header views. Layout: [back? + copy] | [actions]. Wrap-friendly.

import { useAttrs } from 'vue';
import { useRouter } from 'vue-router';
import BaseIcon from './BaseIcon.vue';

withDefaults(
  defineProps<{
    /** Микро-метка перед заголовком (uppercase mono). */
    eyebrow?: string;
    /** Заголовок (или slot:title). */
    title?: string;
    /** Подзаголовок (или slot:description). */
    description?: string;
    /** Показывать back-кнопку. */
    back?: boolean;
    /** Aria-label для back-кнопки. */
    backLabel?: string;
  }>(),
  { back: false, backLabel: 'Назад' },
);

const emit = defineEmits<{ back: [] }>();

const attrs = useAttrs();
const router = useRouter();

// При наличии @back-listener'а — emit, иначе router.back().
function onBack(): void {
  if (attrs.onBack) emit('back');
  else void router.back();
}
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.page-head {
  // Page-head — частный случай `.panel`: наследует depth-shadow и accent-line
  // через depth-токены, не дублирует значения.
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px 24px;
  padding: clamp(20px, 2vw, 28px) clamp(20px, 2.4vw, 32px);
  border-radius: var(--radius-xl);
  isolation: isolate;
  background: rgba(255, 255, 255, 0.022);
  border: var(--border-thin) solid rgba(255, 255, 255, 0.055);
  box-shadow: var(--depth-2);
  transition:
    border-color var(--dur-medium) var(--ease-out),
    box-shadow var(--dur-medium) var(--ease-out);

  // Brand accent line: vertical gradient violet → yellow (Alice-canon) → violet.
  // background-size 280% + alternate-shift даёт «дыхание».
  &::before {
    content: '';
    position: absolute;
    top: 14%;
    bottom: 14%;
    left: 0;
    width: 2px;
    border-radius: 2px;
    background: linear-gradient(
      180deg,
      rgba(var(--color-brand-violet-rgb), 0) 0%,
      rgba(var(--color-brand-violet-rgb), 0.7) 25%,
      rgba(var(--color-brand-yellow-rgb), 0.85) 60%,
      rgba(var(--color-brand-violet-rgb), 0) 100%
    );
    background-size: 100% 280%;
    // Длительность ÷ motion-scale — реактивно к motion-level. Базовый период
    // 6s = «дыхание» каждые 12s (alternate). На reduced 0.6× → 10s, off →
    // kill-list в `_motion.scss`.
    animation: pageHeadAccent calc(6s / max(var(--motion-scale, 1), 0.001)) ease-in-out infinite
      alternate;
    pointer-events: none;
  }

  &:hover {
    border-color: rgba(255, 255, 255, 0.08);
    box-shadow:
      var(--depth-2),
      0 0 24px rgba(var(--color-brand-purple-rgb), 0.18);
  }

  > * {
    position: relative;
    z-index: 1;
  }

  &__lead {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    flex: 1 1 320px;
    min-width: 0;
  }

  // Back button: bare arrow. Hover — shift влево + brand-purple + glow.
  &__back {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    margin-top: 4px;
    padding: 0;
    transition:
      color var(--trans-base),
      box-shadow var(--trans-base);

    :deep(.icon) {
      transition:
        transform var(--trans-transform),
        filter var(--trans-medium);
    }

    &:hover {
      color: var(--color-brand-purple);
      :deep(.icon) {
        transform: translateX(-3px);
        filter: drop-shadow(0 0 6px rgba(var(--color-brand-purple-rgb), 0.55));
      }
    }
    &:active :deep(.icon) {
      transform: translateX(-4px) scale(0.96);
      transition-duration: var(--dur-instant);
    }
    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(var(--color-brand-purple-rgb), 0.32);
    }
  }

  &__copy {
    flex: 1;
    min-width: 0;
    // Prose cap ~75ch для readability; actions уходят вправо через space-between.
    max-width: var(--content-max-prose);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__eyebrow {
    color: var(--color-brand-violet);
    font-family: var(--font-family-mono);
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border-radius: var(--radius-pill);
    background: rgba(var(--color-brand-violet-rgb), 0.14);
    border: 1px solid rgba(var(--color-brand-violet-rgb), 0.26);
    width: fit-content;
    margin-bottom: 4px;

    &::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--gradient-brand);
      box-shadow: 0 0 8px rgba(var(--color-brand-violet-rgb), 0.6);
    }
  }

  &__title {
    margin: 0;
    font-family: var(--font-family-display);
    font-size: var(--font-size-display-2);
    line-height: 1.1;
    letter-spacing: -0.02em;
    font-weight: 720;
  }
  &__desc {
    color: var(--color-text-secondary);
    margin: 0;
    font-size: var(--font-size-body);
    line-height: 1.55;
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
}

@keyframes pageHeadAccent {
  0% {
    background-position: 0% 0%;
    opacity: 0.7;
  }
  100% {
    background-position: 0% 100%;
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .page-head::before {
    animation: none;
  }
}

// Mobile (≤720px): single-column stack, full-width actions row, compact padding.
@media (max-width: 720px) {
  .page-head {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    padding: 14px 14px 16px;
    border-radius: var(--radius-lg);
    box-shadow:
      0 18px 36px -28px rgba(0, 0, 0, 0.7),
      inset 0 1px 0 rgba(255, 255, 255, 0.03);

    &::before {
      top: 18%;
      bottom: 18%;
      left: 0;
    }

    &__lead {
      flex: 1 1 auto;
      gap: 10px;
    }

    &__back {
      width: 36px;
      height: 36px;
      margin-top: 0;
    }

    &__desc {
      font-size: var(--font-size-small);
    }

    &__actions {
      width: 100%;
      flex-wrap: wrap;
      gap: 8px;

      // Actions buttons растягиваются на full-width в две колонки.
      :deep(.button) {
        flex: 1 1 calc(50% - 4px);
        min-width: 0;
        justify-content: center;
      }
    }
  }
}
</style>
