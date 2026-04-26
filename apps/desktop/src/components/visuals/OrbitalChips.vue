<template>
  <div ref="rootEl" class="orbital-chips" :aria-hidden="true">
    <div ref="cssEl" class="orbital-chips__layer" />
    <div ref="templatesEl" class="orbital-chips__templates">
      <span v-for="tag in chips" :key="tag" class="orbital-chips__chip">
        {{ tag }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
// Real 3D chip ring вокруг JarvisOrb через CSS3DRenderer.
// CSS3DSprite — chip всегда смотрит в камеру (билборд) при rotation rings.
// GSAP ticker — единый rAF на все кольца + parallax.

import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue';
import { storeToRefs } from 'pinia';
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { gsap } from 'gsap';
import { useUiStore } from '@/stores/ui';

interface Props {
  chips?: string[];
}
const props = withDefaults(defineProps<Props>(), {
  chips: () => ['Yeelight', 'Hue', 'Tuya', 'Сбер', 'WiZ', 'Shelly', 'miIO', 'Matter'],
});

const ui = useUiStore();
const { reduceMotion } = storeToRefs(ui);

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const cssEl = useTemplateRef<HTMLElement>('cssEl');
const templatesEl = useTemplateRef<HTMLElement>('templatesEl');

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: CSS3DRenderer | null = null;
const rings: Array<{ group: THREE.Group; speed: number }> = [];
let resizeObs: ResizeObserver | null = null;
let onPointerMove: ((e: PointerEvent) => void) | null = null;
let tickerFn: (() => void) | null = null;

// Orbital config: 3 кольца, разные tilt'ы / radii / скорости.
const RING_CONFIG = [
  { speedDeg: 0.32, tiltX: 0.30, tiltZ: 0, count: 3, radius: 280 },
  { speedDeg: -0.24, tiltX: -0.42, tiltZ: 0.45, count: 3, radius: 320 },
  { speedDeg: 0.42, tiltX: 0.78, tiltZ: -0.20, count: 2, radius: 240 },
];

function init(): void {
  if (!rootEl.value || !cssEl.value || !templatesEl.value) return;
  const w = rootEl.value.clientWidth;
  const h = rootEl.value.clientHeight;
  if (w === 0 || h === 0) return;

  scene = new THREE.Scene();
  // FOV/position подобраны так что translateZ(220-320) попадает в кадр близко
  // к окружности JarvisOrb (xl ≈ 420px от которого до chip ~200px радиально).
  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
  camera.position.set(0, 0, 700);

  renderer = new CSS3DRenderer();
  renderer.setSize(w, h);
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.pointerEvents = 'none';
  cssEl.value.appendChild(renderer.domElement);

  const chipEls = Array.from(
    templatesEl.value.querySelectorAll<HTMLElement>('.orbital-chips__chip'),
  );

  let cursor = 0;
  for (const cfg of RING_CONFIG) {
    const group = new THREE.Group();
    group.rotation.x = cfg.tiltX;
    group.rotation.z = cfg.tiltZ;

    const taken = chipEls.slice(cursor, cursor + cfg.count);
    cursor += cfg.count;

    for (let i = 0; i < taken.length; i++) {
      const angle = (i / taken.length) * Math.PI * 2;
      // Sprite билбордится сам — не нужен manual lookAt каждый кадр.
      const sprite = new CSS3DSprite(taken[i]!);
      sprite.position.set(Math.cos(angle) * cfg.radius, 0, Math.sin(angle) * cfg.radius);
      group.add(sprite);
    }
    scene.add(group);
    rings.push({ group, speed: (cfg.speedDeg * Math.PI) / 180 });
  }

  // Parallax — лёгкий, не tracking. Pointer move → плавный tween scene.rotation.
  onPointerMove = (e) => {
    if (!scene) return;
    const nx = e.clientX / window.innerWidth - 0.5;
    const ny = e.clientY / window.innerHeight - 0.5;
    gsap.to(scene.rotation, {
      x: ny * 0.08,
      y: nx * 0.08,
      duration: 0.9,
      ease: 'power2.out',
      overwrite: 'auto',
    });
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  // Single ticker — все кольца + render. dt из gsap уже секундах.
  tickerFn = () => {
    if (!scene || !renderer || !camera) return;
    const dt = gsap.ticker.deltaRatio() / 60; // нормализуем под 60fps
    const motionScale = reduceMotion.value ? 0.25 : 1;
    for (const r of rings) {
      r.group.rotation.y += r.speed * dt * motionScale;
    }
    renderer.render(scene, camera);
  };
  gsap.ticker.add(tickerFn);

  resizeObs = new ResizeObserver(() => {
    if (!rootEl.value || !renderer || !camera) return;
    const W = rootEl.value.clientWidth;
    const H = rootEl.value.clientHeight;
    if (W === 0 || H === 0) return;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  });
  resizeObs.observe(rootEl.value);
}

onMounted(init);

onBeforeUnmount(() => {
  if (tickerFn) gsap.ticker.remove(tickerFn);
  if (onPointerMove) window.removeEventListener('pointermove', onPointerMove);
  resizeObs?.disconnect();
  if (renderer && cssEl.value) {
    try {
      cssEl.value.removeChild(renderer.domElement);
    } catch {
      /* already removed */
    }
  }
  scene = null;
  camera = null;
  renderer = null;
  rings.length = 0;
});
</script>

<style scoped lang="scss">
.orbital-chips {
  position: absolute;
  inset: 0;
  pointer-events: none;
  perspective: 1000px;
  overflow: visible;
}

.orbital-chips__layer {
  position: absolute;
  inset: 0;
}

// Скрытый template-контейнер: chip-элементы перемещаются CSS3DObject'ом
// в renderer.domElement. data-v scoped attribute остаётся на элементах при
// перемещении DOM-API, поэтому стили продолжают применяться.
.orbital-chips__templates {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  visibility: hidden;
}

.orbital-chips__chip {
  display: inline-flex;
  align-items: center;
  font-family: var(--font-family-mono);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: var(--tracking-micro);
  padding: 8px 14px;
  border-radius: var(--radius-pill);
  background: rgba(var(--color-brand-violet-rgb), 0.16);
  border: 1px solid rgba(var(--color-brand-violet-rgb), 0.38);
  color: var(--color-text-primary);
  backdrop-filter: blur(14px);
  box-shadow:
    0 6px 24px rgba(0, 0, 0, 0.4),
    0 0 22px rgba(var(--color-brand-purple-rgb), 0.28);
  white-space: nowrap;
  user-select: none;
  visibility: visible;
}
</style>
