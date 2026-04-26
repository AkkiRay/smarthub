<template>
  <div class="radar" :class="{ 'is-active': active }">
    <!-- Квадратный scope: aspect-ratio:1 = min(w,h) родителя. -->
    <div ref="scopeEl" class="radar__scope">
      <!-- Концентрические кольца + оси. preserveAspectRatio фиксирует квадрат. -->
      <svg
        viewBox="-100 -100 200 200"
        preserveAspectRatio="xMidYMid meet"
        class="radar__grid"
        aria-hidden="true"
      >
        <circle cx="0" cy="0" r="92" class="radar__ring" />
        <circle cx="0" cy="0" r="68" class="radar__ring" />
        <circle cx="0" cy="0" r="44" class="radar__ring" />
        <circle cx="0" cy="0" r="20" class="radar__ring" />
        <line x1="-92" y1="0" x2="92" y2="0" class="radar__axis" />
        <line x1="0" y1="-92" x2="0" y2="92" class="radar__axis" />
        <line x1="-65" y1="-65" x2="65" y2="65" class="radar__axis radar__axis--diag" />
        <line x1="-65" y1="65" x2="65" y2="-65" class="radar__axis radar__axis--diag" />
      </svg>

      <!-- Sweep clip'нут radial-mask'ом в радиус scope. -->
      <span class="radar__sweep" />

      <!-- Blip'ы — позиции в %-долях scope. -->
      <span v-for="(b, i) in blips" :key="i" class="radar__blip" :style="b.style" />

      <!-- Compass-метки на границе. -->
      <span class="radar__tick radar__tick--n">N</span>
      <span class="radar__tick radar__tick--e">E</span>
      <span class="radar__tick radar__tick--s">S</span>
      <span class="radar__tick radar__tick--w">W</span>

      <!-- Readout-slot в центре. -->
      <div class="radar__center">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  /** Активный режим включает sweep и подсветку колец. */
  active?: boolean;
  /** Сколько blip-точек разместить (= кандидатов). */
  count?: number;
}
const props = withDefaults(defineProps<Props>(), { active: false, count: 0 });

interface Blip {
  style: Record<string, string>;
}
const blips = computed<Blip[]>(() =>
  // Golden-angle (137.5°) для равномерного распределения.
  Array.from({ length: props.count }, (_, i) => {
    const angle = i * 137.5 * (Math.PI / 180);
    // Радиус 20-44% — внутри внешнего кольца (46%).
    const radius = 20 + ((i * 7) % 24);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    return {
      style: {
        left: `calc(50% + ${x}%)`,
        top: `calc(50% + ${y}%)`,
        animationDelay: `${(i * 220) % 1800}ms`,
      },
    };
  }),
);
</script>

<style scoped lang="scss">
.radar {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}

// Scope: квадрат через aspect-ratio:1, ограничен min-стороной родителя.
.radar__scope {
  position: relative;
  aspect-ratio: 1;
  width: 100%;
  max-width: 100%;
  max-height: 100%;
  height: 100%;
}

.radar__grid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.radar__ring {
  fill: none;
  stroke: rgba(var(--color-brand-purple-rgb), 0.18);
  stroke-width: 0.4;
  transition: stroke 320ms;

  .is-active & {
    stroke: rgba(var(--color-brand-purple-rgb), 0.32);
  }
}
.radar__axis {
  stroke: rgba(var(--color-brand-purple-rgb), 0.1);
  stroke-width: 0.3;

  &--diag {
    stroke-dasharray: 1 3;
  }
}

.radar__sweep {
  position: absolute;
  inset: 4%;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    rgba(var(--color-brand-purple-rgb), 0.55) 14deg,
    rgba(var(--color-brand-purple-rgb), 0.2) 38deg,
    transparent 60deg,
    transparent 360deg
  );
  // Mask держит sweep внутри круга scope.
  mask: radial-gradient(circle at 50% 50%, #000 0%, #000 96%, transparent 100%);
  -webkit-mask: radial-gradient(circle at 50% 50%, #000 0%, #000 96%, transparent 100%);
  opacity: 0;
  transition: opacity 320ms;
  mix-blend-mode: screen;
  pointer-events: none;

  .is-active & {
    opacity: 0.9;
    animation: radarSweep 3s linear infinite;
  }
}

.radar__blip {
  position: absolute;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  border-radius: 50%;
  background: var(--color-brand-cyan);
  box-shadow:
    0 0 8px var(--color-brand-cyan),
    0 0 16px rgba(var(--color-brand-purple-rgb), 0.45);
  animation: radarBlip 2s ease-in-out infinite;
  pointer-events: none;
  z-index: 2;
}

.radar__tick {
  position: absolute;
  font-family: var(--font-family-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: rgba(var(--color-brand-purple-rgb), 0.6);
  pointer-events: none;
  font-variant-numeric: tabular-nums;
  z-index: 3;

  // Метки на серединах граней scope.
  &--n {
    top: 4px;
    left: 50%;
    transform: translateX(-50%);
  }
  &--s {
    bottom: 4px;
    left: 50%;
    transform: translateX(-50%);
  }
  &--e {
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
  }
  &--w {
    left: 4px;
    top: 50%;
    transform: translateY(-50%);
  }
}

.radar__center {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  z-index: 4;

  // Slot-children принимают клики.
  > * {
    pointer-events: auto;
  }
}

@keyframes radarSweep {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
@keyframes radarBlip {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}
</style>
