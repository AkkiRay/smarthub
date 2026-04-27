<template>
  <section class="alice" ref="root">
    <BasePageHeader :title="pageTitle" eyebrow="Алиса · Подключение">
      <template #description>
        <span v-if="activeSection === 'station'">
          Хаб подключается к вашей колонке Алисы
          <strong>напрямую по локальной сети</strong> (WebSocket :1961). Внешний сервер не нужен —
          приложение работает полностью offline-first. После подключения откройте раздел
          <strong>«Колонка»</strong> для управления.
        </span>
        <span v-else-if="activeSection === 'home'">
          <strong>Все устройства из «Дома с Алисой»</strong> — что Яндекс знает про вас. Хаб тянет
          их через iot.quasar.yandex.ru с использованием той же сессии Яндекса, что и колонка.
        </span>
        <span v-else-if="activeSection === 'skill'">
          Хаб поднимает свой собственный навык в Я.Диалогах и
          <strong>экспонирует все ваши устройства</strong> в приложение «Дом с Алисой» — даже те,
          которые Алиса напрямую не поддерживает.
        </span>
        <span v-else>
          Тонкая настройка экспозиции. Решайте, какие устройства и сценарии
          <strong>видны Алисе</strong>, а какие остаются только в хабе.
        </span>
      </template>
      <template #actions>
        <BaseButton
          v-if="isConnected"
          variant="primary"
          icon-right="arrow-right"
          @click="speakerNav.openSpeaker()"
        >
          Управление колонкой
        </BaseButton>
      </template>
    </BasePageHeader>

    <BaseSegmented
      v-model="activeSection"
      :options="sectionOptions"
      class="alice__nav"
      data-tour="alice-section-nav"
      data-anim="block"
    />

    <!-- Tab-stage: relative-якорь для cross-fade сегментов. -->
    <div class="alice__tab-stage">
      <Transition :name="motion ? 'tab-fade' : 'tab-fade-instant'">
        <div v-if="activeSection === 'station'" :key="'station'" class="alice__stack">
          <!-- ============================================================== -->
          <!-- Connected: success-баннер с быстрыми голосовыми командами       -->
          <!-- ============================================================== -->
          <Transition name="alice-fade" mode="out-in">
            <article
              v-if="isConnected"
              key="connected"
              class="alice__connected"
              data-tour="alice-station-connected"
            >
              <div class="alice__connected-body">
                <div class="alice__connected-head">
                  <span class="alice__connected-pulse" aria-hidden="true" />
                  <div>
                    <h3 class="alice__connected-title">
                      «{{ station.status?.station?.name ?? 'Колонка' }}» подключена
                    </h3>
                    <p class="alice__connected-sub">
                      {{ station.status?.station?.host }}:{{
                        station.status?.station?.port ?? YANDEX_STATION_PORT
                      }}
                      ·
                      {{ station.status?.station?.platform ?? '—' }}
                    </p>
                  </div>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    icon-left="close"
                    class="alice__connected-action"
                    @click="onDisconnect"
                  >
                    Отключить
                  </BaseButton>
                </div>
                <p class="alice__connected-hint">
                  Подключение готово. Управление воспроизведением, оповещения и стрим звука с ПК
                  живут в отдельном разделе <strong>«Колонка»</strong>.
                </p>
                <div class="alice__connected-actions">
                  <BaseButton
                    variant="primary"
                    icon-right="arrow-right"
                    @click="speakerNav.openSpeaker()"
                  >
                    Перейти к управлению
                  </BaseButton>
                </div>
              </div>
              <!-- Orb справа: voice-mode читает aliceState из glagol-сессии
               (LISTENING → пульс, SPEAKING → волна). Mouse-tilt отключён. -->
              <button
                type="button"
                class="alice__orb-stage"
                :aria-label="orbAriaLabel"
                @click="onOrbClick"
              >
                <JarvisOrb
                  size="lg"
                  :state="orbState"
                  voice-mode
                  :voice-state="station.voiceState"
                />
                <Transition name="alice-caption" mode="out-in">
                  <span :key="orbCaption" class="alice__orb-caption">{{ orbCaption }}</span>
                </Transition>
              </button>
            </article>
            <AliceAutoPair v-else key="auto" />
          </Transition>

          <!-- =================================================================== -->
          <!-- Резервный ручной flow — спрятан в details, открывается по требованию -->
          <!-- =================================================================== -->
          <details class="alice__manual">
            <summary class="alice__manual-summary">
              <span>Ручное подключение по device-token</span>
              <span class="alice__manual-hint">для отладки и кейсов без OAuth</span>
            </summary>

            <article class="alice__card">
              <header class="alice__card-head">
                <span class="alice__card-num">01</span>
                <div class="alice__card-copy">
                  <h3 class="alice__card-title">Найти колонку в сети</h3>
                  <p class="alice__card-desc">
                    Колонка должна быть в том же Wi-Fi, что и этот компьютер. Хаб шлёт mDNS-запрос
                    <code>_yandexio._tcp.local</code> и слушает ответы 4 секунды.
                  </p>
                </div>
                <BaseButton
                  variant="primary"
                  icon-left="search"
                  :loading="station.isScanning"
                  class="alice__card-action"
                  @click="onScan"
                >
                  {{ station.isScanning ? `Сканирую · ${scanElapsedLabel}` : 'Сканировать LAN' }}
                </BaseButton>
              </header>

              <!-- Live-панель: видна после первого скана, показывает active/done/error. -->
              <div v-if="hasEverScanned" class="alice__scan" :class="`alice__scan--${scanPhase}`">
                <div class="alice__scan-head">
                  <span class="alice__scan-pip" aria-hidden="true">
                    <BaseIcon v-if="scanPhase === 'done'" name="check" :size="11" />
                    <BaseIcon v-else-if="scanPhase === 'error'" name="close" :size="11" />
                    <BaseIcon v-else name="refresh" :size="11" spin />
                  </span>
                  <div class="alice__scan-copy">
                    <strong class="alice__scan-title">{{ scanTitle }}</strong>
                    <span class="alice__scan-sub">{{ scanSubtitle }}</span>
                  </div>
                  <span class="alice__scan-count">
                    <strong>{{ station.candidates.length }}</strong>
                    {{ pluralizeStation(station.candidates.length) }}
                  </span>
                </div>

                <div
                  class="alice__scan-bar"
                  role="progressbar"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-valuenow="Math.round(scanProgress * 100)"
                >
                  <span
                    class="alice__scan-bar-fill"
                    :style="{ '--scan-progress': `${scanProgress * 100}%` }"
                  />
                </div>

                <p v-if="scanError" class="alice__scan-error">
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
                  <span>{{ scanError }}</span>
                </p>
              </div>

              <ul v-if="station.candidates.length" class="alice__candidates">
                <li v-for="c in station.candidates" :key="c.deviceId" class="alice__candidate">
                  <div class="alice__candidate-icon">
                    <BaseIcon name="alice" size="18" />
                  </div>
                  <div class="alice__candidate-copy">
                    <strong class="alice__candidate-name">{{ c.name }}</strong>
                    <span class="alice__candidate-meta">
                      {{ c.platform }} · {{ c.host }}:{{ c.port }}
                    </span>
                  </div>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    icon-right="arrow-right"
                    @click="useCandidate(c)"
                  >
                    Использовать
                  </BaseButton>
                </li>
              </ul>
              <p v-else-if="!station.isScanning && !hasEverScanned" class="alice__empty">
                Запустите сканирование — найденные колонки появятся здесь.
              </p>
            </article>

            <!-- =================================================================== -->
            <!-- Шаг 2: ввести креды и подключиться                                   -->
            <!-- =================================================================== -->
            <article class="alice__card">
              <header class="alice__card-head">
                <span class="alice__card-num">02</span>
                <div class="alice__card-copy">
                  <h3 class="alice__card-title">Подключение</h3>
                  <p class="alice__card-desc">
                    Glagol-токен (<code>token</code>) выдаётся колонке после OAuth Yandex и
                    одноразового запроса к
                    <code>quasar.yandex.net/glagol/token</code>. Один раз получив токен, приложение
                    использует только локальную сеть.
                    <a class="alice__link" @click="openTokenGuide">Как получить токен →</a>
                  </p>
                </div>
              </header>

              <div class="alice__grid">
                <BaseInput
                  v-model="form.host"
                  label="IP колонки в LAN"
                  placeholder="192.168.1.42"
                  autocomplete="off"
                />
                <BaseInput
                  v-model.number="form.port"
                  type="number"
                  label="Порт"
                  placeholder="1961"
                />
                <BaseInput
                  v-model="form.deviceId"
                  label="Device ID"
                  placeholder="A0X-XXXX..."
                  autocomplete="off"
                />
                <BaseInput
                  v-model="form.token"
                  label="Glagol-token"
                  placeholder="..."
                  autocomplete="off"
                  class="alice__field--wide"
                />
                <BaseInput
                  v-model="form.platform"
                  label="Платформа"
                  placeholder="yandexstation_2"
                  hint="Опционально — определяется автоматически"
                />
                <BaseInput
                  v-model="form.name"
                  label="Имя"
                  placeholder="Алиса в гостиной"
                  hint="Как называть колонку в хабе"
                />
              </div>

              <footer class="alice__card-foot">
                <div class="alice__status" :class="`alice__status--${state}`">
                  <span class="alice__status-dot" />
                  <span class="alice__status-label">{{ statusLabel }}</span>
                  <span v-if="station.status?.lastError" class="alice__status-error">
                    · {{ station.status.lastError }}
                  </span>
                </div>

                <div class="alice__actions">
                  <BaseButton
                    v-if="isConnected || station.status?.configured"
                    variant="ghost"
                    icon-left="close"
                    size="sm"
                    @click="onDisconnect"
                  >
                    Отключить
                  </BaseButton>
                  <BaseButton
                    variant="primary"
                    icon-left="check"
                    :disabled="!canConnect"
                    @click="onConnect"
                  >
                    {{ isConnected ? 'Переподключить' : 'Подключиться' }}
                  </BaseButton>
                </div>
              </footer>
            </article>
          </details>
        </div>

        <AliceHomeDevices v-else-if="activeSection === 'home'" :key="'home'" />
        <AliceSkillBridge v-else-if="activeSection === 'skill'" :key="'skill'" />
        <AliceExposurePanel v-else :key="'exposure'" />
      </Transition>
    </div>
  </section>
