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
    <span class="orb__halo" />
    <span class="orb__ring" />
    <canvas ref="canvasEl" class="orb__canvas" />
    <!-- Spectral analyzer: 28 баров по окружности. Каждый — отдельный wrap для
         rotate, внутренний `i` — для scaleY (декомпозиция нужна, чтобы keyframe
         анимация не конфликтовала с позиционным rotate). Стаггер делителем-простым
         (73мс) даёт «органическую» волну вместо синхронного ripple. -->
    <div v-if="withSpectrum" class="orb__spectrum" aria-hidden="true">
      <span v-for="n in SPECTRUM_BARS" :key="n" class="orb__spectrum-wrap" :style="{ '--i': n }">
        <i class="orb__spectrum-bar" />
      </span>
    </div>
    <!-- Ambient broadcast: 3 концентрических кольца, расширяются от орба наружу
         с шагом по фазе. Создают ощущение, что орб «передаёт сигнал» — нужны
         в Welcome, где вокруг него вращаются orbital chips (протоколы). -->
    <div v-if="ambient" class="orb__broadcast" aria-hidden="true">
      <span class="orb__broadcast-ring" style="--phase: 0" />
      <span class="orb__broadcast-ring" style="--phase: 1" />
      <span class="orb__broadcast-ring" style="--phase: 2" />
    </div>
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
   * Voice-reactive режим: синтетическая волна звука драйвит scale, ядро и halo.
   * Отключает mousemove-tilt — орб «слушает» Алису, а не мышку. Welcome остаётся
   * без этого флага (там mouse-tracking — это часть знакомства с приложением).
   */
  voiceMode?: boolean;
  /** Голосовое состояние Алисы; определяет огибающую амплитуды. */
  voiceState?: OrbVoiceState;
  /**
   * Spectral analyzer вокруг орба: 28 радиальных баров со staggered-волной.
   * По умолчанию включается для voice-mode на размерах ≥md (на sm/avatar
   * слишком тесно — превратится в кашу). Можно переопределить вручную.
   */
  spectrum?: boolean;
  /**
   * Ambient режим (онбординг / hero без голоса):
   *   - mouse-tilt отключён, орб «живёт сам»
   *   - multi-axis lazy spin (тумбл по X+Y одновременно)
   *   - broadcast-кольца расширяются от орба наружу — визуальная «передача»
   *     сигнала к orbital-chips (протоколам интеграций)
   * Несовместим с voiceMode (там Алиса задаёт ритм, ambient бы конфликтовал).
   */
  ambient?: boolean;
}

const SPECTRUM_BARS = 28;

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

// Auto-default: spectrum on если voice-mode и size достаточно крупный.
// Sidebar (sm) сознательно остаётся минималистичным — там 40px, бары лишние.
const withSpectrum = computed<boolean>(() => {
  if (props.spectrum !== undefined) return props.spectrum;
  if (!props.voiceMode) return false;
  return props.size === 'md' || props.size === 'lg' || props.size === 'xl' || props.size === 'hero';
});

const ui = useUiStore();
const { reduceMotion } = storeToRefs(ui);

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl');


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

// Voice envelope: synthetic «звуковая волна» Алисы. Считаем суммой нескольких
// синусов разной частоты — глаз воспринимает это как настоящую речь, хотя WSS
// glagol-канал амплитуды не отдаёт (там только state-changes). Сглаживаем
// через damping для естественного нарастания/затухания.
let voiceAmp = 0; // 0..1 — текущая «громкость»
let voiceTarget = 0; // куда стремимся

/**
 * Огибающая амплитуды для голосовых состояний:
 *  - idle/busy → 0 (орб не «звучит», только базовый spin)
 *  - listening → медленное «сердцебиение» (ждёт команду)
 *  - speaking → хаотичная волна из 3 расстроенных синусов с envelope-модуляцией
 *
 * Возвращает значение 0..1, сэмплируется на каждом кадре в animate().
 */
