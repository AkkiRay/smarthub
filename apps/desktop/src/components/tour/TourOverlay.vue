<template>
  <Teleport to="body">
    <Transition name="tour" :duration="280">
      <div v-if="tour.isActive && current" class="tour" @click.self="onAccidentalClick">
        <!-- Backdrop с blur — только когда нет halo (intro/finish/center-fallback).
             В режиме с halo используем чистое затемнение через SVG-mask, чтобы
             подсвеченный элемент UI оставался резким в «дырке». -->
        <div v-if="!showHalo" class="tour__backdrop" />
        <svg class="tour__mask" :width="vw" :height="vh" aria-hidden="true">
          <defs>
            <mask id="tour-mask">
              <rect width="100%" height="100%" fill="#fff" />
              <rect
                v-if="haloRect"
                :x="haloRect.x"
                :y="haloRect.y"
                :width="haloRect.width"
                :height="haloRect.height"
                :rx="HALO_RADIUS"
                :ry="HALO_RADIUS"
                fill="#000"
              />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(8, 8, 16, 0.62)" mask="url(#tour-mask)" />
        </svg>

        <div
          v-if="haloRect"
          class="tour__halo"
          :class="{ 'tour__halo--measuring': isMeasuring }"
          :style="haloStyle"
        />

        <article
          ref="tooltipEl"
          class="tour__tooltip glass--strong"
          :class="[
            `tour__tooltip--${placement.side}`,
            { 'tour__tooltip--measuring': isMeasuring },
          ]"
          :style="tooltipStyle"
          :data-step="tour.stepIndex"
        >
          <header class="tour__header">
            <div class="tour__head-meta">
              <span v-if="chapter" class="tour__chapter">
                Глава {{ chapter.chapterIndex }} из {{ chapter.chapterTotal }} ·
                {{ chapter.chapter.label }}
              </span>
              <span class="tour__step">Шаг {{ tour.stepIndex + 1 }} из {{ tour.total }}</span>
            </div>
            <button class="tour__close" @click="onAskSkip" aria-label="Закрыть тур">
              <BaseIcon name="close" :size="14" />
            </button>
          </header>

          <h3 class="tour__title">{{ current.title }}</h3>
          <p class="tour__body">{{ current.body }}</p>

          <ul v-if="current.bullets?.length" class="tour__bullets">
            <li v-for="b in current.bullets" :key="b" class="tour__bullet">{{ b }}</li>
          </ul>

          <p v-if="current.tip" class="tour__tip">
            <BaseIcon name="alice" :size="12" />
            <span>{{ current.tip }}</span>
          </p>

          <div class="tour__progress" aria-hidden="true">
            <span
              v-for="i in tour.total"
              :key="i"
              class="tour__progress-dot"
              :class="{ 'is-active': i - 1 === tour.stepIndex, 'is-done': i - 1 < tour.stepIndex }"
            />
          </div>

          <footer class="tour__actions">
            <BaseButton
              v-if="tour.stepIndex > 0"
              variant="ghost"
              size="sm"
              icon-left="arrow-left"
              @click="onBack"
            >
              Назад
            </BaseButton>
            <BaseButton v-if="canSkipChapter" variant="ghost" size="sm" @click="onSkipChapter">
              Пропустить главу
            </BaseButton>
            <BaseButton variant="ghost" size="sm" @click="onAskSkip">Закрыть тур</BaseButton>
            <BaseButton
              variant="primary"
              size="sm"
              :icon-right="isLast ? undefined : 'arrow-right'"
              @click="onNext"
            >
              {{ isLast ? 'Завершить' : 'Дальше' }}
            </BaseButton>
          </footer>

          <span
            v-if="placement.side !== 'center' && placement.side !== 'inside'"
            class="tour__arrow"
            :data-side="placement.side"
            :style="arrowStyle"
            aria-hidden="true"
          />
        </article>

        <Transition name="tour-confirm">
          <div v-if="confirmingSkip" class="tour__confirm" role="alertdialog">
            <p class="tour__confirm-text">Прервать обучение?</p>
            <span class="tour__confirm-hint">
              Можно пройти заново в Настройках → «Тур по интерфейсу».
            </span>
            <div class="tour__confirm-actions">
              <BaseButton variant="ghost" size="sm" @click="confirmingSkip = false">
                Продолжить тур
              </BaseButton>
              <BaseButton variant="danger" size="sm" @click="onConfirmSkip"> Да, выйти </BaseButton>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// Coachmark overlay. Подсвечивает `[data-tour="<id>"]` через SVG-mask hole.
