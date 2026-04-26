<template>
  <section class="discovery" ref="root">
    <BasePageHeader
      title="Поиск устройств"
      description="Хаб опрашивает локальную сеть по нескольким протоколам параллельно. Включите устройство в режим сопряжения — оно появится здесь."
    >
      <template #actions>
        <BaseButton variant="ghost" icon-left="plus" @click="manualOpen = true">
          Добавить вручную
        </BaseButton>
      </template>
    </BasePageHeader>

    <!-- Scan-панель: idle / scanning / done / error. По умолчанию mode='once'. -->
    <section
      class="scan-panel"
      :class="{
        'scan-panel--idle': !hasEverScanned,
        'scan-panel--active': discoveryProgress.cycleActive,
        'scan-panel--done': hasEverScanned && !discoveryProgress.cycleActive,
      }"
    >
      <header class="scan-panel__head">
        <div class="scan-panel__title-row">
          <span
            class="scan-panel__indicator"
            :class="{
              'is-pulsing': discoveryProgress.cycleActive,
              'is-done': hasEverScanned && !discoveryProgress.cycleActive,
            }"
          />
          <div class="scan-panel__title-stack">
            <h2 class="scan-panel__title">{{ scanTitle }}</h2>
            <span class="scan-panel__subtitle">{{ scanSubtitle }}</span>
          </div>
        </div>

        <div class="scan-panel__actions">
          <label
            class="scan-panel__continuous"
            :class="{ 'is-disabled': discoveryProgress.cycleActive }"
          >
            <BaseSwitch
              size="sm"
              :model-value="continuousMode"
              :disabled="discoveryProgress.cycleActive"
              @update:model-value="continuousMode = $event"
            />
            <span>Постоянно</span>
          </label>
          <BaseButton
            v-if="!discoveryProgress.cycleActive"
            variant="primary"
            :icon-left="hasEverScanned ? 'refresh' : 'search'"
            @click="startScan"
          >
            {{ hasEverScanned ? 'Сканировать снова' : 'Сканировать сеть' }}
          </BaseButton>
          <BaseButton v-else variant="ghost" icon-left="close" @click="devices.stopDiscovery">
            Остановить
          </BaseButton>
        </div>
      </header>

      <!-- Список драйверов виден всегда — пользователь должен понимать, ЧТО будет опрошено. -->
      <ul class="scan-panel__drivers" v-if="driverList.length">
        <li
          v-for="d in driverList"
          :key="d.driverId"
          class="scan-driver"
          :class="`scan-driver--${d.phase}`"
        >
          <span class="scan-driver__icon-wrap">
            <DriverIcon :driver="d.driverId as DriverId" size="sm" />
            <span class="scan-driver__pip" aria-hidden="true">
              <BaseIcon v-if="d.phase === 'done'" name="check" :size="9" />
              <BaseIcon v-else-if="d.phase === 'error'" name="close" :size="9" />
            </span>
          </span>
          <div class="scan-driver__body">
            <div class="scan-driver__head">
              <span class="scan-driver__name">{{ d.displayName }}</span>
              <span class="scan-driver__phase">{{ phaseLabel(d) }}</span>
            </div>
            <div
              class="scan-driver__bar"
              role="progressbar"
              :aria-valuemin="0"
              :aria-valuemax="100"
              :aria-valuenow="barProgress(d)"
            >
              <span class="scan-driver__bar-fill" />
            </div>
            <!-- Error full-width с переносом — точная причина (timeout / EHOSTUNREACH / etc). -->
            <p v-if="d.phase === 'error' && d.error" class="scan-driver__error">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 1.5l7 12.5H1L8 1.5z"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linejoin="round"
                />
                <path
                  d="M8 6.5v3.5M8 12v.6"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                />
              </svg>
              <span>{{ d.error }}</span>
            </p>
          </div>
          <span class="scan-driver__found">
            <strong>{{ d.found }}</strong> {{ pluralizeDevice(d.found) }}
          </span>
        </li>
      </ul>
    </section>

    <!-- Diagnostic hint для устройств Яндекса в LAN: lamp/socket/switch/strip — все
         идут через одинаковый flow (привязка в Я.Доме → cloud-импорт). Без явной
         подсказки юзер думает «лампа просто в розетке = должна быть видна», но
         большинство Yandex-устройств LAN-протоколы открывают только после
         cloud-pairing'а. -->
    <section
      v-if="showYandexLampHint"
      class="discovery__hint"
      role="region"
      aria-label="Подсказка про устройства Яндекса"
    >
      <div class="discovery__hint-icon">
        <BaseIcon name="alice" :size="22" />
      </div>
      <div class="discovery__hint-body">
        <strong>Не вижу устройств Яндекса в LAN?</strong>
        <p>
          Лампы, розетки, реле и другие устройства Яндекса
          <strong>транслируют по локальной сети только после привязки</strong> в приложении
          «Дом с Алисой» (для не-привязанных Wi-Fi называется «smartlife-XXX»). Чтобы Hub их
          детектил:
        </p>
        <ol>
          <li>Включите устройство в розетку и дождитесь мигания (режим сопряжения).</li>
          <li>В приложении <strong>«Дом с Алисой»</strong> добавьте устройство → выберите тип
            (лампа / розетка / выключатель / увлажнитель / …) → введите Wi-Fi-пароль и
            привяжите к домашней сети.</li>
          <li>Hub автоматически подтянет его через драйвер <strong>«Дом с Алисой»</strong>
            (yandex-iot) — устройство появится во вкладке «Устройства» с полным управлением.</li>
        </ol>
        <p class="discovery__hint-note">
          Если устройство УЖЕ привязано к чужому Tuya/SmartLife аккаунту — Hub увидит его в LAN,
          но не сможет управлять. Сделайте сброс (обычно 5 быстрых вкл/выкл) и привяжите заново.
        </p>
      </div>
      <BaseButton variant="primary" size="sm" icon-right="arrow-right" @click="onOpenYandexHomeApp">
        Дом с Алисой
      </BaseButton>
    </section>

    <BaseSegmented
      v-if="filters.length > 1"
      v-model="activeFilter"
      :options="segmentedOptions"
      class="discovery__filters"
    />

    <!-- Paired-статус через `isPaired(c)`: backend ставит `knownDeviceId` только в scan-цикле, флаг устаревает после ручного pair / удаления. -->
    <div v-if="filteredCandidates.length" class="discovery__list">
      <article
        v-for="c in filteredCandidates"
        :key="`${c.driver}-${c.externalId}`"
        class="candidate"
        :class="{ 'candidate--paired': isPaired(c) }"
      >
        <div class="candidate__icon" :style="{ '--accent': accentFor(c.driver) }">
          <span class="candidate__icon-glyph" v-safe-html="iconForType(c.type)" />
        </div>

        <div class="candidate__body">
          <div class="candidate__head">
            <span class="candidate__driver">{{ driverLabel(c.driver) }}</span>
            <span
              class="chip"
              :class="
                isPaired(c)
                  ? 'chip--online'
                  : needsYandexHomeBinding(c)
                    ? 'chip--warn'
                    : 'chip--ready'
              "
            >
              <span class="chip__dot" />
              {{
                isPaired(c)
                  ? 'Уже подключено'
                  : needsYandexHomeBinding(c)
                    ? 'Нужна привязка к Дому с Алисой'
                    : 'Готово к сопряжению'
              }}
            </span>
          </div>
          <h3 class="candidate__name">{{ c.name }}</h3>
          <p class="candidate__address">{{ c.address }}</p>
          <!-- Yandex-устройства видны в LAN, но без cloud-key локально мы их не
               контролируем. Подсказка ведёт юзера в правильный flow через «Дом с Алисой». -->
          <p v-if="needsYandexHomeBinding(c) && !isPaired(c)" class="candidate__hint">
            Устройство найдено в локальной сети, но протокол требует ключ из облака.
            Привяжите его через приложение <strong>«Дом с Алисой»</strong> — Hub автоматически
            подтянет через драйвер «yandex-iot» с полным управлением.
          </p>
        </div>

        <div class="candidate__actions">
          <BaseButton
            v-if="isPaired(c)"
            variant="ghost"
            size="sm"
            icon-right="arrow-right"
            @click="openPaired(c)"
          >
            Открыть
          </BaseButton>
          <BaseButton
            v-else-if="needsYandexHomeBinding(c)"
            variant="primary"
            size="sm"
            icon-right="arrow-right"
            @click="onOpenYandexHomeApp"
          >
            Дом с Алисой
          </BaseButton>
          <BaseButton v-else variant="primary" size="sm" icon-left="plus" @click="onPair(c)">
            Подключить
          </BaseButton>
        </div>
      </article>
    </div>

    <PairDeviceFlow :open="!!pairTarget" :candidate="pairTarget" @close="pairTarget = null" />
    <ManualDeviceFlow :open="manualOpen" @close="manualOpen = false" />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import type { DiscoveredDevice, DriverId, DriverScanProgress } from '@smarthome/shared';
