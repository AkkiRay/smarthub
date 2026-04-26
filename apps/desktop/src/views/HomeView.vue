<template>
  <section class="home" ref="root">
    <!-- HERO: двух-колоночный grid, текст слева, orb справа. -->
    <header class="home__hero">
      <div class="home__panel">
        <h1 class="home__title">
          {{ greeting }},<br />
          <span class="text--gradient">умный дом</span>
        </h1>

        <dl v-if="hasMetrics" class="home__metrics">
          <div
            v-if="devices.devices.length"
            class="home__metric"
            :class="{ 'is-active': devices.onlineCount > 0 }"
          >
            <dt class="text--micro">в сети</dt>
            <dd>{{ devices.onlineCount }}</dd>
          </div>
          <div
            v-if="devices.offlineCount > 0"
            class="home__metric home__metric--muted"
          >
            <dt class="text--micro">оффлайн</dt>
            <dd>{{ devices.offlineCount }}</dd>
          </div>
          <div v-if="scenes.scenes.length" class="home__metric">
            <dt class="text--micro">сценарии</dt>
            <dd>{{ scenes.scenes.length }}</dd>
          </div>
        </dl>

        <div class="home__actions">
          <BaseButton variant="primary" size="lg" icon-left="search" @click="runDiscovery">
            Найти устройства
          </BaseButton>
          <BaseButton
            v-if="scenes.scenes.length"
            variant="ghost"
            size="lg"
            icon-right="arrow-right"
            @click="$router.push('/scenes')"
          >
            Сценарии
          </BaseButton>
        </div>
      </div>

      <div class="home__orb-stage">
        <JarvisOrb size="hero" :state="orbState" track-window class="home__orb" />
      </div>
    </header>

    <!-- Onboarding banner — показываем пока нет устройств ИЛИ нет Алисы.
         Цель: дать новому пользователю две понятные «главные» точки входа. -->
    <Transition name="home-fade">
      <section v-if="showOnboarding" class="home__onboarding" data-tour="home-onboarding">
        <div class="home__section-head">
          <span class="text--micro">Начните с этого</span>
          <span class="home__section-line" />
        </div>
        <div class="home__onboarding-grid">
          <button
            v-if="!devices.devices.length"
            type="button"
            class="onboarding-tile onboarding-tile--devices"
            @click="runDiscovery"
          >
            <div class="onboarding-tile__num">1</div>
            <div class="onboarding-tile__copy">
              <strong class="onboarding-tile__title">Найти устройства</strong>
              <span class="onboarding-tile__sub">
                Хаб опросит локальную сеть и покажет все лампы, розетки, датчики.
              </span>
            </div>
            <BaseIcon name="search" :size="20" class="onboarding-tile__arrow" />
          </button>
          <button
            v-if="!isAliceConnected"
            type="button"
            class="onboarding-tile onboarding-tile--alice"
            @click="$router.push('/alice')"
          >
            <div class="onboarding-tile__num">2</div>
            <div class="onboarding-tile__copy">
              <strong class="onboarding-tile__title">Подключить колонку Алисы</strong>
              <span class="onboarding-tile__sub">
                Войти через Яндекс — мы автоматически найдём колонки и подключим их.
              </span>
            </div>
            <BaseIcon name="alice" :size="20" class="onboarding-tile__arrow" />
          </button>
          <button
            v-if="!hasAnyIntegration"
            type="button"
            class="onboarding-tile onboarding-tile--integrations"
            @click="$router.push('/settings')"
          >
            <div class="onboarding-tile__num">3</div>
            <div class="onboarding-tile__copy">
              <strong class="onboarding-tile__title">Подключить облачные интеграции</strong>
              <span class="onboarding-tile__sub">
                Сбер Дом, Tuya, Mi Home, Home Assistant — 28 поддерживаемых платформ.
              </span>
            </div>
            <BaseIcon name="settings" :size="20" class="onboarding-tile__arrow" />
          </button>
        </div>
      </section>
    </Transition>

    <!-- Быстрый доступ скрываем целиком если нет on/off-устройств — клики были бы no-op'ом. -->
    <section v-if="hasToggleable" class="home__quick">
      <div class="home__section-head">
        <span class="text--micro">Быстрый доступ</span>
        <span class="home__section-line" />
      </div>
      <div class="home__quick-grid">
        <button
          v-for="quick in quickScenes"
          :key="quick.id"
          class="quick-tile"
          :style="{ '--accent': quick.accent }"
          @click="runQuick(quick)"
        >
          <span class="quick-tile__glyph">
            <BaseIcon :name="quick.icon" :size="18" />
          </span>
          <span class="quick-tile__name">{{ quick.name }}</span>
          <span class="quick-tile__hint">{{ quick.hint }}</span>
        </button>
      </div>
    </section>

    <!-- Сценарии Алисы — клик запускает через iot.quasar. -->
    <section v-if="topAliceScenarios.length" class="home__alice-scenarios">
      <div class="home__section-head">
        <span class="text--micro">Сценарии Алисы</span>
        <span class="home__section-line" />
        <RouterLink to="/scenes" class="home__section-link">
          Все {{ aliceScenariosCount }} →
        </RouterLink>
      </div>
      <div class="home__alice-grid">
        <button
          v-for="s in topAliceScenarios"
          :key="s.id"
          type="button"
          class="alice-tile"
          :class="{ 'is-running': runningScenarioId === s.id }"
          :disabled="runningScenarioId !== null"
          :title="s.triggers[0]?.summary ?? 'Запустить сценарий'"
          @click="runAliceScenario(s.id, s.name)"
        >
          <span class="alice-tile__glyph">
            <BaseIcon name="alice" :size="18" />
          </span>
          <span class="alice-tile__name">{{ s.name }}</span>
          <span v-if="s.triggers.length" class="alice-tile__hint">
            {{ s.triggers[0]!.summary }}
          </span>
          <span v-else class="alice-tile__hint">Запуск вручную</span>
        </button>
      </div>
    </section>

    <section class="home__rooms" v-if="topDevices.length">
      <div class="home__section-head">
        <span class="text--micro">Устройства</span>
        <span class="home__section-line" />
        <RouterLink to="/devices" class="home__section-link">
          Все {{ devices.devices.length }} →
        </RouterLink>
      </div>
      <div class="home__device-grid">
        <DeviceCard
          v-for="d in topDevices"
          :key="d.id"
          :device="d"
          @click="$router.push(`/devices/${d.id}`)"
        />
      </div>
    </section>

    <BaseEmpty
      v-else
      title="Устройств пока нет"
      text="Запустите сканирование локальной сети — хаб найдёт лампы, розетки и колонку Алисы."
    >
      <template #glyph>
        <BaseIcon name="devices" :size="64" />
      </template>
      <template #actions>
        <BaseButton variant="primary" icon-left="search" @click="runDiscovery">
          Запустить сканирование
        </BaseButton>
      </template>
    </BaseEmpty>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { CAPABILITY, INSTANCE } from '@smarthome/shared';
