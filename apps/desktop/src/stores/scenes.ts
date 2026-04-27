/**
 * @fileoverview Pinia-store сценариев. CRUD-обёртки над IPC-каналом
 * `window.smarthome.scenes.*`, плюс `run(id)` для запуска сценария.
 *
 * Используется ScenesView (список + редактор) и HomeView (быстрые сценарии
 * на главной странице). Engine выполнения живёт в main process'е
 * ({@link SceneService}).
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Scene } from '@smarthome/shared';
import { useToasterStore } from './toaster';

// JSON-roundtrip: критично для Scene.actions[], приходящих из reactive form.
const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const useScenesStore = defineStore('scenes', () => {
  const scenes = ref<Scene[]>([]);
  const isLoading = ref(false);

  async function bootstrap() {
    isLoading.value = true;
    try {
      scenes.value = await window.smarthome.scenes.list();
    } finally {
      isLoading.value = false;
    }
  }

  async function create(input: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'>) {
    const s = await window.smarthome.scenes.create(toPlain(input));
    scenes.value = [s, ...scenes.value];
    return s;
  }

  async function update(id: string, patch: Partial<Scene>) {
    const s = await window.smarthome.scenes.update(id, toPlain(patch));
    const idx = scenes.value.findIndex((x) => x.id === id);
    if (idx !== -1) scenes.value.splice(idx, 1, s);
    return s;
  }

  async function remove(id: string) {
    await window.smarthome.scenes.remove(id);
    scenes.value = scenes.value.filter((s) => s.id !== id);
  }

  async function run(id: string) {
    const toaster = useToasterStore();
    const scene = scenes.value.find((s) => s.id === id);
    await toaster
      .run(window.smarthome.scenes.run(id), {
        success: `Сценарий «${scene?.name ?? id}» запущен`,
        error: 'Сценарий не выполнен',
      })
      .catch(() => {
        /* error уже показан в toaster'е через runWithToast */
      });
  }

  return { scenes, isLoading, bootstrap, create, update, remove, run };
});
