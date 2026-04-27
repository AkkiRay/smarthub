<template>
  <article class="home-dash" data-tour="alice-home-devices">
    <header class="home-dash__head">
      <div class="home-dash__copy">
        <h3 class="home-dash__title">Дом с Алисой</h3>
        <p class="home-dash__desc">
          Сводка по аккаунту Яндекса. Управление устройствами — на вкладке
          <RouterLink class="home-dash__inline-link" to="/devices">«Устройства»</RouterLink>: они
          импортируются автоматически после входа.
        </p>
      </div>
      <div class="home-dash__actions">
        <BaseButton
          variant="ghost"
          size="sm"
          icon-left="refresh"
          :loading="syncing || station.isLoadingHome"
          @click="onSync"
        >
          Синхронизировать
        </BaseButton>
        <BaseButton
          variant="primary"
          size="sm"
          icon-right="arrow-right"
          @click="$router.push('/devices')"
        >
          К устройствам
        </BaseButton>
      </div>
    </header>

    <p v-if="station.homeError" class="home-dash__error">{{ station.homeError }}</p>

    <!-- Household selector: виден при households.length > 1, импорт фильтрует по выбранному. -->
    <section v-if="households.length > 1" class="home-dash__household">
      <div class="home-dash__household-row">
        <span class="home-dash__household-label">Активный дом</span>
        <BaseSelect
          class="home-dash__household-select"
          :model-value="selectedHouseholdId ?? ''"
          :options="householdOptions"
          :disabled="switchingHousehold"
          placeholder="— выбрать —"
          @update:model-value="onHouseholdChange(String($event ?? ''))"
        />
        <span v-if="switchingHousehold" class="home-dash__household-hint">Переключаем…</span>
      </div>
      <div class="home-dash__network-row">
        <span class="home-dash__network-label">Текущая сеть</span>
        <span class="home-dash__network-value">{{ networkLabel }}</span>
        <span
          v-if="boundHouseholdId && boundHouseholdId === selectedHouseholdId"
          class="home-dash__network-tag home-dash__network-tag--ok"
        >
          привязана к активному дому
        </span>
        <span
          v-else-if="boundHouseholdId && boundHouseholdId !== selectedHouseholdId"
          class="home-dash__network-tag home-dash__network-tag--warn"
        >
          привязана к «{{ households.find((h) => h.id === boundHouseholdId)?.name ?? '?' }}»
        </span>
        <span v-else class="home-dash__network-tag">не привязана</span>
      </div>
      <div class="home-dash__policy-row">
        <BaseSwitch
          size="sm"
          :model-value="allowCloudControlOffNetwork"
          @update:model-value="onCloudControlToggle($event)"
        />
        <span>Разрешить управление с любой сети (cloud без network-gate)</span>
      </div>
    </section>

    <!-- Stats grid. -->
    <div class="home-dash__stats">
      <div class="home-dash__stat">
        <strong>{{ deviceCount }}</strong>
        <span>{{ pluralize(deviceCount, ['устройство', 'устройства', 'устройств']) }}</span>
      </div>
      <div class="home-dash__stat">
        <strong>{{ roomCount }}</strong>
        <span>{{ pluralize(roomCount, ['комната', 'комнаты', 'комнат']) }}</span>
      </div>
      <div class="home-dash__stat">
        <strong>{{ groupCount }}</strong>
        <span>{{ pluralize(groupCount, ['группа', 'группы', 'групп']) }}</span>
      </div>
      <div class="home-dash__stat">
        <strong>{{ scenarioCount }}</strong>
        <span>{{ pluralize(scenarioCount, ['сценарий', 'сценария', 'сценариев']) }}</span>
      </div>
      <div class="home-dash__stat home-dash__stat--meta">
        <span>{{ snapshot ? 'Обновлено' : 'Ожидает входа' }}</span>
        <strong>{{ snapshot ? formatTime(snapshot.fetchedAt) : '—' }}</strong>
      </div>
    </div>

    <!-- Type breakdown. -->
    <div v-if="hasSnapshot && deviceCount > 0" class="home-dash__breakdown">
      <h4 class="home-dash__breakdown-title">По типам</h4>
      <ul class="home-dash__type-list">
        <li v-for="t in typeBreakdown" :key="t.key" class="home-dash__type">
          <span class="home-dash__type-icon" :data-type="t.key">
            <BaseIcon :name="t.icon" :size="14" />
          </span>
          <span class="home-dash__type-name">{{ t.label }}</span>
          <strong class="home-dash__type-count">{{ t.count }}</strong>
        </li>
      </ul>
    </div>

    <!-- Rooms. -->
    <section v-if="hasSnapshot && roomCount > 0" class="home-dash__rooms">
      <h4 class="home-dash__rooms-title">Комнаты</h4>
      <div class="home-dash__room-list">
        <span v-for="r in snapshot!.rooms" :key="r.id" class="home-dash__room">
          {{ r.name }}
          <strong>{{ r.devices.length }}</strong>
        </span>
      </div>
    </section>

    <!-- Groups. -->
    <section v-if="hasSnapshot && groupCount > 0" class="home-dash__groups">
      <h4 class="home-dash__groups-title">Группы</h4>
      <div class="home-dash__group-list">
        <span v-for="g in snapshot!.groups" :key="g.id" class="home-dash__group">
          <BaseIcon :name="iconForGroupType(g.type)" :size="11" />
          {{ g.name }}
          <strong>{{ g.devices.length }}</strong>
        </span>
      </div>
    </section>

    <!-- Scenarios. -->
    <section v-if="hasSnapshot && scenarioCount > 0" class="home-dash__scenarios">
      <h4 class="home-dash__scenarios-title">Сценарии Алисы</h4>
      <div class="home-dash__scenario-list">
        <button
          v-for="s in snapshot!.scenarios"
          :key="s.id"
          type="button"
          class="home-dash__scenario"
          :class="{ 'is-active': s.isActive, 'is-running': runningScenarioId === s.id }"
          :disabled="runningScenarioId !== null"
          :title="`Запустить «${s.name}»`"
          @click="onRunScenario(s.id)"
        >
          <BaseIcon name="scenes" :size="11" />
          {{ s.name }}
        </button>
      </div>
      <p class="home-dash__scenarios-hint">
        Клик — запуск через iot.quasar. Свои сценарии (с устройствами хаба + голосом Алисы) — на
        вкладке <RouterLink class="home-dash__inline-link" to="/scenes">«Сценарии»</RouterLink>.
      </p>
    </section>

    <!-- Loading skeleton (sync in-flight). -->
    <div v-if="!hasSnapshot && station.isLoadingHome" class="home-dash__skeleton">
      <div class="home-dash__skeleton-row">
        <BaseSkeleton variant="line" width="40%" />
        <BaseSkeleton variant="line" width="30%" />
      </div>
      <SkeletonGrid :count="6" cell-min="180px" cell-height="100px" />
    </div>

    <!-- Empty state. -->
    <div v-if="!hasSnapshot && !station.isLoadingHome" class="home-dash__empty">
      <BaseIcon name="alice" :size="28" />
      <p>
        Нажмите <strong>«Синхронизировать»</strong> — хаб подтянет устройства, комнаты и сценарии из
        вашего аккаунта Яндекса. Устройства появятся на вкладке
        <RouterLink class="home-dash__inline-link" to="/devices">«Устройства»</RouterLink>
        с полноценным управлением.
      </p>
    </div>
  </article>
