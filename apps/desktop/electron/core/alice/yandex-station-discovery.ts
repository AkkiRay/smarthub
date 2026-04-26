/** mDNS discovery колонок Алисы (`_yandexio._tcp.local`). */

import { Bonjour, type Service } from 'bonjour-service';
import log from 'electron-log/main.js';
import type { YandexStationCandidate } from '@smarthome/shared';
import { ALICE_TIMEOUT, YANDEX_STATION_MDNS_TYPE, YANDEX_STATION_PORT } from './constants.js';

export type YandexStationDiscovery = ReturnType<typeof createYandexStationDiscovery>;

export function createYandexStationDiscovery() {
  return {
    /** Bonjour browser на `timeoutMs`; собирает кандидатов в Map по deviceId. */
    async scan(timeoutMs: number = ALICE_TIMEOUT.MDNS_SCAN_MS): Promise<YandexStationCandidate[]> {
      const bonjour = new Bonjour();
      const found = new Map<string, YandexStationCandidate>();
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
          log.warn(`Bonjour cleanup failed: ${(e as Error).message}`);
        }
      }
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
