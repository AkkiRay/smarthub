<template>
  <section class="home" ref="root">
    <!-- HERO: главный заголовок + статус-strip + ambient 3D mesh -->
    <header class="home__hero">
      <!-- 3D wireframe sphere в правом-верхнем углу hero — статичный визуал
           с медленным spin'ом. На narrow viewport скрыт через CSS. -->
      <AmbientMesh class="home__hero-mesh" :detail="2" />
      <div class="home__hero-copy">
        <span class="home__hero-eyebrow">
          <span class="home__hero-pulse" />
          <span>{{ contextLabel }}</span>
        </span>
        <h1 class="home__title">
          {{ greeting }},<br />
          <span class="text--alice">{{ subtitleAccent }}</span>
        </h1>
        <p class="home__lead">{{ contextLead }}</p>

        <!-- Action bar — не теряется на скролле -->
        <div class="home__actions">
          <BaseButton variant="primary" size="lg" icon-left="search" @click="runDiscovery">
            Найти устройства
          </BaseButton>
          <BaseButton
            variant="ghost"
            size="lg"
            icon-right="arrow-right"
            @click="$router.push('/devices')"
          >
            Все устройства
          </BaseButton>
        </div>
      </div>

      <!-- Status-strip справа: 4 KPI с разделителями -->
      <aside class="home__kpis" v-if="hasMetrics" data-tour="home-onboarding">
        <button
          type="button"
          class="home__kpi"
          :class="{ 'home__kpi--active': devices.onlineCount > 0 }"
          @click="$router.push('/devices')"
        >
          <span class="home__kpi-label">в сети</span>
          <span class="home__kpi-value">{{ devices.onlineCount }}</span>
          <span class="home__kpi-hint">из {{ devices.devices.length }} устройств</span>
        </button>
        <button
          type="button"
          class="home__kpi"
          :class="{ 'home__kpi--muted': devices.offlineCount === 0 }"
          @click="$router.push('/devices')"
        >
          <span class="home__kpi-label">офлайн</span>
          <span class="home__kpi-value">{{ devices.offlineCount }}</span>
          <span class="home__kpi-hint">{{
            devices.offlineCount > 0 ? 'нужно проверить' : 'всё на связи'
          }}</span>
        </button>
        <button type="button" class="home__kpi" @click="$router.push('/scenes')">
          <span class="home__kpi-label">сценарии</span>
          <span class="home__kpi-value">{{ totalScenes }}</span>
          <span class="home__kpi-hint">{{
            aliceScenariosCount > 0 ? `${aliceScenariosCount} в Алисе` : 'локальные'
          }}</span>
        </button>
        <button
          type="button"
          class="home__kpi"
          :class="{ 'home__kpi--accent': isAliceConnected }"
          @click="$router.push('/alice')"
        >
          <span class="home__kpi-label">Алиса</span>
          <span class="home__kpi-value">
            <span class="home__kpi-dot" :class="aliceDotClass" />
            {{ aliceLabel }}
          </span>
          <span class="home__kpi-hint">{{ aliceHint }}</span>
        </button>
      </aside>
    </header>

    <!-- Onboarding banner — нумерованные шаги -->
    <Transition name="home-fade">
      <section v-if="showOnboarding" class="home__onboarding">
        <header class="home__head">
          <div>
            <span class="home__head-eyebrow">Начните с этого</span>
            <h2 class="home__head-title">Подключите первый источник</h2>
          </div>
        </header>
        <div class="home__onboarding-grid">
          <button
            v-if="!devices.devices.length"
            type="button"
            class="tile tile--interactive tile--violet"
            @click="runDiscovery"
          >
            <div class="tile__icon"><BaseIcon name="search" :size="22" /></div>
            <div class="tile__label">Найти в LAN</div>
            <div class="tile__hint">
              Хаб опросит локальную сеть — лампы, розетки, датчики, колонки.
            </div>
            <div class="tile__meta">
              Шаг 1 / 3
              <BaseIcon name="arrow-right" :size="12" />
            </div>
          </button>
          <button
            v-if="!isAliceConnected"
            type="button"
            class="tile tile--interactive tile--pink"
            @click="$router.push('/alice')"
          >
            <div class="tile__icon"><BaseIcon name="alice" :size="22" /></div>
            <div class="tile__label">Подключить Алису</div>
            <div class="tile__hint">
              Войти через Яндекс — автоматический поиск Станций, импорт устройств.
            </div>
            <div class="tile__meta">
              Шаг 2 / 3
              <BaseIcon name="arrow-right" :size="12" />
            </div>
          </button>
          <button
            v-if="!hasAnyIntegration"
            type="button"
            class="tile tile--interactive tile--amber"
            @click="$router.push('/settings')"
          >
            <div class="tile__icon"><BaseIcon name="settings" :size="22" /></div>
            <div class="tile__label">Облачные интеграции</div>
            <div class="tile__hint">
              Сбер Дом, Tuya, Mi Home, Govee — всего 16 платформ в маркетплейсе.
            </div>
            <div class="tile__meta">
              Шаг 3 / 3
              <BaseIcon name="arrow-right" :size="12" />
            </div>
          </button>
        </div>
      </section>
    </Transition>

    <!-- Быстрые сцены: контекстуально (сейчас день — сцены подсветки/кино) -->
    <section v-if="hasOnlineToggleable" class="home__quick">
      <header class="home__head">
        <div>
          <span class="home__head-eyebrow">Быстрые действия</span>
          <h2 class="home__head-title">Управление одним кликом</h2>
        </div>
        <RouterLink v-if="totalScenes > 0" to="/scenes" class="home__head-link">
          Все сценарии
          <BaseIcon name="arrow-right" :size="12" />
        </RouterLink>
      </header>
      <div class="home__quick-grid">
        <button
          v-for="quick in quickScenes"
          :key="quick.id"
          class="quick-tile"
          :class="{ 'quick-tile--running': busyQuickId === quick.id }"
          :disabled="busyQuickId !== null && busyQuickId !== quick.id"
          :style="{ '--accent': quick.accent }"
          @click="runQuick(quick)"
        >
          <span class="quick-tile__glyph">
            <BaseIcon :name="quick.icon" :size="20" />
          </span>
          <span class="quick-tile__body">
            <span class="quick-tile__name">{{ quick.name }}</span>
            <span class="quick-tile__hint">{{ quick.hint }}</span>
          </span>
          <span class="quick-tile__arrow">
            <BaseIcon name="arrow-right" :size="14" />
          </span>
        </button>
      </div>
    </section>

    <!-- Сценарии Алисы -->
    <section v-if="topAliceScenarios.length" class="home__alice">
      <header class="home__head">
        <div>
          <span class="home__head-eyebrow">Сценарии Алисы</span>
          <h2 class="home__head-title">Голосовые автоматизации</h2>
        </div>
        <RouterLink to="/scenes" class="home__head-link">
          Все {{ aliceScenariosCount }}
          <BaseIcon name="arrow-right" :size="12" />
        </RouterLink>
      </header>
      <div class="home__alice-grid">
        <button
          v-for="s in topAliceScenarios"
          :key="s.id"
          type="button"
          class="alice-tile"
          :class="{ 'alice-tile--running': runningScenarioId === s.id }"
          :disabled="runningScenarioId !== null"
          :title="s.triggers[0]?.summary ?? 'Запустить сценарий'"
          @click="runAliceScenario(s.id, s.name)"
        >
          <span class="alice-tile__glyph">
            <BaseIcon name="alice" :size="20" />
          </span>
          <span class="alice-tile__body">
            <span class="alice-tile__name">{{ s.name }}</span>
            <span class="alice-tile__hint">{{ s.triggers[0]?.summary ?? 'Запуск вручную' }}</span>
          </span>
          <span class="alice-tile__action">
            <BaseIcon
              :name="runningScenarioId === s.id ? 'refresh' : 'arrow-right'"
              :size="14"
              :spin="runningScenarioId === s.id"
            />
          </span>
        </button>
      </div>
    </section>

    <!-- Устройства -->
    <section v-if="topDevices.length" class="home__rooms">
      <header class="home__head">
        <div>
          <span class="home__head-eyebrow">Устройства</span>
          <h2 class="home__head-title">Недавние и часто используемые</h2>
        </div>
        <RouterLink to="/devices" class="home__head-link">
          Все {{ devices.devices.length }}
          <BaseIcon name="arrow-right" :size="12" />
        </RouterLink>
      </header>
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
      v-else-if="!showOnboarding"
      title="Устройств пока нет"
      text="Запустите сканирование локальной сети — хаб найдёт лампы, розетки и колонку Алисы."
    >
      <template #glyph>
        <BaseIcon name="devices" :size="48" />
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
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { useDevicesStore } from '@/stores/devices';
import { useScenesStore } from '@/stores/scenes';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useToasterStore } from '@/stores/toaster';
import { useGsap } from '@/composables/useGsap';
import { useRouter } from 'vue-router';
import DeviceCard from '@/components/devices/DeviceCard.vue';
import AmbientMesh from '@/components/visuals/AmbientMesh.vue';
import { BaseButton, BaseEmpty, BaseIcon } from '@/components/base';
import { QUICK_SCENES, type QuickScene } from '@/constants/quickScenes';