import { useDevicesStore } from '@/stores/devices';
import { useToasterStore } from '@/stores/toaster';
import { useGsap } from '@/composables/useGsap';
import { useViewMount } from '@/composables/useViewMount';
import PairDeviceFlow from '@/components/devices/PairDeviceFlow.vue';
import ManualDeviceFlow from '@/components/devices/ManualDeviceFlow.vue';
import DriverIcon from '@/components/visuals/DriverIcon.vue';
import { driverAccent, driverLabel } from '@/constants/driverPalette';
import {
  BaseButton,
  BaseSegmented,
  BasePageHeader,
  BaseSwitch,
  BaseIcon,
  type SegmentedOption,
} from '@/components/base';

const devices = useDevicesStore();
const { discoveryProgress } = storeToRefs(devices);
const router = useRouter();
const route = useRoute();
const root = useTemplateRef<HTMLElement>('root');

const activeFilter = ref<DriverId | 'all'>('all');
const pairTarget = ref<DiscoveredDevice | null>(null);
const manualOpen = ref(false);
// Default false — one-shot, чтобы не нагружать фон UDP-сокетами.
const continuousMode = ref(false);

// 250ms tick для live elapsed-индикатора; без него значение фризилось бы между push'ами.
const now = ref(Date.now());
let nowTimer = 0;

