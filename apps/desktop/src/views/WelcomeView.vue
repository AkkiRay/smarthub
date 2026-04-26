<template>
  <section class="welcome" ref="root" @keydown="onKeydown" tabindex="0">
    <!-- Декоративные орбиты в фоне -->
    <div class="welcome__halo" aria-hidden="true">
      <span class="welcome__halo-ring welcome__halo-ring--1" />
      <span class="welcome__halo-ring welcome__halo-ring--2" />
      <span class="welcome__halo-ring welcome__halo-ring--3" />
    </div>

    <!-- Bar: skip + progress объединены в один компактный row. -->
    <header class="welcome__bar">
      <div class="steps welcome__bar-progress">
        <div class="steps__rail">
          <div class="steps__fill" :style="{ width: `${railProgress}%` }" />
        </div>
        <span class="steps__label">{{ stepLabel }}</span>
      </div>
      <button v-if="step < totalSteps - 1" type="button" class="welcome__skip" @click="skip">
        Пропустить онбординг
        <BaseIcon name="arrow-right" :size="14" />
      </button>
    </header>

    <!-- Сцена -->
    <div class="welcome__layout">
      <Transition :name="motion ? 'welcome-step' : 'welcome-fade'" mode="out-in">
        <div :key="step" class="welcome__scene">
          <!-- Шаг 1: Hero — приветствие -->
          <div v-if="step === 0" class="step-card welcome__hero-step">
            <div class="step-card__head">
              <span class="step-card__kicker">Добро пожаловать</span>
              <h1 class="step-card__title">
                Один хаб для всего<br />
                <span class="text--gradient">умного дома</span>
              </h1>
              <p class="step-card__lead">
                28+ интеграций, локальное управление, голосовые сценарии через Алису. Без облака,
                без подписок, без лишнего.
              </p>
            </div>
            <ul class="welcome__pill-list">
              <li v-for="b in heroBullets" :key="b">
                <span class="welcome__pill-icon"><BaseIcon name="check" :size="12" /></span>
                <span>{{ b }}</span>
              </li>
            </ul>
            <div class="step-card__actions">
              <BaseButton variant="primary" size="lg" icon-right="arrow-right" @click="next">
                Поехали
              </BaseButton>
              <BaseButton variant="ghost" size="lg" @click="skip">Я уже знаком</BaseButton>
            </div>
          </div>

          <!-- Шаг 2: Что получаете — 3 ключевых фичи -->
          <div v-else-if="step === 1" class="step-card">
            <div class="step-card__head">
              <span class="step-card__kicker">Шаг 02 · Что вы получите</span>
              <h2 class="step-card__title">Три способа управлять домом</h2>
              <p class="step-card__lead">
                Каждый канал работает независимо. Можно начать с одного и постепенно подключать
                остальные.
              </p>
            </div>
            <div class="welcome__feature-grid stack-in">
              <article
                v-for="f in features"
                :key="f.title"
                class="tile tile--glass"
                :class="`tile--${f.tone}`"
              >
                <div class="tile__icon"><span v-safe-html="f.icon" /></div>
                <div class="tile__label">{{ f.title }}</div>
                <div class="tile__hint">{{ f.text }}</div>
                <div class="welcome__feature-tags">
                  <span v-for="t in f.tags" :key="t" class="chip chip--brand">{{ t }}</span>
                </div>
              </article>
            </div>
            <div class="step-card__actions">
              <BaseButton variant="ghost" icon-left="arrow-left" @click="back">Назад</BaseButton>
              <BaseButton variant="primary" icon-right="arrow-right" @click="next">
                Дальше
              </BaseButton>
            </div>
          </div>

          <!-- Шаг 3: Выбор пути — куда направить пользователя после онбординга -->
          <div v-else-if="step === 2" class="step-card">
            <div class="step-card__head">
              <span class="step-card__kicker">Шаг 03 · Выбор пути</span>
              <h2 class="step-card__title">С чего начнём?</h2>
              <p class="step-card__lead">
                Выберите способ — после онбординга мы сразу откроем нужный экран. Передумаете —
                всегда можно вернуться через боковое меню.
              </p>
            </div>
            <div class="welcome__path-grid">
              <button
                v-for="p in paths"
                :key="p.id"
                type="button"
                class="welcome__path"
                :class="{ 'welcome__path--active': chosenPath === p.id }"
                :style="{
                  '--path-tone': `var(--color-brand-${p.tone})`,
                  '--path-tone-rgb': `var(--color-brand-${p.tone}-rgb)`,
                }"
                @click="chosenPath = p.id"
              >
                <span class="welcome__path-tag">{{ p.tag }}</span>
                <span class="welcome__path-icon"><span v-safe-html="p.icon" /></span>
                <span class="welcome__path-title">{{ p.title }}</span>
                <span class="welcome__path-text">{{ p.text }}</span>
                <ol class="welcome__path-steps">
                  <li v-for="s in p.steps" :key="s">{{ s }}</li>
                </ol>
                <span class="welcome__path-pick">
                  <BaseIcon
                    :name="chosenPath === p.id ? 'check' : 'arrow-right'"
                    :size="14"
                  />
                  {{ chosenPath === p.id ? 'Выбран' : 'Выбрать' }}
                </span>
              </button>
            </div>
            <div class="step-card__actions">
              <BaseButton variant="ghost" icon-left="arrow-left" @click="back">Назад</BaseButton>
              <BaseButton
                variant="primary"
                icon-right="arrow-right"
                :disabled="!chosenPath"
                @click="next"
              >
                Дальше
              </BaseButton>
            </div>
          </div>

          <!-- Шаг 4: Готово — тур + быстрые подсказки -->
          <div v-else class="step-card">
            <div class="step-card__head">
              <span class="step-card__kicker">Шаг 04 · Финал</span>
              <h2 class="step-card__title">Хаб готов к работе</h2>
              <p class="step-card__lead">
                Можем показать тур по интерфейсу — займёт 60 секунд и покажет где что лежит. Или
                сразу перейдём к
                <strong>{{ chosenPathTitle ?? 'хабу' }}</strong
                >.
              </p>
            </div>

            <div class="welcome__finish">
              <div class="welcome__finish-card welcome__finish-card--primary">
                <div class="welcome__finish-icon"><BaseIcon name="info" :size="20" /></div>
                <div>
                  <div class="welcome__finish-title">Покажу всё на интерфейсе</div>
                  <div class="welcome__finish-text">
                    Подсветим главное: где искать устройства, как собрать сценарий и подключить
                    колонку. Можно прервать в любой момент клавишей Esc.
                  </div>
                </div>
                <BaseButton variant="primary" icon-right="arrow-right" @click="finish(true)">
                  Начать тур
                </BaseButton>
              </div>

              <div class="welcome__finish-card">
                <div class="welcome__finish-icon"><BaseIcon name="arrow-right" :size="20" /></div>
                <div>
                  <div class="welcome__finish-title">Сразу к {{ chosenPathTitle ?? 'хабу' }}</div>
                  <div class="welcome__finish-text">
                    Пропустим тур и откроем нужный раздел. Все подсказки доступны в Настройках.
                  </div>
                </div>
                <BaseButton variant="ghost" @click="finish(false)">Перейти</BaseButton>
              </div>
            </div>

            <ul class="welcome__tips">
              <li v-for="t in finishTips" :key="t.title">
                <kbd>{{ t.title }}</kbd>
                <span>{{ t.text }}</span>
              </li>
            </ul>
          </div>
        </div>
      </Transition>

      <!-- Orb + 3D-chip ring живут в одной сцене; не перерендериваются между шагами. -->
      <aside class="welcome__visual" aria-hidden="true">
        <div class="welcome__visual-stage">
          <JarvisOrb size="xl" ambient :state="orbState" class="welcome__orb" />
          <OrbitalChips :chips="orbitalChips" />
        </div>
      </aside>
    </div>

    <!-- Bottom: dots-навигация -->
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
          @click="step = i - 1"
        />
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue';
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