</template>

<script setup lang="ts">
// Экран Алисы: секции station / home / skill / exposure.

import { computed, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import type { YandexStationCandidate } from '@smarthome/shared';
import { YANDEX_STATION_PORT, YANDEX_STATION_SCAN_MS } from '@smarthome/shared';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useAliceStore } from '@/stores/alice';
import { useUiStore } from '@/stores/ui';
import { useViewMount } from '@/composables/useViewMount';
import { useBootstrapGate } from '@/composables/useBootstrapGate';
import { useSpeakerNavigation } from '@/composables/useSpeakerNavigation';
import AliceAutoPair from '@/components/alice/AliceAutoPair.vue';
import AliceSkillBridge from '@/components/alice/AliceSkillBridge.vue';
import AliceExposurePanel from '@/components/alice/AliceExposurePanel.vue';
import AliceHomeDevices from '@/components/alice/AliceHomeDevices.vue';
import JarvisOrb from '@/components/visuals/JarvisOrb.vue';
import {
  BaseButton,
  BaseIcon,
  BaseInput,
  BaseSegmented,
  BasePageHeader,
  type SegmentedOption,
} from '@/components/base';

const station = useYandexStationStore();
const alice = useAliceStore();
const speakerNav = useSpeakerNavigation();
const root = useTemplateRef<HTMLElement>('root');
const ui = useUiStore();
const { reduceMotion } = storeToRefs(ui);
const motion = computed(() => !reduceMotion.value);

