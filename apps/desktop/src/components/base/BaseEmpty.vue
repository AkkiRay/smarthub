<template>
  <div class="empty" :class="{ 'is-loading': loading }">
    <span class="empty__glyph" :class="{ 'is-loading': loading }">
      <slot name="glyph">
        <!-- Default: фирменная радар-иконка. -->
        <svg viewBox="0 0 96 96" fill="none" aria-hidden="true">
          <circle
            cx="48"
            cy="48"
            r="44"
            stroke="currentColor"
            stroke-width="0.8"
            stroke-dasharray="2 5"
            opacity="0.4"
          />
          <circle cx="48" cy="48" r="32" stroke="currentColor" stroke-width="0.8" />
          <circle cx="48" cy="48" r="20" stroke="currentColor" stroke-width="1" />
          <line
            x1="48"
            y1="4"
            x2="48"
            y2="92"
            stroke="currentColor"
            stroke-width="0.5"
            opacity="0.5"
          />
          <line
            x1="4"
            y1="48"
            x2="92"
            y2="48"
            stroke="currentColor"
            stroke-width="0.5"
            opacity="0.5"
          />
          <circle cx="48" cy="48" r="4" fill="currentColor" />
        </svg>
      </slot>
    </span>

    <h3 v-if="title" class="text--h2 empty__title">{{ title }}</h3>
    <p v-if="text" class="empty__text">{{ text }}</p>

    <div v-if="$slots.actions" class="empty__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Empty / loading-state с радар-иконкой. loading=true — пульсация (хаб опрашивает сеть).

withDefaults(
  defineProps<{
    title?: string;
    text?: string;
    /** Анимация пульсации (loading-state). */
    loading?: boolean;
  }>(),
  { loading: false },
);
</script>

<style scoped lang="scss">
.empty {
  padding: clamp(28px, 3vw, 44px) clamp(20px, 3vw, 32px);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  color: var(--color-text-secondary);
  border: 1px dashed var(--color-border-soft);
  border-radius: var(--radius-xl);
  background: rgba(var(--color-bg-rgb), 0.32);
}

.empty__glyph {
  position: relative;
  width: clamp(64px, 6vw, 88px);
  height: clamp(64px, 6vw, 88px);
  margin-bottom: 4px;
  color: rgba(var(--color-brand-purple-rgb), 0.85);
  display: inline-flex;
  align-items: center;
  justify-content: center;

  :deep(svg) {
    width: 100%;
    height: 100%;
  }

  // Halo за иконкой.
  &::before {
    content: '';
    position: absolute;
    inset: -30%;
    background: radial-gradient(
      circle,
      rgba(var(--color-brand-purple-rgb), 0.32) 0%,
      transparent 65%
    );
    filter: blur(16px);
    z-index: -1;
    pointer-events: none;
  }

  &.is-loading :deep(svg) {
    animation: emptyPulse 2.4s ease-in-out infinite;
  }
}

.empty__title {
  color: var(--color-text-primary);
  margin: 0;
  text-wrap: balance;
}
.empty__text {
  max-width: 440px;
  margin: 0;
  line-height: 1.5;
  text-wrap: pretty;
}
.empty__actions {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

@keyframes emptyPulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.85;
  }
  50% {
    transform: scale(1.06);
    opacity: 1;
  }
}
</style>