const step = ref(0);
const totalSteps = 4;
const motion = computed(() => !reduceMotion.value);
const root = useTemplateRef<HTMLElement>('root');

type PathId = 'lan' | 'alice' | 'cloud';
const chosenPath = ref<PathId | null>(null);

const stepLabels = ['Знакомство', 'Возможности', 'Выбор пути', 'Финал'];
const stepLabel = computed(() => `Шаг ${step.value + 1} из ${totalSteps} · ${stepLabels[step.value]}`);
const railProgress = computed(() => ((step.value + 1) / totalSteps) * 100);

const orbState = computed<'idle' | 'active'>(() => {
  if (!motion.value) return 'idle';
  return step.value === 1 ? 'idle' : 'active';
});

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
    icon:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M2 9c5.5-5.5 14.5-5.5 20 0M5.5 12.5c3.5-3.5 9.5-3.5 13 0M9 16c1.7-1.7 4.3-1.7 6 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="20" r="1.4" fill="currentColor"/></svg>',
  },
  {
    title: 'Колонка Алисы',
    text: 'Один клик «Войти через Яндекс» — хаб найдёт ваши Станции.',
    tone: 'pink',
    tags: ['OAuth', 'Glagol', 'WSS:1961'],
    icon:
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M8 11v2M10.5 9.5v5M13.5 8.5v7M16 10.5v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  },
  {
    title: 'Облачные платформы',
    text: 'Сбер Дом, Tuya, Mi Home, eWeLink, Govee — единая форма ключей.',
    tone: 'amber',
    tags: ['API', 'OAuth', 'РФ + EN'],
    icon:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M7 18a4 4 0 010-8 6 6 0 0111 1.5 4 4 0 011 7.5H7z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13" r="1.3" fill="currentColor"/></svg>',
  },
];

