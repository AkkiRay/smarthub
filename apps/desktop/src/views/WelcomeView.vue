<template>
  <section class="welcome" :class="{ 'welcome--reduce-motion': !motion }" ref="root">
    <div class="welcome__shell">
      <!-- Top-rail: «Шаг N из M» — раньше прогресс был только внизу пилюлями. -->
      <header class="welcome__rail">
        <div class="welcome__rail-progress" aria-hidden="true">
          <div class="welcome__rail-fill" :style="{ width: `${railProgress}%` }" />
        </div>
        <span class="welcome__rail-label">
          Шаг {{ step + 1 }} из {{ totalSteps }} · {{ stepLabels[step] }}
        </span>
      </header>

      <!-- Орб ВНЕ Transition: при смене шага не пересоздаётся, не «дёргает» layout. -->
      <div class="welcome__layout">
        <Transition :name="motion ? 'welcome-step' : 'welcome-fade'" mode="out-in">
          <div :key="step" class="welcome__stage">
            <!-- Шаг 1: hero — только текст (орб общий справа). -->
            <div v-if="step === 0" class="welcome__hero">
              <div class="welcome__hero-copy">
                <h1 class="welcome__title">
                  Один хаб для&nbsp;всего<br />
                  <span class="text--gradient">умного дома</span>
                </h1>
                <p class="welcome__lede">
                  Локальный, без облака. Управляет лампами, розетками, датчиками и колонкой Алисы
                  напрямую по Wi-Fi и Bonjour.
                </p>
                <ul class="welcome__hero-bullets">
                  <li v-for="hb in heroBullets" :key="hb">
                    <BaseIcon name="check" :size="14" />
                    <span>{{ hb }}</span>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Шаг 2: что умеет -->
            <div v-else-if="step === 1" class="welcome__features">
              <h2 class="welcome__heading">Что умеет хаб</h2>
              <p class="welcome__sub">Четыре столпа — и всё в одном окне.</p>

              <div class="welcome__grid">
                <article
                  v-for="(f, i) in features"
                  :key="f.title"
                  class="welcome__feature"
                  :style="{
                    '--feature-accent': f.accent,
                    '--feature-accent-rgb': f.accentRgb,
                    animationDelay: `${0.06 * i}s`,
                  }"
                >
                  <span class="welcome__feature-glyph">
                    <span v-html="f.icon" />
                  </span>
                  <h3 class="welcome__feature-title">{{ f.title }}</h3>
                  <p class="welcome__feature-text">{{ f.text }}</p>
                </article>
              </div>
            </div>

            <!-- Шаг 3: как начать — 2 простых сценария, чтобы было ощущение «я знаю, что делать». -->
            <div v-else-if="step === 2" class="welcome__flow">
              <h2 class="welcome__heading">Как это работает</h2>
              <p class="welcome__sub">Два простых пути — и хаб начнёт работать.</p>

              <div class="welcome__flow-cards">
                <article v-for="path in flowPaths" :key="path.title" class="welcome__flow-card">
                  <span class="welcome__flow-step">{{ path.step }}</span>
                  <h3 class="welcome__flow-title">{{ path.title }}</h3>
                  <ol class="welcome__flow-steps">
                    <li v-for="s in path.steps" :key="s">{{ s }}</li>
                  </ol>
                </article>
              </div>
            </div>

            <!-- Шаг 4: приватность -->
            <div v-else-if="step === 3" class="welcome__privacy">
              <h2 class="welcome__heading">Всё&nbsp;— у&nbsp;вас дома</h2>
              <p class="welcome__sub">
                Никаких внешних серверов. Хаб хранит конфигурацию в&nbsp;зашифрованном SQLite
                на&nbsp;вашем компьютере и&nbsp;общается с&nbsp;устройствами в&nbsp;вашей локальной
                сети.
              </p>
              <div class="welcome__privacy-card">
                <ul class="welcome__bullets">
                  <li v-for="b in privacyBullets" :key="b">
                    <span class="welcome__check">
                      <BaseIcon name="check" :size="14" />
                    </span>
                    <span>{{ b }}</span>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Шаг 5: готово -->
            <div v-else class="welcome__done">
              <h2 class="welcome__heading">Хаб готов к&nbsp;работе</h2>
              <p class="welcome__sub">
                Дальше&nbsp;— короткий тур по&nbsp;интерфейсу. За&nbsp;минуту покажем где искать
                устройства, как собрать сценарий и&nbsp;подключить колонку.
              </p>
              <ul class="welcome__done-tips">
                <li v-for="t in finishTips" :key="t.title">
                  <strong>{{ t.title }}</strong>
                  <span>{{ t.text }}</span>
                </li>
              </ul>
            </div>
          </div>
        </Transition>

        <aside class="welcome__orb-stage" aria-hidden="true">
          <JarvisOrb size="hero" :state="orbState" track-window />
        </aside>
      </div>
    </div>

    <!-- Footer: dots + кнопки -->
    <footer class="welcome__footer">
      <div class="welcome__dots">
        <button
          v-for="i in totalSteps"
          :key="i"
          type="button"
          class="welcome__dot"
          :class="{ 'is-active': i - 1 === step, 'is-passed': i - 1 < step }"
          :aria-label="`Перейти на шаг ${i}: ${stepLabels[i - 1]}`"
          @click="step = i - 1"
        />
      </div>

      <div class="welcome__actions">
        <BaseButton v-if="step > 0" variant="ghost" icon-left="arrow-left" @click="back">
          Назад
        </BaseButton>
        <BaseButton v-if="step < totalSteps - 1" variant="ghost" @click="skip">
          Пропустить
        </BaseButton>
        <BaseButton variant="primary" icon-right="arrow-right" @click="next">
          {{ step === totalSteps - 1 ? 'Начать тур' : 'Дальше' }}
        </BaseButton>
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