// Placement-engine — Floating-UI-style: ranked candidates с проверкой «помещается ли
// без overlap'а с target»; стрелка указывает на центр halo, а не на центр tooltip-а.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { gsap } from 'gsap';
import BaseIcon from '@/components/base/BaseIcon.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import { useTourStore } from '@/stores/tour';
import { useUiStore } from '@/stores/ui';

const tour = useTourStore();
const ui = useUiStore();
const router = useRouter();
const route = useRoute();

// Auto-start по `?tour=1` (из Welcome). Query чистим, чтобы reload не зацикливал.
onMounted(() => {
  if (route.query['tour'] === '1' && !ui.tourCompleted && !tour.isActive) {
    tour.start();
    void router.replace({ path: route.path, query: { ...route.query, tour: undefined } });
  }
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Gap между halo и tooltip card. */
const TOOLTIP_GAP = 16;
/** Минимальная ширина тултипа на узких viewport'ах. */
const TOOLTIP_MIN_W = 280;
/** Максимальная ширина тултипа (комфортная reading-line). */
const TOOLTIP_MAX_W = 460;
/** Внешние отступы тултипа от краёв viewport'а. */
const VIEWPORT_PAD = 24;
/** Резерв для titlebar Electron-а сверху (frameless окно). */
const TITLEBAR_FALLBACK = 46;
/** Padding вокруг target rect для halo (вне него рисуется обводка). */
const HALO_PAD = 8;
/** Радиус скругления подсветки и halo (один источник правды). */
const HALO_RADIUS = 14;
/** Минимальное расстояние от стрелки до угла тултипа. */
const ARROW_MARGIN = 24;
/** Если best-side даёт <60% нужного места — fallback на inside/center. */
const FIT_THRESHOLD = 0.6;
/** Внутренний padding для inside-placement: тултип лежит внутри halo с этим
 *  отступом от рамки подсветки, чтобы был воздух между халo и тултипом. */
const INSIDE_PAD = 32;

const TARGET_POLL_INTERVAL_MS = 80;
const TARGET_POLL_TIMEOUT_MS = 1500;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const tooltipEl = useTemplateRef<HTMLElement>('tooltipEl');
const targetRect = ref<DOMRect | null>(null);
const vw = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);
const vh = ref(typeof window !== 'undefined' ? window.innerHeight : 800);
const tooltipH = ref(260);
/** True пока syncTarget не завершил измерение нового шага. Тултип в это время
 *  держим opacity:0 — иначе он мигает в center-fallback'е до прихода halo. */
const isMeasuring = ref(false);
/** Confirm-pill: защита от случайного exit (overlay-click / Esc / close-кнопка). */
const confirmingSkip = ref(false);

const current = computed(() => tour.current);
const chapter = computed(() => tour.currentChapter);
const isLast = computed(() => tour.stepIndex === tour.total - 1);

const canSkipChapter = computed(() => {
  if (!current.value || isLast.value) return false;
  return tour.nextChapterIndex < tour.total;
});

let rafId: number | null = null;
let resizeObs: ResizeObserver | null = null;
let tooltipResizeObs: ResizeObserver | null = null;
let syncToken = 0;

// ---------------------------------------------------------------------------
// Titlebar height (CSS-токен) — top-pad для clamp'а тултипа
// ---------------------------------------------------------------------------

const titlebarHeight = ref(TITLEBAR_FALLBACK);
function readTitlebarHeight(): void {
  if (typeof document === 'undefined') return;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--titlebar-height')
    .trim();
  const parsed = parseFloat(raw);
  titlebarHeight.value = Number.isFinite(parsed) && parsed > 0 ? parsed : TITLEBAR_FALLBACK;
}

const topPad = computed(() => Math.max(VIEWPORT_PAD, titlebarHeight.value + 8));
const bottomPad = VIEWPORT_PAD;
const sidePad = VIEWPORT_PAD;

// ---------------------------------------------------------------------------
// Target acquisition + measurement
// ---------------------------------------------------------------------------

function isValidRect(r: DOMRect): boolean {
  return r.width > 1 && r.height > 1;
}

/** Polls primary + fallbackTargets, возвращает первый с валидным rect-ом. */
async function waitForTarget(selectors: readonly string[]): Promise<HTMLElement | null> {
  const deadline = Date.now() + TARGET_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el && isValidRect(el.getBoundingClientRect())) return el;
    }
    await new Promise((r) => setTimeout(r, TARGET_POLL_INTERVAL_MS));
  }
  return null;
}

