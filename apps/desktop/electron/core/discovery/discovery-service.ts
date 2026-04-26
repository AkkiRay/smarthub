/**
 * @fileoverview Оркестратор discovery — параллельно вызывает
 * `driver.discover(signal)` для всех активных драйверов и собирает
 * кандидатов в единый stream.
 *
 * Lifecycle одного цикла:
 *   1. `start({ mode: 'once' | 'continuous' })` — создаёт `AbortController`,
 *      запускает все driver'ы в параллель.
 *   2. На каждой смене phase (`scanning` → `done` / `error`) эмитит
 *      `discovery:progress` — UI рисует live-индикатор сканирования.
 *   3. Найденные кандидаты эмитятся как `discovery:candidate`.
 *   4. После завершения всех драйверов цикл закрывается; в `continuous`-режиме
 *      ставится timer на следующий цикл (по умолчанию через 15s).
 *   5. `stop()` — abort'ит signal, все драйверы должны корректно выйти.
 *
 * Concurrency: все driver'ы стартуют одновременно (LAN-discovery — это в
 * основном UDP-broadcast, можно безопасно параллелить). Cloud-driver'ы
 * сами решают throttling внутри.
 */

import { EventEmitter } from 'node:events';
import log from 'electron-log/main.js';
import type { DiscoveredDevice, DiscoveryProgress, DriverScanProgress } from '@smarthome/shared';
import type { DriverRegistry } from '../drivers/driver-registry.js';
import type { DeviceRegistry } from '../registry/device-registry.js';

interface DiscoveryEvents {
  candidate: (candidate: DiscoveredDevice) => void;
  state: (state: { running: boolean }) => void;
  progress: (progress: DiscoveryProgress) => void;
}

export type DiscoveryService = ReturnType<typeof createDiscoveryService>;

export function createDiscoveryService(deps: {
  driverRegistry: DriverRegistry;
  deviceRegistry: DeviceRegistry;
}) {
  const emitter = new EventEmitter();
  const candidates = new Map<string, DiscoveredDevice>();

  let running = false;
  let abortController: AbortController | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  // Race condition guard: новый cycle ждёт предыдущий — иначе драйверы конкурируют за UDP-сокеты.
  let cycleInProgress = false;

  // Re-assigned при каждой эмиссии, чтобы renderer мог делать референсное сравнение.
  let progress: DiscoveryProgress = {
    cycleActive: false,
    cycleStartedAt: 0,
    drivers: [],
  };

  const setDriverPhase = (driverId: string, patch: Partial<DriverScanProgress>): void => {
    const next = progress.drivers.map((d) => (d.driverId === driverId ? { ...d, ...patch } : d));
    progress = { ...progress, drivers: next };
    emitter.emit('progress', progress);
  };

  const runCycle = async (): Promise<void> => {
    if (cycleInProgress) return;
    cycleInProgress = true;

    abortController = new AbortController();
    const drivers = deps.driverRegistry.list();
    const cycleSignal = abortController.signal;
    const cycleStartedAt = Date.now();

    progress = {
      cycleActive: true,
      cycleStartedAt,
      drivers: drivers.map((d) => ({
        driverId: d.id,
        displayName: d.displayName,
        phase: 'scanning' as const,
        found: 0,
        startedAt: cycleStartedAt,
      })),
    };
    emitter.emit('progress', progress);

    const timeoutMs = Number(process.env['HUB_DISCOVERY_TIMEOUT_MS'] ?? 4000);
    const timeoutHandle = setTimeout(() => abortController?.abort(), timeoutMs);

    try {
      // Не allSettled-на-массив: нужно знать момент завершения КАЖДОГО, чтобы UI обновлялся постепенно.
      await Promise.all(
        drivers.map(async (driver) => {
          const driverStartedAt = Date.now();
          try {
            const found = await driver.discover(cycleSignal);
            for (const c of found) {
              const key = `${c.driver}:${c.externalId}`;
              const known = deps.deviceRegistry.findByExternalId(c.driver, c.externalId);
              const enriched: DiscoveredDevice = {
                ...c,
                ...(known ? { knownDeviceId: known.id } : {}),
              };
              candidates.set(key, enriched);
              emitter.emit('candidate', enriched);
            }
            setDriverPhase(driver.id, {
              phase: 'done',
              found: found.length,
              durationMs: Date.now() - driverStartedAt,
            });
          } catch (e) {
            log.warn(`DiscoveryService: ${driver.id} discovery failed`, e);
            setDriverPhase(driver.id, {
              phase: 'error',
              error: (e as Error).message ?? 'unknown error',
              durationMs: Date.now() - driverStartedAt,
            });
          }
        }),
      );
    } finally {
      clearTimeout(timeoutHandle);
      cycleInProgress = false;
      progress = { ...progress, cycleActive: false };
      emitter.emit('progress', progress);
    }
  };

  // Шарится между public stop() и auto-stop в режиме 'once' после first cycle.
  const internalStop = (): void => {
    if (!running) return;
    running = false;
    abortController?.abort();
    if (intervalTimer) clearInterval(intervalTimer);
    intervalTimer = null;
    // Драйверы, оставшиеся в scanning, помечаем idle — иначе UI зафиксирует «вечный» спиннер.
    progress = {
      ...progress,
      cycleActive: false,
      drivers: progress.drivers.map((d) =>
        d.phase === 'scanning' ? { ...d, phase: 'idle' as const } : d,
      ),
    };
    emitter.emit('progress', progress);
    emitter.emit('state', { running });
  };

  return {
    on<E extends keyof DiscoveryEvents>(event: E, listener: DiscoveryEvents[E]): () => void {
      emitter.on(event, listener as never);
      return () => emitter.off(event, listener as never);
    },

    /** mode 'once' (default) — один цикл; 'continuous' — повтор каждые HUB_DISCOVERY_INTERVAL_MS. */
    async start(opts: { mode?: 'once' | 'continuous' } = {}): Promise<void> {
      if (running) return;
      const mode = opts.mode ?? 'once';
      running = true;
      emitter.emit('state', { running });

      await runCycle();

      if (mode === 'once') {
        internalStop();
        return;
      }

      const interval = Number(process.env['HUB_DISCOVERY_INTERVAL_MS'] ?? 15000);
      intervalTimer = setInterval(() => {
        if (running) void runCycle();
      }, interval);
    },

    async stop(): Promise<void> {
      internalStop();
    },

    candidates: (): DiscoveredDevice[] => Array.from(candidates.values()),
    isRunning: (): boolean => running,
    getProgress: (): DiscoveryProgress => progress,
  };
}