// /discovery показывает ТОЛЬКО непривязанных — иначе после первого pair'а
// устройство дублируется здесь же и в /devices, и пользователь не понимает,
// зачем оно тут осталось. Привязанные смотрите на /devices.
const candidates = computed(() => devices.unpairedCandidates);

const hasEverScanned = computed(() => discoveryProgress.value.cycleStartedAt > 0);

const filteredCandidates = computed(() => {
  if (activeFilter.value === 'all') return candidates.value;
  return candidates.value.filter((c) => c.driver === activeFilter.value);
});

interface FilterOption {
  id: DriverId | 'all';
  label: string;
  count: number;
}
const filters = computed<FilterOption[]>(() => {
  const counts = new Map<DriverId, number>();
  for (const c of candidates.value) counts.set(c.driver, (counts.get(c.driver) ?? 0) + 1);
  const all: FilterOption = { id: 'all', label: 'Все', count: candidates.value.length };
  const drivers = Array.from(counts.entries()).map<FilterOption>(([id, count]) => ({
    id,
    label: driverLabel(id),
    count,
  }));
  return [all, ...drivers];
});

const segmentedOptions = computed<SegmentedOption[]>(() =>
  filters.value.map((f) => ({ value: f.id, label: f.label, count: f.count })),
);

const emptyTitle = computed(() =>
  devices.isDiscovering ? 'Сканируем сеть…' : 'Кандидатов пока нет',
);
const emptyText = computed(() =>
  devices.isDiscovering
    ? 'Хаб опрашивает Yeelight, Shelly, MQTT и другие протоколы. Это занимает 5–10 секунд.'
    : 'Запустите поиск, чтобы хаб обнаружил устройства в локальной сети.',
);

const accentFor = (id: DriverId): string => driverAccent(id);

const totalFoundThisCycle = computed(
  () =>
    discoveryProgress.value.drivers.filter((d) => d.phase === 'done' || d.phase === 'error').length,
);

const totalCandidatesFound = computed(() =>
  discoveryProgress.value.drivers.reduce((sum, d) => sum + d.found, 0),
);

/** Тикает live при scanning, заморожено в done. */
const cycleDurationMs = computed(() => {
  const start = discoveryProgress.value.cycleStartedAt;
  if (!start) return 0;
  if (discoveryProgress.value.cycleActive) return now.value - start;
  return Math.max(0, ...discoveryProgress.value.drivers.map((d) => d.durationMs ?? 0));
});

