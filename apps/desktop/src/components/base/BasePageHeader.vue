<template>
  <header class="page-head" data-page-header>
    <div class="page-head__lead">
      <!-- Back-кнопка: emit('back'), либо fallback router.back(). -->
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
// Единый header views. Layout: [back? + copy] | [actions]. Wrap-friendly.

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

// Если родитель повесил @back — отдаём ему control, иначе router.back().
function onBack(): void {
  if (attrs.onBack) emit('back');
  else void router.back();
}
</script>

<style scoped lang="scss">
.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px 24px;

  &__lead {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    flex: 1 1 320px;
    min-width: 0;
  }

  // Back-кнопка — голая стрелка. Hover: shift влево + brand-purple + glow.
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
      color 200ms var(--ease-out),
      box-shadow 200ms var(--ease-out);

    :deep(.icon) {
      transition:
        transform 280ms var(--ease-spring),
        filter 240ms var(--ease-out);
    }

    &:hover {
      color: var(--color-brand-purple);
      :deep(.icon) {
        transform: translateX(-4px);
        filter: drop-shadow(0 0 6px rgba(var(--color-brand-purple-rgb), 0.55));
      }
    }
    &:active :deep(.icon) {
      transform: translateX(-6px) scale(0.94);
      transition-duration: 120ms;
    }
    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(var(--color-brand-purple-rgb), 0.32);
    }
  }

  &__copy {
    flex: 1;
    min-width: 0;
    // Prose-кап ~75ch для readability на широких мониторах. Header остаётся
    // full-width — actions уходят вправо через space-between.
    max-width: var(--content-max-prose);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__eyebrow {
    color: var(--color-brand-purple);
    display: inline-flex;
    align-items: center;
    gap: 8px;

    &::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 8px currentColor;
    }
  }

  &__title {
    margin: 0;
  }
  &__desc {
    color: var(--color-text-secondary);
    margin: 0;
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
}
</style>