const devices = useDevicesStore();
const scenes = useScenesStore();
const yandex = useYandexStationStore();
const toaster = useToasterStore();
const router = useRouter();
const root = useTemplateRef<HTMLElement>('root');

// Reactive hour: пересчитывается при ре-маунте + раз в минуту,
// чтобы greeting обновился после midnight без перезахода в view.
const hour = ref(new Date().getHours());
let hourTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  hourTimer = setInterval(() => {
    hour.value = new Date().getHours();
  }, 60_000);
});
onBeforeUnmount(() => {
  if (hourTimer) clearInterval(hourTimer);
});

const greeting = computed(() => {
  const h = hour.value;
  if (h < 6) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
});

const subtitleAccent = computed(() => {
  const h = hour.value;
  if (h < 6) return 'дом отдыхает';
  if (h < 12) return 'умный дом';
  if (h < 18) return 'всё под контролем';
  return 'время для уюта';
});

const contextLabel = computed(() => {
  const h = hour.value;
  if (h < 6) return 'Ночной режим';
  if (h < 12) return 'Утро';
  if (h < 18) return 'День';
  return 'Вечер';
});

const contextLead = computed(() => {
  const h = hour.value;
  if (h < 6) return 'Сцены приглушены, датчики работают. Ничего не отвлекает.';
  if (h < 12) return 'Запустите утренние сцены или подключите новые устройства.';
  if (h < 18) return 'Все устройства на связи. Можно собирать сценарии и группы.';
  return 'Самое время для сцен «Кино» или «Расслабление».';
});

