<template>
  <section class="welcome" ref="root" @keydown="onKeydown" tabindex="0">
    <!-- Brand-аура: статичная плоскость + два мягких пятна.
         Per feedback flat-hero — НЕ bubble-glass. -->
    <div class="welcome__aura" aria-hidden="true" />
    <div class="welcome__grain" aria-hidden="true" />

    <header class="welcome__bar">
      <div class="welcome__bar-mark">
        <span class="welcome__mark-dot" />
        <span class="welcome__mark-text">SmartHome Hub · Onboarding</span>
      </div>
      <div class="steps welcome__bar-progress">
        <div class="steps__rail">
          <div class="steps__fill" :style="{ width: `${railProgress}%` }" />
        </div>
        <span class="steps__label">{{ stepLabel }}</span>
      </div>
      <button v-if="step < totalSteps - 1" type="button" class="welcome__skip" @click="skip">
        Пропустить
        <BaseIcon name="arrow-right" :size="14" />
      </button>
      <span v-else class="welcome__skip welcome__skip--ghost">Финал</span>
    </header>

    <!-- Сцена-обёртка фиксированной min-height: step-cards живут одновременно
         (absolute-stack), активная видна. Crossfade — opacity + filter, без
         translateY. → grid-row не «дышит» → orb-стейдж не плывёт. -->
    <div class="welcome__layout">
      <div class="welcome__pane welcome__pane--copy">
        <div ref="sceneEl" class="welcome__scene">
          <article
            v-for="(s, idx) in scenes"
            :key="s.id"
            ref="cards"
            class="welcome__card"
            :class="{ 'welcome__card--active': idx === step }"
            :aria-hidden="idx !== step"
          >
            <template v-if="s.id === 'hero'">
              <span class="welcome__kicker">Добро пожаловать</span>
              <h1 class="welcome__title">
                Один хаб
                <span class="welcome__title-accent">
                  <span class="text--gradient">для всего умного дома</span>
                  <span class="welcome__title-line" aria-hidden="true" />
                </span>
              </h1>
              <p class="welcome__lead">
                28+ интеграций, локальное управление, голосовые сценарии через Алису. Без облака,
                без подписок, без лишнего.
              </p>
              <ul class="welcome__pill-list">
                <li v-for="b in heroBullets" :key="b">
                  <span class="welcome__pill-icon"><BaseIcon name="check" :size="12" /></span>
                  <span>{{ b }}</span>
                </li>
              </ul>
              <div class="welcome__actions">
                <BaseButton variant="primary" size="lg" icon-right="arrow-right" @click="next">
                  Поехали
                </BaseButton>
                <BaseButton variant="ghost" size="lg" @click="skip">Я уже знаком</BaseButton>
              </div>
            </template>

            <template v-else-if="s.id === 'features'">
              <span class="welcome__kicker">Шаг 02 · Что вы получите</span>
              <h2 class="welcome__title welcome__title--sm">
                Три способа управлять
                <span class="welcome__title-accent">
                  <span class="text--gradient">умным домом</span>
                </span>
              </h2>
              <p class="welcome__lead">
                Каждый канал работает независимо. Можно начать с одного и постепенно подключать
                остальные.
              </p>
              <div class="welcome__feature-grid">
                <article
                  v-for="f in features"
                  :key="f.title"
                  class="welcome__feature"
                  :style="{
                    '--tone': `var(--color-brand-${f.tone})`,
                    '--tone-rgb': `var(--color-brand-${f.tone}-rgb)`,
                  }"
                >
                  <div class="welcome__feature-icon"><span v-safe-html="f.icon" /></div>
                  <div class="welcome__feature-title">{{ f.title }}</div>
                  <div class="welcome__feature-text">{{ f.text }}</div>
                  <div class="welcome__feature-tags">
                    <span v-for="t in f.tags" :key="t" class="welcome__feature-tag">
                      {{ t }}
                    </span>
                  </div>
                </article>
              </div>
              <div class="welcome__actions">
                <BaseButton variant="ghost" icon-left="arrow-left" @click="back">Назад</BaseButton>
                <BaseButton variant="primary" icon-right="arrow-right" @click="next">
                  Дальше
                </BaseButton>
              </div>
            </template>

            <template v-else-if="s.id === 'path'">
              <span class="welcome__kicker">Шаг 03 · Выбор пути</span>
              <h2 class="welcome__title welcome__title--sm">
                С чего
                <span class="welcome__title-accent">
                  <span class="text--gradient">начнём?</span>
                </span>
              </h2>
              <p class="welcome__lead">
                По умолчанию запустим LAN-сканирование — это самый быстрый старт. Любой путь
                доступен из бокового меню в любой момент.
              </p>
              <div class="welcome__path-grid">
                <button
                  v-for="p in paths"
                  :key="p.id"
                  type="button"
                  class="welcome__path"
                  :class="{ 'welcome__path--active': chosenPath === p.id }"
                  :style="{
                    '--tone': `var(--color-brand-${p.tone})`,
                    '--tone-rgb': `var(--color-brand-${p.tone}-rgb)`,
                  }"
                  @click="chosenPath = p.id"
                >
                  <span class="welcome__path-tag">{{ p.tag }}</span>
                  <span class="welcome__path-title">{{ p.title }}</span>
                  <span class="welcome__path-text">{{ p.text }}</span>
                  <span class="welcome__path-pick">
                    <BaseIcon :name="chosenPath === p.id ? 'check' : 'arrow-right'" :size="14" />
                    {{ chosenPath === p.id ? 'Выбран' : 'Выбрать' }}
                  </span>
                </button>
              </div>
              <div class="welcome__actions">
                <BaseButton variant="ghost" icon-left="arrow-left" @click="back">Назад</BaseButton>
                <BaseButton variant="primary" icon-right="arrow-right" @click="next">
                  Дальше
                </BaseButton>
              </div>
            </template>

            <template v-else>
              <span class="welcome__kicker">Шаг 04 · Финал</span>
              <h2 class="welcome__title welcome__title--sm">
                Хаб
                <span class="welcome__title-accent">
                  <span class="text--gradient">готов к работе</span>
                </span>
              </h2>
              <p class="welcome__lead">
                Покажу тур по интерфейсу — 60 секунд, чтобы освоиться. Или сразу откроем
                <strong>{{ chosenPathTitle ?? 'хаб' }}</strong
                >.
              </p>
              <div class="welcome__finish">
                <button
                  type="button"
                  class="welcome__finish-card welcome__finish-card--primary"
                  @click="finish(true)"
                >
                  <span class="welcome__finish-icon">
                    <BaseIcon name="info" :size="20" />
                  </span>
                  <span class="welcome__finish-body">
                    <span class="welcome__finish-title">Покажу всё на интерфейсе</span>
                    <span class="welcome__finish-text">
                      Подсветим где искать устройства, как собрать сценарий и подключить колонку.
                      Прервать — Esc.
                    </span>
                  </span>
                  <span class="welcome__finish-cta">
                    Начать тур <BaseIcon name="arrow-right" :size="14" />
                  </span>
                </button>
                <button type="button" class="welcome__finish-card" @click="finish(false)">
                  <span class="welcome__finish-icon">
                    <BaseIcon name="arrow-right" :size="20" />
                  </span>
                  <span class="welcome__finish-body">
                    <span class="welcome__finish-title">
                      Сразу к {{ chosenPathTitle ?? 'хабу' }}
                    </span>
                    <span class="welcome__finish-text">
                      Пропустим тур и откроем нужный раздел. Подсказки доступны в Настройках.
                    </span>
                  </span>
                  <span class="welcome__finish-cta">Перейти</span>
                </button>
              </div>
              <ul class="welcome__tips">
                <li v-for="t in finishTips" :key="t.title">
                  <kbd>{{ t.title }}</kbd>
                  <span>{{ t.text }}</span>
                </li>
              </ul>
            </template>
          </article>
        </div>
      </div>

      <!-- Visual pane: фиксированная (viewport-driven) ширина колонки + стейдж
           чёткого размера. Container queries намеренно убраны — иначе высота
           текстовой колонки таскает orb-стейдж за собой. -->
      <aside class="welcome__pane welcome__pane--visual" aria-hidden="true">
        <div class="welcome__stage">
          <JarvisOrb size="xl" ambient :state="orbState" class="welcome__orb" />
          <OrbitalChips :chips="orbitalChips" />
        </div>
      </aside>
    </div>

    <footer class="welcome__bottom">
      <div class="welcome__dots">
        <button
          v-for="i in totalSteps"
          :key="i"
          type="button"
          class="welcome__dot"
          :class="{
            'welcome__dot--active': i - 1 === step,
            'welcome__dot--done': i - 1 < step,
          }"
          :aria-label="`Шаг ${i}: ${stepLabels[i - 1]}`"
          @click="goTo(i - 1)"
        />
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { gsap } from 'gsap';
import { useUiStore } from '@/stores/ui';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseIcon from '@/components/base/BaseIcon.vue';
import JarvisOrb from '@/components/visuals/JarvisOrb.vue';
import OrbitalChips from '@/components/visuals/OrbitalChips.vue';

