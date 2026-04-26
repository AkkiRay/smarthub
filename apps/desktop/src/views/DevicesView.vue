<template>
  <section class="devices" ref="root">
    <!-- Hero header с stat-strip -->
    <header class="devices__hero">
      <div class="devices__hero-copy">
        <span class="devices__eyebrow">
          <span class="devices__eyebrow-dot" />
          Устройства
        </span>
        <h1 class="devices__title">
          {{ devices.devices.length }} <span class="text--gradient">{{ devicePluralizeRu(devices.devices.length) }}</span>
        </h1>
        <p class="devices__lead">
          {{ devices.onlineCount }} в сети ·
          <template v-if="devices.offlineCount > 0">{{ devices.offlineCount }} офлайн · </template>
          {{ counts.lights }} ламп · {{ counts.sockets }} розеток · {{ counts.sensors }} датчиков
        </p>
      </div>
      <div class="devices__hero-actions">
        <BaseInput
          v-model="search"
          class="devices__search"
          placeholder="Поиск по имени или драйверу"
          icon-left="search"
          size="sm"
        />
        <BaseButton
          variant="ghost"
          size="sm"
          icon-left="refresh"
          :loading="syncing"
          :disabled="!yandexAuthorized"
          :title="yandexAuthorized
            ? 'Импортировать устройства из Дома с Алисой'
            : 'Сначала войдите через Яндекс в разделе «Подключение Алисы»'"
          @click="onSyncYandex"
        >
          Из Яндекса
        </BaseButton>
        <BaseButton variant="primary" size="sm" icon-left="plus" @click="onAdd">
          Добавить
        </BaseButton>
      </div>
    </header>

    <BaseSegmented
      v-model="filter"
      :options="filterOptions"
      class="devices__filters"
      data-anim="block"
    />

    <!-- Room-based фильтр: показывается только когда есть >= 2 комнат, чтобы
         не плодить лишний контрол при «Без комнаты» + 0/1 room. -->
    <BaseSegmented
      v-if="roomFilterOptions.length > 2"
      v-model="roomFilter"
      :options="roomFilterOptions"
      class="devices__rooms"
      size="sm"
      data-anim="block"
    />

    <BaseEmpty
      v-if="!filtered.length"
      :title="devices.devices.length === 0 ? 'Устройств пока нет' : 'Нет устройств в выборке'"
      :text="devices.devices.length === 0
        ? 'Импортируйте всё из «Дома с Алисой» одним нажатием — или найдите локально через сканер.'
        : 'Попробуйте изменить фильтр или запустите поиск.'"
    >
      <template #glyph>
        <BaseIcon name="devices" :size="64" />
      </template>
      <template #actions>
        <BaseButton
          v-if="yandexAuthorized && devices.devices.length === 0"
          variant="primary"
          icon-left="refresh"
          :loading="syncing"
          @click="onSyncYandex"
        >
          Импорт из Яндекса
        </BaseButton>
        <BaseButton
          v-else-if="!yandexAuthorized && devices.devices.length === 0"
          variant="primary"
          icon-right="arrow-right"
          @click="$router.push('/alice')"
        >
          Войти через Яндекс
        </BaseButton>
        <BaseButton variant="ghost" icon-left="search" @click="onAdd">
          Поиск в LAN
        </BaseButton>
      </template>
    </BaseEmpty>

    <div v-else class="devices__grid bento-grid">
      <DeviceCard
        v-for="d in filtered"
        :key="d.id"
        :device="d"
        @click="$router.push(`/devices/${d.id}`)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import type { Device } from '@smarthome/shared';
import { useDevicesStore } from '@/stores/devices';
import { useRoomsStore } from '@/stores/rooms';
import { useViewMount } from '@/composables/useViewMount';
import DeviceCard from '@/components/devices/DeviceCard.vue';
import {
  BaseButton,
  BaseInput,
  BaseIcon,
  BaseSegmented,
  BaseEmpty,
  type SegmentedOption,
} from '@/components/base';

function devicePluralizeRu(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'устройств';
  if (m10 === 1) return 'устройство';
  if (m10 >= 2 && m10 <= 4) return 'устройства';
  return 'устройств';
}