/** Fixed-элементы (titlebar) — `nearest`, чтобы не скроллить; остальное — `center`,
 *  иначе у placement не остаётся места для side-выбора. */
function isFixedElement(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const pos = getComputedStyle(node).position;
    if (pos === 'fixed' || pos === 'sticky') return true;
    node = node.parentElement;
  }
  return false;
}

async function syncTarget(): Promise<void> {
  const token = ++syncToken;
  isMeasuring.value = true;
  targetRect.value = null;
  resizeObs?.disconnect();
  resizeObs = null;

  if (!current.value) {
    isMeasuring.value = false;
    return;
  }
  const step = current.value;

  if (step.route) {
    const [path, query] = step.route.split('?');
    const targetPath = path ?? '/';
    const targetSection = new URLSearchParams(query ?? '').get('section');
    const currentRoute = router.currentRoute.value;
    const sameRoute =
      currentRoute.path === targetPath &&
      (!targetSection || currentRoute.query['section'] === targetSection);
    if (!sameRoute) {
      await router.push({
        path: targetPath,
        query: targetSection ? { section: targetSection } : {},
      });
    }
  }

  await nextTick();
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  if (token !== syncToken) return;

  // Шаг без target (intro/finish) — center сразу, без задержек.
  if (!step.target) {
    isMeasuring.value = false;
    return;
  }

  const selectors = [
    `[data-tour="${step.target}"]`,
    ...(step.fallbackTargets ?? []).map((t) => `[data-tour="${t}"]`),
  ];
  const el = await waitForTarget(selectors);
  if (token !== syncToken) return;
  if (!el) {
    targetRect.value = null;
    isMeasuring.value = false;
    return;
  }

  const block: ScrollLogicalPosition = isFixedElement(el) ? 'nearest' : 'center';
  el.scrollIntoView({ behavior: 'smooth', block, inline: 'nearest' });
  await new Promise((r) => setTimeout(r, 260));
  if (token !== syncToken) return;

  measure(el);
  resizeObs = new ResizeObserver(() => measure(el));
  resizeObs.observe(el);

  // Дать одному кадру настояться, чтобы и halo и tooltip позиционировались
  // одновременно по уже стабильному rect-у.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  if (token !== syncToken) return;
  isMeasuring.value = false;
}

function measure(el: HTMLElement): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect();
    targetRect.value = isValidRect(rect) ? rect : null;
  });
}

function onResize(): void {
  vw.value = window.innerWidth;
  vh.value = window.innerHeight;
  const step = current.value;
  if (!step?.target) return;
  const selectors = [
    `[data-tour="${step.target}"]`,
    ...(step.fallbackTargets ?? []).map((t) => `[data-tour="${t}"]`),
  ];
  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && isValidRect(el.getBoundingClientRect())) {
      measure(el);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Placement engine — Floating-UI-style
// ---------------------------------------------------------------------------

type Side = 'top' | 'bottom' | 'left' | 'right';
/** 'inside' — тултип лежит внутри подсвеченной области (для гигантских target'ов).
 *  'center' — последний fallback, halo прячется. */
type Placement = Side | 'inside' | 'center';

const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};
const PERPENDICULAR: Record<Side, readonly Side[]> = {
  top: ['right', 'left'],
  bottom: ['right', 'left'],
  left: ['bottom', 'top'],
  right: ['bottom', 'top'],
};

interface VisibleRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly right: number;
  readonly bottom: number;
}

