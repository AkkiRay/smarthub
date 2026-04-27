<template>
  <div
    ref="rootEl"
    class="orb"
    :class="[
      `orb--${size}`,
      `orb--${state}`,
      voiceMode ? 'orb--voice' : null,
      voiceMode ? `orb--voice-${voiceState}` : null,
      withSpectrum ? 'orb--spectrum' : null,
      ambient ? 'orb--ambient' : null,
    ]"
    :aria-hidden="true"
  >
    <!-- Многослойный halo: 3 уровня с разным blur'ом и сдвигом hue для
         хроматического «lens-feel». Не дёргается синхронно — у каждого
         собственный период. -->
    <span class="orb__halo orb__halo--inner" />
    <span class="orb__halo orb__halo--mid" />
    <span class="orb__halo orb__halo--wide" />

    <!-- Rim-light: тонкая conic-gradient полоска по периметру, медленно
         вращается. Сигнатурный «lens flare» эффект — заменяет 3 broadcast-
         кольца, которые ощущались датированными (~2018 trend). -->
    <span class="orb__rim" />

    <!-- Three.js canvas: outer + inner shells + accent points. -->
    <canvas ref="canvasEl" class="orb__canvas" />

    <!-- Click ring (одноразовый — резервный hook, kept для визуального
         feedback'а если в будущем понадобится). -->
    <span class="orb__ring" />

    <!-- Spectrum analyzer: 14 баров (было 28). Появляется только на
         speaking — остальные voice-states получают свои элементы ниже. -->
    <div v-if="withSpectrum" class="orb__spectrum" aria-hidden="true">
      <span v-for="n in SPECTRUM_BARS" :key="n" class="orb__spectrum-wrap" :style="{ '--i': n }">
        <i class="orb__spectrum-bar" />
      </span>
    </div>

    <!-- Listening: одиночный core-pulse в центре (вместо 28 spectrum баров).
         Чёткий фокус: «жду команду». -->
    <span v-if="voiceMode && voiceState === 'listening'" class="orb__pulse" aria-hidden="true" />

    <!-- Busy: одиночная scan-дуга по halo вместо sweep'а по spectrum'у. -->
    <span v-if="voiceMode && voiceState === 'busy'" class="orb__scan" aria-hidden="true" />
  </div>
</template>

<script setup lang="ts">
/**
 * @fileoverview JarvisOrb — 3D-сфера на Three.js с layered halo, rim-light
 * и voice-reactive режимами. Cinematic-minimalism: медленные движения,
 * volumetric glow, единичные сигналы вместо busy-spectrum'а.
 *
 * Архитектура геометрии:
 *  - outer shell: wireframe icosphere detail=props.detail, radius=1.4
 *  - inner shell: wireframe icosphere detail=2, radius=0.85, counter-rotate
 *  - accent points: 7 штук по Fibonacci-lattice на outer sphere
 *
 * Animation:
 *  - base spin вокруг Y (0.005 rad/frame standard)
 *  - Lissajous tilt по X (две синусоиды разных частот → non-repetitive)
 *  - mouse-tilt overrides Lissajous (только в non-voice/non-ambient)
 *  - voice-amp drives: outer opacity, inner scale, halo CSS-var
 *
 * Voice modes (CSS-driven):
 *  - idle    → минимум (только shells + halo breath)
 *  - listening → + core-pulse в центре
 *  - speaking  → + 14-bar spectrum
 *  - busy      → + scan-дуга на halo
 */

import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import * as THREE from 'three';
import { useUiStore } from '@/stores/ui';
import { BRAND_HEX } from '@/constants/brandColors';

/** Голосовое состояние Алисы для voice-reactive режима. */
export type OrbVoiceState = 'idle' | 'listening' | 'speaking' | 'busy';

interface Props {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
  state?: 'idle' | 'active' | 'error';
  /** Слушать движение мыши по всему окну. */
  trackWindow?: boolean;
  /** Detail у IcosahedronGeometry (1-4). 3 — оптимально по плотности/перфу. */
  detail?: number;
  /**
   * Voice-reactive режим: synthetic envelope drives core/halo/wireframe.
   * Отключает mouse-tilt — орб «слушает» Алису, а не курсор.
   */
  voiceMode?: boolean;
  /** Голосовое состояние — определяет огибающую амплитуды и какие layer'ы видны. */
  voiceState?: OrbVoiceState;
  /**
   * Spectrum-анализатор (14 баров) появляется автоматически на voice-mode size ≥ md
   * только во время speaking. Можно форсировать через prop.
   */
  spectrum?: boolean;
  /**
   * Ambient режим (онбординг / hero):
   *   - mouse-tilt отключён, орб «живёт сам»
   *   - Lissajous tilt на двух осях
   *   - rim-light единственный сигнал «передачи» (вместо 3 broadcast-колец)
   * Несовместим с voiceMode (там Алиса задаёт ритм).
   */
  ambient?: boolean;
}

// 14 баров (было 28) — менее «AI-assistant cliché», более изящная волна.
const SPECTRUM_BARS = 14;

// Accent points — 7 штук по Fibonacci-lattice на outer sphere.
const ACCENT_COUNT = 7;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  state: 'idle',
  trackWindow: false,
  detail: 3,
  voiceMode: false,
  voiceState: 'idle',
  spectrum: undefined,
  ambient: false,
});