type AliceSection = 'station' | 'home' | 'skill' | 'exposure';
const route = useRoute();
const activeSection = ref<AliceSection>('station');

// `?section=` ↔ activeSection (deep-link и тур ходят сюда).
watch(
  () => route.query['section'],
  (q) => {
    if (q === 'skill' || q === 'exposure' || q === 'station' || q === 'home') {
      activeSection.value = q;
    }
  },
  { immediate: true },
);
const sectionOptions = computed<SegmentedOption[]>(() => [
  { value: 'station', label: 'Колонка', icon: 'alice' },
  {
    value: 'home',
    label: 'Дом с Алисой',
    icon: 'devices',
    // Badge считает devices активного дома (homeFiltered), не суммы по аккаунту.
    ...(station.homeFiltered ? { count: station.homeFiltered.devices.length } : {}),
  },
  { value: 'skill', label: 'Связка с Алисой', icon: 'arrow-right' },
  {
    value: 'exposure',
    label: 'Что видит Алиса',
    icon: 'devices',
    count: alice.status?.exposedDeviceCount ?? 0,
  },
]);
const pageTitle = computed(() => {
  switch (activeSection.value) {
    case 'home':
      return 'Дом с Алисой';
    case 'skill':
      return 'Связка с Алисой';
    case 'exposure':
      return 'Что видит Алиса';
    default:
      return 'Подключение Алисы';
  }
});

