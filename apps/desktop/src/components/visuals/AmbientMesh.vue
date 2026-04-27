<template>
  <div ref="rootEl" class="ambient-mesh" :class="{ 'ambient-mesh--paused': paused }" aria-hidden="true">
    <canvas ref="canvasEl" class="ambient-mesh__canvas" />
  </div>
</template>

<script setup lang="ts">
/**
 * @fileoverview AmbientMesh — wireframe icosphere для hero-секций.
 *
 * Three.js IcosahedronGeometry + LineSegments / Points с brand-color material'ом.
 * Оптимизации:
 *  - IntersectionObserver: вращение остановлено когда elem off-screen.
 *  - PageVisibilityAPI: останавливаем при minimize'е окна.
 *  - motionLevel === 'off' / 'reduced': статичный кадр без ticker'а.
 *  - DPR clamp = min(devicePixelRatio, 2): на 4К Retina не утекаем GPU.
 */

import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { useUiStore } from '@/stores/ui';

interface Props {
  /** Detail у IcosahedronGeometry. 2 — оптимально по плотности. */
  detail?: number;
  /** Базовый цвет линий — hex. По умолчанию brand-violet. */
  color?: string;
  /** Вторичный цвет (для cross-fade). По умолчанию brand-yellow. */
  accent?: string;
  /** Speed-multiplier (rad/s). Базовая 0.06 = ~0.95°/frame на 60fps. */
  speed?: number;
}

const props = withDefaults(defineProps<Props>(), {
  detail: 2,
  color: '#6e54ff',
  accent: '#ffcc00',
  speed: 1,
});

const ui = useUiStore();
const { motionLevel } = storeToRefs(ui);

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl');

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let mesh: THREE.LineSegments | null = null;
let pointsCloud: THREE.Points | null = null;
let resizeObs: ResizeObserver | null = null;
let intersectObs: IntersectionObserver | null = null;
let visibilityHandler: (() => void) | null = null;
let tickerFn: (() => void) | null = null;

const paused = ref(false);
let visible = false;
let documentVisible = !document.hidden;

const BASE_SPEED = 0.06;

function shouldRun(): boolean {
  if (motionLevel.value === 'off') return false;
  if (!visible || !documentVisible) return false;
  return true;
}

function syncTicker(): void {
  paused.value = !shouldRun();
}

function init(): void {
  if (!rootEl.value || !canvasEl.value) return;
  const w = rootEl.value.clientWidth;
  const h = rootEl.value.clientHeight;
  if (w === 0 || h === 0) return;

  scene = new THREE.Scene();
  // Distance: 5 единиц от центра — достаточно, чтобы IcosahedronGeometry r=1 заполнила кадр.
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  camera.position.z = 4;

  renderer = new THREE.WebGLRenderer({
    canvas: canvasEl.value,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 0);

  // Wireframe icosphere: EdgesGeometry даёт чистые линии без диагональных артефактов.
  const geometry = new THREE.IcosahedronGeometry(1.4, props.detail);
  const edges = new THREE.EdgesGeometry(geometry);
  const lineMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(props.color),
    transparent: true,
    opacity: 0.55,
  });
  mesh = new THREE.LineSegments(edges, lineMaterial);
  scene.add(mesh);

  // Точки в вершинах: усиление визуальной массы + accent-цвет.
  const pointsMaterial = new THREE.PointsMaterial({
    color: new THREE.Color(props.accent),
    size: 0.045,
    transparent: true,
    opacity: 0.75,
    sizeAttenuation: true,
  });
  pointsCloud = new THREE.Points(geometry, pointsMaterial);
  scene.add(pointsCloud);

  tickerFn = () => {
    if (!scene || !renderer || !camera || !mesh || !pointsCloud) return;
    if (!shouldRun()) return;
    const dt = gsap.ticker.deltaRatio() / 60;
    const k = BASE_SPEED * props.speed * (motionLevel.value === 'reduced' ? 0.3 : 1);
    mesh.rotation.x += k * dt;
    mesh.rotation.y += k * 1.4 * dt;
    pointsCloud.rotation.copy(mesh.rotation);
    renderer.render(scene, camera);
  };
  gsap.ticker.add(tickerFn);

  // Размер canvas-buffer'а синхронен с layout-размером root'а.
  resizeObs = new ResizeObserver(() => {
    if (!rootEl.value || !renderer || !camera) return;
    const W = rootEl.value.clientWidth;
    const H = rootEl.value.clientHeight;
    if (W === 0 || H === 0) return;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  });
  resizeObs.observe(rootEl.value);

  // Off-screen pause: ticker не рендерит когда mesh не виден в viewport'е.
  intersectObs = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry) return;
      visible = entry.isIntersecting;
      syncTicker();
      // Делаем один кадр после возврата в видимость, чтобы canvas был свежий.
      if (visible && tickerFn) tickerFn();
    },
    { threshold: 0.01 },
  );
  intersectObs.observe(rootEl.value);

  visibilityHandler = () => {
    documentVisible = !document.hidden;
    syncTicker();
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  // Один кадр при mount'е, чтобы статичная сцена была видна сразу.
  tickerFn();
}

watch(motionLevel, syncTicker);

onMounted(init);

onBeforeUnmount(() => {
  if (tickerFn) gsap.ticker.remove(tickerFn);
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  resizeObs?.disconnect();
  intersectObs?.disconnect();
  mesh?.geometry.dispose();
  if (mesh && Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
  else (mesh?.material as THREE.Material | undefined)?.dispose();
  pointsCloud?.geometry.dispose();
  (pointsCloud?.material as THREE.Material | undefined)?.dispose();
  renderer?.dispose();
  scene = null;
  camera = null;
  renderer = null;
  mesh = null;
  pointsCloud = null;
});
</script>

<style scoped lang="scss">
.ambient-mesh {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  filter: blur(0.3px) drop-shadow(0 0 24px rgba(var(--color-brand-violet-rgb), 0.32));
  opacity: 0.95;

  &--paused {
    // Keep canvas frame, dim чтоб не отвлекать когда документ скрыт.
    opacity: 0.6;
  }

  &__canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
}

[data-motion='off'] .ambient-mesh {
  filter: none;
  opacity: 0.5;
}
</style>
