<template>
  <div
    ref="rootEl"
    class="orb"
    :class="[`orb--${size}`, `orb--${state}`, { 'is-pulsing': pulsing, 'is-hovered': hovered }]"
    :aria-hidden="true"
    @click="onClick"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <span class="orb__halo" />
    <span class="orb__ring" />
    <canvas ref="canvasEl" class="orb__canvas" />
  </div>
</template>

<script setup lang="ts">
// 3D-globe на Three.js: icosphere wireframe + points + контр-спинящееся ядро.
// mousemove → tilt; hover → ×1.7 spin; click → impulse + pulse + ring;
// reduce-motion → spin ×0.4 (не 0).

import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import * as THREE from 'three';
import { useUiStore } from '@/stores/ui';
import { BRAND_HEX } from '@/constants/brandColors';

interface Props {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
  state?: 'idle' | 'active' | 'error';
  /** Слушать движение мыши по всему окну. */
  trackWindow?: boolean;
  /** Detail у IcosahedronGeometry (1-4). 3 — оптимально по плотности/перфу. */
  detail?: number;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  state: 'idle',
  trackWindow: false,
  detail: 3,
});

const ui = useUiStore();
const { reduceMotion } = storeToRefs(ui);

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl');

const hovered = ref(false);
const pulsing = ref(false);

// Three.js state — нереактивно, иначе Vue triggers per-frame.
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let group: THREE.Group | null = null;
let core: THREE.LineSegments | null = null;

let wireMat: THREE.LineBasicMaterial | null = null;
let pointsMat: THREE.PointsMaterial | null = null;
let coreMat: THREE.LineBasicMaterial | null = null;

let raf = 0;
let resizeObs: ResizeObserver | null = null;

// Rotation state.
let curRotY = 0;
let curRotX = 0;
let velY = 0; // импульс от click

// Mouse [-1..1].
let mouseX = 0;
let mouseY = 0;
let lastMouseAt = performance.now();

// Pulse-scale релакс к 1.
let pulseScale = 1;

// 0xRRGGBB-int'ы из constants/brandColors — JS-сцена и SCSS-токены не расходятся.
const palette = computed<{ wire: number; points: number; core: number }>(() => {
  if (props.state === 'error') {
    return { wire: BRAND_HEX.danger, points: BRAND_HEX.orange, core: BRAND_HEX.warning };
  }
  if (props.state === 'active') {
    return { wire: BRAND_HEX.purple, points: BRAND_HEX.pink, core: BRAND_HEX.purpleHi };
  }
  return { wire: BRAND_HEX.violet, points: BRAND_HEX.purple, core: BRAND_HEX.purpleSoft };
});