type FilterId = 'all' | 'lights' | 'sockets' | 'sensors' | 'on' | 'yandex' | 'local';
/** Виртуальные значения room-filter'а — UUID-комнаты резолвятся отдельно. */
type RoomFilterId = '__all' | '__no_room' | string;

const devices = useDevicesStore();
const rooms = useRoomsStore();
const router = useRouter();
const root = useTemplateRef<HTMLElement>('root');
const search = ref('');
const filter = ref<FilterId>('all');
const roomFilter = ref<RoomFilterId>('__all');

// Yandex sync — кнопка активна только если юзер авторизован в Яндексе.
const yandexAuthorized = ref(false);
const syncing = ref(false);

// Backfill yandex-rooms сделан один раз за сессию — иначе каждый visit /devices
// триггерил бы sync, что бесполезно нагружает iot.quasar.
let backfillTried = false;

onMounted(async () => {
  // Rooms-store нужен для DeviceCard (резолв room.id → name) и для room-фильтра.
  // Bootstrap идемпотентен: если стор уже открывался — он просто переzаписывает.
  if (rooms.rooms.length === 0) {
    try {
      await rooms.bootstrap();
    } catch {
      /* offline — карточки покажут roomName из meta как fallback */
    }
  }
  try {
    const auth = await window.smarthome.yandexStation.getAuthStatus();
    yandexAuthorized.value = auth.authorized;
  } catch {
    /* offline / api недоступен — кнопка остаётся disabled */
  }

  if (!backfillTried && yandexAuthorized.value) {
    backfillTried = true;
    const unrooted = devices.devices.filter(
      (d) => d.driver === 'yandex-iot' && !d.room && (d.meta?.['roomId'] || d.meta?.['roomName']),
    );
    if (unrooted.length > 0) {
      void devices.syncYandexHome({ silent: true }).catch(() => {
        /* sync best-effort: ошибки уже логируются в main.log */
      });
    }
  }
});

async function onSyncYandex(): Promise<void> {
  if (syncing.value) return;
  syncing.value = true;
  try {
    await devices.syncYandexHome();
  } catch {
    /* toast уже показан */
  } finally {
    syncing.value = false;
  }
}

// Бейджи-счётчики для каждого фильтра.
const counts = computed(() => ({
  all: devices.devices.length,
  lights: devices.devices.filter((d) => d.type === 'devices.types.light').length,
  sockets: devices.devices.filter((d) => d.type === 'devices.types.socket').length,
  sensors: devices.devices.filter((d) => d.type === 'devices.types.sensor').length,
  on: devices.devices.filter((d) =>
    d.capabilities.some((c) => c.type === 'devices.capabilities.on_off' && Boolean(c.state?.value)),
  ).length,
  yandex: devices.devices.filter((d) => d.driver === 'yandex-iot').length,
  local: devices.devices.filter((d) => d.driver !== 'yandex-iot').length,
}));

const filterOptions = computed<SegmentedOption[]>(() => {
  const opts: SegmentedOption[] = [
    { value: 'all', label: 'Все', count: counts.value.all },
    { value: 'lights', label: 'Свет', icon: 'light', count: counts.value.lights },
    { value: 'sockets', label: 'Розетки', icon: 'socket', count: counts.value.sockets },
    { value: 'sensors', label: 'Датчики', icon: 'sensor', count: counts.value.sensors },
    { value: 'on', label: 'Включено', count: counts.value.on },
  ];
  // Source-сегменты появляются только если есть смысл различать (хотя бы один yandex и один local).
  if (counts.value.yandex > 0 && counts.value.local > 0) {
    opts.push({ value: 'yandex', label: 'Yandex', icon: 'alice', count: counts.value.yandex });
    opts.push({ value: 'local', label: 'Локальные', count: counts.value.local });
  }
  return opts;
});

/**
 * Room-фильтр: «Все» + комнаты в которых есть устройства + «Без комнаты» если
 * есть устройства без `room`. Пустые комнаты не показываем — фильтрация по ним
 * даст 0 результатов и запутает.
 */