</template>

<script setup lang="ts">
// Дашборд «Дом с Алисой»: сводка по аккаунту + ссылка на /devices.
// Управление устройствами живёт во вкладке «Устройства» через DeviceCard.

import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import type { YandexHomeSnapshot } from '@smarthome/shared';
import type { IconName } from '@/components/base';
import {
  BaseButton,
  BaseIcon,
  BaseSelect,
  BaseSkeleton,
  BaseSwitch,
  SkeletonGrid,
  type SelectOption,
} from '@/components/base';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useDevicesStore } from '@/stores/devices';
import { useToasterStore } from '@/stores/toaster';

const station = useYandexStationStore();
const devices = useDevicesStore();
const toaster = useToasterStore();

// Snapshot фильтруется по активному household'у в store — single source of truth
// для этого компонента и segmented-badge в AliceView.
const snapshot = computed<YandexHomeSnapshot | null>(() => station.homeFiltered);
const hasSnapshot = computed(() => snapshot.value !== null);

const deviceCount = computed(() => snapshot.value?.devices.length ?? 0);
const roomCount = computed(() => snapshot.value?.rooms.length ?? 0);
const groupCount = computed(() => snapshot.value?.groups.length ?? 0);
const scenarioCount = computed(() => snapshot.value?.scenarios.length ?? 0);