const scanTitle = computed(() => {
  if (discoveryProgress.value.cycleActive) return 'Сканирую сеть…';
  if (!hasEverScanned.value) return 'Готов к сканированию';
  return 'Сканирование завершено';
});

const scanSubtitle = computed(() => {
  const drivers = discoveryProgress.value.drivers.length;
  if (discoveryProgress.value.cycleActive) {
    return `Опрашиваю ${drivers} драйверов · ${(cycleDurationMs.value / 1000).toFixed(1)} с`;
  }
  if (!hasEverScanned.value) {
    return `Опросим ${drivers || 'все'} протоколов: Yeelight, Shelly, MQTT, Tuya, HTTP`;
  }
  const found = totalCandidatesFound.value;
  const sec = (cycleDurationMs.value / 1000).toFixed(1);
  return found > 0
    ? `Найдено ${found} ${pluralizeDevice(found)} за ${sec} с`
    : `Ничего нового за ${sec} с — попробуйте ещё раз или добавьте вручную`;
});

const driverList = computed(() => discoveryProgress.value.drivers);

function phaseLabel(d: DriverScanProgress): string {
  switch (d.phase) {
    case 'scanning':
      return 'Опрашиваю…';
    case 'done': {
      const sec = (d.durationMs ?? 0) / 1000;
      const time = sec < 0.1 ? '< 0.1 с' : `${sec.toFixed(1)} с`;
      return d.found > 0 ? `Готово · ${time}` : `Пусто · ${time}`;
    }
    case 'error':
      // Полный текст рендерится строкой ниже бара; тут — короткий ярлык.
      return 'Ошибка';
    default:
      return 'Ожидает';
  }
}

function barProgress(d: DriverScanProgress): number {
  if (d.phase === 'done' || d.phase === 'error') return 100;
  if (d.phase === 'scanning') return 65; // visual sweep — точного значения нет
  return 0;
}

function pluralizeDevice(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'устройств';
  if (m10 === 1) return 'устройство';
  if (m10 >= 2 && m10 <= 4) return 'устройства';
  return 'устройств';
}

function iconForType(t: DiscoveredDevice['type']): string {
  const map: Record<string, string> = {
    'devices.types.light':
      '<svg viewBox="0 0 24 24" fill="none"><path d="M9 18h6M10 21h4M12 3a6 6 0 016 6c0 2.4-1.4 4.4-3 5.4V17H9v-2.6C7.4 13.4 6 11.4 6 9a6 6 0 016-6z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    'devices.types.socket':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.7"/><circle cx="9.5" cy="11" r="1.2" fill="currentColor"/><circle cx="14.5" cy="11" r="1.2" fill="currentColor"/><path d="M8 16h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    'devices.types.switch':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="9" width="18" height="6" rx="3" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="12" r="2" fill="currentColor"/></svg>',
    'devices.types.sensor':
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v8.5M12 16a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" stroke-width="1.7"/><path d="M5 18.5a8 8 0 0114 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    'devices.types.thermostat':
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    'devices.types.media_device':
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M10 9l6 3-6 3z" fill="currentColor"/></svg>',
  };
  return map[t] ?? map['devices.types.switch']!;
}

/** Live: считаем по `devices.devices` (реактивно), а не stale `c.knownDeviceId`. */
function isPaired(c: DiscoveredDevice): boolean {
  return devices.pairedDeviceIdFor(c) !== undefined;
}

function onPair(c: DiscoveredDevice): void {
  if (isPaired(c)) return;
  pairTarget.value = c;
}

function openPaired(c: DiscoveredDevice): void {
  const id = devices.pairedDeviceIdFor(c);
  if (id) void router.push(`/devices/${id}`);
}

/**
 * Yandex-устройства (лампы, розетки, реле, увлажнители, …) детектируются по
 * UDP-broadcast Tuya-протокола, но управлять ими без `localKey` (живёт в Tuya
 * cloud / Yandex IoT) нельзя. Driver выставляет `meta.requiresYandexHomeApp = true` —
 * UI показывает не «Подключить», а ссылку в приложение «Дом с Алисой».
 */
function needsYandexHomeBinding(c: DiscoveredDevice): boolean {
  return c.driver === 'yandex-lamp' || c.meta?.['requiresYandexHomeApp'] === true;
}