const ui = useUiStore();
const router = useRouter();
const { reduceMotion } = storeToRefs(ui);

type PathId = 'lan' | 'alice' | 'cloud';

const step = ref(0);
const totalSteps = 4;
const motion = computed(() => !reduceMotion.value);
const chosenPath = ref<PathId>('lan');

const root = useTemplateRef<HTMLElement>('root');
const sceneEl = useTemplateRef<HTMLElement>('sceneEl');
const cards = useTemplateRef<HTMLElement[]>('cards');

const scenes = [{ id: 'hero' }, { id: 'features' }, { id: 'path' }, { id: 'finish' }] as const;

const stepLabels = ['Знакомство', 'Возможности', 'Выбор пути', 'Финал'];
const stepLabel = computed(
  () => `Шаг ${step.value + 1} / ${totalSteps} · ${stepLabels[step.value]}`,
);
const railProgress = computed(() => ((step.value + 1) / totalSteps) * 100);

// Hero и финал — orb «оживает» (главный визуальный акцент). Content-тяжёлые
// шаги features/path — orb успокаивается, чтобы не отвлекать от выбора.
const orbState = computed<'idle' | 'active'>(() =>
  step.value === 0 || step.value === 3 ? 'active' : 'idle',
);

const heroBullets = [
  'Локально, без облака',
  'Один установщик',
  '28+ интеграций',
  'Голос через Алису',
];