const isAliceConnected = computed(() => yandex.status?.connection === 'connected');
const isAliceConnecting = computed(
  () =>
    yandex.status?.connection === 'connecting' || yandex.status?.connection === 'authenticating',
);

const aliceLabel = computed(() => {
  if (isAliceConnected.value) return 'на связи';
  if (isAliceConnecting.value) return '…';
  return 'не подключена';
});

const aliceHint = computed(() => {
  if (isAliceConnected.value) return yandex.status?.station?.name ?? 'станция онлайн';
  if (isAliceConnecting.value) return 'подключение…';
  return 'войти через Яндекс';
});

const aliceDotClass = computed(() => ({
  'home__kpi-dot--active': isAliceConnected.value,
  'home__kpi-dot--pending': isAliceConnecting.value,
}));

const hasAnyIntegration = ref(false);
const showOnboarding = computed(
  () => !devices.devices.length || !isAliceConnected.value || !hasAnyIntegration.value,
);

const topDevices = computed(() => devices.devices.slice(0, 6));
const totalScenes = computed(
  () => scenes.scenes.length + (yandex.homeFiltered?.scenarios.length ?? 0),
);

/** True если хотя бы одно online устройство имеет on_off capability. */
const hasOnlineToggleable = computed(() =>
  devices.devices.some(
    (d) =>
      d.status === 'online' && d.capabilities.some((c) => c.type === 'devices.capabilities.on_off'),
  ),
);