// JarvisOrb отражает реальное состояние WSS-сессии. Кликом ведёт на пульт.
const orbState = computed<'idle' | 'active' | 'error'>(() => {
  const c = station.status?.connection;
  if (c === 'connected') return 'active';
  if (c === 'error') return 'error';
  return 'idle';
});

const orbCaption = computed(() => {
  const c = station.status?.connection;
  if (c === 'connecting' || c === 'authenticating') return 'Подключение…';
  if (c === 'error') return 'Ошибка соединения';
  if (c !== 'connected') return 'Ожидает подключения';
  // connected → voice-state из glagol-канала.
  switch (station.voiceState) {
    case 'listening':
      return 'Слушает…';
    case 'speaking':
      return 'Говорит…';
    case 'busy':
      return 'Думает…';
    default:
      return 'На связи · клик → пульт';
  }
});

const orbAriaLabel = computed(() => `Алиса · ${orbCaption.value}`);

function onOrbClick(): void {
  void speakerNav.openSpeaker();
}

const gate = useBootstrapGate({
  minDuration: 600,
  tasks: [() => alice.bootstrap().catch(() => undefined)],
});

const form = reactive({
  host: '',
  port: YANDEX_STATION_PORT,
  deviceId: '',
  token: '',
  platform: '',
  name: '',
});

const state = computed(() => station.status?.connection ?? 'disconnected');
const isConnected = computed(() => state.value === 'connected');

const statusLabel = computed(() => {
  switch (state.value) {
    case 'connecting':
      return 'Подключение…';
    case 'authenticating':
      return 'Аутентификация…';
    case 'connected':
      return 'Колонка в сети';
    case 'error':
      return 'Ошибка соединения';
    default:
      return 'Не подключена';
  }
});

const canConnect = computed(() => form.host.trim() && form.deviceId.trim() && form.token.trim());

// Hydrate form из сохранённых creds для edit/reconnect.
watch(
  () => station.status?.station,
  (s) => {
    if (!s) return;
    form.host = s.host;
    form.port = s.port;
    form.deviceId = s.deviceId;
    if (s.platform) form.platform = s.platform;
    if (s.name) form.name = s.name;
  },
  { immediate: true },
);

// Time-based прогресс mDNS scan'а (backend не шлёт events).

const SCAN_TIMEOUT_MS = YANDEX_STATION_SCAN_MS;
const scanStartedAt = ref(0);
const scanFinishedAt = ref(0);
const scanError = ref<string | null>(null);
const now = ref(Date.now());
let scanTimer = 0;

const hasEverScanned = computed(() => scanStartedAt.value > 0);

const scanPhase = computed<'scanning' | 'done' | 'error'>(() => {
  if (station.isScanning) return 'scanning';
  if (scanError.value) return 'error';
  return 'done';
});

const scanElapsedMs = computed(() => {
  if (!scanStartedAt.value) return 0;
  const end = station.isScanning ? now.value : scanFinishedAt.value || now.value;
  return Math.max(0, end - scanStartedAt.value);
});

const scanElapsedLabel = computed(() => `${(scanElapsedMs.value / 1000).toFixed(1)}с`);

/** 0..1 по времени; done/error → 1. */
const scanProgress = computed(() => {
  if (!station.isScanning) return 1;
  return Math.min(1, scanElapsedMs.value / SCAN_TIMEOUT_MS);
});

const scanTitle = computed(() => {
  if (station.isScanning) return 'Опрашиваю локальную сеть';
  if (scanError.value) return 'Сканирование не удалось';
  return station.candidates.length > 0
    ? `Найдено ${station.candidates.length} ${pluralizeStation(station.candidates.length)}`
    : 'Колонок не найдено';
});