import { useDevicesStore } from '@/stores/devices';
import { useScenesStore } from '@/stores/scenes';
import { useUiStore } from '@/stores/ui';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useToasterStore } from '@/stores/toaster';
import { useGsap } from '@/composables/useGsap';
import { useRoute, useRouter } from 'vue-router';
import DeviceCard from '@/components/devices/DeviceCard.vue';
import JarvisOrb from '@/components/visuals/JarvisOrb.vue';
import { useTourStore } from '@/stores/tour';
import { BaseButton, BaseEmpty, BaseIcon } from '@/components/base';
import { QUICK_SCENES, type QuickScene } from '@/constants/quickScenes';

const devices = useDevicesStore();
const scenes = useScenesStore();
const ui = useUiStore();
const yandex = useYandexStationStore();
const toaster = useToasterStore();
const tour = useTourStore();
const router = useRouter();
const route = useRoute();
const root = useTemplateRef<HTMLElement>('root');

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
});

const orbState = computed<'idle' | 'active' | 'error'>(() => {
  if (devices.onlineCount > 0) return 'active';
  if (devices.devices.length > 0 && devices.onlineCount === 0) return 'error';
  return 'idle';
});

// Onboarding banner: видим пока есть незакрытый шаг.
const isAliceConnected = computed(() => yandex.status?.connection === 'connected');
const hasAnyIntegration = ref(false);
const showOnboarding = computed(
  () => !devices.devices.length || !isAliceConnected.value || !hasAnyIntegration.value,
);