interface Path {
  id: PathId;
  tag: string;
  title: string;
  text: string;
  steps: string[];
  tone: string;
  icon: string;
}

const paths: Path[] = [
  {
    id: 'lan',
    tag: 'Самый быстрый',
    title: 'Найти в LAN',
    text: 'Yeelight, Shelly, Hue, miIO. Хаб опросит сеть за 5 секунд.',
    tone: 'violet',
    icon:
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M5 12a7 7 0 0114 0M2 12a10 10 0 0120 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    steps: [
      'Откроем «Поиск устройств»',
      'Хаб параллельно опросит протоколы',
      'Подключим первое устройство',
    ],
  },
  {
    id: 'alice',
    tag: 'Самый мощный',
    title: 'Подключить Алису',
    text: 'Импорт всех устройств из «Дома с Алисой» + локальная Станция.',
    tone: 'pink',
    icon:
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M8 11v2M10.5 9.5v5M13.5 8.5v7M16 10.5v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    steps: [
      'Раздел «Алиса» откроется первым',
      '«Войти через Яндекс» — единственный клик',
      'Все Станции и устройства подтянутся',
    ],
  },
  {
    id: 'cloud',
    tag: 'Самый универсальный',
    title: 'Облачные интеграции',
    text: 'Tuya, Mi Home, Сбер Дом, eWeLink, Aqara — 16 платформ.',
    tone: 'amber',
    icon:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M7 18a4 4 0 010-8 6 6 0 0111 1.5 4 4 0 011 7.5H7z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    steps: [
      'Откроем маркетплейс интеграций',
      'Выберите свою облачную платформу',
      'Введёте API-ключ — всё устройства появятся',
    ],
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

const orbitalChips = [
  { id: 'yeelight', label: 'Yeelight' },
  { id: 'hue', label: 'Hue' },
  { id: 'tuya', label: 'Tuya' },
  { id: 'sber-home', label: 'Сбер' },
  { id: 'wiz', label: 'WiZ' },
  { id: 'shelly', label: 'Shelly' },
  { id: 'miio', label: 'Mi Home' },
  { id: 'matter', label: 'Matter' },
];

function next(): void {
  if (step.value < totalSteps - 1) {
    step.value += 1;
  } else {
    finish(true);
  }
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
  const target = chosenPath.value ? pathRoute() : '/home';
  void router.replace({ path: target, query: startTour ? { tour: '1' } : {} });
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

onMounted(() => {
  root.value?.focus();
  if (!motion.value) return;
  gsap.from(root.value, {
    opacity: 0,
    duration: 0.6,
    ease: 'power2.out',
  });
});
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.welcome {
  // Absolute-positioned поверх app__fullscreen (он `position: relative; flex: 1`).
  // Это исключает любые flex/grid-конфликты с parent — welcome всегда занимает
  // ровно слот fullscreen, не больше и не меньше.
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: clamp(10px, 1.4vw, 18px);
  padding: clamp(12px, 1.6vw, 24px) clamp(20px, 3.2vw, 44px);
  color: var(--color-text-primary);
  outline: none;
  overflow: hidden;

  @media (max-height: 720px) {
    gap: 8px;
    padding-block: 12px;
  }

  // Декоративный halo
  &__halo {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 0;
  }

  &__halo-ring {
    position: absolute;
    border-radius: 50%;
    border: 1px solid rgba(var(--color-brand-violet-rgb), 0.08);

    &--1 {
      width: 600px;
      height: 600px;
      top: -200px;
      right: -200px;
      animation: orbit 60s linear infinite;
    }
    &--2 {
      width: 380px;
      height: 380px;
      bottom: -160px;
      left: 10%;
      border-color: rgba(var(--color-brand-pink-rgb), 0.1);
      animation: orbit 90s linear infinite reverse;
    }
    &--3 {
      width: 220px;
      height: 220px;
      top: 30%;
      right: 35%;
      border-color: rgba(var(--color-brand-amber-rgb), 0.08);
    }
  }

  > * {
    position: relative;
    z-index: 1;
  }

  &__bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;
  }

  &__bar-progress {
    min-width: 0;
  }

  &__skip {
    background: transparent;
    border: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
    padding: 8px 14px;
    border-radius: var(--radius-pill);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-size-small);
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease-out);

    &:hover {
      color: var(--color-text-primary);
      background: var(--surface-hover);
      border-color: var(--color-border-soft);
    }
  }

  &__progress {
    display: flex;
    align-items: center;
    max-width: 1320px;
    width: 100%;
    margin: 0 auto;
  }

  &__layout {
    width: 100%;
    max-width: 1440px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: clamp(24px, 3vw, 56px);
    min-height: 0;
    align-items: stretch;

    @media (max-width: 1024px) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(180px, 30vh) minmax(0, 1fr);
    }
  }

  &__scene {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    width: 100%;
    min-width: 0;
    min-height: 0;
    // Перенесли overflow на step-card — у него внутренний контент с разной
    // высотой; scene остаётся чистым flex-контейнером без scrollbar-edge'ов.
  }

  &__visual {
    position: relative;
    display: grid;
    place-items: center;
    isolation: isolate;
    min-width: 0;
    min-height: 0;
    // Container query basis: stage читает 100cqi/100cqb относительно этой колонки.
    container-type: size;

    @media (max-width: 1024px) {
      order: -1;
    }
  }

  // Stage = max квадрат, влезающий в колонку. cqi = inline size, cqb = block size.
  &__visual-stage {
    --stage-size: min(100cqi, 100cqb, 640px);
    position: relative;
    aspect-ratio: 1;
    width: var(--stage-size);
    height: var(--stage-size);
    display: grid;
    place-items: center;

    @media (max-width: 1024px) {
      --stage-size: min(100cqi, 100cqb, 320px);
    }

    :deep(.orb) {
      --orb-size: calc(var(--stage-size) * 0.62);
      position: relative;
      z-index: 2;
    }
  }



  &__pill-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;

    li {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-radius: var(--radius-pill);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--color-border-subtle);
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
    background: rgba(var(--color-success-rgb), 0.16);
    color: var(--color-success);
  }

  &__feature-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
    gap: 14px;
  }

  &__feature-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: auto;
    padding-top: var(--space-3);

    .chip {
      font-size: 11px;
      padding: 3px 9px;
      height: auto;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--color-border-subtle);
      color: var(--color-text-secondary);
    }
  }

  &__path-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;

    @media (max-width: 1280px) {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
    }
  }

  &__path {
    --path-tone: var(--color-brand-violet);
    --path-tone-rgb: var(--color-brand-violet-rgb);
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-subtle);
    text-align: left;
    color: var(--color-text-primary);
    cursor: pointer;
    transition:
      background var(--dur-medium) var(--ease-out),
      border-color var(--dur-medium) var(--ease-out),
      transform var(--dur-medium) var(--ease-out),
      box-shadow var(--dur-medium) var(--ease-out);
    overflow: hidden;
    isolation: isolate;

    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(80% 60% at 0% 0%, rgba(var(--path-tone-rgb), 0.18) 0%, transparent 60%);
      opacity: 0;
      transition: opacity var(--dur-medium) var(--ease-out);
      z-index: 0;
    }

    > * {
      position: relative;
      z-index: 1;
    }

    &:hover {
      transform: translateY(-2px);
      border-color: rgba(var(--path-tone-rgb), 0.3);
      box-shadow: var(--shadow-hover);
      &::before { opacity: 0.6; }
    }

    &--active {
      border-color: rgba(var(--path-tone-rgb), 0.5);
      box-shadow:
        var(--shadow-violet-glow),
        0 0 0 2px rgba(var(--path-tone-rgb), 0.25);
      &::before { opacity: 1; }
    }
  }

  &__path-tag {
    align-self: flex-start;
    padding: 4px 10px;
    border-radius: var(--radius-pill);
    background: rgba(var(--path-tone-rgb), 0.18);
    border: 1px solid rgba(var(--path-tone-rgb), 0.3);
    color: var(--path-tone);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: var(--tracking-micro);
    text-transform: uppercase;
  }

  &__path-icon {
    display: inline-grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: rgba(var(--path-tone-rgb), 0.18);
    color: var(--path-tone);

    :deep(svg) {
      width: 26px;
      height: 26px;
    }
  }

  &__path-title {
    font-family: var(--font-family-display);
    font-size: 19px;
    font-weight: 700;
    color: var(--color-text-primary);
    letter-spacing: -0.012em;
  }

  &__path-text {
    font-size: var(--font-size-small);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  &__path-steps {
    list-style: none;
    counter-reset: pstep;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;

    li {
      counter-increment: pstep;
      position: relative;
      padding-left: 26px;
      font-size: var(--font-size-small);
      line-height: 1.4;
      color: var(--color-text-secondary);

      &::before {
        @include numeric-badge(0);
        content: counter(pstep);
        position: absolute;
        left: 0;
        top: 0;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: rgba(var(--path-tone-rgb), 0.16);
        color: var(--path-tone);
        font-size: 10px;
        font-weight: 700;
      }
    }
  }

  &__path-pick {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: auto;
    padding-top: var(--space-3);
    color: var(--path-tone);
    font-size: var(--font-size-small);
    font-weight: 600;
  }

  &__finish {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__finish-card {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-subtle);

    &--primary {
      background: rgba(var(--color-brand-violet-rgb), 0.08);
      border-color: rgba(var(--color-brand-violet-rgb), 0.32);
    }

    @media (max-width: 720px) {
      grid-template-columns: auto 1fr;
      :deep(.button) {
        grid-column: 1 / -1;
      }
    }
  }

  &__finish-icon {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgba(var(--color-brand-violet-rgb), 0.16);
    color: var(--color-brand-violet);
  }

  &__finish-title {
    font-size: var(--font-size-h2);
    font-weight: 600;
    color: var(--color-text-primary);
    margin-bottom: 4px;
  }

  &__finish-text {
    font-size: var(--font-size-small);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  &__tips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
    gap: 8px;

    li {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: var(--radius-md);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--color-border-subtle);

      kbd {
        font-family: var(--font-family-mono);
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 6px;
        background: rgba(var(--color-brand-violet-rgb), 0.16);
        color: var(--color-brand-violet);
        font-weight: 600;
        letter-spacing: var(--tracking-micro);
        text-transform: uppercase;
        border: 1px solid rgba(var(--color-brand-violet-rgb), 0.24);
        flex-shrink: 0;
      }

      span {
        font-size: var(--font-size-small);
        color: var(--color-text-secondary);
      }
    }
  }

  &__bottom {
    display: flex;
    justify-content: center;
  }

  &__dots {
    display: flex;
    gap: 8px;
  }

  &__dot {
    width: 24px;
    height: 4px;
    border-radius: 4px;
    border: 0;
    padding: 0;
    background: var(--color-border-soft);
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease-out);

    &--active {
      width: 36px;
      background: var(--gradient-brand);
      box-shadow: 0 0 12px rgba(var(--color-brand-violet-rgb), 0.5);
    }
    &--done {
      background: rgba(var(--color-brand-violet-rgb), 0.5);
    }
  }
}


.welcome-step-enter-active,
.welcome-step-leave-active {
  transition:
    opacity var(--dur-medium) var(--ease-out),
    transform var(--dur-slow) var(--ease-out);
}
.welcome-step-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.98);
}
.welcome-step-leave-to {
  opacity: 0;
  transform: translateY(-14px) scale(0.99);
}

.welcome-fade-enter-active,
.welcome-fade-leave-active {
  transition: opacity var(--dur-fast) ease;
}
.welcome-fade-enter-from,
.welcome-fade-leave-to {
  opacity: 0;
}

.app--reduce-motion .welcome {
  &__halo-ring,
  &__pulse,
  &__orbit {
    animation: none !important;
  }
  &__pulse {
    opacity: 0.18;
    transform: scale(1);
  }
  &__visual-tags span {
    animation: none !important;
  }
}

@media (max-width: 720px) {
  .welcome {
    padding: 16px;
    grid-template-rows: auto auto 1fr auto;

    &__top {
      flex-wrap: wrap;
    }

    &__skip {
      font-size: 11px;
      padding: 6px 10px;
    }

    &__finish-card {
      padding: 14px;
    }
  }
}
</style>
