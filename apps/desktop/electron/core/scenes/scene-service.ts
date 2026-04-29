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
import type { Scene, SceneDryRunReport, SceneDryRunStep } from '@smarthome/shared';
import type { DeviceStore } from '../storage/device-store.js';
import type { DeviceRegistry } from '../registry/device-registry.js';

export type SceneService = ReturnType<typeof createSceneService>;

function shouldStopStationBeforeAction(action: Scene['actions'][number]): boolean {
  return (
    action.capability === 'devices.capabilities.quasar.server_action' ||
    action.capability === 'devices.capabilities.quasar'
  );
}

export function createSceneService(deps: {
  deviceStore: DeviceStore;
  deviceRegistry: DeviceRegistry;
  checkStationAlive?: () => Promise<{ ok: boolean; connection?: string; error?: string }>;
  stopStationMedia?: () => Promise<void>;
}) {
  const cache = new Map<string, Scene>();
  const executableQuasarInstances = new Set([
    'phrase_action',
    'text_action',
    'voice_action',
    'tts',
    'sound_command',
  ]);

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

    async dryRun(id: string): Promise<SceneDryRunReport> {
      const scene = cache.get(id);
      if (!scene) throw new Error(`Unknown scene ${id}`);
      await Promise.allSettled(
        Array.from(new Set(scene.actions.map((action) => action.deviceId))).map((deviceId) =>
          deps.deviceRegistry.get(deviceId)
            ? deps.deviceRegistry.refresh(deviceId)
            : Promise.resolve(null),
        ),
      );
      const needsStation = scene.actions.some(shouldStopStationBeforeAction);
      const stationHealth =
        needsStation && deps.checkStationAlive ? await deps.checkStationAlive() : null;

      const steps: SceneDryRunStep[] = scene.actions.map((action, index) => {
        const device = deps.deviceRegistry.get(action.deviceId);
        const delayMs = Math.max(0, Number(action.delayMs ?? 0));
        if (!device) {
          return {
            index,
            delayMs,
            deviceId: action.deviceId,
            deviceName: 'Неизвестное устройство',
            deviceStatus: 'missing',
            capability: action.capability,
            instance: action.instance,
            value: action.value,
            severity: 'error',
            message: 'Устройство больше не привязано к хабу',
          };
        }

        const isExecutableServerAction =
          action.capability === 'devices.capabilities.quasar.server_action' &&
          executableQuasarInstances.has(action.instance);
        const hasCapability = isExecutableServerAction
          ? device.capabilities.some((cap) => cap.type === action.capability)
          : device.capabilities.some((cap) => {
              const instance =
                cap.state?.instance ?? (cap.parameters?.['instance'] as string | undefined) ?? '';
              return cap.type === action.capability && instance === action.instance;
            });

        if (!hasCapability) {
          return {
            index,
            delayMs,
            deviceId: action.deviceId,
            deviceName: device.name,
            deviceStatus: device.status,
            capability: action.capability,
            instance: action.instance,
            value: action.value,
            severity: 'error',
            message: 'Устройство больше не поддерживает это действие',
          };
        }

        if (
          action.capability === 'devices.capabilities.quasar' &&
          !executableQuasarInstances.has(action.instance)
        ) {
          return {
            index,
            delayMs,
            deviceId: action.deviceId,
            deviceName: device.name,
            deviceStatus: device.status,
            capability: action.capability,
            instance: action.instance,
            value: action.value,
            severity: 'error',
            message:
              'Это состояние/нативная возможность колонки, а не надёжная команда сценария. Используйте голосовую команду, например "включи музыку" или "какая погода".',
          };
        }

        if (shouldStopStationBeforeAction(action) && stationHealth && !stationHealth.ok) {
          return {
            index,
            delayMs,
            deviceId: action.deviceId,
            deviceName: device.name,
            deviceStatus: device.status,
            capability: action.capability,
            instance: action.instance,
            value: action.value,
            severity: 'error',
            message: `Алиса не отвечает на ping: ${stationHealth.error ?? stationHealth.connection ?? 'нет соединения'}`,
          };
        }

        if (device.status !== 'online') {
          const severity = shouldStopStationBeforeAction(action) ? 'error' : 'warning';
          return {
            index,
            delayMs,
            deviceId: action.deviceId,
            deviceName: device.name,
            deviceStatus: device.status,
            capability: action.capability,
            instance: action.instance,
            value: action.value,
            severity,
            message: `Статус устройства: ${device.status}. Команда может не выполниться`,
          };
        }

        return {
          index,
          delayMs,
          deviceId: action.deviceId,
          deviceName: device.name,
          deviceStatus: device.status,
          capability: action.capability,
          instance: action.instance,
          value: action.value,
          severity: 'ok',
          message: 'Готово к выполнению',
        };
      });

      const errors = steps.filter((step) => step.severity === 'error').length;
      const warnings = steps.filter((step) => step.severity === 'warning').length;

      return {
        sceneId: scene.id,
        sceneName: scene.name,
        actionCount: scene.actions.length,
        estimatedDurationMs: steps.reduce((max, step) => Math.max(max, step.delayMs), 0),
        canRun: scene.actions.length > 0 && errors === 0,
        warnings,
        errors,
        steps,
      };
    },

    async run(id: string): Promise<void> {
      const scene = cache.get(id);
      if (!scene) throw new Error(`Unknown scene ${id}`);
      const preflight = await this.dryRun(id);
      if (preflight.errors > 0) {
        const failedSteps = preflight.steps
          .filter((step) => step.severity === 'error')
          .map((step) => `${step.index + 1}: ${step.deviceName} - ${step.message}`)
          .join('; ');
        throw new Error(`Сценарий «${scene.name}» не запущен: ${failedSteps}`);
      }
      if (deps.stopStationMedia && scene.actions.some(shouldStopStationBeforeAction)) {
        try {
          await deps.stopStationMedia();
        } catch (e) {
          log.warn(`SceneService: pre-stop station failed: ${(e as Error).message}`);
        }
      }
      log.info(`SceneService: running ${scene.name} (${scene.actions.length} actions)`);
      // allSettled, не all: «свет + музыка + штора» — упало одно действие, остальные
      // физически выполнились. Promise.all бросал на первой ошибке, давая UI ложный
      // negative («сцена не сработала»), хотя 2 из 3 устройств отработали.
      const results = await Promise.all(
        scene.actions.map(async (action) => {
          if (action.delayMs && action.delayMs > 0) await delay(action.delayMs);
          try {
            const r = await deps.deviceRegistry.execute({
              deviceId: action.deviceId,
              capability: action.capability,
              instance: action.instance,
              value: action.value,
            });
            return { ok: r.status === 'DONE', deviceId: action.deviceId, result: r };
          } catch (e) {
            return { ok: false, deviceId: action.deviceId, error: (e as Error).message };
          }
        }),
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length === scene.actions.length) {
        throw new Error(`Сцена «${scene.name}» не сработала: все ${failed.length} действий упали`);
      }
      if (failed.length > 0) {
        log.warn(
          `SceneService: scene ${scene.name} partial — ${failed.length}/${scene.actions.length} actions failed: ` +
            failed.map((r) => r.deviceId).join(', '),
        );
      }
    },
  };
}