const scanSubtitle = computed(() => {
  if (station.isScanning) {
    return `mDNS · _yandexio._tcp.local · ${(scanElapsedMs.value / 1000).toFixed(1)} с`;
  }
  if (scanError.value) {
    return 'Подробности ниже. Проверьте, что компьютер и колонка в одном Wi-Fi.';
  }
  const sec = (scanElapsedMs.value / 1000).toFixed(1);
  return station.candidates.length > 0
    ? `Завершено за ${sec} с — выберите колонку и нажмите «Использовать»`
    : `Опрос занял ${sec} с. Включите колонку, проверьте Wi-Fi и попробуйте ещё раз.`;
});

function pluralizeStation(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'колонок';
  if (m10 === 1) return 'колонка';
  if (m10 >= 2 && m10 <= 4) return 'колонки';
  return 'колонок';
}

async function onScan(): Promise<void> {
  if (station.isScanning) return;
  scanError.value = null;
  scanStartedAt.value = Date.now();
  scanFinishedAt.value = 0;
  now.value = Date.now();

  // 100ms tick для прогресс-бара.
  if (scanTimer) window.clearInterval(scanTimer);
  scanTimer = window.setInterval(() => {
    now.value = Date.now();
  }, 100);

  try {
    await station.scan(SCAN_TIMEOUT_MS);
  } catch (e) {
    scanError.value = (e as Error).message || 'Неизвестная ошибка mDNS';
  } finally {
    scanFinishedAt.value = Date.now();
    if (scanTimer) {
      window.clearInterval(scanTimer);
      scanTimer = 0;
    }
  }
}

onBeforeUnmount(() => {
  if (scanTimer) window.clearInterval(scanTimer);
});

function useCandidate(c: YandexStationCandidate): void {
  form.host = c.host;
  form.port = c.port;
  form.deviceId = c.deviceId;
  form.platform = c.platform;
  form.name = c.name;
}

async function onConnect(): Promise<void> {
  await station.connect({
    host: form.host.trim(),
    port: Number(form.port) || YANDEX_STATION_PORT,
    deviceId: form.deviceId.trim(),
    token: form.token.trim(),
    platform: form.platform.trim() || undefined,
    name: form.name.trim() || undefined,
  });
}

async function onDisconnect(): Promise<void> {
  await station.disconnect();
  form.token = '';
}

function openTokenGuide(): void {
  void window.smarthome.app.openExternal(
    'https://github.com/AlexxIT/YandexStation#%D0%BF%D0%BE%D0%BB%D1%83%D1%87%D0%B5%D0%BD%D0%B8%D0%B5-%D1%82%D0%BE%D0%BA%D0%B5%D0%BD%D0%B0',
  );
}

useViewMount({ scope: root, itemsSelector: '.alice__card', defer: gate.whenReady() });
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

// Flat surface + hairline, без backdrop-filter. Разделение — типографика и whitespace.