// Spectrum видим только когда: voice-mode + voiceState='speaking' + size ≥ md.
// Sidebar (sm) исключаем — на 40px бары сливаются. Idle/listening/busy
// получают свои визуальные сигналы (core-pulse / scan-arc) — спектр для них
// не нужен. `spectrum={false}` явно отключает даже на speaking.
const withSpectrum = computed<boolean>(() => {
  if (props.spectrum === false) return false;
  if (!props.voiceMode) return false;
  if (props.voiceState !== 'speaking') return false;
  return props.size === 'md' || props.size === 'lg' || props.size === 'xl' || props.size === 'hero';
});

const ui = useUiStore();
const { reduceMotion } = storeToRefs(ui);

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl');

// Three.js state — нереактивно (Vue triggers per-frame были бы катастрофой).
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let group: THREE.Group | null = null;

let outerWire: THREE.LineSegments | null = null;
let innerWire: THREE.LineSegments | null = null;
let accentDots: THREE.Points | null = null;

let outerMat: THREE.LineBasicMaterial | null = null;
let innerMat: THREE.LineBasicMaterial | null = null;
let dotsMat: THREE.PointsMaterial | null = null;

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

// Pulse-scale релакс к 1 после click'а.
let pulseScale = 1;

// Voice envelope: synthetic «звуковая волна» Алисы. WSS glagol амплитуды не
// отдаёт, генерим сами — глаз воспринимает sum-of-sines как настоящую речь.
let voiceAmp = 0;
let voiceTarget = 0;

/**
 * Огибающая амплитуды:
 *  - idle/busy → 0 (тихо, busy управляется отдельным scan-arc'ом)
 *  - listening → медленный heartbeat (период 1.4s, peak 0.32)
 *  - speaking  → speech-like waveform (3 синуса разных частот + envelope)
 */
function voiceEnvelope(t: number, state: OrbVoiceState): number {
  if (state === 'idle' || state === 'busy') return 0;
  if (state === 'listening') {
    const phase = (t % 1.4) / 1.4;
    return Math.max(0, Math.sin(phase * Math.PI)) * 0.32;
  }
  // speaking: 3 расстроенных синуса + slow envelope-modulation.
  const a = Math.sin(t * 11.0) * 0.42;
  const b = Math.sin(t * 7.3 + 1.7) * 0.34;
  const c = Math.sin(t * 17.5 + 0.9) * 0.22;
  const env = (Math.sin(t * 2.7) + Math.sin(t * 1.1 + 0.5) + 2) / 4;
  return Math.min(1, Math.abs(a + b + c) * env);
}