const hasMetrics = computed(() => devices.devices.length > 0 || scenes.scenes.length > 0);

const quickScenes = QUICK_SCENES;

const aliceScenariosCount = computed(() => yandex.homeFiltered?.scenarios.length ?? 0);
const topAliceScenarios = computed(() => {
  const all = yandex.homeFiltered?.scenarios ?? [];
  const active = all.filter((s) => s.isActive !== false);
  const inactive = all.filter((s) => s.isActive === false);
  return [...active, ...inactive].slice(0, 6);
});

const runningScenarioId = ref<string | null>(null);
const busyQuickId = ref<string | null>(null);

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
  await router.push('/discovery');
  void devices.startDiscovery();
}

async function runQuick(quick: QuickScene): Promise<void> {
  if (busyQuickId.value) return;
  busyQuickId.value = quick.id;
  const targets = devices.devices.filter((d) =>
    d.capabilities.some((c) => c.type === 'devices.capabilities.on_off'),
  );
  const value = quick.id === 'all-off' || quick.id === 'sleep' ? false : true;
  try {
    // Параллельно: serial-цикл блокировал UI на 1.5с/устройство (15с на 10 лампах,
    // фриз orb'а и спиннеров). allSettled — каждая команда failure'ит независимо,
    // success-toast считает только удавшиеся.
    const results = await Promise.allSettled(
      targets.map((t) =>
        devices.execute({
          deviceId: t.id,
          capability: 'devices.capabilities.on_off',
          instance: 'on',
          value,
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - ok;
    if (failed === 0) {
      toaster.push({ kind: 'success', message: `«${quick.name}» применено к ${ok} устройствам` });
    } else if (ok === 0) {
      toaster.push({
        kind: 'error',
        message: `«${quick.name}» не применилось ни к одному устройству`,
      });
    } else {
      toaster.push({
        kind: 'info',
        message: `«${quick.name}»: ${ok} из ${results.length} устройств отработали, ${failed} не ответили`,
      });
    }
  } catch (e) {
    toaster.push({ kind: 'error', message: (e as Error).message });
  } finally {
    busyQuickId.value = null;
  }
}

const { timeline } = useGsap(root);

onMounted(() => {
  // Async-bootstrap и IPC текут параллельно с mount-каскадом; результаты
  // pop-in'ят элементы через Vue-reactivity.
  void (async () => {
    if (!scenes.scenes.length) await scenes.bootstrap();
    try {
      const drivers = await window.smarthome.drivers.list();
      hasAnyIntegration.value = drivers.some(
        (d) => d.active && d.id !== 'mock' && d.id !== 'yandex-station',
      );
    } catch {
      /* ничего */
    }
  })();

  // Единый timeline вместо 5 параллельных from()-вызовов:
  // 1) общий ease/clearProps + один пул tween'ов меньше нагружает GSAP-ticker;
  // 2) hero-stagger горизонтальный (x), tiles-stagger вертикальный (y) —
  //    визуальная иерархия "shoulder → cards" сохраняется.
  // СИНХРОННО в onMounted: immediateRender (default для from()) ставит
  // opacity:0 inline ДО первого paint'а — fade-in полностью видим, без
  // flash'а natural-state'а на frame'е 0.
  const tl = timeline({
    defaults: { ease: 'power3.out', force3D: true, clearProps: 'opacity,transform' },
  });
  tl.from('.home__hero-copy > *', { opacity: 0, x: -16, stagger: 0.06, duration: 0.5 }, 0)
    .from('.home__kpi', { opacity: 0, y: 14, stagger: 0.04, duration: 0.45 }, 0.12)
    // Comma-selector: квик-плитки + Alice-плитки + device-карты — одной волной.
    // stagger.amount шапит общее время волны независимо от числа элементов.
    .from(
      '.quick-tile, .alice-tile, .home__device-grid > *',
      { opacity: 0, y: 12, stagger: { each: 0.04, amount: 0.42, from: 'start' }, duration: 0.42 },
      0.22,
    );
});
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.home {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
  width: 100%;
  align-self: start;

  @media (max-width: 720px) {
    gap: var(--space-4);
  }
}

// HERO: glass-карточка с двумя колонками — copy слева, KPI strip справа.
// AmbientMesh висит абсолютным слоем за gradient'ом, под содержимым.
.home__hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) auto;
  gap: var(--space-7);
  align-items: center;
  padding: var(--pad-roomy);
  border-radius: var(--radius-xl);
  overflow: hidden;
  isolation: isolate;
  @include glass(var(--glass-alpha-soft), var(--glass-blur-medium));
  // Layered depth + Alice-yellow tint в gradient'е.
  box-shadow: var(--depth-2);
  contain: layout style;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        60% 80% at 0% 0%,
        rgba(var(--color-brand-violet-rgb), 0.32) 0%,
        transparent 60%
      ),
      radial-gradient(
        50% 60% at 100% 100%,
        rgba(var(--color-brand-pink-rgb), 0.22) 0%,
        transparent 60%
      ),
      radial-gradient(
        38% 48% at 84% 18%,
        rgba(var(--color-brand-yellow-rgb), 0.16) 0%,
        transparent 60%
      );
    z-index: 0;
    pointer-events: none;
  }

  > * {
    position: relative;
    z-index: 1;
  }

  @media (max-width: 1080px) {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
  }

  @media (max-width: 720px) {
    padding: var(--pad-comfort);
    border-radius: var(--radius-lg);
    gap: var(--space-4);
  }
}