.alice {
  display: flex;
  flex-direction: column;
  gap: var(--content-gap);
  width: 100%;

  &__nav {
    align-self: flex-start;
  }

  // Tab-stage — relative-якорь для cross-fade сегментов. leave-active в absolute,
  // entering-tab сразу в финальной позиции.
  &__tab-stage {
    position: relative;
    min-height: 0;
    width: 100%;
  }

  &__stack {
    display: flex;
    flex-direction: column;
    gap: clamp(14px, 1.4vw, 22px);
  }

  // ---- Card --------------------------------------------------------------
  &__card {
    container-type: inline-size;
    position: relative;
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.022);
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: clamp(20px, 2vw, 30px) clamp(20px, 2vw, 32px);
    display: flex;
    flex-direction: column;
    gap: clamp(16px, 1.6vw, 24px);
    transition:
      background-color 280ms var(--ease-out),
      border-color 280ms var(--ease-out);

    &:hover {
      background: rgba(255, 255, 255, 0.032);
      border-color: rgba(255, 255, 255, 0.07);
    }

    // Head: number + copy + (optional) action на правом краю.
    &-head {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: clamp(14px, 1.4vw, 22px);
      align-items: start;

      @container (max-width: 560px) {
        grid-template-columns: auto minmax(0, 1fr);
        .alice__card-action {
          grid-column: 1 / -1;
          justify-self: start;
        }
      }
    }

    &-num {
      font-family: var(--font-family-mono);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      color: transparent;
      background: var(--gradient-brand);
      -webkit-background-clip: text;
      background-clip: text;
      padding-top: 6px;
    }

    &-copy {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }

    &-title {
      font-family: var(--font-family-display);
      font-size: var(--font-size-h1);
      font-weight: 600;
      letter-spacing: var(--tracking-h1);
      color: var(--color-text-primary);
      margin: 0;
    }

    &-desc {
      font-size: var(--font-size-small);
      color: var(--color-text-secondary);
      line-height: 1.55;
      margin: 0;
      max-width: 72ch;
      text-wrap: pretty;

      code {
        font-family: var(--font-family-mono);
        font-size: 0.92em;
        background: rgba(255, 255, 255, 0.05);
        padding: 1px 5px;
        border-radius: 4px;
        color: var(--color-text-primary);
      }
    }

    &-action {
      align-self: start;
    }

    &-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      padding-top: 18px;
      border-top: 1px solid rgba(255, 255, 255, 0.045);
    }
  }

  &__link {
    color: var(--color-brand-purple);
    cursor: pointer;
    border-bottom: 1px dashed currentColor;
    transition:
      color 160ms var(--ease-out),
      border-bottom-color 160ms var(--ease-out),
      border-bottom-style 160ms var(--ease-out);

    &:hover {
      color: var(--color-brand-pink);
      border-bottom-style: solid;
    }
  }

  // Candidates list — flat hairline rows.
  &__candidates {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  &__candidate {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    padding: 12px 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.045);
    transition: padding-left 220ms var(--ease-out);

    &:first-child {
      border-top: 0;
    }
    &:hover {
      padding-left: 10px;
    }

    &-icon {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-sm);
      display: grid;
      place-items: center;
      background: rgba(var(--color-brand-purple-rgb), 0.1);
      color: var(--color-brand-purple);
      flex-shrink: 0;
    }

    &-copy {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      > * {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    &-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text-primary);
      letter-spacing: -0.005em;
    }

    &-meta {
      font-size: 12px;
      color: var(--color-text-muted);
      font-family: var(--font-family-mono);
    }
  }

  &__empty {
    font-size: var(--font-size-small);
    color: var(--color-text-muted);
    margin: 0;
    padding: 8px 4px;
    line-height: 1.5;
  }

  // ---- Live mDNS scan panel ----------------------------------------------
  &__scan {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px;
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--color-border-subtle);
    transition:
      background 240ms var(--ease-out),
      border-color 240ms var(--ease-out);

    &--scanning {
      border-color: rgba(var(--color-brand-purple-rgb), 0.32);
      background: rgba(var(--color-brand-purple-rgb), 0.04);
    }
    &--done {
      border-color: rgba(var(--color-success-rgb), 0.28);
    }
    &--error {
      border-color: rgba(var(--color-danger-rgb), 0.32);
      background: rgba(var(--color-danger-rgb), 0.04);
    }
  }

  &__scan-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
  }

  &__scan-pip {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    background: var(--color-text-muted);
    color: #fff;
    transition: background 240ms var(--ease-out);

    .alice__scan--scanning & {
      background: var(--color-brand-purple);
      box-shadow: 0 0 0 0 rgba(var(--color-brand-purple-rgb), 0.5);
      animation: aliceScanPipPulse calc(1.6s / max(var(--motion-scale, 1), 0.001)) ease-out infinite;
    }
    .alice__scan--done & {
      background: var(--color-success);
    }
    .alice__scan--error & {
      background: var(--color-danger);
    }
  }

  &__scan-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__scan-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary);
    letter-spacing: -0.005em;
    line-height: 1.2;
  }

  &__scan-sub {
    font-size: 12px;
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    line-height: 1.35;
  }

  &__scan-count {
    flex-shrink: 0;
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    font-size: 12px;
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;

    strong {
      font-family: var(--font-family-display);
      font-size: 18px;
      font-weight: 700;
      line-height: 1;
      color: var(--color-text-primary);
    }
    .alice__scan--done & strong {
      color: var(--color-success);
    }
    .alice__scan--error & strong {
      color: var(--color-text-muted);
    }
  }

  &__scan-bar {
    width: 100%;
    height: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
    position: relative;
  }
  &__scan-bar-fill {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    width: var(--scan-progress, 0%);
    background: var(--color-brand-purple);
    transition:
      width var(--trans-base),
      background var(--trans-base);

    .alice__scan--done & {
      background: var(--color-success);
    }
    .alice__scan--error & {
      background: var(--color-danger);
    }
  }

  &__scan-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: rgba(var(--color-danger-rgb), 0.08);
    border: 1px solid rgba(var(--color-danger-rgb), 0.22);
    color: var(--color-danger);
    font-size: 12.5px;
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

  // ---- Connect form grid -------------------------------------------------
  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }

  &__field--wide {
    grid-column: 1 / -1;
  }

  // ---- Status indicator (flat dot + label) -------------------------------
  &__status {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--color-text-secondary);
  }

  &__status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-text-muted);
    transition: background-color 200ms var(--ease-out);
  }

  &__status-label {
    font-weight: 500;
    letter-spacing: -0.005em;
  }

  &__status-error {
    color: var(--color-danger);
    font-size: 12.5px;
  }

  &__status--connected {
    color: var(--color-text-primary);
    .alice__status-dot {
      background: var(--color-success);
      box-shadow: 0 0 0 4px rgba(var(--color-success-rgb), 0.18);
    }
  }
  &__status--connecting,
  &__status--authenticating {
    .alice__status-dot {
      background: var(--color-warning);
      animation: aliceStatusPulse calc(1.6s / max(var(--motion-scale, 1), 0.001)) ease-in-out
        infinite;
    }
  }
  &__status--error .alice__status-dot {
    background: var(--color-danger);
    box-shadow: 0 0 0 4px rgba(var(--color-danger-rgb), 0.18);
  }

  &__actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
}

