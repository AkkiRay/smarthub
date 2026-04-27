<template>
  <div class="aura" ref="root">
    <div class="aura__blob aura__blob--violet" />
    <div class="aura__blob aura__blob--pink" />
    <div class="aura__blob aura__blob--blue" />
    <div class="aura__noise" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { gsap } from 'gsap';
import { useUiStore } from '@/stores/ui';

const root = useTemplateRef<HTMLElement>('root');
const ui = useUiStore();
const { motionLevel } = storeToRefs(ui);

let tweens: gsap.core.Tween[] = [];
let visibilityHandler: (() => void) | null = null;

function killTweens(): void {
  tweens.forEach((t) => t.kill());
  tweens = [];
}

function startDrift(): void {
  killTweens();
  if (!root.value) return;
  // off / reduced / hidden-tab — drift отключён.
  if (motionLevel.value === 'off' || motionLevel.value === 'reduced') return;
  if (document.hidden) return;
  const blobs = root.value.querySelectorAll<HTMLElement>('.aura__blob');
  // full — увеличенная амплитуда и speed.
  const amp = motionLevel.value === 'full' ? 1.2 : 1;
  const speed = motionLevel.value === 'full' ? 0.85 : 1;
  blobs.forEach((blob, idx) => {
    tweens.push(
      gsap.to(blob, {
        x: `+=${120 * amp}`,
        y: `+=${80 * amp}`,
        duration: (14 + idx * 3) * speed,
        yoyo: true,
        repeat: -1,
        ease: 'sine.inOut',
        force3D: true,
      }),
    );
  });
}

// Runtime-reaction на смену motionLevel: рестарт drift'а без перезагрузки.
watch(motionLevel, () => startDrift(), { immediate: true, flush: 'post' });

onMounted(() => {
  // Pause drift, когда окно minimized / в фоне — экономит GPU при backdrop-filter
  // на остальных panel'ах. resume при возврате — startDrift пересоздаёт tween'ы.
  visibilityHandler = () => {
    if (document.hidden) killTweens();
    else startDrift();
  };
  document.addEventListener('visibilitychange', visibilityHandler);
});

onBeforeUnmount(() => {
  killTweens();
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
});
</script>

<style scoped lang="scss">
.aura {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  // z-deep — под app__shell и titlebar.
  z-index: var(--z-deep);

  // Цвета блобов из `--aura-blob-*` токенов; темы свапают палитру.
  // Имена `&--violet/--pink/--yellow` — слоты 1/2/3 (yellow = Alice-canon).
  // will-change опущен: GSAP `force3D: true` промоутит layer на время tween'а,
  // постоянный hint держал бы 3 composite-layer'а с blur(140px) всегда → GPU-hit.
  &__blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(140px);
    opacity: 0.55;
    backface-visibility: hidden;
    transform: translateZ(0);

    &--violet {
      width: 520px;
      height: 520px;
      top: -180px;
      left: -120px;
      background: radial-gradient(circle, var(--aura-blob-1), transparent 60%);
    }
    &--pink {
      width: 480px;
      height: 480px;
      top: -160px;
      right: -120px;
      background: radial-gradient(circle, var(--aura-blob-2), transparent 60%);
    }
    &--blue {
      width: 600px;
      height: 600px;
      bottom: -240px;
      left: 25%;
      background: radial-gradient(circle, var(--aura-blob-3), transparent 60%);
    }
  }

  &__noise {
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.06 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
    opacity: 0.4;
    mix-blend-mode: overlay;
  }
}
</style>