// 0xRRGGBB-int'ы из shared/BRAND. Voice-mode переопределяет палитру по
// состоянию Алисы — орб «меняет настроение» без CSS-фильтров.
const palette = computed<{ outer: number; inner: number; dots: number }>(() => {
  if (props.state === 'error') {
    return { outer: BRAND_HEX.danger, inner: BRAND_HEX.coral, dots: BRAND_HEX.warning };
  }
  if (props.voiceMode) {
    if (props.voiceState === 'listening') {
      return { outer: BRAND_HEX.cyan, inner: BRAND_HEX.violet, dots: BRAND_HEX.purpleHi };
    }
    if (props.voiceState === 'speaking') {
      return { outer: BRAND_HEX.purple, inner: BRAND_HEX.pink, dots: BRAND_HEX.amber };
    }
    if (props.voiceState === 'busy') {
      return { outer: BRAND_HEX.amber, inner: BRAND_HEX.purple, dots: BRAND_HEX.purpleSoft };
    }
    return { outer: BRAND_HEX.violet, inner: BRAND_HEX.purple, dots: BRAND_HEX.purpleSoft };
  }
  if (props.state === 'active') {
    return { outer: BRAND_HEX.purple, inner: BRAND_HEX.pink, dots: BRAND_HEX.purpleHi };
  }
  return { outer: BRAND_HEX.violet, inner: BRAND_HEX.purple, dots: BRAND_HEX.purpleSoft };
});