// AmbientMesh — 3D wireframe sphere в верхне-правом углу hero. Position
// absolute поверх gradient'а, под content'ом, через z-index. На <1080px
// hide — мобильный hero одноколоночный, mesh бы накладывался на text.
.home__hero-mesh {
  position: absolute;
  top: -40px;
  right: -60px;
  width: 320px;
  height: 320px;
  z-index: 0;
  opacity: 0.85;
  pointer-events: none;

  @media (max-width: 1080px) {
    width: 220px;
    height: 220px;
    top: -30px;
    right: -40px;
    opacity: 0.55;
  }

  @media (max-width: 760px) {
    display: none;
  }
}

.home__hero-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.home__hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px var(--space-3);
  border-radius: var(--radius-pill);
  background: rgba(var(--color-brand-violet-rgb), 0.16);
  border: var(--border-thin) solid rgba(var(--color-brand-violet-rgb), 0.28);
  font-size: var(--font-size-micro);
  font-weight: 600;
  letter-spacing: var(--tracking-micro);
  text-transform: uppercase;
  color: var(--color-text-primary);
  width: fit-content;
}

.home__hero-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--gradient-brand);
  box-shadow: 0 0 12px rgba(var(--color-brand-violet-rgb), 0.7);
  animation: pulseGlow 2.4s ease-in-out infinite;
}

.home__title {
  font-family: var(--font-family-display);
  font-size: var(--font-size-display);
  font-weight: 720;
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-display);
  margin: 0;
  text-wrap: balance;

  @media (max-width: 720px) {
    br {
      display: none;
    }
  }
}

.home__lead {
  font-size: var(--font-size-h2);
  line-height: var(--leading-relaxed);
  color: var(--color-text-secondary);
  max-width: 60ch;
  margin: 0;

  @media (max-width: 720px) {
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
  }
}

.home__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-3);

  @media (max-width: 720px) {
    margin-top: var(--space-1);
    gap: var(--space-2);
    > :deep(.btn) {
      flex: 1 1 auto;
    }
  }
}

