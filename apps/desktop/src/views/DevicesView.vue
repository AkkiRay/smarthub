<template>
  <section class="devices" ref="root">
    <BasePageHeader
      title="Устройства"
      :description="`${devices.devices.length} подключено · ${devices.onlineCount} в сети`"
    >
      <template #actions>
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
      </template>
    </BasePageHeader>

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
  BasePageHeader,
  BaseEmpty,
  type SegmentedOption,
} from '@/components/base';

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

  // Self-heal: устройства, спаренные ДО того как room-binding научился тянуть
  // roomId из снапшота, лежат в БД с пустым `device.room`. Если пользователь
  // авторизован — тихо запускаем sync (он перепрочитает state каждого устройства
  // через readState, который теперь обновляет room). Триггерим максимум один
  // раз за сессию, и только если есть кому помогать.
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
.devices {
  display: flex;
  flex-direction: column;
  gap: var(--content-gap);
  width: 100%;

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
  }

  @media (max-width: 720px) {
    &__search {
      width: 100%;
    }
  }
}
</style>
