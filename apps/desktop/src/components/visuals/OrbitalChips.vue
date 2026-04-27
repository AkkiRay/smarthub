<template>
  <div ref="rootEl" class="orbital-chips" :aria-hidden="true">
    <div ref="cssEl" class="orbital-chips__layer" />
    <div ref="templatesEl" class="orbital-chips__templates">
      <span v-for="tag in chips" :key="tag.id" class="orbital-chips__chip">
        <BrandMark :brand="tag.id" size="sm" />
        <span class="orbital-chips__chip-label">{{ tag.label }}</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
// 3D satellite-orbit chips вокруг JarvisOrb через CSS3DRenderer.
//
// Каждый chip — независимый «спутник» на собственной наклонной орбите.
// Стартовые позиции — Fibonacci-lattice (golden-angle distribution на сфере),
// гарантирует max-min angular distance вне зависимости от количества chips.
//
// Per-chip параметры:
//   - unit-vector starting position (Fibonacci point),
//   - orbit-axis с tilt'ом ≤26° от world-Y,
//   - speed 0.7×–1.3× от base, направление prograde/retrograde,
//   - phase offset.
//
// DOF: back-side (Z < 0) → scale 0.62×, opacity 35%; front → 1.0×, 100%.
// Z-index синхронно через depth (CSS3DSprite painter-sort не делает).
//
// CSS3DSprite — billboard, chip всегда face-камера.
// GSAP ticker — единый rAF на orbits + DOF + render + parallax.

import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue';
import { storeToRefs } from 'pinia';
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { gsap } from 'gsap';
import { useUiStore } from '@/stores/ui';
import BrandMark from './BrandMark.vue';

/**
 * Чип вокруг орба: пара (driver-id, label). ID — ключ для BrandMark
 * (SVG из реестра + accent-цвет из driverPalette).
 */
export interface OrbitalChip {
  id: string;
  label: string;
}

interface Props {
  chips?: OrbitalChip[];
}
const props = withDefaults(defineProps<Props>(), {
  chips: () => [
    { id: 'yeelight', label: 'Yeelight' },
    { id: 'hue', label: 'Hue' },
    { id: 'tuya', label: 'Tuya' },
    { id: 'sber-home', label: 'Сбер' },
    { id: 'wiz', label: 'WiZ' },
    { id: 'shelly', label: 'Shelly' },
    { id: 'miio', label: 'Mi Home' },
    { id: 'matter', label: 'Matter' },
  ],
});

const ui = useUiStore();
const { motionLevel } = storeToRefs(ui);

// Speed-multiplier по motionLevel: off=0, reduced=0.25, standard=1, full=1.15.
const RING_SPEED: Record<string, number> = {
  off: 0,
  reduced: 0.25,
  standard: 1,
  full: 1.15,
};

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const cssEl = useTemplateRef<HTMLElement>('cssEl');
const templatesEl = useTemplateRef<HTMLElement>('templatesEl');

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: CSS3DRenderer | null = null;
let orbitRadius = 0; // World-радиус сферы по размеру root'а.
let resizeObs: ResizeObserver | null = null;
let onPointerMove: ((e: PointerEvent) => void) | null = null;
let tickerFn: (() => void) | null = null;

// Helpers разделены между init() и resize-handler'ом.
function computeOrbitRadius(w: number, h: number): number {
  const halfMin = Math.max(80, Math.min(w, h) / 2);
  const focalPx = (h / 2) / Math.tan((CAMERA_FOV_DEG * Math.PI / 180) / 2);
  const safeWorld = ((halfMin - CHIP_HALF_PX) * CAMERA_DIST) / focalPx;
  return safeWorld * ORBIT_RADIUS_FRAC;
}

// Camera: FOV 50°, dist 700.
const CAMERA_FOV_DEG = 50;
const CAMERA_DIST = 700;
// Полуширина крупного чипа в CSS-pixels — safety-margin от края бокса.
const CHIP_HALF_PX = 56;
// Доля safe-радиуса до центра шара: 0.92 даёт visual gap от края.
const ORBIT_RADIUS_FRAC = 0.92;
// Базовая угловая скорость в rad/s. Per-chip множители 0.7×–1.3×, направление ±.
const BASE_SPEED = 0.05;
// DOF scale: front-chip = 1.0, back-chip = 0.62.
const DOF_SCALE_MIN = 0.62;
// DOF opacity: front = 1.0, back = 0.35.
const DOF_OPACITY_MIN = 0.35;

// Orbit-state per chip: initial position через Fibonacci-lattice (равномерное
// распределение на единичной сфере) + per-chip ось вращения с tilt'ом.
interface OrbitState {
  sprite: CSS3DSprite;
  initial: THREE.Vector3; // unit-vector
  axis: THREE.Vector3;    // unit-vector; ось вращения орбиты
  speed: number;          // rad/s, может быть отрицательной (retrograde)
  angle: number;          // текущий угол поворота вокруг axis
  mountDelay: number;     // сек до старта fade-in (stagger)
  mountElapsed: number;   // сек с момента mount'а — для smooth fade-in factor
}

const orbits: OrbitState[] = [];

// Golden-angle (~137.5°) — min-max-distance distribution на сфере (Vogel 1979).
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Fibonacci-lattice positioning + per-chip tilted orbit axis.
 * Возвращает unit-vector starting position и единичную ось вращения.
 * Сдвиг `i + 0.5` в формуле y избегает exact-poles (y = ±1).
 */