// KPI strip — 4 метрики с pixel-thin разделителями.
.home__kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(140px, 1fr));
  gap: 1px;
  background: var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: var(--border-thin) solid var(--color-border-subtle);

  @media (max-width: 1080px) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  @media (max-width: 720px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  // ≤380px: single-column stack — каждая метрика на свою строку.
  @media (max-width: 380px) {
    grid-template-columns: 1fr;
  }
}

.home__kpi {
  background: rgba(var(--glass-tint), 0.4);
  border: 0;
  padding: var(--space-4) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  align-items: flex-start;
  cursor: pointer;
  color: var(--color-text-primary);
  text-align: left;
  transition: background var(--dur-fast) var(--ease-out);

  @media (max-width: 720px) {
    padding: 12px;
    gap: 2px;
  }

  // ≤380px: row-layout, label слева, value справа (выровнены по baseline).
  @media (max-width: 380px) {
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  &:hover {
    background: rgba(var(--glass-tint), 0.6);
  }

  &-label {
    font-size: var(--font-size-micro);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-micro);
  }

  // Value поддерживает numeric (`1`) и текстовые (`на связи`) значения.
  // text-wrap: balance + min-width: 0 — flexible-shrink в narrow cell'е.
  &-value {
    font-family: var(--font-family-display);
    font-size: var(--font-size-display-2);
    font-weight: 720;
    line-height: 1;
    letter-spacing: var(--tracking-display);
    font-variant-numeric: tabular-nums;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    text-wrap: balance;

    @media (max-width: 720px) {
      font-size: clamp(15px, 4.4vw, 19px);
    }
    @media (max-width: 380px) {
      font-size: 15px;
      gap: 6px;
    }
  }

  &-hint {
    font-size: var(--font-size-micro);
    color: var(--color-text-secondary);
  }

  &--active {
    .home__kpi-value {
      background: var(--gradient-brand);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }
  }

  &--accent {
    background: rgba(var(--color-brand-violet-rgb), 0.1);
    &:hover {
      background: rgba(var(--color-brand-violet-rgb), 0.16);
    }
  }

  &--muted {
    .home__kpi-value {
      color: var(--color-text-secondary);
    }
  }
}

.home__kpi-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-text-muted);
  flex-shrink: 0;

  &--active {
    background: var(--color-success);
    box-shadow: 0 0 12px rgba(var(--color-success-rgb), 0.6);
  }

  &--pending {
    background: var(--color-warning);
    animation: pulseGlow 1.6s ease-in-out infinite;
  }
}

// Section heads — eyebrow + title слева, "посмотреть всё" link справа.
.home__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
  flex-wrap: wrap;

  &-eyebrow {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-micro);
    color: var(--color-brand-violet);
    text-transform: uppercase;
    letter-spacing: var(--tracking-micro);
    font-weight: 600;
  }

  &-title {
    font-family: var(--font-family-display);
    font-size: var(--font-size-h1);
    font-weight: 700;
    color: var(--color-text-primary);
    letter-spacing: var(--tracking-h1);
    margin: var(--space-1) 0 0;
  }

  &-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-pill);
    font-size: var(--font-size-small);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: all var(--dur-fast) var(--ease-out);

    &:hover {
      color: var(--color-brand-violet);
      background: rgba(var(--color-brand-violet-rgb), 0.08);
    }
  }
}

// Onboarding tile grid.
.home__onboarding-grid {
  @include auto-grid(280px, var(--space-3));
}

// Quick scenes tile grid.
.home__quick-grid {
  @include auto-grid(220px, var(--space-3));
}