/**
 * Подсказка «как подготовить устройства Яндекса» — показываем после первого
 * скана, если ни одного кандидата от yandex-lamp driver'а нет. Если хоть что-то
 * нашли — блок не нужен (юзер увидит устройства в списке и сам разберётся).
 */
const showYandexLampHint = computed(() => {
  if (!hasEverScanned.value) return false;
  if (discoveryProgress.value.cycleActive) return false;
  const lampDriverDone = discoveryProgress.value.drivers.some(
    (d) => d.driverId === 'yandex-lamp' && d.phase === 'done',
  );
  if (!lampDriverDone) return false;
  return !candidates.value.some((c) => c.driver === 'yandex-lamp');
});

/**
 * Открывает embedded-окно «Дома с Алисой» прямо внутри хаба. Юзер видит
 * привычный Yandex-UI, авторизация уже подтянута из OAuth-партиции. После
 * закрытия окна автоматически делается sync — добавленные устройства
 * появятся в Hub без ручного клика «Синхронизировать».
 *
 * Fallback: если юзер не авторизован — открываем external браузер.
 */
async function onOpenYandexHomeApp(): Promise<void> {
  const toaster = useToasterStore();
  try {
    const auth = await window.smarthome.yandexStation.getAuthStatus();
    if (!auth.authorized) {
      void window.smarthome.app.openExternal('https://yandex.ru/quasar/iot');
      return;
    }
    const summary = await window.smarthome.yandexStation.openHomeBindingWindow();
    if (summary.imported > 0) {
      toaster.push({
        kind: 'success',
        message: `Добавлено ${summary.imported} ${pluralizeNew(summary.imported)} в Hub`,
      });
      void devices.bootstrap();
    } else if (summary.lastError) {
      toaster.push({ kind: 'error', message: summary.lastError });
    }
  } catch (e) {
    toaster.push({ kind: 'error', message: (e as Error).message ?? 'Не удалось открыть окно' });
  }
}

function pluralizeNew(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'новых устройств';
  if (m10 === 1) return 'нового устройства';
  if (m10 >= 2 && m10 <= 4) return 'новых устройств';
  return 'новых устройств';
}

async function startScan(): Promise<void> {
  await devices.startDiscovery({
    mode: continuousMode.value ? 'continuous' : 'once',
  });
}

// Сняли «Постоянно» в continuous-режиме (между циклами) — стопаем backend, чтобы UI не врал.
watch(continuousMode, (next) => {
  if (!next && devices.isDiscovering && !discoveryProgress.value.cycleActive) {
    void devices.stopDiscovery();
  }
});

useViewMount({ scope: root.value, itemsSelector: '.candidate' });

// Re-stagger новой выборки при смене фильтра.
const { from } = useGsap(root.value);
watch(activeFilter, () => {
  from('.candidate', { opacity: 0, y: 10, stagger: 0.04, duration: 0.4 });
});

onMounted(() => {
  // 250ms tick — точности 0.1с достаточно, setInterval легче чем rAF.
  nowTimer = window.setInterval(() => {
    now.value = Date.now();
  }, 250);

  // Автостарт по `?scan=1` (из tray); чистим query, чтобы F5 не перезапускал.
  if (route.query['scan'] === '1' && !discoveryProgress.value.cycleActive) {
    void devices.startDiscovery({
      mode: continuousMode.value ? 'continuous' : 'once',
    });
    const { scan: _scan, ...rest } = route.query;
    void router.replace({ path: route.path, query: rest });
  }
});