const topDevices = computed(() => devices.devices.slice(0, 6));

/** Хотя бы одно устройство умеет on/off — иначе quick-tiles бесполезны. */
const hasToggleable = computed(() =>
  devices.devices.some((d) =>
    d.capabilities.some((c) => c.type === 'devices.capabilities.on_off'),
  ),
);

/** Метрики имеют смысл, если есть что считать (либо устройства, либо сценарии). */
const hasMetrics = computed(
  () => devices.devices.length > 0 || scenes.scenes.length > 0,
);

const quickScenes = QUICK_SCENES;

// ---- Yandex scenarios surface ---------------------------------------------

const aliceScenariosCount = computed(() => yandex.home?.scenarios.length ?? 0);
/** Топ-6 yandex-сценариев: активные сверху, остальные после. */
const topAliceScenarios = computed(() => {
  const all = yandex.home?.scenarios ?? [];
  const active = all.filter((s) => s.isActive !== false);
  const inactive = all.filter((s) => s.isActive === false);
  return [...active, ...inactive].slice(0, 6);
});

const runningScenarioId = ref<string | null>(null);

async function runAliceScenario(id: string, name: string): Promise<void> {
  if (runningScenarioId.value) return;
  runningScenarioId.value = id;
  try {
    const r = await window.smarthome.yandexStation.runHomeScenario(id);
    if (r.ok) {
      toaster.push({ kind: 'success', message: `Сценарий «${name}» запущен` });
    } else {
      toaster.push({ kind: 'error', message: r.error ?? `Не удалось запустить «${name}»` });
    }
  } catch (e) {
    toaster.push({ kind: 'error', message: (e as Error).message });
  } finally {
    runningScenarioId.value = null;
  }
}

async function runDiscovery(): Promise<void> {
  // Сначала push, потом start: ack backend перед навигацией → кнопка казалась мёртвой.
  await router.push('/discovery');
  void devices.startDiscovery();
}

async function runQuick(quick: QuickScene): Promise<void> {
  const targets = devices.devices.filter((d) =>
    d.capabilities.some((c) => c.type === 'devices.capabilities.on_off'),
  );
  const value = quick.id === 'all-off' || quick.id === 'sleep' ? false : true;
  for (const t of targets) {
    await devices.execute({
      deviceId: t.id,
      capability: 'devices.capabilities.on_off',
      instance: 'on',
      value,
    });
  }
}

const { from } = useGsap(root.value);
onMounted(async () => {
  if (!scenes.scenes.length) await scenes.bootstrap();

  // Active integrations check — для onboarding-баннера. Mock и yandex-station исключаем,
  // потому что mock — debug-режим, а yandex-station учитывается отдельным шагом.
  try {
    const drivers = await window.smarthome.drivers.list();
    hasAnyIntegration.value = drivers.some(
      (d) => d.active && d.id !== 'mock' && d.id !== 'yandex-station',
    );
  } catch {
    /* ничего — баннер просто покажет шаг подключения интеграций */
  }

  from('.home__orb', { opacity: 0, scale: 0.92, duration: 0.9, ease: 'power3.out' });
  from('.home__panel > *', { opacity: 0, x: -20, stagger: 0.06, duration: 0.55, delay: 0.2 });
  from('.quick-tile', { opacity: 0, y: 12, stagger: 0.06, duration: 0.5, delay: 0.4 });
  from('.home__device-grid > *', { opacity: 0, y: 14, stagger: 0.05, duration: 0.45, delay: 0.5 });

  // Глобальный TourOverlay (App.vue) сам подхватит ?tour=1 через свой onMounted-хук.
  // Здесь поддерживаем разовый «чистый» запуск из Welcome → /home?tour=1.
  if (route.query.tour === '1' && !ui.tourCompleted && !tour.isActive) {
    setTimeout(() => tour.start(), 700);
  }
});
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.home {
  display: flex;
  flex-direction: column;
  gap: var(--content-gap);
  width: 100%;
}

// Onboarding banner: 1-3 крупных tile'а с пронумерованными шагами.
.home__onboarding {
  display: flex;
  flex-direction: column;
  gap: 14px;

  &-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 10px;
  }
}