/** Fibonacci-lattice vertex на единичной сфере; i из [0..total). */
function fibonacciPoint(i: number, total: number): THREE.Vector3 {
  const y = 1 - (2 * (i + 0.5)) / total;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const azimuth = i * GOLDEN_ANGLE;
  return new THREE.Vector3(Math.cos(azimuth) * r, y, Math.sin(azimuth) * r);
}

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

  // === Outer shell: тонкий wireframe icosphere ===========================
  const outerGeo = new THREE.IcosahedronGeometry(1.4, props.detail);
  const outerWireGeo = new THREE.WireframeGeometry(outerGeo);
  outerMat = new THREE.LineBasicMaterial({
    color: palette.value.outer,
    transparent: true,
    opacity: 0.32,
  });
  outerWire = new THREE.LineSegments(outerWireGeo, outerMat);
  group.add(outerWire);

  // === Inner shell: counter-rotate, более яркий ==========================
  const innerGeo = new THREE.IcosahedronGeometry(0.85, 2);
  const innerWireGeo = new THREE.WireframeGeometry(innerGeo);
  innerMat = new THREE.LineBasicMaterial({
    color: palette.value.inner,
    transparent: true,
    opacity: 0.55,
  });
  innerWire = new THREE.LineSegments(innerWireGeo, innerMat);
  group.add(innerWire);

  // === Accent points: 7 ярких dots по Fibonacci-lattice на outer sphere ==
  // Заменяют плотные Points (которые были на каждой вершине detail=3) — меньше
  // visual noise, больше «премиум» feeling.
  const dotPositions = new Float32Array(ACCENT_COUNT * 3);
  for (let i = 0; i < ACCENT_COUNT; i++) {
    const v = fibonacciPoint(i, ACCENT_COUNT).multiplyScalar(1.4);
    dotPositions[i * 3] = v.x;
    dotPositions[i * 3 + 1] = v.y;
    dotPositions[i * 3 + 2] = v.z;
  }
  const dotsGeo = new THREE.BufferGeometry();
  dotsGeo.setAttribute('position', new THREE.BufferAttribute(dotPositions, 3));
  dotsMat = new THREE.PointsMaterial({
    color: palette.value.dots,
    size: 0.08,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  accentDots = new THREE.Points(dotsGeo, dotsMat);
  group.add(accentDots);

  outerGeo.dispose();
  innerGeo.dispose();
}

function animate(): void {
  if (!renderer || !scene || !camera || !group) return;

  const tSec = performance.now() / 1000;

  // Базовый spin: медленнее предыдущей версии (0.008 → 0.005). Cinematic-feel.
  let baseSpin = 0.005;
  if (props.state === 'active') baseSpin = 0.008;
  if (props.state === 'error') baseSpin = 0.012;
  if (props.voiceMode) {
    if (props.voiceState === 'busy') baseSpin = 0.014;
    else if (props.voiceState === 'speaking') baseSpin = 0.009;
    else if (props.voiceState === 'listening') baseSpin = 0.006;
  }
  if (props.ambient) baseSpin = 0.004; // самый медленный — кинематографичный
  if (reduceMotion.value) baseSpin *= 0.4;

  const mouseDriven = !props.voiceMode && !props.ambient;
  if (props.voiceMode) {
    voiceTarget = voiceEnvelope(tSec, props.voiceState);
    voiceAmp += (voiceTarget - voiceAmp) * 0.12;
    mouseX = 0;
    mouseY = 0;
  } else if (!mouseDriven) {
    mouseX = 0;
    mouseY = 0;
  } else if (performance.now() - lastMouseAt > 2000) {
    mouseX *= 0.96;
    mouseY *= 0.96;
  }

  // Lissajous tilt по X: две синусоиды разных частот → non-repetitive
  // organic motion. Mouse-tilt overrides когда курсор активен.
  const lissajousX = Math.sin(tSec * 0.31) * 0.14 + Math.sin(tSec * 0.13) * 0.06;
  const lissajousY = Math.sin(tSec * 0.21 + 1.3) * 0.08;

  const targetRotY = mouseDriven ? mouseX * 0.6 : lissajousY;
  const targetRotX = mouseDriven ? mouseY * 0.5 : lissajousX;

  curRotY += (targetRotY - curRotY) * 0.05 + velY + baseSpin;
  curRotX += (targetRotX - curRotX) * 0.05;

  // Multi-axis tumble для busy («думаю») — синхронный поворот по X на синусоиде
  // создаёт ощущение «вычисления». Без этого busy неотличим от обычного spin.
  if (props.voiceMode && props.voiceState === 'busy') {
    const xTumble = Math.sin(tSec * 0.7) * 0.28;
    curRotX += (xTumble - curRotX) * 0.06;
  }

  velY *= 0.94;
  pulseScale += (1 - pulseScale) * 0.08;

  group.rotation.y = curRotY;
  group.rotation.x = curRotX;

  // Idle breathing — едва заметная синусоида scale (без voice/ambient).
  let stateScale = 1;
  if (!props.voiceMode && !props.ambient) {
    stateScale = 1 + Math.sin(tSec * 1.1) * 0.012;
  }
  // Voice-mode: «дыхание» от амплитуды. Listening меньше (фокус внутрь),
  // speaking — заметнее (орб «говорит» наружу).
  const voiceScale = props.voiceMode
    ? 1 + voiceAmp * (props.voiceState === 'listening' ? 0.05 : 0.12)
    : 1;
  // Ambient: медленный 8s breath.
  const ambientScale = props.ambient ? 1 + Math.sin(tSec * 0.78) * 0.018 : 1;
  group.scale.setScalar(pulseScale * voiceScale * stateScale * ambientScale);

  // Inner shell: counter-rotate по обоим осям. Скорость в 1.8× outer'а.
  if (innerWire) {
    innerWire.rotation.y -= baseSpin * 1.8;
    innerWire.rotation.x += baseSpin * 1.1;
    if (props.voiceMode) {
      const innerBoost = props.voiceState === 'listening' ? 0.55 : 0.3;
      innerWire.scale.setScalar(1 + voiceAmp * innerBoost);
      if (innerMat) innerMat.opacity = 0.45 + voiceAmp * 0.4;
    } else if (props.ambient) {
      // Ambient: ядро дышит независимо от outer'а — двухслойный «организм».
      innerWire.scale.setScalar(1 + Math.sin(tSec * 1.45) * 0.08);
      if (innerMat) innerMat.opacity = 0.5 + Math.sin(tSec * 1.45) * 0.12;
    }
  }

  // Accent dots: pulse в voice-mode + slight independent rotation для
  // «искристого» feeling.
  if (accentDots) {
    accentDots.rotation.y = curRotY * 0.85;
    accentDots.rotation.x = curRotX * 0.85;
    if (props.voiceMode && dotsMat) {
      dotsMat.size = 0.08 + voiceAmp * 0.06;
      dotsMat.opacity = 0.85 + voiceAmp * 0.15;
    } else if (props.ambient && dotsMat) {
      dotsMat.size = 0.08 + Math.abs(Math.sin(tSec * 0.78)) * 0.02;
    }
  }

  // Outer wire opacity «дышит» в voice-mode.
  if (props.voiceMode && outerMat) {
    outerMat.opacity = 0.32 + voiceAmp * 0.28;
  }

  // CSS-var для halo glow — синхронизируем blur-фон с амплитудой звука.
  if (props.voiceMode && rootEl.value) {
    rootEl.value.style.setProperty('--orb-voice-amp', voiceAmp.toFixed(3));
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

// Реактивная palette → обновляем materials без re-init сцены.
watch(palette, (p) => {
  outerMat?.color.setHex(p.outer);
  innerMat?.color.setHex(p.inner);
  dotsMat?.color.setHex(p.dots);
});

onMounted(() => {
  init();
  raf = requestAnimationFrame(animate);

  const mouseDriven = !props.voiceMode && !props.ambient;
  if (mouseDriven) {
    const target: Window | HTMLElement | null = props.trackWindow ? window : rootEl.value;
    target?.addEventListener('mousemove', onMouseMove as EventListener, { passive: true });
  }

  if (rootEl.value) {
    resizeObs = new ResizeObserver(handleResize);
    resizeObs.observe(rootEl.value);
  }
});

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf);
  const mouseDriven = !props.voiceMode && !props.ambient;
  if (mouseDriven) {
    const target: Window | HTMLElement | null = props.trackWindow ? window : rootEl.value;
    target?.removeEventListener('mousemove', onMouseMove as EventListener);
  }

  resizeObs?.disconnect();

  if (group) {
    group.traverse((obj) => {
      if (obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
        obj.geometry.dispose();
      }
    });
  }
  outerMat?.dispose();
  innerMat?.dispose();
  dotsMat?.dispose();
  renderer?.dispose();

  renderer = null;
  scene = null;
  camera = null;
  group = null;
  outerWire = null;
  innerWire = null;
  accentDots = null;
  outerMat = null;
  innerMat = null;
  dotsMat = null;
});
</script>