interface Feature {
  title: string;
  text: string;
  tone: string;
  icon: string;
  tags: string[];
}

const features: Feature[] = [
  {
    title: 'Локальная сеть',
    text: 'Yeelight, Shelly, WiZ, LIFX, Hue, TP-Link, miIO — без интернета.',
    tone: 'violet',
    tags: ['Wi-Fi', 'mDNS', 'UPnP'],
    icon: '<svg viewBox="0 0 24 24" fill="none"><path d="M2 9c5.5-5.5 14.5-5.5 20 0M5.5 12.5c3.5-3.5 9.5-3.5 13 0M9 16c1.7-1.7 4.3-1.7 6 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="20" r="1.4" fill="currentColor"/></svg>',
  },
  {
    title: 'Колонка Алисы',
    text: 'Один клик «Войти через Яндекс» — хаб найдёт ваши Станции.',
    tone: 'pink',
    tags: ['OAuth', 'Glagol', 'WSS:1961'],
    icon: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M8 11v2M10.5 9.5v5M13.5 8.5v7M16 10.5v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  },
  {
    title: 'Облачные платформы',
    text: 'Сбер Дом, Tuya, Mi Home, eWeLink, Govee — единая форма ключей.',
    tone: 'amber',
    tags: ['API', 'OAuth', 'РФ + EN'],
    icon: '<svg viewBox="0 0 24 24" fill="none"><path d="M7 18a4 4 0 010-8 6 6 0 0111 1.5 4 4 0 011 7.5H7z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13" r="1.3" fill="currentColor"/></svg>',
  },
];

interface Path {
  id: PathId;
  tag: string;
  title: string;
  text: string;
  tone: string;
}

const paths: Path[] = [
  {
    id: 'lan',
    tag: 'Самый быстрый',
    title: 'Найти в LAN',
    text: 'Yeelight, Shelly, Hue, miIO. Хаб опросит сеть за 5 секунд.',
    tone: 'violet',
  },
  {
    id: 'alice',
    tag: 'Самый мощный',
    title: 'Подключить Алису',
    text: 'Импорт всех устройств из «Дома с Алисой» + локальная Станция.',
    tone: 'pink',
  },
  {
    id: 'cloud',
    tag: 'Самый универсальный',
    title: 'Облачные интеграции',
    text: 'Tuya, Mi Home, Сбер Дом, eWeLink, Aqara — 16 платформ.',
    tone: 'amber',
  },
];

const chosenPathTitle = computed(() => {
  const p = paths.find((x) => x.id === chosenPath.value);
  return p?.title.toLowerCase();
});

const finishTips = [
  { title: 'Esc', text: 'закрыть тур или модалку' },
  { title: '← / →', text: 'листать шаги клавиатурой' },
  { title: '⌘/Ctrl K', text: 'быстрый поиск (скоро)' },
  { title: 'Настройки', text: 'пройти онбординг заново' },
];

// Подборка для орба: top-of-mind интеграции — массовые LAN-бренды + ключевые
// протоколы + российские платформы. Fibonacci-распределение OrbitalChips даёт
// одинаково ровный паттерн на 8 / 14 / 24 чипах, поэтому количество подбираем
// от UX (узнаваемость, плотность), не технически. 14 — visually полно, но
// без перегруза: каждый chip остаётся читаемым на любой rotation сферы.
const orbitalChips = [
  // LAN-light (массовые умные лампы) — самые узнаваемые иконки.
  { id: 'yeelight', label: 'Yeelight' },
  { id: 'hue', label: 'Hue' },
  { id: 'lifx', label: 'LIFX' },
  { id: 'wiz', label: 'WiZ' },
  // LAN-actuators (реле, розетки, сенсоры) — тоже high-recognition.
  { id: 'shelly', label: 'Shelly' },
  { id: 'aqara-cloud', label: 'Aqara' },
  { id: 'switchbot', label: 'SwitchBot' },
  // Universal-протоколы — без них «умный дом» не определяется.
  { id: 'matter', label: 'Matter' },
  { id: 'homekit', label: 'HomeKit' },
  { id: 'home-assistant', label: 'Home Assistant' },
  // Российские платформы — таргет-аудитория проекта.
  { id: 'yandex-iot', label: 'Алиса' },
  { id: 'sber-home', label: 'Сбер' },
  // Cloud-гиганты китайского сегмента — реальный охват по бытовой технике.
  { id: 'tuya', label: 'Tuya' },
  { id: 'miio', label: 'Mi Home' },
];