@keyframes aliceStatusPulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(var(--color-warning-rgb), 0.2);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(var(--color-warning-rgb), 0);
  }
}

@keyframes aliceScanPipPulse {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--color-brand-purple-rgb), 0.55);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(var(--color-brand-purple-rgb), 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(var(--color-brand-purple-rgb), 0);
  }
}

// === Connected success banner ============================================
.alice__connected {
  position: relative;
  border-radius: var(--radius-xl);
  padding: clamp(22px, 2.2vw, 32px);
  background: var(--color-bg-surface);
  border: var(--border-thin) solid var(--color-border-subtle);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: clamp(20px, 2.4vw, 36px);
  overflow: hidden;
  isolation: isolate;
  box-shadow: 0 18px 48px -24px rgba(0, 0, 0, 0.45);

  // Animated brand accent — top hairline, тонкий gradient flow.
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(var(--color-brand-violet-rgb), 0.5) 25%,
      rgba(var(--color-brand-pink-rgb), 0.6) 55%,
      rgba(var(--color-brand-amber-rgb), 0.4) 80%,
      transparent 100%
    );
    pointer-events: none;
  }

  // Soft ambient glow в верхнем углу — придаёт глубину без bubble-glass.
  &::after {
    content: '';
    position: absolute;
    inset: -20% -10% auto auto;
    width: 280px;
    height: 280px;
    background: radial-gradient(
      circle,
      rgba(var(--color-brand-violet-rgb), 0.12) 0%,
      transparent 65%
    );
    pointer-events: none;
    filter: blur(24px);
    z-index: -1;
  }

  &-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    position: relative;
  }

  &-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    position: relative;
  }

  &-pulse {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--color-success, #2dd89a);
    animation: aliceConnectedPulse calc(2.4s / max(var(--motion-scale, 1), 0.001)) ease-out infinite;
  }

  &-title {
    font-family: var(--font-family-display);
    font-size: var(--font-size-h1);
    font-weight: 600;
    letter-spacing: var(--tracking-h1);
    color: var(--color-text-primary);
    margin: 0 0 4px;
    text-wrap: balance;
  }

  &-sub {
    font-family: var(--font-family-mono);
    font-size: 12.5px;
    color: var(--color-text-muted);
    margin: 0;
  }

  &-action {
    flex-shrink: 0;
  }

  &-hint {
    font-size: 13.5px;
    color: var(--color-text-secondary);
    margin: 0;
    position: relative;
    line-height: 1.55;
  }

  &-actions {
    position: relative;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
}

// JarvisOrb справа в connected-карточке. Состояние orb берётся из station store.
.alice__orb-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: inherit;
  z-index: 1;

  :deep(.orb) {
    --orb-size: clamp(180px, 16vw, 240px);
    transition: transform var(--dur-medium) var(--ease-spring);
  }

  &:hover :deep(.orb) {
    transform: scale(1.04);
  }

  &:focus-visible {
    outline: none;
    :deep(.orb) {
      filter: drop-shadow(0 0 24px rgba(var(--color-brand-violet-rgb), 0.6));
    }
  }
}