function voiceEnvelope(t: number, state: OrbVoiceState): number {
  if (state === 'idle' || state === 'busy') return 0;
  if (state === 'listening') {
    // Период ~1.4с, пик 0.32 — мягкий heartbeat.
    const phase = (t % 1.4) / 1.4;
    return Math.max(0, Math.sin(phase * Math.PI)) * 0.32;
  }
  // speaking: speech-like waveform. Три синуса разной частоты + envelope-модуляция,
  // чтобы амплитуда «гуляла» как у живой речи, а не была равномерным пульсом.
  const a = Math.sin(t * 11.0) * 0.42;
  const b = Math.sin(t * 7.3 + 1.7) * 0.34;
  const c = Math.sin(t * 17.5 + 0.9) * 0.22;
  const env = (Math.sin(t * 2.7) + Math.sin(t * 1.1 + 0.5) + 2) / 4; // 0..1 slow envelope
  return Math.min(1, Math.abs(a + b + c) * env);
}

// 0xRRGGBB-int'ы из constants/brandColors — JS-сцена и SCSS-токены не расходятся.
// Voice-mode переопределяет палитру по голосовым состояниям, чтобы орб «менял
// настроение» когда Алиса слушает / говорит — без прибегания к CSS-фильтрам.
const palette = computed<{ wire: number; points: number; core: number }>(() => {
  if (props.state === 'error') {
    return { wire: BRAND_HEX.danger, points: BRAND_HEX.orange, core: BRAND_HEX.warning };
  }
  if (props.voiceMode) {
    if (props.voiceState === 'listening') {
      return { wire: BRAND_HEX.cyan, points: BRAND_HEX.violet, core: BRAND_HEX.purpleHi };
    }
    if (props.voiceState === 'speaking') {
      return { wire: BRAND_HEX.purple, points: BRAND_HEX.pink, core: BRAND_HEX.purpleHi };
    }
    if (props.voiceState === 'busy') {
      return { wire: BRAND_HEX.amber, points: BRAND_HEX.purple, core: BRAND_HEX.purpleSoft };
    }
    // idle in voice-mode — спокойный violet/purple
    return { wire: BRAND_HEX.violet, points: BRAND_HEX.purple, core: BRAND_HEX.purpleSoft };
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

  const tSec = performance.now() / 1000;

  // Базовый spin: всегда заметно крутится даже на idle, чтобы орб «жил».
  // Ускоряется в active/speaking/busy. Hover усиливает только без voice-mode —
  // в voice-mode орб «слушает» Алису и не реагирует на мышь.
  let baseSpin = 0.008;
  if (props.state === 'active') baseSpin = 0.012;
  if (props.state === 'error') baseSpin = 0.016;
  if (props.voiceMode) {
    if (props.voiceState === 'busy') baseSpin = 0.024;
    else if (props.voiceState === 'speaking') baseSpin = 0.014;
    else if (props.voiceState === 'listening') baseSpin = 0.010;
  }
  if (props.ambient) baseSpin = 0.006; // медленный, кинематографичный
  if (reduceMotion.value) baseSpin *= 0.4;

  // Mouse-tilt отключаем в voice-mode и ambient. Welcome теперь ambient — орб
  // не реагирует на мышь, живёт собственной анимацией.
  const mouseDriven = !props.voiceMode && !props.ambient;
  if (props.voiceMode) {
    voiceTarget = voiceEnvelope(tSec, props.voiceState);
    voiceAmp += (voiceTarget - voiceAmp) * 0.18; // smooth attack/release
    mouseX = 0;
    mouseY = 0;
  } else if (!mouseDriven) {
    mouseX = 0;
    mouseY = 0;
  } else if (performance.now() - lastMouseAt > 2000) {
    mouseX *= 0.96;
    mouseY *= 0.96;
  }

  const targetRotY = mouseDriven ? mouseX * 0.6 : 0;
  const targetRotX = mouseDriven ? mouseY * 0.5 : 0;

  curRotY += (targetRotY - curRotY) * 0.06 + velY + baseSpin;
  curRotX += (targetRotX - curRotX) * 0.06;

  // Multi-axis tumble: для busy («думает») и ambient — синхронный поворот по X
  // на синусоиде создаёт ощущение «вычисления», когда орб не просто крутится
  // вокруг одной оси, а перекатывается. Без этого busy визуально неотличим
  // от обычного spin.
  if ((props.voiceMode && props.voiceState === 'busy') || props.ambient) {
    const xTumble = Math.sin(tSec * (props.ambient ? 0.42 : 0.9)) * 0.32;
    curRotX += (xTumble - curRotX) * 0.08;
  } else {
    curRotX = Math.max(-0.55, Math.min(0.55, curRotX));
  }

  velY *= 0.94; // damping импульса
  pulseScale += (1 - pulseScale) * 0.12; // релакс к 1

  group.rotation.y = curRotY;
  group.rotation.x = curRotX;

  // Idle breathing — лёгкая синусоида scale без voice-mode и ambient: даже
  // «спокойный» орб не должен быть статичным.
  let stateScale = 1;
  if (!props.voiceMode && !props.ambient) {
    stateScale = 1 + Math.sin(tSec * 1.3) * 0.018;
  }
  // Voice-mode: «дыхание» от амплитуды. Listening → core тянет внимание внутрь
  // (см. ниже), для group делаем меньшее рост — фокус на ядре, не на оболочке.
  const voiceScale = props.voiceMode
    ? 1 + voiceAmp * (props.voiceState === 'listening' ? 0.08 : 0.18)
    : 1;
  // Ambient: периодическое «дыхание» в ритме broadcast-колец (~5с).
  const ambientScale = props.ambient ? 1 + Math.sin(tSec * 0.62) * 0.025 : 1;
  group.scale.setScalar(pulseScale * voiceScale * stateScale * ambientScale);

  // Core: контр-спин + расширение/яркость на пиках амплитуды. Listening даёт
  // ядру отдельный, более сильный отклик (фокус внутрь).
  if (core) {
    core.rotation.y -= baseSpin * 2.5;
    core.rotation.x += baseSpin * 1.5;
    if (props.voiceMode) {
      const coreBoost = props.voiceState === 'listening' ? 0.7 : 0.45;
      core.scale.setScalar(1 + voiceAmp * coreBoost);
      if (coreMat) coreMat.opacity = 0.45 + voiceAmp * 0.5;
    } else if (props.ambient) {
      // Ambient: ядро дышит независимо от внешней оболочки — двухслойный
      // «организм», а не монолитный куль. Period 3.4с противофаза с oblochkoi.
      core.scale.setScalar(1 + Math.sin(tSec * 1.85) * 0.12);
      if (coreMat) coreMat.opacity = 0.5 + Math.sin(tSec * 1.85) * 0.18;
    }
  }

  // Points в voice-mode пульсируют размером — выглядит как «искры» голоса.
  if (props.voiceMode && pointsMat) {
    pointsMat.size = 0.05 + voiceAmp * 0.06;
    pointsMat.opacity = 0.7 + voiceAmp * 0.3;
  } else if (props.ambient && pointsMat) {
    // Ambient: размер вершин слегка пульсирует — «искры» при broadcast.
    pointsMat.size = 0.05 + Math.abs(Math.sin(tSec * 0.62)) * 0.03;
    pointsMat.opacity = 0.7 + Math.abs(Math.sin(tSec * 0.62)) * 0.25;
  }

  // Wire opacity тоже плавает — общая «жизненность» орба под голос.
  if (props.voiceMode && wireMat) {
    wireMat.opacity = 0.45 + voiceAmp * 0.3;
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
  wireMat?.color.setHex(p.wire);
  pointsMat?.color.setHex(p.points);
  coreMat?.color.setHex(p.core);
});

onMounted(() => {
  init();
  raf = requestAnimationFrame(animate);

  // В ambient/voice-mode мышь не нужна — экономим listener и предотвращаем
  // случайные tilt'ы при движении курсора рядом с орбом.
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
  // Voice-amp 0..1 — пишется из animate(), читается в halo.
  --orb-voice-amp: 0;

  position: relative;
  width: var(--orb-size);
  height: var(--orb-size);
  flex-shrink: 0;
  display: inline-block;
  isolation: isolate;
  pointer-events: none;
  // Idle/active без voice-mode: лёгкое CSS-дыхание ВО ВНЕШНЕМ слое (Three.js
  // делает свой scale в animate(), а это — внешний контейнер). Никогда не
  // должен быть статичен — даже на parking page орб «дышит».
  animation: orbBreath 4.6s ease-in-out infinite alternate;

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

}

.orb__halo {
  position: absolute;
  inset: -22%;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 50%, var(--orb-glow) 0%, transparent 55%),
    radial-gradient(circle at 70% 30%, var(--orb-glow-2) 0%, transparent 50%);
  filter: blur(24px);
  // В voice-mode opacity тянется за амплитудой — halo «дышит» под голос.
  // По дефолту работает обычная idle-анимация orbHalo (см. ниже).
  opacity: calc(0.55 + var(--orb-voice-amp) * 0.45);
  transform: scale(calc(1 + var(--orb-voice-amp) * 0.08));
  z-index: -1;
  pointer-events: none;
  animation: orbHalo 5s ease-in-out infinite alternate;
}

// В voice-mode keyframes-анимация выключена: glow управляется CSS-var из JS-`animate()`.
.orb--voice .orb__halo {
  animation: none;
  transition:
    opacity 90ms linear,
    transform 90ms linear;
}

// Busy («думает»): halo вращается вокруг орба — gradient-сместился по углу,
// glow-точка перемещается по окружности. Чёткий визуальный сигнал «processing».
.orb--voice-busy .orb__halo {
  animation: orbHaloOrbit 2.8s linear infinite;
  filter: blur(20px);
}

// Listening: halo сжимается внутрь (фокус), а ядро в Three.js одновременно
// растёт — в сумме «втягивающее» движение, как у настоящей речи распознавания.
.orb--voice-listening .orb__halo {
  animation: orbHaloFocus 1.4s ease-in-out infinite;
}

// Speaking: halo пульсирует резче, blur меньше — orb ярко «излучает».
.orb--voice-speaking .orb__halo {
  animation: orbHaloEmit 0.8s ease-in-out infinite;
  filter: blur(18px);
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

// =============================================================================
// Spectral analyzer: радиальные бары вокруг орба
// =============================================================================
// Каждый бар — wrap (rotate в плоскости) + inner i (scaleY-анимация). Стаггер
// 73мс на бар + длинный 1.6с период даёт «несинхронную» волну, которая не
// складывается обратно в чистый ripple за один период.
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
  transform: rotate(calc((var(--i) - 1) * (360deg / 28)));
}

.orb__spectrum-bar {
  --base-amp: 0.5; // idle (state-driven, см. ниже)
  --peak-amp: 1.05;
  display: block;
  width: 2px;
  height: calc(var(--orb-size) * 0.18);
  margin-bottom: calc(var(--orb-size) * 0.92);
  border-radius: 2px;
  background:
    linear-gradient(
      0deg,
      rgba(var(--color-brand-pink-rgb), 0) 0%,
      rgba(var(--color-brand-pink-rgb), 0.85) 38%,
      rgba(var(--color-brand-purple-rgb), 1) 100%
    );
  transform: scaleY(var(--base-amp));
  transform-origin: 50% 100%;
  filter: drop-shadow(0 0 4px rgba(var(--color-brand-purple-rgb), 0.45));
  animation: orbSpectrumPulse 1.6s cubic-bezier(0.4, 0.0, 0.2, 1) infinite;
  animation-delay: calc(var(--i) * -73ms);
  will-change: transform, opacity;
  opacity: 0.55;
}

@keyframes orbSpectrumPulse {
  0%, 100% {
    transform: scaleY(var(--base-amp));
    opacity: 0.45;
  }
  50% {
    transform: scaleY(var(--peak-amp));
    opacity: 0.95;
  }
}

// State-driven амплитуда. Idle — едва дышит; listening — внятный пульс;
// speaking — широкая волна; busy — radar-sweep по периметру.
.orb--voice-idle .orb__spectrum-bar { --base-amp: 0.32; --peak-amp: 0.7; }
.orb--voice-listening .orb__spectrum-bar { --base-amp: 0.45; --peak-amp: 1.15; }
.orb--voice-speaking .orb__spectrum-bar {
  --base-amp: 0.55;
  --peak-amp: 1.55;
  animation-duration: 0.9s;
  background:
    linear-gradient(
      0deg,
      rgba(var(--color-brand-pink-rgb), 0) 0%,
      rgba(255, 184, 102, 0.9) 30%,
      rgba(var(--color-brand-pink-rgb), 1) 70%,
      rgba(var(--color-brand-purple-rgb), 1) 100%
    );
}
// Busy: radar-sweep вокруг орба. Период 1.4с равномерно делится на 28 баров
// (50мс на бар) — пик «бежит» по кругу как луч локатора, а не пульсирует
// синхронно. Чёткий визуальный сигнал «думаю / обрабатываю».
.orb--voice-busy .orb__spectrum-bar {
  --base-amp: 0.35;
  --peak-amp: 1.4;
  animation-name: orbSpectrumSweep;
  animation-duration: 1.4s;
  animation-timing-function: cubic-bezier(0.16, 0.84, 0.44, 1);
  animation-delay: calc(var(--i) * -50ms);
  background:
    linear-gradient(
      0deg,
      rgba(255, 184, 102, 0) 0%,
      rgba(255, 184, 102, 0.85) 50%,
      rgba(var(--color-brand-purple-rgb), 1) 100%
    );
  filter: drop-shadow(0 0 6px rgba(255, 184, 102, 0.4));
}
.orb--error .orb__spectrum-bar {
  background:
    linear-gradient(
      0deg,
      rgba(255, 85, 119, 0) 0%,
      rgba(255, 138, 77, 0.9) 40%,
      rgba(255, 85, 119, 1) 100%
    );
  filter: drop-shadow(0 0 5px rgba(255, 85, 119, 0.5));
}

// =============================================================================
// Ambient broadcast rings (Welcome / онбординг)
// =============================================================================
// Три концентрических кольца, расходятся от орба наружу с шагом по фазе —
// визуальная «передача» сигнала к orbital-chips (протоколам интеграций).
.orb__broadcast {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;
}

.orb__broadcast-ring {
  --phase: 0;
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(var(--color-brand-purple-rgb), 0.4);
  box-shadow:
    0 0 32px rgba(var(--color-brand-purple-rgb), 0.25),
    inset 0 0 18px rgba(var(--color-brand-pink-rgb), 0.2);
  opacity: 0;
  animation: orbBroadcast 5.4s cubic-bezier(0.16, 0.84, 0.44, 1) infinite;
  animation-delay: calc(var(--phase) * 1.8s);
}

@keyframes orbBroadcast {
  0% {
    transform: scale(0.85);
    opacity: 0;
    border-color: rgba(var(--color-brand-purple-rgb), 0.6);
  }
  20% {
    opacity: 0.7;
  }
  100% {
    transform: scale(2.4);
    opacity: 0;
    border-color: rgba(var(--color-brand-pink-rgb), 0);
  }
}

@keyframes orbSpectrumSweep {
  0%, 70%, 100% {
    transform: scaleY(var(--base-amp));
    opacity: 0.35;
  }
  40% {
    transform: scaleY(var(--peak-amp));
    opacity: 1;
  }
}

// =============================================================================
// Idle breath: внешний контейнер слегка пульсирует — орб никогда не статичен.
// =============================================================================
@keyframes orbBreath {
  0% { transform: scale(1); }
  100% { transform: scale(1.012); }
}

// Halo state-варианты: каждое голосовое состояние получает свою форму движения.
// Busy — orbiting glow (точка света бегает по окружности halo).
@keyframes orbHaloOrbit {
  0% { transform: rotate(0deg) scale(1.04); opacity: 0.55; }
  50% { transform: rotate(180deg) scale(1.12); opacity: 0.85; }
  100% { transform: rotate(360deg) scale(1.04); opacity: 0.55; }
}

// Listening — halo сжимается внутрь (втягивает внимание).
@keyframes orbHaloFocus {
  0%, 100% { transform: scale(1.02); opacity: 0.55; }
  50% { transform: scale(0.88); opacity: 0.85; }
}

// Speaking — резкий короткий пульс наружу.
@keyframes orbHaloEmit {
  0%, 100% { transform: scale(1.0); opacity: 0.6; }
  50% { transform: scale(1.18); opacity: 1; }
}

// Voice-mode/ambient переопределяют idle-breath на orb-уровне (внутри
// keyframes уже своё движение, breath сверху создавал бы дрожание).
.orb--voice,
.orb--ambient {
  animation: none;
}

// Reduce-motion — глушим CSS-keyframes, оставляем тонкую базовую амплитуду.
// Three.js spin сам глушится через reduceMotion ×0.4 в animate().
@media (prefers-reduced-motion: reduce) {
  .orb {
    animation: none;
  }
  .orb__spectrum-bar {
    animation: none;
    transform: scaleY(var(--base-amp));
    opacity: 0.55;
  }
  .orb__broadcast-ring {
    animation: none;
    opacity: 0.25;
    transform: scale(1.6);
  }
  .orb--voice .orb__halo,
  .orb--ambient .orb__halo {
    animation: none !important;
  }
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