const ui = useUiStore();
const router = useRouter();
const { reduceMotion } = storeToRefs(ui);

const step = ref(0);
const totalSteps = 5;
const motion = computed(() => !reduceMotion.value);
const root = useTemplateRef<HTMLElement>('root');

const stepLabels = ['Знакомство', 'Возможности', 'Как начать', 'Приватность', 'Готово'];

const railProgress = computed(() => ((step.value + 1) / totalSteps) * 100);

// Семантика орба: hero/features/done — active, flow/privacy — idle (не отвлекает от текста).
const orbState = computed<'idle' | 'active'>(() => {
  if (!motion.value) return 'idle';
  if (step.value === 2 || step.value === 3) return 'idle';
  return 'active';
});

const heroBullets = [
  '28+ интеграций: Yeelight, Hue, LIFX, Sber Дом, Mi Home, Tuya, Matter…',
  'Сценарии и расписание без node-red',
  'Колонка Алисы — авто-подключение через Яндекс ID',
  'Skill-мост: ваши устройства в приложении «Дом с Алисой»',
];

interface Feature {
  title: string;
  text: string;
  accent: string;
  accentRgb: string;
  icon: string;
}
const features: Feature[] = [
  {
    title: 'Локальные протоколы',
    text: 'Yeelight, Shelly, WiZ, LIFX, Hue, TP-Link, Mi Home (miIO), DIRIGERA, WeMo — без облака и аккаунтов.',
    accent: 'var(--color-brand-purple)',
    accentRgb: 'var(--color-brand-purple-rgb)',
    icon: '<svg viewBox="0 0 24 24" fill="none"><path d="M2 9c5.5-5.5 14.5-5.5 20 0M5.5 12.5c3.5-3.5 9.5-3.5 13 0M9 16c1.7-1.7 4.3-1.7 6 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="20" r="1.4" fill="currentColor"/></svg>',
  },
  {
    title: 'Российские облака',
    text: 'Сбер Дом, SaluteHome, Rubetek, Tuya/Smart Life — единая форма credentials, всё в Настройках.',
    accent: 'var(--color-brand-pink)',
    accentRgb: 'var(--color-brand-pink-rgb)',
    icon: '<svg viewBox="0 0 24 24" fill="none"><path d="M7 18a4 4 0 010-8 6 6 0 0111 1.5 4 4 0 011 7.5H7z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13" r="1.3" fill="currentColor"/></svg>',
  },
  {
    title: 'Универсальные стандарты',
    text: 'Matter / HomeKit (discovery), MQTT (Zigbee2MQTT/ESPHome), Home Assistant bridge, Z-Wave-JS.',
    accent: 'var(--color-brand-amber)',
    accentRgb: 'var(--color-brand-amber-rgb)',
    icon: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" stroke="currentColor" stroke-width="1.5"/></svg>',
  },
  {
    title: 'Колонка Алисы',
    text: 'Один клик «Войти через Яндекс» — хаб найдёт ваши Станции и подключится локально по WSS:1961.',
    accent: 'var(--color-brand-amber)',
    accentRgb: 'var(--color-brand-amber-rgb)',
    icon: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M8 11v2M10.5 9.5v5M13.5 8.5v7M16 10.5v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  },
  {
    title: 'Сценарии и комнаты',
    text: 'Композиция действий с задержками, голосовой запуск через Алису, фильтрация устройств по комнате.',
    accent: 'var(--color-brand-cyan)',
    accentRgb: 'var(--color-brand-cyan-rgb)',
    icon: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2l2.5 6.5L21 11l-5 4.5 1.5 6.5L12 18.5 6.5 22 8 15.5 3 11l6.5-2.5L12 2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  },
  {
    title: 'Полностью локально',
    text: 'Конфигурация в зашифрованном SQLite на вашем ПК. Голос и команды не уходят на сторонние серверы.',
    accent: 'var(--color-brand-mint)',
    accentRgb: 'var(--color-brand-mint-rgb)',
    icon: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
];

interface FlowPath {
  step: string;
  title: string;
  steps: string[];
}
const flowPaths: FlowPath[] = [
  {
    step: 'Путь 1',
    title: 'Локальное устройство',
    steps: [
      '«Поиск» в боковом меню → «Сканировать»',
      'Хаб опросит 10+ протоколов параллельно за 5 секунд',
      'Нажмите «Подключить» — карточка появится в «Устройства»',
    ],
  },
  {
    step: 'Путь 2',
    title: 'Облако (Сбер, Tuya, Mi Home)',
    steps: [
      '«Настройки» → «Интеграции» — список 28 платформ',
      'Раскройте нужную, введите API-ключ или email/пароль',
      'Хаб подтянет все ваши устройства облака сразу',
    ],
  },
  {
    step: 'Путь 3',
    title: 'Колонка Алисы',
    steps: [
      'Раздел «Алиса» → «Войти через Яндекс»',
      'Окно входа Я.Паспорта — логин остаётся в Яндексе',
      'Хаб найдёт ваши Станции и подключится по WSS:1961',
    ],
  },
  {
    step: 'Путь 4',
    title: 'Сценарий «Доброе утро»',
    steps: [
      '«Сценарии» → «Новый сценарий»',
      'Действия с задержками: свет 30%, шторы, чайник 95°',
      '«Доступно через Алису» — голосовой запуск из любого места',
    ],
  },
];

const privacyBullets = [
  'Никакой телеметрии и аналитики',
  'Ключи и токены шифруются в локальном хранилище',
  'Управление работает даже без интернета',
  'Открытый код — можно проверить самим',
];

interface FinishTip {
  title: string;
  text: string;
}
const finishTips: FinishTip[] = [
  { title: 'Esc', text: 'закрыть тур в любой момент' },
  { title: '← / →', text: 'листать шаги клавиатурой' },
  { title: 'Главная', text: '3 быстрых CTA для старта' },
  { title: 'Настройки', text: 'пройти тур заново' },
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

function finish(startTour: boolean): void {
  ui.completeOnboarding();
  if (!startTour) ui.completeTour();
  void router.replace({ path: '/home', query: startTour ? { tour: '1' } : {} });
}

onMounted(() => {
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
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--color-text-primary);
  overflow: hidden;

  &__shell {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 32px clamp(24px, 4vw, 64px) 16px;
    position: relative;
    z-index: 1;
    min-height: 0;
  }

  &__rail {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: clamp(20px, 3vw, 36px);
  }

  &__rail-progress {
    width: 100%;
    height: 3px;
    border-radius: 2px;
    background: var(--color-border-subtle);
    overflow: hidden;
  }

  &__rail-fill {
    height: 100%;
    background: var(--gradient-brand);
    border-radius: 2px;
    transition: width 360ms var(--ease-out);
  }

  &__rail-label {
    font-family: var(--font-family-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  // Фикс-ширина правой колонки, чтобы лево не дёргалось при смене шагов.
  &__layout {
    flex: 1;
    width: 100%;
    max-width: 1320px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(360px, 0.85fr);
    align-items: center;
    gap: clamp(32px, 4vw, 72px);
    min-height: 0;

    @media (max-width: 960px) {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
  }

  &__stage {
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    // Фикс min-height удерживает grid-row при разной длине контента шагов.
    justify-content: center;
    min-height: clamp(440px, 62vh, 580px);
  }

  &__orb-stage {
    place-self: center;
    display: grid;
    place-items: center;
    width: 100%;
    min-height: clamp(360px, 50vh, 540px);

    :deep(.orb) {
      --orb-size: clamp(320px, min(36vw, 100%), 560px);
    }

    @media (max-width: 960px) {
      display: none;
    }
  }

  &__title {
    font-family: var(--font-family-display);
    font-size: clamp(36px, 5vw, 56px);
    line-height: 1.05;
    letter-spacing: -0.02em;
    font-weight: 800;
    margin: 0 0 18px;
    text-wrap: balance;
  }

  &__heading {
    font-family: var(--font-family-display);
    font-size: clamp(28px, 3.6vw, 40px);
    line-height: 1.1;
    font-weight: 700;
    letter-spacing: -0.015em;
    margin: 0 0 10px;
  }

  &__lede,
  &__sub {
    max-width: 580px;
    margin: 0 0 28px;
    font-size: 16px;
    line-height: 1.55;
    color: var(--color-text-secondary);
  }

  &__hero {
    display: flex;
  }

  &__hero-copy {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    width: 100%;
  }

  &__hero-bullets {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;

    li {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      color: var(--color-text-secondary);

      :deep(svg) {
        color: var(--color-success);
        flex-shrink: 0;
      }
    }
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
    gap: 14px;
    text-align: left;
  }

  &__feature {
    --feature-accent: var(--color-brand-purple);
    --feature-accent-rgb: var(--color-brand-purple-rgb);
    padding: 20px;
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--color-border-subtle);
    animation: featureIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) backwards;
    transition:
      background 160ms var(--ease-out),
      border-color 160ms var(--ease-out);

    &:hover {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(var(--feature-accent-rgb), 0.4);
    }

    &-glyph {
      display: inline-flex;
      width: 40px;
      height: 40px;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-md);
      background: rgba(var(--feature-accent-rgb), 0.14);
      color: var(--feature-accent);
      margin-bottom: 14px;

      :deep(svg) {
        width: 20px;
        height: 20px;
      }
    }

    &-title {
      font-size: 15.5px;
      font-weight: 700;
      margin: 0 0 6px;
      color: var(--color-text-primary);
      letter-spacing: -0.005em;
    }

    &-text {
      font-size: 13px;
      line-height: 1.5;
      color: var(--color-text-secondary);
      margin: 0;
    }
  }

  &__flow-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
    gap: 14px;
    text-align: left;
  }

  &__flow-card {
    padding: 22px;
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--color-border-subtle);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__flow-step {
    font-family: var(--font-family-mono);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-brand-purple);
  }

  &__flow-title {
    font-size: 17px;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.01em;
  }

  &__flow-steps {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    counter-reset: flow;
    display: flex;
    flex-direction: column;
    gap: 10px;

    li {
      counter-increment: flow;
      position: relative;
      padding-left: 30px;
      font-size: 13.5px;
      line-height: 1.5;
      color: var(--color-text-secondary);

      &::before {
        @include numeric-badge(0);
        content: counter(flow);
        position: absolute;
        left: 0;
        top: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: rgba(var(--color-brand-purple-rgb), 0.14);
        color: var(--color-brand-purple);
        font-family: var(--font-family-mono);
        font-size: 12px;
        font-weight: 700;
      }
    }
  }

  &__privacy-card {
    max-width: 560px;
    margin: 0;
    padding: 24px 28px;
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--color-border-subtle);
    text-align: left;
  }

  &__bullets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;

    li {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      font-size: 14.5px;
      color: var(--color-text-primary);
      animation: bulletIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards;

      &:nth-child(1) {
        animation-delay: 0.05s;
      }
      &:nth-child(2) {
        animation-delay: 0.15s;
      }
      &:nth-child(3) {
        animation-delay: 0.25s;
      }
      &:nth-child(4) {
        animation-delay: 0.35s;
      }
    }
  }

  &__check {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(var(--color-success-rgb), 0.16);
    color: var(--color-success);
    display: grid;
    place-items: center;

    :deep(svg) {
      width: 14px;
      height: 14px;
    }
  }

  &__done {
    display: flex;
    flex-direction: column;
    align-items: flex-start;

    @media (max-width: 720px) {
      align-items: center;
      text-align: center;
    }
  }

  &__done-tips {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
    gap: 8px;
    width: 100%;
    max-width: 580px;

    li {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 12px 14px;
      border-radius: var(--radius-md);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--color-border-subtle);

      strong {
        font-family: var(--font-family-mono);
        font-size: 12px;
        font-weight: 700;
        color: var(--color-brand-purple);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      span {
        font-size: 12.5px;
        color: var(--color-text-secondary);
      }
    }
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px clamp(24px, 4vw, 64px) 28px;
    position: relative;
    z-index: 2;
    flex-wrap: wrap;
    gap: 16px;
  }

  &__dots {
    display: flex;
    gap: 8px;
  }

  &__dot {
    width: 28px;
    height: 5px;
    border-radius: 3px;
    border: 0;
    padding: 0;
    background: var(--color-border-soft);
    cursor: pointer;
    transition:
      background 280ms var(--ease-out),
      transform 200ms var(--ease-out);

    &:hover {
      transform: scaleY(1.3);
    }

    &.is-active {
      background: var(--gradient-brand);
    }
    &.is-passed {
      background: rgba(var(--color-brand-purple-rgb), 0.5);
    }
  }

  &__actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
}

