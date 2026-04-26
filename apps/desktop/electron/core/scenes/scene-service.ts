/**
 * @fileoverview Scene service — CRUD сценариев + execution.
 *
 * Сценарий — это массив {@link SceneAction} с per-action `delayMs`. Все шаги
 * стартуют параллельно через `setTimeout(action.delayMs)` — это даёт
 * sequential-like поведение (за счёт сортировки по delay) без блокировки
 * event loop'а.
 *
 * Persistence: scenes хранятся в SQLite вместе с devices/rooms (через
 * {@link DeviceStore}), чтобы один транзакционный backup покрывал всё.
 *
 * Exposure to Alice: при `scene.exposeToStation === true` сценарий
 * регистрируется в {@link AliceBridge} как virtual `devices.types.other`
 * с capability `on_off` — юзер вызывает голосом «Алиса, включи романтику».
 */

import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import log from 'electron-log/main.js';
import type { Scene } from '@smarthome/shared';
import type { DeviceStore } from '../storage/device-store.js';
import type { DeviceRegistry } from '../registry/device-registry.js';

export type SceneService = ReturnType<typeof createSceneService>;

export function createSceneService(deps: {
  deviceStore: DeviceStore;
  deviceRegistry: DeviceRegistry;
}) {
  const cache = new Map<string, Scene>();

  return {
    init(): void {
      for (const s of deps.deviceStore.scenes.list()) cache.set(s.id, s);
      log.info(`SceneService: ${cache.size} scenes loaded`);
    },

    list: (): Scene[] => Array.from(cache.values()),

    create(input: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'>): Scene {
      const now = new Date().toISOString();
      const scene: Scene = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
      cache.set(scene.id, scene);
      deps.deviceStore.scenes.upsert(scene);
      return scene;
    },

    update(id: string, patch: Partial<Scene>): Scene {
      const existing = cache.get(id);
      if (!existing) throw new Error(`Unknown scene ${id}`);
      const updated: Scene = {
        ...existing,
        ...patch,
        id,
        updatedAt: new Date().toISOString(),
      };
      cache.set(id, updated);
      deps.deviceStore.scenes.upsert(updated);
      return updated;
    },

    remove(id: string): void {
      cache.delete(id);
      deps.deviceStore.scenes.remove(id);
    },

    async run(id: string): Promise<void> {
      const scene = cache.get(id);
      if (!scene) throw new Error(`Unknown scene ${id}`);
      log.info(`SceneService: running ${scene.name} (${scene.actions.length} actions)`);
      await Promise.all(
        scene.actions.map(async (action) => {
          if (action.delayMs && action.delayMs > 0) await delay(action.delayMs);
          await deps.deviceRegistry.execute({
            deviceId: action.deviceId,
            capability: action.capability,
            instance: action.instance,
            value: action.value,
          });
        }),
      );
    },
  };
}
