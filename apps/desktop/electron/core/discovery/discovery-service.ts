/**
 * @fileoverview Discovery orchestrator. Параллельно вызывает
 * `driver.discover(signal)` для всех зарегистрированных драйверов и
 * агрегирует кандидатов в единый stream.
 *
 * Lifecycle одного цикла:
 *   1. `start({ mode: 'once' | 'continuous' })` — детектит current network,
 *      создаёт `AbortController`, запускает все драйверы параллельно.
 *   2. На каждой смене phase эмитит `discovery:progress`.
 *   3. Найденные кандидаты эмитятся как `discovery:candidate`. LAN-кандидаты
 *      получают штамп текущей network signature; cloud-кандидаты yandex-iot
 *      проходят household-фильтр.
 *   4. После завершения всех драйверов цикл закрывается; в `continuous`-
 *      режиме ставится timer на следующий цикл.
 *   5. `stop()` — abort'ит signal, драйверы корректно выходят.
 *
 * Network filter:
 *   В начале цикла все кандидаты с не-matching network signature удаляются
 *   из cache. Yandex-iot фильтруется по `householdId === activeHousehold`,
 *   где `activeHousehold = boundHousehold ?? selectedHouseholdId`.
 */

import { EventEmitter } from 'node:events';
import log from 'electron-log/main.js';
import type { DiscoveredDevice, DiscoveryProgress, DriverScanProgress } from '@smarthome/shared';
import type { DriverRegistry } from '../drivers/driver-registry.js';
import type { DeviceRegistry } from '../registry/device-registry.js';
import type { SettingsStore } from '../storage/settings-store.js';
import {
  detectCurrentNetwork,
  findHouseholdForNetwork,
  networkMatches,
  type NetworkSignature,
} from '../network/network-identity.js';
import { invalidateInterfaceCache } from '../network/lan-interfaces.js';

interface DiscoveryEvents {
  candidate: (candidate: DiscoveredDevice) => void;
  state: (state: { running: boolean }) => void;
  progress: (progress: DiscoveryProgress) => void;
}

export type DiscoveryService = ReturnType<typeof createDiscoveryService>;

export function createDiscoveryService(deps: {
  driverRegistry: DriverRegistry;
  deviceRegistry: DeviceRegistry;
  settings: SettingsStore;
}) {
  const emitter = new EventEmitter();
  const candidates = new Map<string, DiscoveredDevice>();

  let running = false;
  let abortController: AbortController | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let cycleInProgress = false;

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

  /**
   * Удаляет из cache кандидатов с network signature, отличной от текущей.
   * Yandex-iot фильтруется по `householdId === activeHousehold`.
   * Возвращает количество удалённых записей.
   */
  const pruneStaleCandidates = (
    current: NetworkSignature,
    activeHousehold: string | null,
  ): number => {
    let pruned = 0;
    for (const [key, c] of candidates) {
      if (c.driver === 'yandex-iot') {
        if (activeHousehold && c.meta?.['householdId'] !== activeHousehold) {
          candidates.delete(key);
          pruned++;
        }
        continue;
      }
      if (!c.network) {
        candidates.delete(key);
        pruned++;
        continue;
      }
      if (!networkMatches(c.network as NetworkSignature, current)) {
        candidates.delete(key);
        pruned++;
      }
    }
    return pruned;
  };

  const runCycle = async (): Promise<void> => {
    if (cycleInProgress) return;
    cycleInProgress = true;

    abortController = new AbortController();
    const drivers = deps.driverRegistry.list();
    const cycleSignal = abortController.signal;
    const cycleStartedAt = Date.now();

    invalidateInterfaceCache();
    const currentNetwork = await detectCurrentNetwork();
    const bindings = deps.settings.get('householdNetworks');
    const boundHousehold = findHouseholdForNetwork(currentNetwork, bindings);
    const selectedHousehold = deps.settings.get('selectedHouseholdId');
    const householdFilter = boundHousehold ?? selectedHousehold ?? null;

    const pruned = pruneStaleCandidates(currentNetwork, householdFilter);
    if (pruned > 0) {
      log.info(`DiscoveryService: pruned ${pruned} stale candidates`);
    }

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

    const timeoutMs = Number(process.env['HUB_DISCOVERY_TIMEOUT_MS'] ?? 8000);
    const timeoutHandle = setTimeout(() => abortController?.abort(), timeoutMs);

    try {
      const abortPromise = new Promise<never>((_, reject) => {
        cycleSignal.addEventListener(
          'abort',
          () => reject(new DOMException('Discovery cycle aborted', 'AbortError')),
          { once: true },
        );
      });

      await Promise.all(
        drivers.map(async (driver) => {
          const driverStartedAt = Date.now();
          try {
            const found = await Promise.race([driver.discover(cycleSignal), abortPromise]);
            if (cycleSignal.aborted) {
              setDriverPhase(driver.id, {
                phase: 'idle',
                durationMs: Date.now() - driverStartedAt,
              });
              return;
            }

            const filtered =
              driver.id === 'yandex-iot' && householdFilter
                ? found.filter((c) => c.meta?.['householdId'] === householdFilter)
                : found;

            for (const c of filtered) {
              const key = `${c.driver}:${c.externalId}`;
              const known = deps.deviceRegistry.findByExternalId(c.driver, c.externalId);
              const enriched: DiscoveredDevice = {
                ...c,
                ...(known ? { knownDeviceId: known.id } : {}),
                ...(c.driver !== 'yandex-iot'
                  ? {
                      network: {
                        gatewayMac: currentNetwork.gatewayMac,
                        ssid: currentNetwork.ssid,
                        subnet: currentNetwork.subnet,
                      },
                    }
                  : {}),
              };
              candidates.set(key, enriched);
              emitter.emit('candidate', enriched);
            }
            setDriverPhase(driver.id, {
              phase: 'done',
              found: filtered.length,
              durationMs: Date.now() - driverStartedAt,
            });
          } catch (e) {
            const isAbort = (e as Error)?.name === 'AbortError';
            if (isAbort) {
              setDriverPhase(driver.id, {
                phase: 'idle',
                durationMs: Date.now() - driverStartedAt,
              });
              return;
            }
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

  const internalStop = (): void => {
    if (!running) return;
    running = false;
    abortController?.abort();
    if (intervalTimer) clearInterval(intervalTimer);
    intervalTimer = null;
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

    /** mode 'once' (default) — один цикл; 'continuous' — повтор каждые `HUB_DISCOVERY_INTERVAL_MS`. */
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
