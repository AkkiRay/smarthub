/**
 * @fileoverview Periodic state-refresh — раз в `HUB_POLL_INTERVAL_MS` (default
 * 30s) опрашивает все online-устройства через `driver.readState(device)`.
 *
 * Зачем нужен polling:
 *   - Устройства часто меняют state снаружи (физический выключатель,
 *     голос Алисе, mobile app другого вендора).
 *   - Не у всех драйверов есть push-канал (Yeelight notify, MQTT subscribe,
 *     Yandex updates_url) — без polling state в UI протухает.
 *
 * Adaptive backoff:
 *   - `unreachable`-устройства опрашиваются в 4× реже (`FAIL_BACKOFF_MULTIPLIER`).
 *     Иначе при отвалившемся LAN-сегменте polling спамит timeout'ы и забивает
 *     event-loop.
 *
 * Concurrency:
 *   - Не больше {@link MAX_PARALLEL_REFRESH} одновременных readState'ов —
 *     иначе UDP-сокеты драйверов конкурируют и теряют пакеты.
 *
 * Polling можно полностью отключить через `HUB_POLL_INTERVAL_MS=0`
 * (если все драйверы поддерживают push).
 */

import log from 'electron-log/main.js';
import type { DeviceRegistry } from '../registry/device-registry.js';

const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 5_000;
const FAIL_BACKOFF_MULTIPLIER = 4; // unreachable опрашиваем в 4× реже
const MAX_PARALLEL_REFRESH = 6; // concurrency limit, чтобы не топить LAN

export type PollingService = ReturnType<typeof createPollingService>;

export function createPollingService(deps: { deviceRegistry: DeviceRegistry }) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let cycleInProgress = false;
  const failureCounts = new Map<string, number>();

  const intervalMs = (() => {
    const raw = Number(process.env['HUB_POLL_INTERVAL_MS']);
    if (!Number.isFinite(raw)) return DEFAULT_INTERVAL_MS;
    if (raw === 0) return 0; // 0 = polling off
    return Math.max(MIN_INTERVAL_MS, raw);
  })();

  const shouldPollNow = (deviceId: string, cycleNumber: number): boolean => {
    const fails = failureCounts.get(deviceId) ?? 0;
    if (fails === 0) return true;
    // Пропускаем циклы пропорционально fail-count, но не дольше чем раз в 16 циклов.
    const skipEvery = Math.min(fails * FAIL_BACKOFF_MULTIPLIER, 16);
    return cycleNumber % skipEvery === 0;
  };

  let cycleCounter = 0;

  const runCycle = async (): Promise<void> => {
    if (cycleInProgress) return;
    cycleInProgress = true;
    cycleCounter++;

    try {
      const devices = deps.deviceRegistry
        .list()
        .filter((d) => !d.hidden)
        .filter((d) => shouldPollNow(d.id, cycleCounter));

      if (devices.length === 0) return;

      for (let i = 0; i < devices.length; i += MAX_PARALLEL_REFRESH) {
        const chunk = devices.slice(i, i + MAX_PARALLEL_REFRESH);
        const results = await Promise.allSettled(
          chunk.map((d) => deps.deviceRegistry.refresh(d.id)),
        );
        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          const d = chunk[j];
          if (!r || !d) continue;
          if (r.status === 'fulfilled' && r.value.status === 'online') {
            failureCounts.delete(d.id);
          } else {
            failureCounts.set(d.id, (failureCounts.get(d.id) ?? 0) + 1);
          }
        }
      }
    } catch (e) {
      log.warn(`PollingService cycle failed: ${(e as Error).message}`);
    } finally {
      cycleInProgress = false;
    }
  };

  return {
    start(): void {
      if (running || intervalMs === 0) {
        if (intervalMs === 0) {
          log.info('PollingService disabled (HUB_POLL_INTERVAL_MS=0)');
        }
        return;
      }
      running = true;
      timer = setInterval(() => {
        if (running) void runCycle();
      }, intervalMs);
      log.info(`PollingService started (interval=${intervalMs}ms)`);
    },
    stop(): void {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** Forced cycle — для UI-кнопки «Обновить всё». */
    runOnce: runCycle,
    isRunning: (): boolean => running,
  };
}