.quick-tile {
  --accent: var(--color-brand-violet);
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  border: var(--border-thin) solid var(--color-border-subtle);
  cursor: pointer;
  color: var(--color-text-primary);
  text-align: left;
  transition: all var(--dur-fast) var(--ease-out);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(
      80% 60% at 0% 0%,
      color-mix(in srgb, var(--accent) 18%, transparent),
      transparent 60%
    );
    opacity: 0;
    transition: opacity var(--dur-medium) var(--ease-out);
  }

  > * {
    position: relative;
    z-index: 1;
  }

  &:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--color-border-soft));
    transform: translateY(-2px);
    box-shadow: var(--shadow-hover);
    &::before {
      opacity: 1;
    }
    .quick-tile__arrow {
      transform: translateX(2px);
      color: var(--accent);
    }
  }

  &:active {
    transform: translateY(0);
    transition-duration: var(--dur-instant);
  }
  &:disabled {
    opacity: 0.5;
    cursor: progress;
  }

  &--running {
    border-color: var(--accent);
    box-shadow:
      0 0 0 var(--border-thin) var(--accent),
      var(--shadow-hover);
  }

  &__glyph {
    width: var(--icon-box-md);
    height: var(--icon-box-md);
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
    display: grid;
    place-items: center;
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__name {
    font-weight: 600;
    font-size: var(--font-size-h2);
    letter-spacing: var(--tracking-h2);
    color: var(--color-text-primary);
  }

  &__hint {
    font-size: var(--font-size-small);
    color: var(--color-text-secondary);
  }

  &__arrow {
    color: var(--color-text-muted);
    transition: all var(--dur-fast) var(--ease-out);
  }
}

// Alice scenarios tile grid.
.home__alice-grid {
  @include auto-grid(var(--cell-md), var(--space-3));
}

.alice-tile {
  // Alice-canon yellow из централизованного token'а — правки палитры
  // подхватываются автоматически без поиска rgb-литералов.
  --alice-accent: var(--color-brand-yellow-rgb);
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-lg);
  background: rgba(var(--alice-accent), 0.04);
  border: var(--border-thin) solid rgba(var(--alice-accent), 0.2);
  cursor: pointer;
  color: var(--color-text-primary);
  text-align: left;
  position: relative;
  overflow: hidden;
  transition: all var(--dur-fast) var(--ease-out);

  &::after {
    content: '';
    position: absolute;
    inset: -40% auto auto -20%;
    width: 140px;
    height: 140px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(var(--alice-accent), 0.32), transparent 65%);
    filter: blur(20px);
    pointer-events: none;
  }

  > * {
    position: relative;
    z-index: 1;
  }

  &:hover:not(:disabled) {
    background: rgba(var(--alice-accent), 0.08);
    border-color: rgba(var(--alice-accent), 0.45);
    transform: translateY(-1px);
    .alice-tile__action {
      transform: translateX(2px);
      color: var(--color-brand-yellow);
    }
  }

  &:disabled {
    opacity: 0.55;
    cursor: progress;
  }

  &--running {
    border-color: rgba(var(--alice-accent), 0.7);
    box-shadow: 0 0 0 var(--border-thin) rgba(var(--alice-accent), 0.4);
  }

  &__glyph {
    width: var(--icon-box-md);
    height: var(--icon-box-md);
    border-radius: 12px;
    background: rgba(var(--alice-accent), 0.18);
    color: var(--color-brand-yellow);
    display: grid;
    place-items: center;
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__name {
    font-weight: 600;
    font-size: var(--font-size-h2);
    letter-spacing: var(--tracking-h2);
  }

  &__hint {
    font-size: var(--font-size-small);
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__action {
    color: var(--color-text-muted);
    transition: all var(--dur-fast) var(--ease-out);
  }
}

// Devices tile grid. На Home `topDevices = slice(0, 6)` — короткий ряд,
// content-visibility не используется: intrinsic-size больше реальной высоты,
// при попадании в viewport layout схлопывается на десятки px и mount-stagger
// видится как «прыжок». Для длинных листов (DevicesView) есть utility .cv-auto.
.home__device-grid {
  @include auto-grid(var(--cell-md), var(--space-3));
}

.home-fade-enter-active,
.home-fade-leave-active {
  transition:
    opacity var(--dur-medium) var(--ease-out),
    transform var(--dur-medium) var(--ease-out);
}
.home-fade-enter-from,
.home-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 720px) {
  .home__hero {
    padding: 20px;
  }
  .home__head {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