/** Пересечение target-rect с viewport (минус pad'ы). null → target вне экрана,
 *  halo не рисуем, placement → center. */
const visibleRect = computed<VisibleRect | null>(() => {
  const t = targetRect.value;
  if (!t) return null;
  const top = Math.max(t.y, topPad.value);
  const bottom = Math.min(t.y + t.height, vh.value - bottomPad);
  const left = Math.max(t.x, sidePad);
  const right = Math.min(t.x + t.width, vw.value - sidePad);
  if (bottom <= top || right <= left) return null;
  return { x: left, y: top, width: right - left, height: bottom - top, right, bottom };
});

/** Желаемая ширина тултипа — `MAX_W`, ограниченная viewport'ом. */
const desiredW = computed<number>(() =>
  Math.max(TOOLTIP_MIN_W, Math.min(TOOLTIP_MAX_W, vw.value - sidePad * 2)),
);

interface PlacementResult {
  readonly side: Placement;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  /** Координата стрелки внутри тултипа (X для top/bottom, Y для left/right). */
  readonly arrowOffset: number;
  /** Показывать halo? false для center-fallback (иначе тултип бы накрыл target). */
  readonly showHalo: boolean;
}

const placement = computed<PlacementResult>(() => {
  const v = visibleRect.value;
  const tw = desiredW.value;
  const th = tooltipH.value;
  const requested = current.value?.placement ?? 'auto';

  // intro/finish/no-target → center без halo.
  if (!v || current.value?.highlight === false) {
    return centerPlacement(tw, th);
  }

  // 1) Чистое свободное место с каждой стороны (без overlap'а с target).
  const space = {
    top: v.y - topPad.value - TOOLTIP_GAP,
    bottom: vh.value - bottomPad - v.bottom - TOOLTIP_GAP,
    left: v.x - sidePad - TOOLTIP_GAP,
    right: vw.value - sidePad - v.right - TOOLTIP_GAP,
  };

  const need = (s: Side): number => (s === 'top' || s === 'bottom' ? th : tw);
  const fits = (s: Side): boolean => space[s] >= need(s);

  // 2. Order по приоритету: explicit → opposite → perpendicular → fallback.
  const candidateOrder: Side[] =
    requested && requested !== 'auto'
      ? [requested, OPPOSITE[requested], ...PERPENDICULAR[requested]]
      : ['bottom', 'top', 'right', 'left'];

  for (const side of candidateOrder) {
    if (fits(side)) return positionOnSide(side, v, tw, th);
  }

  // 3. Снаружи не помещается — пробуем поместить ВНУТРЬ подсвеченной области.
  //    Для больших target'ов (settings-integrations и т.п.) это лучше, чем
  //    отрывать тултип в центр без halo: связь «что подсвечено / о чём текст»
  //    остаётся, а главная суть видна — внутри halo нет затемнения.
  if (v.width >= tw + INSIDE_PAD * 2 && v.height >= th + INSIDE_PAD * 2) {
    return insidePlacement(v, tw, th);
  }

  // 4. Снаружи — выбираем сторону с лучшим relative-space, если хотя бы 70%.
  const ranked = (['right', 'left', 'bottom', 'top'] as const)
    .map((s) => ({ side: s, ratio: space[s] / need(s) }))
    .sort((a, b) => b.ratio - a.ratio);
  const best = ranked[0];
  if (best && best.ratio >= FIT_THRESHOLD) {
    return positionOnSide(best.side, v, tw, th);
  }

  // 5. Inside «впритык» — даже если 32px-pad'а не хватило, пробуем влезть
  //    с минимальным отступом 12px. Лучше чуть-чуть «обнять» края, чем потерять
  //    halo и улететь в центр с пустым backdrop'ом.
  const TIGHT_PAD = 12;
  if (v.width >= tw + TIGHT_PAD * 2 && v.height >= th + TIGHT_PAD * 2) {
    return insidePlacement(v, tw, th, TIGHT_PAD);
  }

  // 6. Совсем некуда — center-fallback. Halo прячется.
  return centerPlacement(tw, th);
});