.onboarding-tile {
  --tile-accent: var(--color-brand-purple);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  text-align: left;
  position: relative;
  overflow: hidden;
  transition:
    background-color 240ms var(--ease-out),
    border-color 240ms var(--ease-out),
    transform 240ms var(--ease-out);

  &::before {
    content: '';
    position: absolute;
    inset: -50% -10% auto auto;
    width: 200px;
    height: 200px;
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--tile-accent) 18%, transparent),
      transparent 65%
    );
    opacity: 0;
    transition: opacity 280ms var(--ease-out);
    pointer-events: none;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.045);
    border-color: color-mix(in srgb, var(--tile-accent) 35%, transparent);
    transform: translateY(-2px);
    &::before {
      opacity: 1;
    }
  }

  &:active {
    transform: translateY(0);
    transition-duration: 0ms;
  }

  &--alice {
    --tile-accent: #ffd75e;
  }

  &--integrations {
    --tile-accent: var(--color-brand-pink);
  }

  &__num {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--tile-accent) 14%, transparent);
    color: var(--tile-accent);
    font-family: var(--font-family-mono);
    font-weight: 700;
    font-size: 15px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    position: relative;
  }

  &__copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    position: relative;
  }

  &__title {
    font-size: 15px;
    font-weight: 600;
    color: var(--color-text-primary);
    letter-spacing: -0.005em;
  }

  &__sub {
    font-size: 12.5px;
    color: var(--color-text-secondary);
    line-height: 1.45;
    text-wrap: pretty;
  }

  &__arrow {
    color: var(--color-text-muted);
    transition:
      color 200ms var(--ease-out),
      transform 240ms var(--ease-out);
    flex-shrink: 0;
    position: relative;
  }

  &:hover &__arrow {
    color: var(--tile-accent);
    transform: translateX(4px);
  }
}

.home-fade-enter-active,
.home-fade-leave-active {
  transition:
    opacity 280ms var(--ease-out),
    transform 280ms var(--ease-out);
}
.home-fade-enter-from,
.home-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .onboarding-tile,
  .onboarding-tile__arrow {
    transition: none;
  }
  .home-fade-enter-active,
  .home-fade-leave-active {
    transition: none;
  }
}

// HERO без рамки: контент и орб «парят» над общей aura приложения.
.home__hero {
  position: relative;
  padding: 0;
  min-height: clamp(420px, 56vh, 640px);
  isolation: isolate;
  // Aura: радиальное свечение под орбом, привязано к точке композиции, не к границам hero.
  &::before {
    content: '';
    position: absolute;
    inset: -8% -4% -10% 30%;
    background:
      radial-gradient(
        55% 70% at 70% 50%,
        rgba(var(--color-brand-purple-rgb), 0.32) 0%,
        transparent 65%
      ),
      radial-gradient(
        40% 55% at 88% 70%,
        rgba(var(--color-brand-pink-rgb), 0.22) 0%,
        transparent 60%
      ),
      radial-gradient(
        35% 60% at 50% 30%,
        rgba(var(--color-brand-amber-rgb), 0.16) 0%,
        transparent 70%
      );
    filter: blur(20px);
    z-index: -1;
    pointer-events: none;
  }

  // Орб вылезает за правый край rendered-area — это норма, общий aura-фон ловит сияние.
  display: grid;
  grid-template-columns: minmax(320px, 520px) minmax(0, 1fr);
  align-items: center;
  gap: clamp(24px, 3vw, 56px);

  @media (max-width: 900px) {
    grid-template-columns: minmax(0, 1fr);
    min-height: auto;
    padding: 0;
    gap: 24px;

    &::before {
      inset: -10% -10% 20% -10%;
    }
  }
}

.home__panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;

  @media (max-width: 900px) {
    align-items: flex-start;
  }
}

// Negative-margin даёт орбу «выйти» за правый край без ломки layout-а соседей.
.home__orb-stage {
  display: grid;
  place-items: center;
  align-self: stretch;
  min-width: 0;
  min-height: clamp(420px, 56vh, 620px);
  margin-right: clamp(-120px, -8vw, -40px);

  .home__orb {
    --orb-size: clamp(380px, min(48vw, 100%), 720px);
    pointer-events: auto;
  }

  @media (max-width: 900px) {
    display: none;
  }
}