onBeforeUnmount(() => {
  if (nowTimer) clearInterval(nowTimer);
});
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.discovery {
  display: flex;
  flex-direction: column;
  gap: var(--content-gap);
  width: 100%;

  &__filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  // Yandex-lamp diagnostic: brand-tinted card с ol-step-by-step гайдом, появляется
  // если scan завершён, но yandex-lamp driver ничего не нашёл — типичный case
  // когда лампочка ещё в setup-mode и не присоединена к домашнему Wi-Fi.
  &__hint {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto;
    gap: clamp(14px, 1.4vw, 20px);
    align-items: start;
    padding: clamp(16px, 1.6vw, 22px);
    border-radius: var(--radius-lg);
    background:
      linear-gradient(
        130deg,
        color-mix(in srgb, var(--color-brand-purple) 10%, transparent),
        color-mix(in srgb, var(--color-brand-amber) 7%, transparent)
      ),
      rgba(255, 255, 255, 0.02);
    border: 1px solid color-mix(in srgb, var(--color-brand-purple) 26%, transparent);

    @container (max-width: 640px) {
      grid-template-columns: 1fr;
    }
  }

  &__hint-icon {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-brand-purple) 18%, transparent);
    color: var(--color-brand-purple);
  }

  &__hint-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;

    strong {
      font-family: var(--font-family-display);
      font-size: clamp(15px, 0.4vw + 13px, 17px);
      font-weight: 600;
      color: var(--color-text-primary);
      letter-spacing: var(--tracking-h1);
    }

    p {
      font-size: 13px;
      color: var(--color-text-secondary);
      line-height: 1.55;
      margin: 0;
      text-wrap: pretty;
    }

    ol {
      margin: 4px 0 0;
      padding-left: 22px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12.5px;
      color: var(--color-text-secondary);
      line-height: 1.5;

      strong {
        font-family: inherit;
        font-size: inherit;
        letter-spacing: 0;
      }
    }
  }

  &__hint-note {
    font-size: 12px !important;
    color: var(--color-text-muted) !important;
    font-style: italic;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: var(--radius-sm);
    border-left: 2px solid var(--color-warning);
  }

  // Auto-fit: 1 кол узкий / 2 кол >=960px. Inner grid карточки фикс 3-кол, не режется.
  &__list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 460px), 1fr));
    gap: 10px;
  }
}