function positionOnSide(side: Side, v: VisibleRect, tw: number, th: number): PlacementResult {
  const targetCx = v.x + v.width / 2;
  const targetCy = v.y + v.height / 2;

  const clampX = (raw: number): number =>
    Math.min(Math.max(raw, sidePad), Math.max(sidePad, vw.value - tw - sidePad));
  const clampY = (raw: number): number =>
    Math.min(Math.max(raw, topPad.value), Math.max(topPad.value, vh.value - th - bottomPad));

  let left: number;
  let top: number;
  let arrowOffset: number;

  switch (side) {
    case 'bottom':
      top = v.bottom + TOOLTIP_GAP;
      left = clampX(targetCx - tw / 2);
      arrowOffset = clamp(targetCx - left, ARROW_MARGIN, tw - ARROW_MARGIN);
      break;
    case 'top':
      top = v.y - TOOLTIP_GAP - th;
      left = clampX(targetCx - tw / 2);
      arrowOffset = clamp(targetCx - left, ARROW_MARGIN, tw - ARROW_MARGIN);
      break;
    case 'right':
      left = v.right + TOOLTIP_GAP;
      top = clampY(targetCy - th / 2);
      arrowOffset = clamp(targetCy - top, ARROW_MARGIN, th - ARROW_MARGIN);
      break;
    case 'left':
    default:
      left = v.x - TOOLTIP_GAP - tw;
      top = clampY(targetCy - th / 2);
      arrowOffset = clamp(targetCy - top, ARROW_MARGIN, th - ARROW_MARGIN);
      break;
  }

  return { side, left, top, width: tw, arrowOffset, showHalo: true };
}

function centerPlacement(tw: number, th: number): PlacementResult {
  const top = Math.max(topPad.value, (vh.value - th) / 2);
  const left = Math.max(sidePad, (vw.value - tw) / 2);
  return { side: 'center', left, top, width: tw, arrowOffset: 0, showHalo: false };
}

/** Тултип внутри подсвеченной области. Halo остаётся, стрелки нет (тултип сам
 *  указывает на себя). Вертикально предпочитаем верхнюю треть halo, чтобы заголовок
 *  был ближе к началу подсвеченного блока — взгляд не «теряется» в большой секции.
 *  `pad` — отступ от рамки halo: INSIDE_PAD для нормального случая, ~12 для tight. */
function insidePlacement(v: VisibleRect, tw: number, th: number, pad = INSIDE_PAD): PlacementResult {
  const left = clamp(v.x + (v.width - tw) / 2, v.x + pad, v.right - tw - pad);
  const preferred = v.y + Math.max(pad, (v.height - th) / 3);
  const top = clamp(preferred, v.y + pad, v.bottom - th - pad);
  return { side: 'inside', left, top, width: tw, arrowOffset: 0, showHalo: true };
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// Tooltip + halo styles
// ---------------------------------------------------------------------------

const showHalo = computed<boolean>(() => placement.value.showHalo);

/** Halo рисуется по visibleRect с HALO_PAD. На длинных секциях это даёт «сжатую»
 *  дырку, ограниченную тем, что реально видно — иначе breathing-анимация box-shadow
 *  на 2000px-rect'е била бы далеко за viewport. */
const haloRect = computed<VisibleRect | null>(() => {
  if (!showHalo.value) return null;
  const v = visibleRect.value;
  if (!v) return null;
  return {
    x: v.x - HALO_PAD,
    y: v.y - HALO_PAD,
    width: v.width + HALO_PAD * 2,
    height: v.height + HALO_PAD * 2,
    right: v.right + HALO_PAD,
    bottom: v.bottom + HALO_PAD,
  };
});

const haloStyle = computed(() => {
  const h = haloRect.value;
  if (!h) return { display: 'none' };
  return {
    left: `${h.x}px`,
    top: `${h.y}px`,
    width: `${h.width}px`,
    height: `${h.height}px`,
    borderRadius: `${HALO_RADIUS}px`,
  };
});

const tooltipStyle = computed(() => {
  const p = placement.value;
  return {
    left: `${p.left}px`,
    top: `${p.top}px`,
    width: `${p.width}px`,
  };
});

const arrowStyle = computed(() => {
  const p = placement.value;
  if (p.side === 'center' || p.side === 'inside') return { display: 'none' };
  return { '--tour-arrow-offset': `${p.arrowOffset}px` } as Record<string, string>;
});

// ---------------------------------------------------------------------------
// Reactivity glue
// ---------------------------------------------------------------------------

watch(
  () => tour.stepIndex,
  () => {
    confirmingSkip.value = false;
    void syncTarget();
  },
  { immediate: true },
);

watch(tooltipEl, (el) => {
  tooltipResizeObs?.disconnect();
  tooltipResizeObs = null;
  if (!el) return;
  tooltipH.value = el.getBoundingClientRect().height || tooltipH.value;
  tooltipResizeObs = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry) tooltipH.value = entry.contentRect.height || tooltipH.value;
  });
  tooltipResizeObs.observe(el);
});