<style scoped lang="scss">
.orb {
  --orb-size: 80px;
  // Базовая палитра halo — переопределяется state/voice-state модификаторами.
  --orb-halo-1: rgba(var(--color-brand-violet-rgb), 0.55);
  --orb-halo-2: rgba(var(--color-brand-purple-rgb), 0.42);
  --orb-halo-3: rgba(var(--color-brand-pink-rgb), 0.18);
  --orb-rim: rgba(var(--color-brand-purple-rgb), 0.7);
  --orb-rim-2: rgba(var(--color-brand-pink-rgb), 0.4);
  // Voice-amp 0..1 — пишется из animate(), читается в halo.
  --orb-voice-amp: 0;

  position: relative;
  width: var(--orb-size);
  height: var(--orb-size);
  flex-shrink: 0;
  display: inline-block;
  isolation: isolate;
  pointer-events: none;
  // Тончайшее CSS-дыхание во внешнем контейнере (Three.js делает свой scale).
  // Period 6s (было 4.6s) — более кинематографично.
  animation: orbBreath calc(6s / max(var(--motion-scale, 1), 0.001)) ease-in-out infinite alternate;

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

  // State-driven halo палитра. Модификаторы переопределяют только токены
  // halo/rim — ничего не дублируем.
  &--idle {
    --orb-halo-1: rgba(var(--color-brand-violet-rgb), 0.5);
    --orb-halo-2: rgba(var(--color-brand-purple-rgb), 0.35);
    --orb-halo-3: rgba(var(--color-brand-pink-rgb), 0.16);
  }
  &--active {
    --orb-halo-1: rgba(var(--color-brand-purple-rgb), 0.7);
    --orb-halo-2: rgba(var(--color-brand-pink-rgb), 0.5);
    --orb-halo-3: rgba(var(--color-brand-amber-rgb), 0.22);
    --orb-rim: rgba(var(--color-brand-purple-rgb), 0.85);
    --orb-rim-2: rgba(var(--color-brand-pink-rgb), 0.55);
  }
  &--error {
    --orb-halo-1: rgba(255, 85, 119, 0.6);
    --orb-halo-2: rgba(255, 138, 77, 0.5);
    --orb-halo-3: rgba(255, 85, 119, 0.22);
    --orb-rim: rgba(255, 85, 119, 0.7);
    --orb-rim-2: rgba(255, 138, 77, 0.4);
  }

  // Voice-state палитры.
  &--voice-listening {
    --orb-halo-1: rgba(var(--color-brand-cyan-rgb), 0.55);
    --orb-halo-2: rgba(var(--color-brand-violet-rgb), 0.42);
    --orb-halo-3: rgba(var(--color-brand-purple-rgb), 0.18);
    --orb-rim: rgba(var(--color-brand-cyan-rgb), 0.7);
    --orb-rim-2: rgba(var(--color-brand-violet-rgb), 0.45);
  }
  &--voice-speaking {
    --orb-halo-1: rgba(var(--color-brand-purple-rgb), 0.7);
    --orb-halo-2: rgba(var(--color-brand-pink-rgb), 0.55);
    --orb-halo-3: rgba(var(--color-brand-amber-rgb), 0.25);
    --orb-rim: rgba(var(--color-brand-pink-rgb), 0.85);
    --orb-rim-2: rgba(var(--color-brand-amber-rgb), 0.5);
  }
  &--voice-busy {
    --orb-halo-1: rgba(var(--color-brand-amber-rgb), 0.6);
    --orb-halo-2: rgba(var(--color-brand-purple-rgb), 0.45);
    --orb-halo-3: rgba(var(--color-brand-yellow-rgb), 0.22);
    --orb-rim: rgba(var(--color-brand-amber-rgb), 0.75);
    --orb-rim-2: rgba(var(--color-brand-purple-rgb), 0.5);
  }
}

