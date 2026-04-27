/**
 * @fileoverview Утиль для `module.probe()`: создаёт временный driver instance
 * с переданными creds, делает один `discover()`-запрос с timeout и cleanup'ит
 * сокеты через `shutdown()`. Используется UI-кнопкой «Проверить подключение».
 *
 * Не подходит для драйверов, у которых `discover()` запускает long-running
 * подписки (WS-streams) — там надо писать кастомный probe.
 */

import type { DeviceDriver, DriverProbeResult } from '@smarthome/shared';

export interface ProbeViaDiscoverOptions {
  /** Timeout для discover-call'а; default 8s. */
  timeoutMs?: number;
  /** Sub-message при успехе; default — `Найдено устройств: N`. */
  successMessageFor?: (count: number) => string;
}

/**
 * Builds a tmp driver, runs discover, returns probe-result. На исключения от
 * сети или auth — возвращает `{ ok: false, message }` без throw.
 */
export async function probeViaDiscover(
  buildDriver: () => Promise<DeviceDriver | null>,
  opts: ProbeViaDiscoverOptions = {},
): Promise<DriverProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const successFor =
    opts.successMessageFor ?? ((n: number) => `Подключение работает. Найдено устройств: ${n}`);

  let driver: DeviceDriver | null = null;
  try {
    driver = await buildDriver();
  } catch (e) {
    return { ok: false, message: (e as Error).message ?? 'Не удалось создать драйвер' };
  }
  if (!driver) {
    return { ok: false, message: 'Заполните обязательные поля' };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const found = await driver.discover(ac.signal);
    return { ok: true, message: successFor(found.length) };
  } catch (e) {
    return { ok: false, message: (e as Error).message ?? 'Сервер не ответил' };
  } finally {
    clearTimeout(timer);
    try {
      await driver.shutdown();
    } catch {
      /* shutdown best-effort */
    }
  }
}