// Анимация входа триггерится по падающему фронту isMeasuring (когда target
// измерен и halo+tooltip готовы показаться). До этого CSS держит opacity:0,
// иначе GSAP бы fromTo'нул в позиции центра-фолбэка ещё до measure.
watch(isMeasuring, async (now, prev) => {
  if (prev && !now) {
    await nextTick();
    if (!tooltipEl.value || ui.reduceMotion) return;
    gsap.fromTo(
      tooltipEl.value,
      { y: 8, opacity: 0, scale: 0.97 },
      { y: 0, opacity: 1, scale: 1, duration: 0.36, ease: 'power3.out' },
    );
  }
});

onMounted(() => {
  readTitlebarHeight();
  if (typeof window === 'undefined') return;
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);
  window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onResize, true);
    window.removeEventListener('keydown', onKey);
  }
  resizeObs?.disconnect();
  tooltipResizeObs?.disconnect();
  if (rafId) cancelAnimationFrame(rafId);
});

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function onNext(): void {
  if (confirmingSkip.value) confirmingSkip.value = false;
  tour.next();
}
function onBack(): void {
  if (confirmingSkip.value) confirmingSkip.value = false;
  tour.back();
}
function onSkipChapter(): void {
  tour.skipChapter();
}
function onAskSkip(): void {
  confirmingSkip.value = true;
}
function onConfirmSkip(): void {
  confirmingSkip.value = false;
  tour.skip();
}
function onAccidentalClick(): void {
  confirmingSkip.value = true;
}

