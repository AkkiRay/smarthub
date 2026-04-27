/**
 * @fileoverview Active LAN-host probe для драйверов, чьи устройства не
 * отвечают на UDP-broadcast (TP-Link Tapo, некоторые legacy Hue moonshine).
 *
 * Перебирает все хосты `/24` каждого active LAN-интерфейса и пробует
 * `probeFn(host)` с ограничением concurrency. Хосты, на которых probe
 * resolve'ится в truthy — считаются «нашими». Default concurrency 16: не
 * нагружает Wi-Fi и не триггерит antivirus / IDS, при этом скан занимает
 * ~3–4 сек на спокойной /24.
 */

import { mapWithLimit } from '@smarthome/shared';
import { getActiveLanInterfaces, type LanInterface } from '../../network/lan-interfaces.js';

export interface SubnetProbeOptions<T> {
  /** Метка для grep'а в логах. */
  driverId: string;
  /** Per-host probe — должен возвращать описание устройства либо null. */
  probeFn: (host: string, signal: AbortSignal) => Promise<T | null>;
  /** Максимум одновременно открытых проб (default 16). */
  concurrency?: number;
  /** Внешний AbortSignal (discovery cycle). */
  signal: AbortSignal;
  /** Скипать default-gateway interface'ы? Default false (probe'им основной LAN). */
  skipDefault?: boolean;
}

const DEFAULT_CONCURRENCY = 16;

/**
 * Построить список IPv4-хостов в /24 (`a.b.c.1` .. `a.b.c.254`),
 * исключая адрес самого интерфейса. Сейчас поддерживается только /24:
 * для /16 это слишком много хостов, для /23 — нестандартно в SOHO LAN.
 */
function enumerateHosts(iface: LanInterface): string[] {
  const a = iface.address.split('.').map(Number);
  const m = iface.netmask.split('.').map(Number);
  if (a.length !== 4 || m.length !== 4 || a.some(Number.isNaN) || m.some(Number.isNaN)) return [];
  if (m[0] !== 255 || m[1] !== 255 || m[2] !== 255) return [];
  const prefix = `${a[0]}.${a[1]}.${a[2]}`;
  const ownLast = a[3];
  const hosts: string[] = [];
  for (let i = 1; i <= 254; i++) {
    if (i === ownLast) continue;
    hosts.push(`${prefix}.${i}`);
  }
  return hosts;
}

/**
 * Probe'ит /24-подсеть каждого active LAN-интерфейса параллельно, возвращает
 * список устройств для которых `probeFn` resolve'нулся в non-null. Закрывает
 * pending-probes при abort.
 */
export async function probeSubnet<T>(opts: SubnetProbeOptions<T>): Promise<T[]> {
  const interfaces = await getActiveLanInterfaces();
  const hosts = new Set<string>();
  for (const iface of interfaces) {
    if (opts.skipDefault && iface.hasDefaultGateway) continue;
    for (const h of enumerateHosts(iface)) hosts.add(h);
  }
  if (hosts.size === 0) return [];

  const results = await mapWithLimit(
    Array.from(hosts),
    opts.concurrency ?? DEFAULT_CONCURRENCY,
    async (host) => {
      if (opts.signal.aborted) return null;
      try {
        return await opts.probeFn(host, opts.signal);
      } catch {
        return null;
      }
    },
  );
  return results.filter((x): x is T => x !== null);
}