// =====================================================================
// GSAP step-transitions: все step-cards живут одновременно (absolute-stack);
// активный — opacity 1 + filter:none, остальные — opacity 0 + visibility:hidden.
// Никаких translateY / scale → grid-row статична → orb-стейдж не дёргается.
// =====================================================================
let activeTl: gsap.core.Timeline | null = null;
let entranceTl: gsap.core.Timeline | null = null;

function applyStepInstantly(idx: number): void {
  if (!cards.value) return;
  cards.value.forEach((el, i) => {
    gsap.set(el, {
      opacity: i === idx ? 1 : 0,
      visibility: i === idx ? 'visible' : 'hidden',
      pointerEvents: i === idx ? 'auto' : 'none',
      y: 0,
    });
  });
}

function animateStep(prev: number, idx: number): void {
  if (!cards.value || cards.value.length === 0) return;
  if (!motion.value) {
    applyStepInstantly(idx);
    return;
  }
  activeTl?.kill();

  const fromEl = cards.value[prev];
  const toEl = cards.value[idx];
  if (!toEl) return;

  // Opacity-only crossfade. force3D промоутит карточку в отдельный compositor-слой.
  const tl = gsap.timeline({ defaults: { ease: 'power3.out', force3D: true } });

  if (fromEl && fromEl !== toEl) {
    tl.to(fromEl, {
      opacity: 0,
      duration: 0.22,
      onStart: () => gsap.set(fromEl, { pointerEvents: 'none' }),
      onComplete: () => gsap.set(fromEl, { visibility: 'hidden' }),
    });
  }

  // Children stagger: opacity без transform — конкуренция с Vue route-fade'ом
  // на parent'е давала бы «дрейф» при смене шага.
  tl.set(toEl, { visibility: 'visible', pointerEvents: 'auto', opacity: 0 })
    .to(toEl, { opacity: 1, duration: 0.32 }, fromEl && fromEl !== toEl ? '-=0.12' : 0)
    .fromTo(
      toEl.children,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.36, stagger: 0.04 },
      '-=0.26',
    );

  activeTl = tl;
}

function goTo(idx: number): void {
  if (idx < 0 || idx >= totalSteps || idx === step.value) return;
  step.value = idx;
}

function next(): void {
  if (step.value < totalSteps - 1) step.value += 1;
  else finish(true);
}

function back(): void {
  if (step.value > 0) step.value -= 1;
}

function skip(): void {
  finish(false);
}

function pathRoute(): string {
  switch (chosenPath.value) {
    case 'alice':
      return '/alice';
    case 'cloud':
      return '/settings';
    case 'lan':
    default:
      return '/discovery';
  }
}

function finish(startTour: boolean): void {
  ui.completeOnboarding();
  if (!startTour) ui.completeTour();
  const target = pathRoute();
  const query: Record<string, string> = {};
  if (startTour) query['tour'] = '1';
  if (target === '/discovery') query['scan'] = '1';
  void router.replace({ path: target, query });
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowRight' || e.key === 'Enter') {
    e.preventDefault();
    next();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    back();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    skip();
  }
}

watch(step, (now, prev) => animateStep(prev, now));

// =====================================================================
// Touch swipe handler. Горизонтальный жест → next/back step.
//   - Threshold X: 60px (случайные тапы отсекаются).
//   - dy > dx: вертикаль приоритетна → нативный scroll контента.
//   - dt > 600ms: жест считается долгим, игнорируется.
// =====================================================================
let touchStart: { x: number; y: number; t: number } | null = null;

function onTouchStart(e: TouchEvent): void {
  const t = e.touches[0];
  if (!t) return;
  touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
}

function onTouchEnd(e: TouchEvent): void {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  if (!t) return;
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  const dt = performance.now() - touchStart.t;
  touchStart = null;

  if (dt > 600) return; // долгое — не свайп
  if (Math.abs(dy) > Math.abs(dx)) return; // вертикаль → scroll
  if (Math.abs(dx) < 60) return; // короткое — не свайп

  if (dx < 0) next();
  else back();
}