function onKey(e: KeyboardEvent): void {
  if (!tour.isActive) return;
  if (e.key === 'Escape') {
    if (confirmingSkip.value) confirmingSkip.value = false;
    else onAskSkip();
  } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (!confirmingSkip.value) onNext();
  } else if (e.key === 'ArrowLeft') {
    if (!confirmingSkip.value) onBack();
  }
}
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.tour {
  position: fixed;
  inset: 0;
  z-index: var(--z-tour);
  pointer-events: auto;

  // Blur-фон рисуется ТОЛЬКО когда нет halo (intro/finish/center-fallback).
  // На шагах с halo используем чистый SVG-mask — иначе backdrop-filter не клипается
  // через mask и blur «протекает» поверх дырки.
  &__backdrop {
    position: absolute;
    inset: 0;
    backdrop-filter: blur(6px) saturate(120%);
    -webkit-backdrop-filter: blur(6px) saturate(120%);
    background: rgba(8, 8, 16, 0.18);
    pointer-events: none;
  }

  &__mask {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: auto;
  }

  &__halo {
    position: fixed;
    pointer-events: none;
    box-shadow:
      0 0 0 2px rgba(var(--color-brand-purple-rgb), 0.6),
      0 0 36px rgba(var(--color-brand-purple-rgb), 0.45),
      0 0 96px rgba(var(--color-brand-pink-rgb), 0.18);
    animation: halo-breathe 2.4s ease-in-out infinite;
    z-index: 1;
    opacity: 1;
    transition:
      opacity 200ms var(--ease-out),
      left 220ms var(--ease-out),
      top 220ms var(--ease-out),
      width 220ms var(--ease-out),
      height 220ms var(--ease-out);

    // Скрываем halo пока target ещё не измерен — иначе он мигает на старом
    // месте за долю секунды до прыжка на новое.
    &--measuring {
      opacity: 0;
    }
  }

  &__tooltip {
    position: fixed;
    padding: 18px 20px 16px;
    border-radius: var(--radius-lg);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
    pointer-events: auto;
    z-index: 2;
    max-height: calc(100vh - var(--titlebar-height, 46px) - 48px);
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-gutter: stable;
    transition:
      left 320ms var(--ease-out),
      top 320ms var(--ease-out),
      width 320ms var(--ease-out);

    // Пока syncTarget измеряет новый шаг, тултип невидим — иначе он мигает в
    // center-fallback'е за долю секунды до прыжка в финальную позицию.
    // !important перебивает inline-opacity от GSAP, если та осталась с прошлого шага.
    &--measuring {
      opacity: 0 !important;
      transition: none;
    }

    // Inside-placement: тултип лежит внутри подсвеченной области. Лёгкий accent
    // border + усиленная тень, чтобы визуально отделить его от halo-рамки и
    // дать понять «карточка плавает над содержимым подсветки».
    &--inside {
      border: 1px solid rgba(var(--color-brand-purple-rgb), 0.35);
      box-shadow:
        0 24px 64px rgba(0, 0, 0, 0.7),
        0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    }

    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 6px;
    }
  }

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 8px;
    gap: 12px;
  }

  &__head-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__chapter {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    padding: 3px 9px;
    border-radius: 999px;
    background: rgba(var(--color-brand-purple-rgb), 0.15);
    border: 1px solid rgba(var(--color-brand-purple-rgb), 0.3);
    color: var(--color-brand-purple);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    line-height: 1.2;
  }

  &__step {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--color-text-muted);
    letter-spacing: 0.04em;
  }

  &__close {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.06);
    border: 0;
    color: var(--color-text-secondary);
    display: grid;
    place-items: center;
    cursor: pointer;
    transition:
      background 200ms var(--ease-out),
      color 200ms var(--ease-out);

    &:hover {
      background: rgba(255, 255, 255, 0.12);
      color: var(--color-text-primary);
    }
  }

  &__title {
    font-family: var(--font-family-display);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0 0 6px;
  }

  &__body {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--color-text-secondary);
    margin: 0 0 12px;
  }

  &__bullets {
    list-style: none;
    margin: 0 0 14px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  &__bullet {
    position: relative;
    padding: 0 0 0 18px;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--color-text-secondary);

    &::before {
      content: '';
      position: absolute;
      left: 4px;
      top: 8px;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: rgba(var(--color-brand-purple-rgb), 0.7);
    }
  }

  &__tip {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0 0 14px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: rgba(var(--color-brand-cyan-rgb), 0.06);
    border: 1px solid rgba(var(--color-brand-cyan-rgb), 0.18);
    font-size: 12px;
    line-height: 1.45;
    color: var(--color-text-secondary);
    font-style: italic;

    > :deep(.icon) {
      flex-shrink: 0;
      margin-top: 2px;
      color: var(--color-brand-cyan);
    }
    span {
      min-width: 0;
    }
  }

  &__progress {
    display: flex;
    gap: 4px;
    margin-bottom: 14px;
  }

  &__progress-dot {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.08);
    transition: background 280ms var(--ease-out);

    &.is-active {
      background: var(--gradient-brand);
    }
    &.is-done {
      background: rgba(var(--color-brand-purple-rgb), 0.5);
    }
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }

  // Динамическая стрелка через CSS-var --tour-arrow-offset.
  // Позиция оси (top/bottom/left/right) зависит от side; указатель — повёрнутый
  // на 45° квадрат с двумя бордерами, продолжающий стекло тултипа.
  &__arrow {
    position: absolute;
    width: 14px;
    height: 14px;
    background: rgba(var(--glass-tint), var(--glass-alpha-strong));
    backdrop-filter: blur(var(--glass-blur-strong)) saturate(var(--glass-saturation));
    -webkit-backdrop-filter: blur(var(--glass-blur-strong)) saturate(var(--glass-saturation));
    pointer-events: none;

    &[data-side='bottom'] {
      top: -7px;
      left: var(--tour-arrow-offset, 50%);
      transform: translateX(-50%) rotate(45deg);
      border-left: 1px solid var(--glass-edge);
      border-top: 1px solid var(--glass-edge);
    }
    &[data-side='top'] {
      bottom: -7px;
      left: var(--tour-arrow-offset, 50%);
      transform: translateX(-50%) rotate(45deg);
      border-right: 1px solid var(--glass-edge);
      border-bottom: 1px solid var(--glass-edge);
    }
    &[data-side='right'] {
      left: -7px;
      top: var(--tour-arrow-offset, 50%);
      transform: translateY(-50%) rotate(45deg);
      border-left: 1px solid var(--glass-edge);
      border-bottom: 1px solid var(--glass-edge);
    }
    &[data-side='left'] {
      right: -7px;
      top: var(--tour-arrow-offset, 50%);
      transform: translateY(-50%) rotate(45deg);
      border-right: 1px solid var(--glass-edge);
      border-top: 1px solid var(--glass-edge);
    }
  }

  // Confirm-pill: всплывает по центру при попытке выйти из тура.
  &__confirm {
    position: fixed;
    left: 50%;
    bottom: 36px;
    transform: translateX(-50%);
    padding: 16px 22px;
    border-radius: var(--radius-lg);
    background: rgba(20, 20, 30, 0.92);
    border: 1px solid rgba(var(--color-brand-purple-rgb), 0.45);
    backdrop-filter: blur(14px);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    min-width: 320px;
    max-width: calc(100vw - 48px);
  }
  &__confirm-text {
    margin: 0;
    font-size: 14.5px;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  &__confirm-hint {
    font-size: 12px;
    color: var(--color-text-muted);
    text-align: center;
  }
  &__confirm-actions {
    margin-top: 10px;
    display: flex;
    gap: 8px;
  }
}