const syncing = ref(false);
const runningScenarioId = ref<string | null>(null);

// Households dropdown — рендерится при households.length > 1.
// selectedHouseholdId хранится в store: фильтр snapshot'а в station.homeFiltered
// и счётчик в AliceView segmented.
const households = ref<Array<{ id: string; name: string }>>([]);
const selectedHouseholdId = computed({
  get: () => station.selectedHouseholdId,
  set: (v) => station.setSelectedHousehold(v),
});
const switchingHousehold = ref(false);
const currentNetwork = ref<{
  gatewayMac: string | null;
  ssid: string | null;
  subnet: string | null;
  detectedAt: string;
} | null>(null);
const boundHouseholdId = ref<string | null>(null);
const allowCloudControlOffNetwork = ref(false);

async function onCloudControlToggle(allow: boolean): Promise<void> {
  try {
    await window.smarthome.yandexStation.setCloudControlPolicy(allow);
    allowCloudControlOffNetwork.value = allow;
  } catch (e) {
    toaster.push({ kind: 'error', message: (e as Error).message });
  }
}

const networkLabel = computed(() => {
  const n = currentNetwork.value;
  if (!n) return '—';
  if (n.ssid) return n.ssid;
  if (n.subnet) return `${n.subnet}.0/24`;
  return 'неизвестна';
});

const householdOptions = computed<SelectOption[]>(() =>
  households.value.map((h) => ({ value: h.id, label: h.name })),
);

async function loadHouseholds(): Promise<void> {
  try {
    const r = await window.smarthome.yandexStation.listHouseholds();
    households.value = r.households;
    selectedHouseholdId.value = r.selected;
    currentNetwork.value = r.currentNetwork;
    boundHouseholdId.value = r.boundHouseholdId;
    allowCloudControlOffNetwork.value = r.allowCloudControlOffNetwork;
  } catch {
    /* not authorized: households.length === 0 → UI скрыт */
  }
}

async function onHouseholdChange(id: string): Promise<void> {
  const next = id || null;
  if (switchingHousehold.value || next === selectedHouseholdId.value) return;
  switchingHousehold.value = true;
  try {
    await window.smarthome.yandexStation.setHousehold(next);
    selectedHouseholdId.value = next;
    await Promise.all([station.fetchHome(), devices.syncYandexHome()]);
    // Backend rebind'ит network на новый household внутри setHousehold + sync.
    // Перечитываем households — обновляем badge boundHouseholdId.
    await loadHouseholds();
  } catch (e) {
    toaster.push({ kind: 'error', message: (e as Error).message });
  } finally {
    switchingHousehold.value = false;
  }
}

