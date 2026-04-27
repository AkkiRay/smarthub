<template>
  <div
    ref="rootEl"
    class="ambient-mesh"
    :class="{ 'ambient-mesh--paused': paused }"
    aria-hidden="true"
  >
    <!-- 2-layer ambient glow для cinematic depth (без отдельных DOM-элементов
         за счёт ::before / ::after на root'е — см. SCSS ниже). -->
    <canvas ref="canvasEl" class="ambient-mesh__canvas" />
  </div>
</template>

<script setup lang="ts">
/**
 * @fileoverview AmbientMesh — декоративная 3D-сцена для hero-секций.
 *
 * Cinematic-minimalism: dual-shell wireframe + 7 accent dots по Fibonacci-
 * lattice + Lissajous tilt. Тот же визуальный язык что JarvisOrb (без voice-mode).
 *
 * Оптимизации:
 *  - IntersectionObserver: вращение остановлено когда elem off-screen.
 *  - PageVisibilityAPI: останавливаем при minimize'е окна.
 *  - motionLevel === 'off' / 'reduced': статичный кадр.
 *  - DPR clamp = min(devicePixelRatio, 2): 4К Retina не утекает GPU.
 */

import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { useUiStore } from '@/stores/ui';
import { BRAND_HEX } from '@/constants/brandColors';

interface Props {
  /** Detail у IcosahedronGeometry. 2 — оптимально по плотности. */
  detail?: number;
  /** Базовый цвет outer-shell. */
  color?: number;
  /** Цвет inner-shell. */
  innerColor?: number;
  /** Цвет accent-dots. */
  accent?: number;
  /** Speed-multiplier (rad/s). База 0.04 = 0.6°/frame на 60fps. */
  speed?: number;
}

const props = withDefaults(defineProps<Props>(), {
  detail: 2,
  color: BRAND_HEX.violet,
  innerColor: BRAND_HEX.purple,
  accent: BRAND_HEX.amber,
  speed: 1,
});

const ui = useUiStore();
const { motionLevel } = storeToRefs(ui);

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl');

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let group: THREE.Group | null = null;
let outerWire: THREE.LineSegments | null = null;
let innerWire: THREE.LineSegments | null = null;
let dots: THREE.Points | null = null;
let resizeObs: ResizeObserver | null = null;
let intersectObs: IntersectionObserver | null = null;
let visibilityHandler: (() => void) | null = null;
let tickerFn: (() => void) | null = null;

const paused = ref(false);
let visible = false;
let documentVisible = !document.hidden;

// Базовая скорость снижена с 0.06 до 0.04 — кинематографично.
const BASE_SPEED = 0.04;
const ACCENT_COUNT = 7;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function shouldRun(): boolean {
  if (motionLevel.value === 'off') return false;
  if (!visible || !documentVisible) return false;
  return true;
}

function syncTicker(): void {
  paused.value = !shouldRun();
}

/** Fibonacci-lattice vertex (равномерное распределение на единичной сфере). */
function fibonacciPoint(i: number, total: number): THREE.Vector3 {
  const y = 1 - (2 * (i + 0.5)) / total;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const az = i * GOLDEN_ANGLE;
  return new THREE.Vector3(Math.cos(az) * r, y, Math.sin(az) * r);
}

function init(): void {
  if (!rootEl.value || !canvasEl.value) return;
  const w = rootEl.value.clientWidth;
  const h = rootEl.value.clientHeight;
  if (w === 0 || h === 0) return;

  scene = new THREE.Scene();
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

  group = new THREE.Group();
  scene.add(group);

  // === Outer shell: wireframe icosphere, тонкие линии =====================
  const outerGeo = new THREE.IcosahedronGeometry(1.4, props.detail);
  const outerWireGeo = new THREE.WireframeGeometry(outerGeo);
  const outerMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(props.color),
    transparent: true,
    opacity: 0.42,
  });
  outerWire = new THREE.LineSegments(outerWireGeo, outerMat);
  group.add(outerWire);

  // === Inner shell: counter-rotate, более яркий ==========================
  const innerGeo = new THREE.IcosahedronGeometry(0.85, 1);
  const innerWireGeo = new THREE.WireframeGeometry(innerGeo);
  const innerMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(props.innerColor),
    transparent: true,
    opacity: 0.6,
  });
  innerWire = new THREE.LineSegments(innerWireGeo, innerMat);
  group.add(innerWire);

  // === Accent dots: 7 штук по Fibonacci-lattice на outer sphere ==========
  const positions = new Float32Array(ACCENT_COUNT * 3);
  for (let i = 0; i < ACCENT_COUNT; i++) {
    const v = fibonacciPoint(i, ACCENT_COUNT).multiplyScalar(1.4);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }
  const dotsGeo = new THREE.BufferGeometry();
  dotsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const dotsMat = new THREE.PointsMaterial({
    color: new THREE.Color(props.accent),
    size: 0.07,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  dots = new THREE.Points(dotsGeo, dotsMat);
  group.add(dots);

  outerGeo.dispose();
  innerGeo.dispose();

  tickerFn = () => {
    if (!scene || !renderer || !camera || !group || !outerWire || !innerWire) return;
    if (!shouldRun()) return;
    const tSec = performance.now() / 1000;
    const dt = gsap.ticker.deltaRatio() / 60;
    const k = BASE_SPEED * props.speed * (motionLevel.value === 'reduced' ? 0.3 : 1);

    // Outer: slow Y-spin + Lissajous X-tilt (non-repetitive).
    outerWire.rotation.y += k * dt;
    const lissX = Math.sin(tSec * 0.31) * 0.16 + Math.sin(tSec * 0.13) * 0.07;
    outerWire.rotation.x += (lissX - outerWire.rotation.x) * 0.04;

    // Inner: counter-rotate в 1.6× быстрее, по обоим осям.
    innerWire.rotation.y -= k * 1.6 * dt;
    innerWire.rotation.x += k * 1.0 * dt;
    innerWire.scale.setScalar(1 + Math.sin(tSec * 1.2) * 0.06);

    // Dots ездят с outer (rotate same axis), отдельный subtle pulse.
    if (dots) {
      dots.rotation.copy(outerWire.rotation);
      const dotsMaterial = dots.material as THREE.PointsMaterial;
      dotsMaterial.size = 0.07 + Math.abs(Math.sin(tSec * 0.78)) * 0.025;
    }

    // Group breath — subtle scale через synthesized 8s-период.
    const breath = 1 + Math.sin(tSec * 0.78) * 0.018;
    group.scale.setScalar(breath);

    renderer.render(scene, camera);
  };
  gsap.ticker.add(tickerFn);

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

  intersectObs = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry) return;
      visible = entry.isIntersecting;
      syncTicker();
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
  outerWire?.geometry.dispose();
  (outerWire?.material as THREE.Material | undefined)?.dispose();
  innerWire?.geometry.dispose();
  (innerWire?.material as THREE.Material | undefined)?.dispose();
  dots?.geometry.dispose();
  (dots?.material as THREE.Material | undefined)?.dispose();
  renderer?.dispose();
  scene = null;
  camera = null;
  renderer = null;
  group = null;
  outerWire = null;
  innerWire = null;
  dots = null;
});
</script>

<style scoped lang="scss">
.ambient-mesh {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  // Drop-shadow для multi-layer glow без отдельных DOM-нодов. 24px blur даёт
  // soft halo вокруг wireframe — premium-feel вместо плоского canvas'а.
  filter: drop-shadow(0 0 28px rgba(var(--color-brand-violet-rgb), 0.35))
    drop-shadow(0 0 48px rgba(var(--color-brand-pink-rgb), 0.18));
  opacity: 0.95;

  // Soft ambient backlight — тонкий radial glow за canvas'ом, добавляет depth.
  &::before {
    content: '';
    position: absolute;
    inset: -10%;
    background: radial-gradient(
      circle at 50% 50%,
      rgba(var(--color-brand-violet-rgb), 0.18) 0%,
      transparent 60%
    );
    filter: blur(40px);
    z-index: 0;
    pointer-events: none;
  }

  &--paused {
    // Paused: dim canvas, keep last rendered frame.
    opacity: 0.55;
  }

  &__canvas {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    z-index: 1;
  }
}

[data-motion='off'] .ambient-mesh {
  filter: none;
  opacity: 0.5;
  &::before {
    display: none;
  }
}
</style>