// =============================================================================
// 3-layer volumetric halo: каждый layer на своём blur'е и периоде anim'а.
// Сдвиг по hue (violet → purple → pink/amber) даёт «хроматический» edge —
// premium-lens feel. На voice-mode keyframes отключаются, opacity/scale
// тянутся за CSS-var --orb-voice-amp из animate() ticker'а.
// =============================================================================
.orb__halo {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  z-index: -1;

  &--inner {
    inset: -12%;
    background: radial-gradient(circle at 50% 50%, var(--orb-halo-1) 0%, transparent 55%);
    filter: blur(12px);
    animation: orbHaloInner calc(6s / max(var(--motion-scale, 1), 0.001)) ease-in-out infinite
      alternate;
  }
  &--mid {
    inset: -22%;
    background: radial-gradient(circle at 50% 50%, var(--orb-halo-2) 0%, transparent 60%);
    filter: blur(28px);
    animation: orbHaloMid calc(8s / max(var(--motion-scale, 1), 0.001)) ease-in-out infinite
      alternate-reverse;
  }
  &--wide {
    inset: -45%;
    background:
      radial-gradient(circle at 65% 30%, var(--orb-halo-3) 0%, transparent 55%),
      radial-gradient(circle at 35% 70%, var(--orb-halo-3) 0%, transparent 60%);
    filter: blur(72px);
    animation: orbHaloWide calc(12s / max(var(--motion-scale, 1), 0.001)) ease-in-out infinite
      alternate;
  }
}

// В voice-mode keyframes выключаем — opacity/scale управляются JS (--orb-voice-amp).
.orb--voice .orb__halo--inner {
  animation: none;
  opacity: calc(0.65 + var(--orb-voice-amp) * 0.35);
  transform: scale(calc(1 + var(--orb-voice-amp) * 0.06));
  transition:
    opacity 90ms linear,
    transform 90ms linear;
}
.orb--voice .orb__halo--mid {
  animation: none;
  opacity: calc(0.55 + var(--orb-voice-amp) * 0.4);
  transform: scale(calc(1 + var(--orb-voice-amp) * 0.04));
  transition:
    opacity 90ms linear,
    transform 90ms linear;
}