function init(): void {
  const el = rootEl.value;
  const canvas = canvasEl.value;
  if (!el || !canvas) return;

  const w = el.clientWidth || 1;
  const h = el.clientHeight || 1;

  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  camera.position.set(0, 0, 4.2);

  group = new THREE.Group();
  scene.add(group);

  const sphereGeo = new THREE.IcosahedronGeometry(1.4, props.detail);

  const wireGeo = new THREE.WireframeGeometry(sphereGeo);
  wireMat = new THREE.LineBasicMaterial({
    color: palette.value.wire,
    transparent: true,
    opacity: 0.45,
  });
  const wire = new THREE.LineSegments(wireGeo, wireMat);
  group.add(wire);

  // Points на вершинах icosphere.
  const pointsGeo = new THREE.BufferGeometry();
  pointsGeo.setAttribute('position', sphereGeo.getAttribute('position'));
  pointsMat = new THREE.PointsMaterial({
    color: palette.value.points,
    size: 0.05,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(pointsGeo, pointsMat);
  group.add(points);

  // Внутреннее ядро (контр-спин).
  const coreSphere = new THREE.IcosahedronGeometry(0.55, 1);
  const coreWire = new THREE.WireframeGeometry(coreSphere);
  coreMat = new THREE.LineBasicMaterial({
    color: palette.value.core,
    transparent: true,
    opacity: 0.6,
  });
  core = new THREE.LineSegments(coreWire, coreMat);
  group.add(core);

  // sphereGeo уже клонирован в wire/points — освобождаем промежуточные.
  sphereGeo.dispose();
  coreSphere.dispose();
}

function animate(): void {
  if (!renderer || !scene || !camera || !group) return;

  let baseSpin = 0.004;
  if (props.state === 'active') baseSpin = 0.008;
  if (props.state === 'error') baseSpin = 0.014;
  if (hovered.value) baseSpin *= 1.7;
  if (reduceMotion.value) baseSpin *= 0.4;

  // Idle drift: гасим mouse-влияние через 2с без движения.
  if (performance.now() - lastMouseAt > 2000) {
    mouseX *= 0.96;
    mouseY *= 0.96;
  }

  const targetRotY = mouseX * 0.6;
  const targetRotX = mouseY * 0.5;

  curRotY += (targetRotY - curRotY) * 0.06 + velY + baseSpin;
  curRotX += (targetRotX - curRotX) * 0.06;
  curRotX = Math.max(-0.55, Math.min(0.55, curRotX));

  velY *= 0.94; // damping импульса
  pulseScale += (1 - pulseScale) * 0.12; // релакс к 1

  group.rotation.y = curRotY;
  group.rotation.x = curRotX;
  group.scale.setScalar(pulseScale);

  // Core крутится против group, быстрее.
  if (core) {
    core.rotation.y -= baseSpin * 2.5;
    core.rotation.x += baseSpin * 1.5;
  }

  renderer.render(scene, camera);
  raf = requestAnimationFrame(animate);
}

function handleResize(): void {
  if (!renderer || !camera || !rootEl.value) return;
  const w = rootEl.value.clientWidth || 1;
  const h = rootEl.value.clientHeight || 1;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function onMouseMove(e: MouseEvent): void {
  let cx0: number;
  let cy0: number;
  let w: number;
  let h: number;

  if (props.trackWindow) {
    cx0 = window.innerWidth / 2;
    cy0 = window.innerHeight / 2;
    w = window.innerWidth / 2;
    h = window.innerHeight / 2;
  } else if (rootEl.value) {
    const r = rootEl.value.getBoundingClientRect();
    cx0 = r.left + r.width / 2;
    cy0 = r.top + r.height / 2;
    w = (r.width / 2) * 1.6;
    h = (r.height / 2) * 1.6;
  } else return;

  mouseX = Math.max(-1, Math.min(1, (e.clientX - cx0) / w));
  mouseY = Math.max(-1, Math.min(1, (e.clientY - cy0) / h));
  lastMouseAt = performance.now();
}

function onClick(): void {
  pulsing.value = false;
  requestAnimationFrame(() => {
    pulsing.value = true;
  });
  setTimeout(() => {
    pulsing.value = false;
  }, 700);

  velY += 0.18;
  pulseScale = 1.12;
}

// Реактивная palette → обновляем materials без re-init сцены.
watch(palette, (p) => {
  wireMat?.color.setHex(p.wire);
  pointsMat?.color.setHex(p.points);
  coreMat?.color.setHex(p.core);
});

onMounted(() => {
  init();
  raf = requestAnimationFrame(animate);

  const target: Window | HTMLElement | null = props.trackWindow ? window : rootEl.value;
  target?.addEventListener('mousemove', onMouseMove as EventListener, { passive: true });

  if (rootEl.value) {
    resizeObs = new ResizeObserver(handleResize);
    resizeObs.observe(rootEl.value);
  }
});

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf);
  const target: Window | HTMLElement | null = props.trackWindow ? window : rootEl.value;
  target?.removeEventListener('mousemove', onMouseMove as EventListener);

  resizeObs?.disconnect();

  // Полный teardown GPU-ресурсов.
  if (group) {
    group.traverse((obj) => {
      if (obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
        obj.geometry.dispose();
      }
    });
  }
  wireMat?.dispose();
  pointsMat?.dispose();
  coreMat?.dispose();
  renderer?.dispose();

  renderer = null;
  scene = null;
  camera = null;
  group = null;
  core = null;
  wireMat = null;
  pointsMat = null;
  coreMat = null;
});
</script>

<style scoped lang="scss">
.orb {
  --orb-size: 80px;
  --orb-glow: rgba(var(--color-brand-purple-rgb), 0.55);
  --orb-glow-2: rgba(var(--color-brand-pink-rgb), 0.45);

  position: relative;
  width: var(--orb-size);
  height: var(--orb-size);
  flex-shrink: 0;
  display: inline-block;
  isolation: isolate;
  cursor: pointer;
  transition: transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1);

  &--sm {
    --orb-size: 40px;
  }
  &--md {
    --orb-size: 80px;
  }
  &--lg {
    --orb-size: 220px;
  }
  &--xl {
    --orb-size: clamp(280px, 32vw, 420px);
  }
  &--hero {
    --orb-size: clamp(340px, 46vw, 600px);
  }

  &--idle {
    --orb-glow: rgba(var(--color-brand-violet-rgb), 0.42);
    --orb-glow-2: rgba(var(--color-brand-purple-rgb), 0.32);
  }
  &--active {
    --orb-glow: rgba(var(--color-brand-purple-rgb), 0.7);
    --orb-glow-2: rgba(var(--color-brand-pink-rgb), 0.55);
  }
  &--error {
    --orb-glow: rgba(255, 85, 119, 0.6);
    --orb-glow-2: rgba(255, 138, 77, 0.5);
  }

  &.is-hovered {
    transform: scale(1.02);
  }
  &.is-pulsing {
    .orb__ring {
      animation: orbRingPulse 700ms ease-out forwards;
    }
  }
}

.orb__halo {
  position: absolute;
  inset: -22%;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 50%, var(--orb-glow) 0%, transparent 55%),
    radial-gradient(circle at 70% 30%, var(--orb-glow-2) 0%, transparent 50%);
  filter: blur(24px);
  opacity: 0.65;
  z-index: -1;
  pointer-events: none;
  animation: orbHalo 5s ease-in-out infinite alternate;
}

// Ring — расходящаяся волна на click.
.orb__ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--orb-glow-2), white 25%);
  box-shadow: 0 0 16px var(--orb-glow-2);
  opacity: 0;
  pointer-events: none;
}

.orb__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

@keyframes orbHalo {
  0% {
    opacity: 0.45;
    transform: scale(0.96);
  }
  100% {
    opacity: 0.8;
    transform: scale(1.06);
  }
}
@keyframes orbRingPulse {
  0% {
    opacity: 0.85;
    transform: scale(0.98);
  }
  100% {
    opacity: 0;
    transform: scale(1.45);
  }
}
</style>