function fibonacciOrbit(i: number, total: number): { initial: THREE.Vector3; axis: THREE.Vector3 } {
  const y = 1 - (2 * (i + 0.5)) / total;
  const radiusXZ = Math.sqrt(Math.max(0, 1 - y * y));
  const azimuth = i * GOLDEN_ANGLE;
  const initial = new THREE.Vector3(
    Math.cos(azimuth) * radiusXZ,
    y,
    Math.sin(azimuth) * radiusXZ,
  );
  // Per-chip orbit axis: лёгкий tilt от world-Y, направление зависит от i.
  // Magnitude ≤ 0.45 rad (≈26°), чтобы орбит-плейн оставался в safe-радиусе.
  const tiltX = Math.sin(i * 0.73) * 0.32;
  const tiltZ = Math.cos(i * 0.91) * 0.32;
  const axis = new THREE.Vector3(tiltX, 1, tiltZ).normalize();
  return { initial, axis };
}

function init(): void {
  if (!rootEl.value || !cssEl.value || !templatesEl.value) return;
  const w = rootEl.value.clientWidth;
  const h = rootEl.value.clientHeight;
  if (w === 0 || h === 0) return;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, w / h, 0.1, 2000);
  camera.position.set(0, 0, CAMERA_DIST);

  renderer = new CSS3DRenderer();
  renderer.setSize(w, h);
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.pointerEvents = 'none';
  cssEl.value.appendChild(renderer.domElement);

  const chipEls = Array.from(
    templatesEl.value.querySelectorAll<HTMLElement>('.orbital-chips__chip'),
  );
  orbitRadius = computeOrbitRadius(w, h);

  for (let i = 0; i < chipEls.length; i++) {
    const el = chipEls[i]!;
    // CSS3DSprite — billboard: chip face-камера, анимируем только position.
    const sprite = new CSS3DSprite(el);
    const { initial, axis } = fibonacciOrbit(i, chipEls.length);
    // Per-chip speed: 0.7×–1.3× от BASE_SPEED, чётные prograde, нечётные retrograde.
    const speedMult = 0.7 + ((i * 0.37) % 1) * 0.6;
    const direction = i % 2 === 0 ? 1 : -1;
    // Phase offset разводит chips по разным углам на старте.
    const phase = (i * 1.618) % (Math.PI * 2);

    // Стартовая opacity 0 — ticker поднимет её через mount-fade фактор.
    sprite.element.style.opacity = '0';
    scene.add(sprite);
    orbits.push({
      sprite,
      initial,
      axis,
      speed: BASE_SPEED * speedMult * direction,
      angle: phase,
      mountDelay: 0.18 + i * 0.06,
      mountElapsed: 0,
    });
  }

  // Parallax: pointermove → tween scene.rotation. Off/reduced — выключен.
  onPointerMove = (e) => {
    if (!scene) return;
    if (motionLevel.value === 'off' || motionLevel.value === 'reduced') return;
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

  // Single ticker: все орбиты + DOF + render.
  // dt — секунды: deltaRatio() = deltaMs / 16.67, делим на 60 (BASE_SPEED в rad/s).
  tickerFn = () => {
    if (!scene || !renderer || !camera) return;
    const dt = gsap.ticker.deltaRatio() / 60;
    const speedMult = RING_SPEED[motionLevel.value] ?? 1;

    for (const orbit of orbits) {
      orbit.angle += orbit.speed * dt * speedMult;
      // Position = initial, повёрнутый вокруг axis на angle, scale до orbit-радиуса.
      // applyAxisAngle мутирует — клонируем.
      const pos = orbit.initial.clone().applyAxisAngle(orbit.axis, orbit.angle);
      pos.multiplyScalar(orbitRadius);
      orbit.sprite.position.copy(pos);

      // DOF: depth ∈ [0, 1], нормализован pos.z от [-orbitRadius, +orbitRadius].
      const depth = (pos.z + orbitRadius) / (2 * orbitRadius);
      const scale = DOF_SCALE_MIN + depth * (1 - DOF_SCALE_MIN);
      orbit.sprite.scale.set(scale, scale, 1);
      // Z-index по depth: ручной painter-sort для CSS3DSprite.
      orbit.sprite.element.style.zIndex = String(Math.round(depth * 1000));

      // Mount-fade × DOF-opacity. Mount-фактор 0→1 за 0.6с после личного delay'а (stagger).
      orbit.mountElapsed += dt;
      const sinceStart = Math.max(0, orbit.mountElapsed - orbit.mountDelay);
      const mountFactor = Math.min(1, sinceStart / 0.6);
      // power2.out easing: 1 - (1 - t)^2.
      const mountEased = 1 - (1 - mountFactor) * (1 - mountFactor);
      const dofOpacity = DOF_OPACITY_MIN + depth * (1 - DOF_OPACITY_MIN);
      orbit.sprite.element.style.opacity = String(mountEased * dofOpacity);
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
    // Пересчёт только радиуса; позиции — на следующем tick'е.
    orbitRadius = computeOrbitRadius(W, H);
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
  orbits.length = 0;
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
// в renderer.domElement; data-v scoped attribute сохраняется при move.
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
  gap: 8px;
  font-family: var(--font-family-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: var(--tracking-micro);
  padding: 7px 13px 7px 9px;
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

.orbital-chips__chip :deep(.brand-mark) {
  color: var(--color-brand-purple);
}

.orbital-chips__chip-label {
  font-weight: 600;
}
</style>
