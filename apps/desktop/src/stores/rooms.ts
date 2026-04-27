/**
 * @fileoverview Pinia-store комнат. Локальные комнаты (`origin: 'local'`)
 * редактируются юзером, импортированные из «Дома с Алисой» (`origin: 'yandex'`)
 * read-only — UI блокирует rename/delete, т.к. на следующем sync'е изменения
 * будут затёрты.
 *
 * Подписан на IPC events `room:upserted` / `room:removed`. Используется
 * RoomsView для bulk-операций и DeviceCard для chip'а с именем комнаты.
 */

import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref } from 'vue';
import type { Room } from '@smarthome/shared';

/** JSON-roundtrip: Vue reactive не сериализуется через IPC structured-clone. */
const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const useRoomsStore = defineStore('rooms', () => {
  const rooms = ref<Room[]>([]);
  const isLoading = ref(false);
  let subscribed = false;

  async function bootstrap() {
    isLoading.value = true;
    try {
      rooms.value = await window.smarthome.rooms.list();
    } finally {
      isLoading.value = false;
    }
    if (subscribed) return;
    subscribed = true;
    window.smarthome.events.on('room:upserted', (room) => {
      const idx = rooms.value.findIndex((r) => r.id === room.id);
      if (idx === -1) rooms.value = [...rooms.value, room];
      else rooms.value.splice(idx, 1, room);
    });
    window.smarthome.events.on('room:removed', ({ id }) => {
      rooms.value = rooms.value.filter((r) => r.id !== id);
    });
  }

  async function create(input: { name: string; icon: string }) {
    const r = await window.smarthome.rooms.create(toPlain(input));
    rooms.value = [...rooms.value, r];
    return r;
  }

  async function update(id: string, patch: Partial<Pick<Room, 'name' | 'icon' | 'order'>>) {
    const r = await window.smarthome.rooms.update(id, toPlain(patch));
    const idx = rooms.value.findIndex((x) => x.id === id);
    if (idx !== -1) rooms.value.splice(idx, 1, r);
  }

  async function remove(id: string) {
    await window.smarthome.rooms.remove(id);
    rooms.value = rooms.value.filter((r) => r.id !== id);
  }

  /**
   * Прямая запись (после yandex-sync). Бэкенд уже сделал upsert; UI просто
   * подбирает свежий список без второго round-trip'а через bootstrap().
   */
  function setRooms(next: Room[]): void {
    rooms.value = next;
  }

  return { rooms, isLoading, bootstrap, create, update, remove, setRooms };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRoomsStore, import.meta.hot));
}