.tour-confirm-enter-active,
.tour-confirm-leave-active {
  transition:
    opacity 240ms var(--ease-out),
    transform 240ms var(--ease-out);
}
.tour-confirm-enter-from,
.tour-confirm-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}

@keyframes halo-breathe {
  0%,
  100% {
    box-shadow:
      0 0 0 2px rgba(var(--color-brand-purple-rgb), 0.55),
      0 0 36px rgba(var(--color-brand-purple-rgb), 0.45),
      0 0 96px rgba(var(--color-brand-pink-rgb), 0.18);
  }
  50% {
    box-shadow:
      0 0 0 2px rgba(var(--color-brand-purple-rgb), 0.85),
      0 0 48px rgba(var(--color-brand-purple-rgb), 0.7),
      0 0 120px rgba(var(--color-brand-pink-rgb), 0.32);
  }
}

.tour-enter-active,
.tour-leave-active {
  transition: opacity 280ms var(--ease-out);
}
.tour-enter-from,
.tour-leave-to {
  opacity: 0;
}

// ---- Mobile: bottom-sheet вместо плавающего tooltip ----
@media (max-width: 720px) {
  .tour {
    &__tooltip {
      left: 0 !important;
      right: 0 !important;
      top: auto !important;
      bottom: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
      transform: none !important;
      max-height: 78vh;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      padding: 16px 16px 20px;
      padding-bottom: max(20px, env(safe-area-inset-bottom));
      box-shadow: 0 -16px 48px rgba(0, 0, 0, 0.6);
    }

    &__arrow {
      display: none;
    }

    &__title {
      font-size: 16px;
    }
    &__body {
      font-size: 13px;
      margin-bottom: 10px;
    }
    &__bullets {
      margin-bottom: 12px;
    }
    &__actions {
      flex-direction: column-reverse;
      gap: 6px;

      :deep(.base-button),
      :deep(.btn) {
        width: 100%;
      }
    }
    &__halo {
      animation-duration: 3s;
    }
    &__confirm {
      left: 16px;
      right: 16px;
      bottom: calc(78vh + 12px);
      width: auto;
      max-width: none;
      transform: none;
    }
  }
}

@media (max-width: 380px) {
  .tour__chapter {
    font-size: 9.5px;
    padding: 2px 7px;
  }
  .tour__step {
    display: none;
  }
  .tour__bullet {
    font-size: 12px;
    padding-left: 16px;
  }
}

@media (max-width: 900px) and (max-height: 500px) {
  .tour__tooltip {
    max-height: 90vh;
  }
}
</style>
