<template>
  <div class="aura" ref="root">
    <div class="aura__blob aura__blob--violet" />
    <div class="aura__blob aura__blob--pink" />
    <div class="aura__blob aura__blob--blue" />
    <div class="aura__noise" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue';
import { gsap } from 'gsap';
import { useUiStore } from '@/stores/ui';

const root = useTemplateRef<HTMLElement>('root');
const ui = useUiStore();

onMounted(() => {
  if (ui.reduceMotion || !root.value) return;
  const blobs = root.value.querySelectorAll('.aura__blob');
  blobs.forEach((blob, idx) => {
    gsap.to(blob, {
      x: '+=120',
      y: '+=80',
      duration: 14 + idx * 3,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
    });
  });
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

  // Цвета блобов идут из `--aura-blob-*` токенов — темы свапают палитру.
  // Имена `&--violet/--pink/--blue` остались как «слоты 1/2/3».
  &__blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(140px);
    opacity: 0.55;
    will-change: transform;

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