onMounted(async () => {
  root.value?.focus();
  await nextTick();
  applyStepInstantly(step.value);

  root.value?.addEventListener('touchstart', onTouchStart, { passive: true });
  root.value?.addEventListener('touchend', onTouchEnd, { passive: true });

  if (!motion.value || !root.value) return;

  // Entrance: НЕ затухаем root повторно — это делает уже Vue route-transition
  // (см. .fade-slide / .fade в App.vue). Двойной fade давал «вспышку» — Vue
  // фейдит, GSAP сразу snap'ит обратно в opacity:0 и фейдит ещё раз.
  // Анимируем только внутренние элементы поверх Vue-fade'а: bar → visual → cards.
  // СИНХРОННО в onMounted: immediateRender ставит FROM-state ДО paint'а — fade
  // видно с opacity:0, без flash'а на frame'е 0.
  entranceTl?.kill();
  const tl = gsap.timeline({
    defaults: { ease: 'power3.out', force3D: true },
  });
  entranceTl = tl;
  tl.from('.welcome__bar > *', {
    opacity: 0,
    y: -6,
    duration: 0.4,
    stagger: 0.05,
    clearProps: 'opacity,transform',
  }).from(
    '.welcome__pane--visual',
    {
      opacity: 0,
      scale: 0.96,
      duration: 0.55,
      ease: 'power2.out',
      clearProps: 'opacity,transform',
    },
    '-=0.25',
  );

  const active = cards.value?.[step.value];
  if (active) {
    tl.fromTo(
      active.children,
      { opacity: 0, y: 10 },
      {
        opacity: 1,
        y: 0,
        duration: 0.45,
        stagger: 0.05,
        clearProps: 'opacity,transform',
      },
      '-=0.35',
    );
  }
});