.candidate {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 12px 14px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  transition:
    background 160ms var(--ease-out),
    border-color 160ms var(--ease-out);

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: var(--color-border-soft);
  }

  &__icon {
    --accent: #a961ff;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    display: grid;
    place-items: center;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);

    &-glyph :deep(svg) {
      width: 20px;
      height: 20px;
    }
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  &__driver {
    font-family: var(--font-family-mono);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  &__name {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__address {
    font-family: var(--font-family-mono);
    font-size: 12px;
    color: var(--color-text-muted);
    margin: 0;
  }

  &__actions {
    flex-shrink: 0;
  }

  &--paired {
    opacity: 0.55;
  }
}

// chip-стили — в styles/blocks/_chip.scss (single source of truth).

.scan-panel {
  padding: 20px 22px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition:
    background 240ms var(--ease-out),
    border-color 240ms var(--ease-out);

  &--idle {
    border-style: dashed;
    border-color: var(--color-border-soft);
  }

  &--active {
    border-color: rgba(var(--color-brand-purple-rgb), 0.4);
    background: rgba(var(--color-brand-purple-rgb), 0.05);
  }

  &--done {
    border-color: rgba(var(--color-success-rgb), 0.28);
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px 24px;
    flex-wrap: wrap;
  }

  &__title-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1 1 auto;
  }

  &__indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-text-muted);
    flex-shrink: 0;
    transition: background 240ms var(--ease-out);

    &.is-pulsing {
      background: var(--color-brand-purple);
      box-shadow: 0 0 0 0 rgba(var(--color-brand-purple-rgb), 0.6);
      animation: scanIndicatorPulse 1.4s ease-out infinite;
    }

    &.is-done {
      background: var(--color-success);
      box-shadow: 0 0 8px rgba(var(--color-success-rgb), 0.45);
    }
  }

  &__title-stack {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__title {
    font-family: var(--font-family-display);
    font-size: 17px;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.005em;
    line-height: 1.2;
  }

  &__subtitle {
    font-size: 13px;
    color: var(--color-text-secondary);
    line-height: 1.35;
    font-variant-numeric: tabular-nums;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  &__continuous {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 12.5px;
    color: var(--color-text-muted);
    cursor: pointer;
    user-select: none;
    transition: color 160ms var(--ease-out);

    &:hover {
      color: var(--color-text-secondary);
    }
    &.is-disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  &__drivers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
    gap: 10px;
  }
}

.scan-driver {
  display: grid;
  // Head + counter сверху; error-row тянется на всю ширину снизу.
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 6px 12px;
  padding: 12px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-subtle);
  transition:
    background 180ms var(--ease-out),
    border-color 180ms var(--ease-out);

  &__icon-wrap {
    position: relative;
    flex-shrink: 0;
    align-self: center;
  }

  // Виден только в done/error; scanning показывает sweep в bar-fill, idle — пустой угол.
  &__pip {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--color-bg-base, #0d0e18);
    color: #fff;
    box-shadow: 0 0 0 2px var(--color-bg-base, #0d0e18);
    transform: scale(0);
    transition: transform 220ms var(--ease-spring);
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    align-self: center;
  }

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  &__name {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__phase {
    font-size: 11.5px;
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  &__error {
    grid-column: 1 / -1;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 4px 0 0;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: rgba(var(--color-danger-rgb), 0.08);
    border: 1px solid rgba(var(--color-danger-rgb), 0.22);
    color: var(--color-danger);
    font-size: 12px;
    line-height: 1.4;
    word-break: break-word;

    svg {
      width: 13px;
      height: 13px;
      flex-shrink: 0;
      margin-top: 1px;
    }
    span {
      flex: 1;
      min-width: 0;
    }
  }

  &__bar {
    width: 100%;
    height: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
    position: relative;
  }

  &__bar-fill {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--color-brand-purple);
    transform-origin: left;
    transform: scaleX(0);
    transition:
      transform 320ms var(--ease-out),
      background 200ms var(--ease-out);
  }

  &__found {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    font-size: 11.5px;
    color: var(--color-text-muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;

    strong {
      font-family: var(--font-family-display);
      font-size: 16px;
      font-weight: 700;
      color: var(--color-text-primary);
      line-height: 1;
    }
  }

  &--done .scan-driver__found strong {
    color: var(--color-success);
  }
  &--error .scan-driver__found strong {
    color: var(--color-danger);
  }

  &--scanning {
    border-color: rgba(var(--color-brand-purple-rgb), 0.32);

    .scan-driver__bar-fill {
      transform: scaleX(0.65);
      animation: scanBarSweep 1.4s ease-in-out infinite;
    }
    .scan-driver__phase {
      color: var(--color-brand-purple);
    }
  }

  &--done {
    .scan-driver__bar-fill {
      transform: scaleX(1);
      background: var(--color-success);
    }
    .scan-driver__phase {
      color: var(--color-success);
    }
    .scan-driver__pip {
      background: var(--color-success);
      transform: scale(1);
    }
  }

  &--error {
    border-color: rgba(var(--color-danger-rgb), 0.32);
    background: rgba(var(--color-danger-rgb), 0.04);
    .scan-driver__bar-fill {
      transform: scaleX(1);
      background: var(--color-danger);
    }
    .scan-driver__phase {
      color: var(--color-danger);
    }
    .scan-driver__pip {
      background: var(--color-danger);
      transform: scale(1);
    }
  }

  &--idle {
    opacity: 0.55;
    .scan-driver__bar-fill {
      transform: scaleX(0);
    }
  }
}

@keyframes scanIndicatorPulse {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--color-brand-purple-rgb), 0.55);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(var(--color-brand-purple-rgb), 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(var(--color-brand-purple-rgb), 0);
  }
}

@keyframes scanBarSweep {
  0%,
  100% {
    transform: scaleX(0.2) translateX(0);
  }
  50% {
    transform: scaleX(0.65) translateX(60%);
  }
}

.app--reduce-motion {
  .scan-panel__indicator.is-pulsing {
    animation: none;
  }
  .scan-driver__bar-fill {
    animation: none !important;
  }
}

// ---- Mobile ----
@media (max-width: 720px) {
  .scan-panel {
    padding: 14px 16px;
    gap: 12px;

    &__head {
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
    }

    &__actions {
      flex-wrap: wrap;
      width: 100%;
      justify-content: space-between;

      :deep(.btn) {
        flex: 1 1 auto;
      }
    }

    &__continuous {
      flex: 0 0 auto;
    }
  }

  .scan-driver {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto auto;
    gap: 6px 10px;

    &__found {
      grid-column: 1 / -1;
      justify-self: end;
    }
  }

  .candidate {
    grid-template-columns: 40px minmax(0, 1fr);
    grid-template-rows: auto auto;
    padding: 10px 12px;

    &__actions {
      grid-column: 1 / -1;
      justify-self: stretch;

      :deep(.btn) {
        width: 100%;
      }
    }
  }

  .discovery__list {
    grid-template-columns: 1fr;
  }
}
</style>
