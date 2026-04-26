/**
 * @fileoverview Multi-interface mDNS browser. Создаёт по `Bonjour` instance
 * на каждый active LAN interface, агрегирует найденные сервисы в общий Map,
 * деструктит instance'ы по timeout/abort.
 *
 * @example
 * ```ts
 * const services = await browseMdns({
 *   type: 'matterc', protocol: 'udp',
 *   timeoutMs: 6000, signal,
 * });
 * ```
 */

import { Bonjour, type Service } from 'bonjour-service';
import log from 'electron-log/main.js';
import { getActiveLanInterfaces } from '../../network/lan-interfaces.js';

export interface MdnsServiceLite {
  /** Service instance name из PTR-записи. */
  name: string;
  type: string;
  protocol: 'tcp' | 'udp';
  /** IPv4 из `referer.address` или `svc.host`. */
  host: string;
  port: number;
  txt: Record<string, string>;
  /** Имя interface'а через который пришёл response. */
  viaInterface: string;
}

export interface BrowseOptions {
  type: string;
  protocol?: 'tcp' | 'udp';
  /** Окно сбора responses. По умолчанию 5000. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Браузит mDNS на всех active LAN-интерфейсах параллельно. Дедуп по
 * `service.name`. Возвращает срез найденного по timeoutMs или abort.
 */
export async function browseMdns(opts: BrowseOptions): Promise<MdnsServiceLite[]> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const interfaces = await getActiveLanInterfaces();

  const found = new Map<string, MdnsServiceLite>();
  const instances: Array<{ bonjour: Bonjour; iface: string }> = [];

  const targets =
    interfaces.length > 0
      ? interfaces.map((i) => ({ ip: i.address, name: i.name }))
      : [{ ip: undefined as string | undefined, name: '0.0.0.0' }];

  for (const target of targets) {
    let bonjour: Bonjour;
    try {
      // `interface` отсутствует в типе ServiceConfig, но Bonjour прокидывает
      // opts в `multicast-dns(opts)`, который понимает `opts.interface`.
      const ctorOpts = (target.ip ? { interface: target.ip } : {}) as Record<string, unknown>;
      bonjour = new Bonjour(
        ctorOpts as never,
        (err: unknown) => log.debug(`[mdns:${target.name}] ${(err as Error).message ?? err}`),
      );
    } catch (e) {
      log.warn(`[mdns:${target.name}] new Bonjour failed: ${(e as Error).message}`);
      continue;
    }

    const browseConfig: { type: string; protocol?: 'tcp' | 'udp' } = { type: opts.type };
    if (opts.protocol) browseConfig.protocol = opts.protocol;

    try {
      const browser = bonjour.find(browseConfig);
      browser.on('up', (svc: Service) => {
        const host = svc.referer?.address ?? svc.host;
        if (!host || !svc.name) return;
        if (found.has(svc.name)) return;
        found.set(svc.name, {
          name: svc.name,
          type: svc.type,
          protocol: svc.protocol,
          host,
          port: svc.port ?? 0,
          txt: (svc.txt as Record<string, string>) ?? {},
          viaInterface: target.name,
        });
      });
      instances.push({ bonjour, iface: target.name });
    } catch (e) {
      log.warn(`[mdns:${target.name}] find(${opts.type}) failed: ${(e as Error).message}`);
      try {
        bonjour.destroy();
      } catch {
        /* best-effort */
      }
    }
  }

  return new Promise<MdnsServiceLite[]>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      for (const { bonjour } of instances) {
        try {
          bonjour.destroy();
        } catch {
          /* best-effort */
        }
      }
      resolve(Array.from(found.values()));
    };
    const timer = setTimeout(finish, timeoutMs);
    if (opts.signal) {
      if (opts.signal.aborted) {
        clearTimeout(timer);
        finish();
        return;
      }
      opts.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          finish();
        },
        { once: true },
      );
    }
  });
}