onBeforeUnmount(() => {
  activeTl?.kill();
  activeTl = null;
  entranceTl?.kill();
  entranceTl = null;
  root.value?.removeEventListener('touchstart', onTouchStart);
  root.value?.removeEventListener('touchend', onTouchEnd);
});
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.welcome {
  // Welcome рендерится с classed `app__fullscreen` (см. App.vue):
  // `flex: 1; min-height: 0` уже выставлены на нашем root-элементе через class
  // merge — section получает остаточную высоту viewport'а минус titlebar.
  //
  // Внутри — собственный flex-column, чтобы bar/layout/footer стояли в
  // фиксированной вертикали: header сразу под titlebar'ом, dots-footer
  // вплотную к нижнему краю, layout (flex: 1) растягивается между.
  //
  // height/min-height не выставляем: parent `.app__fullscreen { flex: 1 }` уже
  // даёт высоту, а percentage в flex-context Chromium резолвит как overflow.
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: clamp(12px, 1.6vh, 24px);
  padding: clamp(14px, 1.8vh, 22px) clamp(24px, 4vw, 64px) clamp(16px, 2vh, 28px);
  color: var(--color-text-primary);
  outline: none;
  overflow: hidden;
  isolation: isolate;
  background: var(--color-bg-base);

  // Brand aura: flat plane + три soft pятна (НЕ bubble-glass).
  &__aura {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
      radial-gradient(
        58% 42% at 8% 6%,
        rgba(var(--color-brand-violet-rgb), 0.22) 0%,
        transparent 65%
      ),
      radial-gradient(
        45% 38% at 96% 102%,
        rgba(var(--color-brand-amber-rgb), 0.14) 0%,
        transparent 70%
      ),
      radial-gradient(
        55% 48% at 92% 0%,
        rgba(var(--color-brand-pink-rgb), 0.18) 0%,
        transparent 65%
      );
  }

  &__grain {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background-image: var(--glass-noise);
    background-size: 240px 240px;
    opacity: 0.05;
    mix-blend-mode: overlay;
  }

  > * {
    position: relative;
    z-index: 1;
  }

  // =================================================================
  // Header bar — tool-bar высоты, держим консистентный visual rhythm с
  // BasePageHeader на остальных view'ах: subtle plane + hairline border +
  // достаточный min-height (читается как «полноценный» bar, а не тонкая
  // полоска под titlebar'ом).
  // =================================================================
  &__bar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-5);
    align-items: center;
    min-height: clamp(56px, 6vh, 68px);
    padding: 0 clamp(10px, 1.2vw, 18px);
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.022);
    border: 1px solid rgba(255, 255, 255, 0.05);
    box-shadow:
      0 18px 48px -36px rgba(0, 0, 0, 0.7),
      inset 0 1px 0 rgba(255, 255, 255, 0.03);
    flex: 0 0 auto;
  }

  &__bar-mark {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-small);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-micro);
  }

  &__mark-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gradient-brand);
    box-shadow: 0 0 12px rgba(var(--color-brand-violet-rgb), 0.7);
    animation: welcomeMarkPulse calc(2.4s / max(var(--motion-scale, 1), 0.001)) ease-in-out infinite;
  }

  &__bar-progress {
    min-width: 0;
  }

  &__skip {
    background: transparent;
    border: var(--border-thin) solid var(--color-border-subtle);
    color: var(--color-text-secondary);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-pill);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-small);
    font-family: inherit;
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);

    &:hover {
      color: var(--color-text-primary);
      background: var(--surface-hover);
      border-color: var(--color-border-soft);
    }

    &--ghost {
      pointer-events: none;
      opacity: 0.6;
    }
  }

  // =================================================================
  // Layout: copy-pane (left) + visual-pane (right). Visual-pane —
  // фиксированной ширины через viewport-clamp, чтобы copy любой высоты не
  // растягивал колонку (= не двигал --stage-size).
  // =================================================================
  &__layout {
    width: 100%;
    max-width: var(--content-max);
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(360px, 38vw, 560px);
    gap: clamp(24px, 3vw, 56px);
    align-items: center;
    flex: 1 1 auto;
    min-height: 0;

    @media (max-width: 1024px) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: clamp(220px, 26vh, 320px) minmax(0, 1fr);
      align-items: stretch;
    }
  }

  &__pane {
    min-width: 0;
    min-height: 0;
  }

  &__pane--copy {
    align-self: center;
  }

  // Scene min-height: hero ~340, features ~430, path ~440, finish ~450 — берём
  // 440 как safe-минимум для самого высокого шага.
  &__scene {
    position: relative;
    width: 100%;
    min-height: clamp(360px, 44vh, 460px);
  }

  &__card {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    will-change: opacity, filter;

    // Дефолт — невидимо: applyStepInstantly() в onMounted синхронизирует
    // активную с первым шагом до первого paint'а.
    opacity: 0;
    visibility: hidden;
    pointer-events: none;

    &--active {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
    }
  }

  // =================================================================
  // Typography: hero / kicker / lead
  // =================================================================
  &__kicker {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-micro);
    color: var(--color-brand-violet);
    text-transform: uppercase;
    letter-spacing: var(--tracking-micro);
    font-variant-numeric: tabular-nums;
  }

  &__title {
    font-family: var(--font-family-display);
    font-size: var(--font-size-display);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-display);
    font-weight: 720;
    color: var(--color-text-primary);
    margin: 0;
    text-wrap: balance;

    &--sm {
      font-size: var(--font-size-display-2);
    }
  }

  // Inline-block + relative — accent-line абсолютно позиционируется снизу.
  // Per feedback: brand color via animated accent-line, не bubble-glass.
  &__title-accent {
    display: inline-block;
    position: relative;
  }

  &__title-line {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -10px;
    height: 3px;
    border-radius: 3px;
    background: var(--gradient-brand);
    transform-origin: left center;
    box-shadow: 0 0 14px rgba(var(--color-brand-violet-rgb), 0.5);
    animation: welcomeAccent calc(5.4s / max(var(--motion-scale, 1), 0.001)) ease-in-out infinite;
  }

  &__lead {
    font-size: var(--font-size-h3);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
    max-width: 56ch;
    margin: 0;
    text-wrap: pretty;

    strong {
      color: var(--color-text-primary);
      font-weight: 620;
    }
  }

  // =================================================================
  // Step 1: hero pill list
  // =================================================================
  &__pill-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);

    li {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: 10px 16px;
      border-radius: var(--radius-pill);
      background: rgba(255, 255, 255, 0.04);
      border: var(--border-thin) solid var(--color-border-subtle);
      font-size: var(--font-size-small);
      color: var(--color-text-secondary);
    }
  }

  &__pill-icon {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: rgba(var(--color-success-rgb), 0.18);
    color: var(--color-success);

    :deep(svg) {
      width: 12px;
      height: 12px;
    }
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: auto;
    padding-top: var(--space-2);
  }

  // =================================================================
  // Step 2: feature grid
  // =================================================================
  &__feature-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--space-3);
  }

  &__feature {
    --tone: var(--color-brand-violet);
    --tone-rgb: var(--color-brand-violet-rgb);
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.025);
    border: var(--border-thin) solid var(--color-border-subtle);
    overflow: hidden;
    isolation: isolate;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);

    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(
        80% 60% at 0% 0%,
        rgba(var(--tone-rgb), 0.16) 0%,
        transparent 55%
      );
      opacity: 0.55;
      z-index: -1;
    }

    &:hover {
      border-color: rgba(var(--tone-rgb), 0.35);
      background: rgba(255, 255, 255, 0.04);
    }
  }

  &__feature-icon {
    display: inline-grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 12px;
    background: rgba(var(--tone-rgb), 0.18);
    color: var(--tone);
    margin-bottom: var(--space-1);

    :deep(svg) {
      width: 20px;
      height: 20px;
    }
  }

  &__feature-title {
    font-family: var(--font-family-display);
    font-size: var(--font-size-h2);
    font-weight: 620;
    color: var(--color-text-primary);
  }

  &__feature-text {
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  &__feature-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: auto;
    padding-top: var(--space-3);
  }

  &__feature-tag {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-micro);
    padding: 3px 8px;
    border-radius: var(--radius-pill);
    background: rgba(var(--tone-rgb), 0.12);
    color: var(--tone);
    text-transform: uppercase;
    letter-spacing: var(--tracking-micro);
  }

  // =================================================================
  // Step 3: path picker — текст + tone-accent, без иллюстраций
  // =================================================================
  &__path-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-3);
  }

  &__path {
    --tone: var(--color-brand-violet);
    --tone-rgb: var(--color-brand-violet-rgb);
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.03);
    border: var(--border-thin) solid var(--color-border-subtle);
    text-align: left;
    color: var(--color-text-primary);
    cursor: pointer;
    overflow: hidden;
    isolation: isolate;
    font-family: inherit;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);

    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(
        90% 60% at 0% 0%,
        rgba(var(--tone-rgb), 0.18) 0%,
        transparent 65%
      );
      opacity: 0;
      transition: opacity var(--dur-medium) var(--ease-out);
      z-index: -1;
    }

    &:hover {
      border-color: rgba(var(--tone-rgb), 0.32);
      background: rgba(255, 255, 255, 0.045);
      &::before {
        opacity: 0.55;
      }
    }

    &--active {
      border-color: rgba(var(--tone-rgb), 0.55);
      background: rgba(var(--tone-rgb), 0.07);
      box-shadow: 0 0 0 1px rgba(var(--tone-rgb), 0.35);
      &::before {
        opacity: 1;
      }
    }
  }

  &__path-tag {
    @include pill-tag(var(--tone-rgb), var(--tone));
    align-self: flex-start;
  }

  &__path-title {
    font-family: var(--font-family-display);
    font-size: var(--font-size-h2);
    font-weight: 700;
    color: var(--color-text-primary);
    line-height: var(--leading-snug);
  }

  &__path-text {
    font-size: var(--font-size-small);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  &__path-pick {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: auto;
    padding-top: var(--space-3);
    color: var(--tone);
    font-size: var(--font-size-small);
    font-weight: 600;
  }

  // =================================================================
  // Step 4: finish
  // =================================================================
  &__finish {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  &__finish-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.03);
    border: var(--border-thin) solid var(--color-border-subtle);
    color: var(--color-text-primary);
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);

    &:hover {
      border-color: var(--color-border-soft);
      background: rgba(255, 255, 255, 0.05);
    }

    &--primary {
      background: rgba(var(--color-brand-violet-rgb), 0.08);
      border-color: rgba(var(--color-brand-violet-rgb), 0.3);

      &:hover {
        background: rgba(var(--color-brand-violet-rgb), 0.13);
        border-color: rgba(var(--color-brand-violet-rgb), 0.45);
      }
    }
  }

  &__finish-icon {
    display: inline-grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: rgba(var(--color-brand-violet-rgb), 0.16);
    color: var(--color-brand-violet);

    :deep(svg) {
      width: 20px;
      height: 20px;
    }
  }

  &__finish-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  &__finish-title {
    font-size: var(--font-size-h2);
    font-weight: 620;
    color: var(--color-text-primary);
  }

  &__finish-text {
    font-size: var(--font-size-small);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  &__finish-cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-brand-violet);
    font-weight: 600;
    font-size: var(--font-size-small);
    white-space: nowrap;
  }

  &__tips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-2);

    li {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      background: rgba(255, 255, 255, 0.025);
      border: var(--border-thin) solid var(--color-border-subtle);

      kbd {
        font-family: var(--font-family-mono);
        font-size: var(--font-size-micro);
        padding: 3px 8px;
        border-radius: 6px;
        background: rgba(var(--color-brand-violet-rgb), 0.16);
        color: var(--color-brand-violet);
        font-weight: 600;
        letter-spacing: var(--tracking-micro);
        text-transform: uppercase;
        border: var(--border-thin) solid rgba(var(--color-brand-violet-rgb), 0.24);
        flex-shrink: 0;
      }

      span {
        font-size: var(--font-size-small);
        color: var(--color-text-secondary);
      }
    }
  }

  // =================================================================
  // Visual pane: orb + chips. Стейдж viewport-driven (`vw`/`vh`), fixed-aspect.
  // Container queries не используем — стейдж не должен зависеть от copy-колонки.
  // =================================================================
  &__pane--visual {
    position: relative;
    display: grid;
    place-items: center;
    align-self: center;
  }

  &__stage {
    --stage-size: clamp(320px, min(38vw, 56vh), 520px);
    position: relative;
    width: var(--stage-size);
    height: var(--stage-size);
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    pointer-events: none;

    @media (max-width: 1024px) {
      --stage-size: clamp(220px, 30vh, 320px);
    }

    :deep(.orb) {
      --orb-size: calc(var(--stage-size) * 0.66);
      position: relative;
      z-index: 2;
    }
  }

  // =================================================================
  // Bottom dots
  // =================================================================
  &__bottom {
    display: flex;
    justify-content: center;
  }

  &__dots {
    display: flex;
    gap: var(--space-2);
  }

  &__dot {
    width: 28px;
    height: 4px;
    border-radius: 4px;
    border: 0;
    padding: 0;
    background: rgba(255, 255, 255, 0.1);
    cursor: pointer;
    transition:
      width var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);

    &--active {
      width: 42px;
      background: var(--gradient-brand);
      box-shadow: 0 0 14px rgba(var(--color-brand-violet-rgb), 0.55);
    }

    &--done {
      background: rgba(var(--color-brand-violet-rgb), 0.55);
    }
  }
}