.home__title {
  font-family: var(--font-family-display);
  font-size: clamp(32px, 3.6vw, 52px);
  font-weight: 720;
  line-height: 1.02;
  letter-spacing: -0.025em;
  margin: 0;
  text-wrap: balance;
}

// Метрики: hairline-разделители между колонками, без box-frame.
.home__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  padding: 0;
  margin: 0;
  background: transparent;
  border: 0;
}
.home__metric {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 16px;
  background: transparent;

  & + .home__metric {
    border-left: 1px solid var(--color-border-subtle);
  }
  &:first-child {
    padding-left: 0;
  }

  dt {
    color: var(--color-text-muted);
    margin-bottom: 2px;
  }
  dd {
    font-family: var(--font-family-display);
    font-size: clamp(36px, 3.4vw, 48px);
    font-weight: 720;
    line-height: 1;
    letter-spacing: -0.025em;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
    margin: 0;
  }

  &.is-active dd {
    background: var(--gradient-brand);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  &--muted dd {
    color: var(--color-text-muted);
  }
}

.home__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;

  @media (max-width: 900px) {
    justify-content: center;
  }
}

.home__section-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;

  .text--micro {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
}
.home__section-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(to right, var(--color-border-soft), transparent 70%);
}
.home__section-link {
  font-family: var(--font-family-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  flex-shrink: 0;
  transition: color 200ms;
  &:hover {
    color: var(--color-brand-purple);
  }
}

.home__quick {
  display: flex;
  flex-direction: column;
}
.home__quick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
  gap: 12px;
}

.quick-tile {
  --accent: var(--color-brand-violet);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  text-align: left;
  cursor: pointer;
  color: var(--color-text-primary);
  transition:
    background 160ms var(--ease-out),
    border-color 160ms var(--ease-out);

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: color-mix(in srgb, var(--accent) 50%, var(--color-border-soft));
  }
  &:active {
    background: rgba(255, 255, 255, 0.08);
  }

  &__glyph {
    display: inline-flex;
    width: 32px;
    height: 32px;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
    margin-bottom: 6px;
    :deep(svg) {
      width: 18px;
      height: 18px;
    }
  }
  &__name {
    font-weight: 600;
    font-size: 13.5px;
    letter-spacing: -0.005em;
  }
  &__hint {
    font-size: 12px;
    color: var(--color-text-muted);
  }
}

.home__alice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
  gap: 12px;
}

.alice-tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px;
  border-radius: var(--radius-lg);
  background: rgba(255, 204, 0, 0.04);
  border: 1px solid rgba(255, 204, 0, 0.18);
  text-align: left;
  cursor: pointer;
  color: var(--color-text-primary);
  position: relative;
  overflow: hidden;
  transition:
    background 160ms var(--ease-out),
    border-color 160ms var(--ease-out),
    transform 160ms var(--ease-out);

  &::after {
    content: '';
    position: absolute;
    inset: -40% auto auto -20%;
    width: 140px;
    height: 140px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 204, 0, 0.32), transparent 65%);
    filter: blur(20px);
    pointer-events: none;
  }

  &:hover:not(:disabled) {
    background: rgba(255, 204, 0, 0.08);
    border-color: rgba(255, 204, 0, 0.4);
    transform: translateY(-1px);
  }
  &:disabled {
    opacity: 0.55;
    cursor: progress;
  }
  &.is-running {
    border-color: rgba(255, 204, 0, 0.7);
    box-shadow: 0 0 0 1px rgba(255, 204, 0, 0.4);
  }

  &__glyph {
    display: inline-flex;
    width: 32px;
    height: 32px;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: rgba(255, 204, 0, 0.18);
    color: #ffcc00;
    margin-bottom: 6px;
    position: relative;
    z-index: 1;
  }
  &__name {
    font-weight: 600;
    font-size: 13.5px;
    letter-spacing: -0.005em;
    position: relative;
    z-index: 1;
  }
  &__hint {
    font-size: 12px;
    color: var(--color-text-muted);
    position: relative;
    z-index: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.home__rooms {
  display: flex;
  flex-direction: column;
}
.home__device-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
  gap: 12px;
}

.home__empty {
  padding: 48px 32px;
  border: 1px dashed var(--color-border-soft);
  border-radius: var(--radius-xl);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: var(--color-text-secondary);
}

@keyframes homePulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.4);
    opacity: 0.4;
  }
}
</style>