const roomFilterOptions = computed<SegmentedOption[]>(() => {
  const counts = new Map<string, number>();
  let noRoomCount = 0;
  for (const d of devices.devices) {
    if (d.room) counts.set(d.room, (counts.get(d.room) ?? 0) + 1);
    else noRoomCount++;
  }
  const opts: SegmentedOption[] = [
    { value: '__all', label: 'Все комнаты', count: devices.devices.length },
  ];
  for (const room of rooms.rooms) {
    const c = counts.get(room.id);
    if (c) opts.push({ value: room.id, label: room.name, count: c });
  }
  if (noRoomCount) opts.push({ value: '__no_room', label: 'Без комнаты', count: noRoomCount });
  return opts;
});

const filtered = computed<Device[]>(() => {
  let list = devices.devices;
  if (filter.value === 'lights') list = list.filter((d) => d.type === 'devices.types.light');
  if (filter.value === 'sockets') list = list.filter((d) => d.type === 'devices.types.socket');
  if (filter.value === 'sensors') list = list.filter((d) => d.type === 'devices.types.sensor');
  if (filter.value === 'on') {
    list = list.filter((d) =>
      d.capabilities.some(
        (c) => c.type === 'devices.capabilities.on_off' && Boolean(c.state?.value),
      ),
    );
  }
  if (filter.value === 'yandex') list = list.filter((d) => d.driver === 'yandex-iot');
  if (filter.value === 'local') list = list.filter((d) => d.driver !== 'yandex-iot');
  if (roomFilter.value === '__no_room') {
    list = list.filter((d) => !d.room);
  } else if (roomFilter.value !== '__all') {
    list = list.filter((d) => d.room === roomFilter.value);
  }
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    list = list.filter(
      (d) => d.name.toLowerCase().includes(q) || d.driver.toLowerCase().includes(q),
    );
  }
  return list;
});

function onAdd(): void {
  void router.push('/discovery');
}

useViewMount({
  scope: root.value,
  itemsSelector: '.devices__grid > *',
});
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.devices {
  display: flex;
  flex-direction: column;
  gap: var(--content-gap);
  width: 100%;
  align-self: start;

  // Hero block — gradient bg + title + actions row справа.
  &__hero {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-6);
    padding: var(--pad-roomy);
    border-radius: var(--radius-xl);
    overflow: hidden;
    isolation: isolate;
    @include glass(var(--glass-alpha-soft), var(--glass-blur-medium));

    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background:
        radial-gradient(60% 80% at 0% 0%, rgba(var(--color-brand-violet-rgb), 0.28) 0%, transparent 60%),
        radial-gradient(40% 60% at 100% 100%, rgba(var(--color-brand-pink-rgb), 0.18) 0%, transparent 60%);
      pointer-events: none;
      z-index: 0;
    }

    > * { position: relative; z-index: 1; }

    @media (max-width: 920px) {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  &__hero-copy {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  &__eyebrow {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-micro);
    text-transform: uppercase;
    letter-spacing: var(--tracking-micro);
    color: var(--color-brand-violet);
    font-weight: 600;

    &-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--gradient-brand);
      box-shadow: 0 0 12px rgba(var(--color-brand-violet-rgb), 0.6);
    }
  }

  &__title {
    font-family: var(--font-family-display);
    font-size: var(--font-size-display);
    font-weight: 720;
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-display);
    margin: 0;
    color: var(--color-text-primary);
  }

  &__lead {
    font-size: var(--font-size-body);
    color: var(--color-text-secondary);
    margin: 0;
  }

  &__hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }

  &__search {
    width: clamp(180px, 22vw, 280px);
  }

  &__filters {
    width: 100%;
  }

  &__rooms {
    align-self: flex-start;
  }

  // .bento-grid из глобальных blocks; кастомизация через CSS-переменные.
  &__grid {
    --bento-tile-min: 220px;

    @media (max-width: 720px) {
      --bento-tile-min: 100%;
    }
  }

  @media (max-width: 720px) {
    &__hero-actions {
      width: 100%;
    }
    &__search {
      width: 100%;
      flex: 1 1 100%;
    }
  }
}
</style>