@keyframes welcomeMarkPulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.85;
  }
  50% {
    transform: scale(1.18);
    opacity: 1;
  }
}

@keyframes welcomeAccent {
  0%,
  100% {
    transform: scaleX(1);
    opacity: 1;
  }
  50% {
    transform: scaleX(0.6);
    opacity: 0.75;
  }
}

@media (prefers-reduced-motion: reduce) {
  .welcome__mark-dot,
  .welcome__title-line {
    animation: none !important;
  }
}

// =====================================================================
// Mobile (≤720px): vertical stack-layout.
//   - Orb: hero сверху (≤30vh), под ним прокручивается контент.
//   - Actions: внутри step-card с `margin-top: auto`, оказываются в конце.
//   - Touch swipe ←/→: листает шаги (см. onTouchStart / onTouchEnd в script).
// =====================================================================
@media (max-width: 720px) {
  .welcome {
    padding: 14px 14px calc(18px + var(--safe-bottom));
    gap: 14px;
    grid-template-rows: auto auto 1fr auto;
    overflow: hidden auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;

    &__bar {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      min-height: 48px;
      padding: 0 10px;
      border-radius: var(--radius-md);
      box-shadow: none;
    }
    &__bar-mark {
      display: none;
    }
    &__skip {
      font-size: var(--font-size-micro);
      padding: 6px 12px;
    }

    // ---- Layout: одноколоночный stack, visual сверху, copy под ним.
    &__layout {
      display: grid;
      grid-template-columns: 100%;
      grid-template-rows: auto auto;
      gap: 18px;
      align-items: stretch;
    }
    &__pane--copy {
      align-self: stretch;
    }

    // Visual: hero-блок 30vh max, orb 70% от стейджа.
    &__pane--visual {
      order: -1;
      height: clamp(220px, 30vh, 300px);
      align-self: start;
    }
    &__stage {
      --stage-size: min(82vw, 30vh);
      width: var(--stage-size);
      height: var(--stage-size);

      :deep(.orb) {
        --orb-size: calc(var(--stage-size) * 0.7);
      }
    }

    // Scene min-height — резерв под самый высокий step (path-grid ≈ 540px).
    // overflow:auto на root скроллит overflow естественно.
    &__scene {
      min-height: clamp(480px, 70vh, 620px);
    }

    &__card {
      gap: 16px;
    }

    &__title {
      line-height: 1.15;
    }
    &__title-line {
      display: none;
    }
    &__lead {
      font-size: var(--font-size-body);
      line-height: var(--leading-normal);
    }

    // ---- Pills hero — wrap на 2 ряда максимум.
    &__pill-list {
      gap: 8px;

      li {
        padding: 8px 12px;
        font-size: 12px;
      }
    }

    // Actions — full-width column, min-height = tap-target.
    &__actions {
      flex-direction: column;
      gap: 8px;
      width: 100%;

      :deep(.button) {
        width: 100%;
        justify-content: center;
        min-height: var(--tap-min);
      }
    }

    // Feature / path grids: single-column.
    &__feature-grid,
    &__path-grid {
      grid-template-columns: 100%;
      gap: 10px;
    }
    &__path {
      padding: 16px;
      min-height: 0;
    }
    &__feature {
      padding: 14px;
    }

    // Finish cards: icon + body в строке, CTA отдельной строкой снизу.
    &__finish-card {
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-rows: auto auto;
      align-items: start;
      gap: 12px;
      padding: 14px;

      .welcome__finish-icon {
        grid-row: 1;
      }
      .welcome__finish-body {
        grid-row: 1;
        grid-column: 2;
      }
      .welcome__finish-cta {
        grid-row: 2;
        grid-column: 1 / -1;
        justify-content: center;
        padding: 8px 0;
        border-top: 1px solid var(--color-border-subtle);
      }
    }

    // ---- Tips: один column (и так wrap'ились, но фиксируем).
    &__tips {
      grid-template-columns: 100%;
    }
  }
}

// Очень узкие screens (iPhone SE, < 380px) — ещё компактнее.
@media (max-width: 379px) {
  .welcome {
    padding: 12px 10px calc(14px + var(--safe-bottom));

    &__title {
      font-size: 22px;
    }
    &__pane--visual {
      height: clamp(180px, 26vh, 240px);
    }
  }
}
</style>