.welcome-step-enter-active,
.welcome-step-leave-active {
  transition:
    opacity 360ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
}
.welcome-step-enter-from {
  opacity: 0;
  transform: translateY(24px) scale(0.98);
}
.welcome-step-leave-to {
  opacity: 0;
  transform: translateY(-18px) scale(0.99);
}

.welcome-fade-enter-active,
.welcome-fade-leave-active {
  transition: opacity 200ms ease;
}
.welcome-fade-enter-from,
.welcome-fade-leave-to {
  opacity: 0;
}

@keyframes featureIn {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes bulletIn {
  from {
    opacity: 0;
    transform: translateX(-12px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.welcome--reduce-motion {
  .welcome__feature,
  .welcome__bullets li {
    animation: none !important;
  }
  .welcome__rail-fill,
  .welcome__dot {
    transition: none !important;
  }
}

// ---- Mobile (≤ 720px) ----
// Welcome — первая встреча с приложением, должна быть удобна и на 360px.
@media (max-width: 720px) {
  .welcome {
    &__shell {
      padding: 18px 16px 12px;
    }

    &__rail {
      margin-bottom: 16px;
    }

    &__title {
      font-size: clamp(24px, 7vw, 32px);
      margin-bottom: 12px;
    }

    &__heading {
      font-size: clamp(20px, 5vw, 26px);
    }

    &__lede,
    &__sub {
      font-size: 14px;
    }

    &__stage {
      // Снимаем фикс min-height — экран и так маленький.
      min-height: 0;
    }

    &__hero {
      gap: 14px;
    }

    &__hero-bullets,
    &__bullets {
      font-size: 13px;
    }

    &__flow-cards,
    &__grid {
      grid-template-columns: 1fr;
      gap: 10px;
    }

    &__flow-card,
    &__feature {
      padding: 14px;
    }

    &__footer {
      padding: 12px 16px 20px;
      // Safe-area iOS.
      padding-bottom: max(20px, env(safe-area-inset-bottom));
      // Dots выше, кнопки ниже на всю ширину — типичная мобильная раскладка.
      flex-direction: column-reverse;
      align-items: stretch;
      gap: 12px;
    }

    &__actions {
      width: 100%;
      flex-direction: column-reverse;
      gap: 8px;

      :deep(.base-button),
      :deep(.btn) {
        width: 100%;
      }
    }

    &__dots {
      justify-content: center;
    }

    &__done-tips {
      grid-template-columns: 1fr;
    }
  }
}

// ---- Очень узкие (< 380px) или landscape phone ----
@media (max-width: 380px) {
  .welcome__title {
    font-size: 22px;
  }
}
</style>