// =============================================================================
// Rim-light: thin conic-gradient ring по edge'у орба. Сигнатурный эффект —
// «lens flare»/«iridescent rim». 12s-период вращения, медленный → premium.
// =============================================================================
.orb__rim {
  position: absolute;
  inset: -1px;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    var(--orb-rim) 60deg,
    var(--orb-rim-2) 110deg,
    transparent 180deg,
    transparent 280deg,
    rgba(255, 255, 255, 0.18) 320deg,
    transparent 360deg
  );
  // Mask: оставляем только тонкое кольцо по краю (radial alpha-gradient).
  -webkit-mask: radial-gradient(
    circle at center,
    transparent 49%,
    #000 49.5%,
    #000 50.5%,
    transparent 51%
  );
  mask: radial-gradient(circle at center, transparent 49%, #000 49.5%, #000 50.5%, transparent 51%);
  animation: orbRimRotate calc(12s / max(var(--motion-scale, 1), 0.001)) linear infinite;
  pointer-events: none;
  z-index: 0;
  opacity: 0.85;
}

// На sm (sidebar 40px) маска даёт слишком тонкую полоску — увеличиваем толщину.
.orb--sm .orb__rim {
  -webkit-mask: radial-gradient(
    circle at center,
    transparent 47%,
    #000 48%,
    #000 52%,
    transparent 53%
  );
  mask: radial-gradient(circle at center, transparent 47%, #000 48%, #000 52%, transparent 53%);
  opacity: 0.7;
}

// Speaking: rim вращается быстрее (даёт ощущение active broadcast'а).
.orb--voice-speaking .orb__rim {
  animation-duration: calc(5s / max(var(--motion-scale, 1), 0.001));
  opacity: 1;
}
// Busy: rim становится amber-tinted и вращается ещё медленнее (медитативно
// «думает»).
.orb--voice-busy .orb__rim {
  animation-duration: calc(16s / max(var(--motion-scale, 1), 0.001));
  opacity: 0.95;
}

// =============================================================================
// Click ring (резерв для будущего click-feedback).
// =============================================================================
.orb__ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px solid var(--orb-rim);
  box-shadow: 0 0 16px var(--orb-rim);
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

// =============================================================================
// Spectrum analyzer (только speaking): 14 баров, длинные тонкие, period 1.2s.
// Менее «AI-cliché» чем 28-bar wall, более elegant feel.
// =============================================================================
.orb__spectrum {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

.orb__spectrum-wrap {
  --i: 1;
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  transform: rotate(calc((var(--i) - 1) * (360deg / 14)));
}

.orb__spectrum-bar {
  --base-amp: 0.4;
  --peak-amp: 1.2;
  display: block;
  width: 1.5px;
  height: calc(var(--orb-size) * 0.16);
  margin-bottom: calc(var(--orb-size) * 0.94);
  border-radius: 2px;
  background: linear-gradient(
    0deg,
    rgba(var(--color-brand-pink-rgb), 0) 0%,
    rgba(var(--color-brand-amber-rgb), 0.7) 30%,
    rgba(var(--color-brand-pink-rgb), 0.95) 65%,
    rgba(var(--color-brand-purple-rgb), 1) 100%
  );
  transform: scaleY(var(--base-amp));
  transform-origin: 50% 100%;
  filter: drop-shadow(0 0 4px rgba(var(--color-brand-pink-rgb), 0.45));
  // Period 1.2s, stagger -90ms на бар (×14 = ~1.26s — не повторяется в фазе).
  animation: orbSpectrumPulse calc(1.2s / max(var(--motion-scale, 1), 0.001))
    cubic-bezier(0.4, 0, 0.2, 1) infinite;
  animation-delay: calc(var(--i) * -90ms * var(--motion-scale, 1));
  will-change: transform, opacity;
  opacity: 0.7;
}

@keyframes orbSpectrumPulse {
  0%,
  100% {
    transform: scaleY(var(--base-amp));
    opacity: 0.5;
  }
  50% {
    transform: scaleY(var(--peak-amp));
    opacity: 1;
  }
}

// =============================================================================
// Listening: одиночный core-pulse в центре. Чистый focus, не 28 баров.
// =============================================================================
.orb__pulse {
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(var(--orb-size) * 0.18);
  height: calc(var(--orb-size) * 0.18);
  margin-top: calc(var(--orb-size) * -0.09);
  margin-left: calc(var(--orb-size) * -0.09);
  border-radius: 50%;
  background: radial-gradient(
    circle at center,
    rgba(var(--color-brand-cyan-rgb), 0.95) 0%,
    rgba(var(--color-brand-violet-rgb), 0.6) 60%,
    transparent 100%
  );
  box-shadow:
    0 0 24px rgba(var(--color-brand-cyan-rgb), 0.6),
    0 0 48px rgba(var(--color-brand-violet-rgb), 0.4);
  animation: orbCorePulse calc(1.4s / max(var(--motion-scale, 1), 0.001)) ease-in-out infinite;
  pointer-events: none;
  z-index: 1;
}

@keyframes orbCorePulse {
  0%,
  100% {
    transform: scale(0.7);
    opacity: 0.55;
  }
  50% {
    transform: scale(1.05);
    opacity: 1;
  }
}

// =============================================================================
// Busy: одиночная scan-arc на halo. Conic-gradient, медленно вращается. Чёткий
// сигнал «processing» без агрессивного 28-bar sweep'а.
// =============================================================================
.orb__scan {
  position: absolute;
  inset: -8%;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    rgba(var(--color-brand-amber-rgb), 0.72) 30deg,
    rgba(var(--color-brand-yellow-rgb), 0.55) 50deg,
    transparent 80deg,
    transparent 360deg
  );
  -webkit-mask: radial-gradient(
    circle at center,
    transparent 46%,
    #000 47%,
    #000 53%,
    transparent 54%
  );
  mask: radial-gradient(circle at center, transparent 46%, #000 47%, #000 53%, transparent 54%);
  animation: orbScanRotate calc(2.4s / max(var(--motion-scale, 1), 0.001)) linear infinite;
  pointer-events: none;
  z-index: 1;
  filter: drop-shadow(0 0 12px rgba(var(--color-brand-amber-rgb), 0.5));
}

@keyframes orbScanRotate {
  to {
    transform: rotate(360deg);
  }
}

// Voice/ambient переопределяют idle-breath на orb-уровне (внутри keyframes уже
// своё движение).
.orb--voice,
.orb--ambient {
  animation: none;
}

// =============================================================================
// Reduced-motion: глушим все CSS-keyframes. Three.js spin сам глушится через
// reduceMotion ×0.4 в animate().
// =============================================================================
@media (prefers-reduced-motion: reduce) {
  .orb {
    animation: none;
  }
  .orb__halo,
  .orb__rim,
  .orb__spectrum-bar,
  .orb__pulse,
  .orb__scan {
    animation: none;
  }
  .orb__spectrum-bar {
    transform: scaleY(var(--base-amp));
    opacity: 0.55;
  }
  .orb__rim {
    opacity: 0.5;
  }
}

// =============================================================================
// Keyframes
// =============================================================================
@keyframes orbBreath {
  0% {
    transform: scale(1);
  }
  100% {
    transform: scale(1.012);
  }
}

@keyframes orbHaloInner {
  0%,
  100% {
    opacity: 0.65;
    transform: scale(0.96);
  }
  50% {
    opacity: 0.95;
    transform: scale(1.04);
  }
}
@keyframes orbHaloMid {
  0%,
  100% {
    opacity: 0.5;
    transform: scale(1);
  }
  50% {
    opacity: 0.85;
    transform: scale(1.06);
  }
}
@keyframes orbHaloWide {
  0%,
  100% {
    opacity: 0.6;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}

@keyframes orbRimRotate {
  to {
    transform: rotate(360deg);
  }
}
</style>
