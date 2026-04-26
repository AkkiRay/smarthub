/** mDNS discovery колонок Алисы (`_yandexio._tcp.local`) на всех интерфейсах. */

import os from 'node:os';
import { Bonjour, type Service } from 'bonjour-service';
import log from 'electron-log/main.js';
import type { YandexStationCandidate } from '@smarthome/shared';
import { ALICE_TIMEOUT, YANDEX_STATION_MDNS_TYPE, YANDEX_STATION_PORT } from './constants.js';

export type YandexStationDiscovery = ReturnType<typeof createYandexStationDiscovery>;

/** Non-loopback non-link-local IPv4 интерфейсы для multi-iface mDNS scan. */
function listScanInterfaces(): string[] {
  const ips = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const [a, b] = iface.address.split('.').map(Number) as [number, number, number, number];
      if (a === 169 && b === 254) continue;
      if (a === 198 && (b === 18 || b === 19)) continue;
      ips.add(iface.address);
    }
  }
  return ips.size > 0 ? [...ips] : ['0.0.0.0'];
}

async function scanOnInterface(
  bindIp: string,
  timeoutMs: number,
  found: Map<string, YandexStationCandidate>,
): Promise<void> {
  // `interface` пробрасывается в multicast-dns, но `Partial<ServiceConfig>` в типах
  // bonjour-service v1.3.0 его не объявляет — каст безопасен, runtime принимает.
  const bonjour = new Bonjour({ interface: bindIp } as unknown as ConstructorParameters<typeof Bonjour>[0]);
  const browser = bonjour.find({ type: YANDEX_STATION_MDNS_TYPE });
  browser.on('up', (svc: Service) => {
    const candidate = parseService(svc);
    if (candidate) found.set(candidate.deviceId, candidate);
  });
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  } finally {
    try {
      browser.stop();
      bonjour.destroy();
    } catch (e) {
      log.warn(`Bonjour cleanup failed on ${bindIp}: ${(e as Error).message}`);
    }
  }
}

export function createYandexStationDiscovery() {
  return {
    /** Параллельный mDNS-browse на всех физических IPv4 интерфейсах. */
    async scan(timeoutMs: number = ALICE_TIMEOUT.MDNS_SCAN_MS): Promise<YandexStationCandidate[]> {
      const found = new Map<string, YandexStationCandidate>();
      const interfaces = listScanInterfaces();
      log.info(`YandexStationDiscovery: scanning ${interfaces.length} interface(s): ${interfaces.join(', ')}`);
      await Promise.all(interfaces.map((ip) => scanOnInterface(ip, timeoutMs, found)));
      return Array.from(found.values());
    },
  };
}

function parseService(svc: Service): YandexStationCandidate | null {
  const host = svc.referer?.address ?? svc.host ?? '';
  const port = svc.port ?? YANDEX_STATION_PORT;
  if (!host) return null;

  const txt = (svc.txt ?? {}) as Record<string, string | undefined>;
  const deviceId = txt['deviceId'] ?? svc.name;
  if (!deviceId) return null;

  return {
    deviceId,
    platform: txt['platform'] ?? 'unknown',
    name: txt['name'] ?? svc.name ?? deviceId,
    host,
    port,
  };
}