async function onRunScenario(id: string): Promise<void> {
  if (runningScenarioId.value) return;
  runningScenarioId.value = id;
  const name = snapshot.value?.scenarios.find((s) => s.id === id)?.name ?? 'сценарий';
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

function iconForGroupType(type?: string): IconName {
  if (!type) return 'devices';
  if (type.includes('light')) return 'light';
  if (type.includes('socket')) return 'socket';
  if (type.includes('switch')) return 'switch';
  if (type.includes('thermostat') || type.includes('humidifier')) return 'thermostat';
  if (type.includes('media') || type.includes('tv') || type.includes('speaker')) return 'media';
  return 'devices';
}

onMounted(() => {
  // Lazy fetch snapshot для type-breakdown при наличии авторизации.
  if (!station.home && !station.isLoadingHome) {
    void station.fetchHome();
  }
  void loadHouseholds();
});

async function onSync(): Promise<void> {
  if (syncing.value) return;
  syncing.value = true;
  try {
    // Параллельно: snapshot для дашборда + импорт в реестр устройств.

    const [, summary] = await Promise.all([
      station.fetchHome(),
      devices.syncYandexHome().catch(() => null),
    ]);
    if (summary) {
      households.value = summary.availableHouseholds;
      selectedHouseholdId.value = summary.householdId;
      currentNetwork.value = summary.currentNetwork;
    }
    // Перечитываем network binding после sync.
    void loadHouseholds();
  } finally {
    syncing.value = false;
  }
}

// Type breakdown: группировка yandex-types в bucket'ы свет / розетки / климат / медиа / прочее.
interface TypeBucket {
  key: string;
  label: string;
  icon: IconName;
  count: number;
  match: (yandexType: string) => boolean;
}

const typeBreakdown = computed<TypeBucket[]>(() => {
  if (!snapshot.value) return [];
  const buckets: TypeBucket[] = [
    { key: 'light', label: 'Свет', icon: 'light', count: 0, match: (t) => t.includes('light') },
    {
      key: 'socket',
      label: 'Розетки',
      icon: 'socket',
      count: 0,
      match: (t) => t.includes('socket') || t.includes('switch'),
    },
    {
      key: 'climate',
      label: 'Климат',
      icon: 'thermostat',
      count: 0,
      match: (t) =>
        t.includes('thermostat') ||
        t.includes('humidifier') ||
        t.includes('purifier') ||
        t.includes('fan'),
    },
    {
      key: 'sensor',
      label: 'Датчики',
      icon: 'sensor',
      count: 0,
      match: (t) => t.includes('sensor'),
    },
    {
      key: 'media',
      label: 'Медиа',
      icon: 'media',
      count: 0,
      match: (t) => t.includes('media') || t.includes('tv') || t.includes('speaker'),
    },
    { key: 'other', label: 'Прочее', icon: 'devices', count: 0, match: () => true },
  ];
  for (const d of snapshot.value.devices) {
    const bucket = buckets.find((b) => b.match(d.type)) ?? buckets[buckets.length - 1]!;
    bucket.count++;
  }
  return buckets.filter((b) => b.count > 0);
});

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function pluralize(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return forms[2];
  if (m10 === 1) return forms[0];
  if (m10 >= 2 && m10 <= 4) return forms[1];
  return forms[2];
}
</script>

<style scoped lang="scss">
.home-dash {
  container-type: inline-size;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: clamp(20px, 2vw, 30px) clamp(20px, 2vw, 32px);
  display: flex;
  flex-direction: column;
  gap: clamp(16px, 1.6vw, 22px);

  &__head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: start;

    @container (max-width: 560px) {
      grid-template-columns: 1fr;
    }
  }

  &__copy {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  &__household {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  &__household-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  &__household-label {
    font-size: 12px;
    color: var(--text-secondary, rgba(255, 255, 255, 0.7));
    letter-spacing: var(--tracking-meta);
    text-transform: uppercase;
  }

  &__household-select {
    flex: 1 1 auto;
    min-width: 160px;
  }

  &__household-hint {
    font-size: 12px;
    color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  }

  &__network-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  &__network-label {
    color: var(--text-secondary, rgba(255, 255, 255, 0.6));
    letter-spacing: var(--tracking-meta);
    text-transform: uppercase;
  }

  &__network-value {
    font-family: var(--font-family-mono);
    color: var(--text-primary, #fff);
  }

  &__policy-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--color-text-secondary);
    user-select: none;
    span {
      flex: 1;
    }
  }

  &__network-tag {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-secondary, rgba(255, 255, 255, 0.7));
    &--ok {
      background: rgba(72, 200, 130, 0.18);
      color: rgb(72, 200, 130);
    }
    &--warn {
      background: rgba(255, 170, 80, 0.18);
      color: rgb(255, 170, 80);
    }
  }

  &__title {
    font-family: var(--font-family-display);
    font-size: var(--font-size-h1);
    font-weight: 600;
    letter-spacing: var(--tracking-h1);
    margin: 0;
    color: var(--color-text-primary);
  }

  &__desc {
    font-size: var(--font-size-small);
    color: var(--color-text-secondary);
    line-height: 1.55;
    margin: 0;
    max-width: 72ch;
    text-wrap: pretty;
  }

  &__inline-link {
    color: var(--color-brand-purple);
    text-decoration: none;
    border-bottom: 1px dashed currentColor;
    transition: color 160ms var(--ease-out);

    &:hover {
      color: var(--color-brand-pink);
    }
  }

  &__actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  &__error {
    margin: 0;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: rgba(var(--color-danger-rgb), 0.08);
    border: 1px solid rgba(var(--color-danger-rgb), 0.22);
    color: var(--color-danger);
    font-size: 12.5px;
    line-height: 1.45;
  }

  &__stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
  }

  &__stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 16px;
    border-radius: var(--radius-md);
    background: rgba(0, 0, 0, 0.16);
    border: 1px solid rgba(255, 255, 255, 0.04);

    strong {
      font-family: var(--font-family-display);
      font-size: 24px;
      font-weight: 600;
      color: var(--color-text-primary);
      letter-spacing: -0.01em;
      line-height: 1.1;
    }

    span {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    &--meta {
      strong {
        font-family: var(--font-family-mono);
        font-size: 16px;
      }
    }
  }

  &__breakdown {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  &__breakdown-title {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  &__type-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 8px;
  }

  &__type {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 8px 12px;
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.04);
  }

  &__type-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: rgba(var(--color-brand-purple-rgb), 0.14);
    color: var(--color-brand-purple);

    &[data-type='light'] {
      background: rgba(255, 196, 0, 0.14);
      color: #ffc400;
    }
    &[data-type='socket'] {
      background: rgba(var(--color-success-rgb), 0.16);
      color: var(--color-success);
    }
    &[data-type='media'] {
      background: rgba(var(--color-brand-pink-rgb), 0.16);
      color: var(--color-brand-pink);
    }
    &[data-type='climate'] {
      background: rgba(70, 184, 255, 0.16);
      color: #46b8ff;
    }
    &[data-type='sensor'] {
      background: rgba(120, 220, 200, 0.14);
      color: #78dcc8;
    }
  }

  &__type-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__type-count {
    font-family: var(--font-family-mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-secondary);
  }

  &__scenarios {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  &__scenarios-title {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  &__scenario-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__scenario {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.07);
    color: var(--color-text-primary);
    font-size: 12.5px;
    cursor: pointer;
    transition:
      background-color 180ms var(--ease-out),
      border-color 180ms var(--ease-out),
      transform 180ms var(--ease-out);

    &:hover:not(:disabled) {
      background: rgba(var(--color-brand-purple-rgb), 0.12);
      border-color: rgba(var(--color-brand-purple-rgb), 0.45);
      transform: translateY(-1px);
    }
    &:disabled {
      opacity: 0.6;
      cursor: progress;
    }
    &.is-active {
      border-color: rgba(var(--color-success-rgb), 0.4);
      background: rgba(var(--color-success-rgb), 0.08);
    }
    &.is-running {
      border-color: rgba(var(--color-brand-pink-rgb), 0.6);
      background: rgba(var(--color-brand-pink-rgb), 0.14);
    }
  }

  &__rooms,
  &__groups {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  &__rooms-title,
  &__groups-title {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  &__room-list,
  &__group-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__room,
  &__group {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: var(--color-text-primary);
    font-size: 12.5px;

    strong {
      font-family: var(--font-family-mono);
      font-size: 11px;
      color: var(--color-text-muted);
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.04);
    }
  }

  &__scenario-more {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.025);
    color: var(--color-text-muted);
    font-size: 12.5px;
    font-family: var(--font-family-mono);
  }

  &__scenarios-hint {
    margin: 0;
    font-size: 11.5px;
    color: var(--color-text-muted);
    font-style: italic;
    line-height: 1.45;
  }

  &__skeleton {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 4px 0;
  }

  &__skeleton-row {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 28px 16px;
    border-radius: var(--radius-md);
    border: 1px dashed rgba(255, 255, 255, 0.08);
    color: var(--color-text-muted);
    text-align: center;

    p {
      margin: 0;
      max-width: 56ch;
      font-size: 13px;
      line-height: 1.55;

      strong {
        color: var(--color-text-primary);
      }
    }
  }
}

@media (max-width: 720px) {
  .home-dash {
    padding: 16px;

    &__head {
      grid-template-columns: 1fr;
    }
    &__actions :deep(.btn) {
      flex: 1 1 calc(50% - 4px);
      justify-content: center;
    }
  }
}
</style>