.alice__orb-caption {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-micro);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--tracking-micro);
  text-align: center;
}

@media (max-width: 720px) {
  .alice__connected {
    grid-template-columns: minmax(0, 1fr);
  }
  // Orb на mobile — 120px, чтобы connected-card помещалась в viewport.
  .alice__orb-stage :deep(.orb) {
    --orb-size: 120px;
  }
  .alice__orb-caption {
    font-size: 10px;
  }
}

@media (max-width: 380px) {
  .alice__orb-stage :deep(.orb) {
    --orb-size: 96px;
  }
}

// === Manual fallback (details) ===========================================
.alice__manual {
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.018);
  border: 1px dashed rgba(255, 255, 255, 0.07);
  padding: 0;
  transition: background-color 200ms var(--ease-out);

  &[open] {
    background: rgba(255, 255, 255, 0.025);
    padding: 0 0 12px;
  }

  &-summary {
    list-style: none;
    cursor: pointer;
    padding: 12px 16px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-secondary);
    user-select: none;

    &::-webkit-details-marker {
      display: none;
    }
    &::before {
      content: '▸';
      margin-right: 8px;
      transition: transform 200ms var(--ease-out);
      display: inline-block;
    }
    &:hover {
      color: var(--color-text-primary);
    }
  }

  &[open] &-summary::before {
    transform: rotate(90deg);
  }

  &-hint {
    font-size: 11.5px;
    font-weight: 400;
    color: var(--color-text-muted);
  }

  .alice__card {
    margin: 8px 12px 0;
  }
}

@keyframes aliceConnectedPulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-success, #2dd89a) 60%, transparent);
  }
  70% {
    box-shadow: 0 0 0 12px color-mix(in srgb, var(--color-success, #2dd89a) 0%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

.alice-fade-enter-active,
.alice-fade-leave-active {
  transition:
    opacity 280ms var(--ease-out),
    transform 280ms var(--ease-out);
}
.alice-fade-enter-from,
.alice-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

// Caption под orb'ом: cross-fade при смене voiceState.
.alice-caption-enter-active,
.alice-caption-leave-active {
  transition:
    opacity 220ms var(--ease-out),
    transform 220ms var(--ease-out);
}
.alice-caption-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.alice-caption-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

// Tab cross-fade: simultaneous + leave-active absolute внутри `.alice__tab-stage`.
.tab-fade-enter-active,
.tab-fade-leave-active {
  transition:
    opacity 220ms var(--ease-out),
    transform 280ms var(--ease-out);
  will-change: opacity, transform;
}
.tab-fade-leave-active {
  position: absolute;
  inset: 0;
  width: 100%;
  pointer-events: none;
}
.tab-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.tab-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

// Reduce-motion: instant swap, leave-active в absolute (без opacity/transform tween).
.tab-fade-instant-leave-active {
  position: absolute;
  inset: 0;
  width: 100%;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .alice__candidate,
  .alice__card,
  .alice__status-dot,
  .alice__scan-pip,
  .alice__connected-pulse {
    transition: none;
    animation: none;
  }
  .alice-fade-enter-active,
  .alice-fade-leave-active {
    transition: none;
  }
}

// ---- Mobile: 1-колоночные карточки, чипы и form'ы ----
@media (max-width: 720px) {
  .alice {
    &__connected {
      padding: 16px;
      gap: 12px;

      &-head {
        // Pulse + title в одной row, action — на отдельной row снизу.
        grid-template-columns: auto minmax(0, 1fr);
        grid-template-rows: auto auto;
        gap: 10px 12px;
      }

      &-action {
        grid-column: 1 / -1;
        justify-self: stretch;
      }
    }

    &__card {
      padding: 16px;
    }

    &__card-head {
      grid-template-columns: auto minmax(0, 1fr);
      gap: 12px;

      // Action-кнопка на отдельной row, full-width.
      .alice__card-action {
        grid-column: 1 / -1;
        justify-self: stretch;
      }
    }

    &__candidates {
      gap: 8px;
    }

    &__candidate {
      grid-template-columns: 36px minmax(0, 1fr);
      grid-template-rows: auto auto;
      padding: 10px 12px;

      // Action-кнопка на отдельной row под мета-инфой.
      :deep(.btn) {
        grid-column: 1 / -1;
        justify-self: stretch;
      }
    }
  }
}
</style>
