/**
 * @fileoverview Multi-interface SSDP M-SEARCH. На каждом active LAN
 * interface создаёт `dgram` socket, биндит к IP интерфейса, joinит multicast
 * group и шлёт M-SEARCH. Дедуп ответов — забота вызывающего (по `USN`/`ID`).
 */

import { createSocket, type Socket as DgramSocket, type RemoteInfo } from 'node:dgram';
import log from 'electron-log/main.js';
import { getActiveLanInterfaces } from '../../network/lan-interfaces.js';

export interface SsdpDiscoverOptions {
  /** Значение SSDP `ST:` header (например `wifi_bulb`, `urn:Belkin:device:**`). */
  st: string;
  /** Дополнительные headers (HOST/MAN ставятся автоматически). */
  extraHeaders?: Record<string, string>;
  /** Multicast IP. По умолчанию `239.255.255.250`. */
  multicastAddr?: string;
  /** Multicast port. По умолчанию 1900 (UPnP); для Yeelight — 1982. */
  multicastPort?: number;
  /** Окно ожидания ответов. */
  timeoutMs: number;
  signal: AbortSignal;
  onResponse: (text: string, rinfo: RemoteInfo) => void;
  driverId: string;
}

const DEFAULT_MCAST_ADDR = '239.255.255.250';
const DEFAULT_MCAST_PORT = 1900;

/**
 * Шлёт M-SEARCH на каждом active LAN-интерфейсе с явным `addMembership` +
 * `setMulticastInterface` для bind'а multicast egress на нужный adapter.
 */
export async function ssdpDiscover(opts: SsdpDiscoverOptions): Promise<void> {
  const mcastAddr = opts.multicastAddr ?? DEFAULT_MCAST_ADDR;
  const mcastPort = opts.multicastPort ?? DEFAULT_MCAST_PORT;
  const interfaces = await getActiveLanInterfaces();
  const sockets: DgramSocket[] = [];

  const targets =
    interfaces.length > 0
      ? interfaces.map((i) => ({ bind: i.address, name: i.name }))
      : [{ bind: undefined as string | undefined, name: '0.0.0.0' }];

  const headers: Record<string, string> = {
    HOST: `${mcastAddr}:${mcastPort}`,
    MAN: '"ssdp:discover"',
    MX: '2',
    ST: opts.st,
    ...(opts.extraHeaders ?? {}),
  };
  const message =
    `M-SEARCH * HTTP/1.1\r\n` +
    Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n') +
    '\r\n\r\n';
  const payload = Buffer.from(message, 'utf8');

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      for (const sock of sockets) {
        try {
          sock.close();
        } catch {
          /* closed */
        }
      }
      resolve();
    };

    const timer = setTimeout(finish, opts.timeoutMs);
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

    for (const target of targets) {
      const sock = createSocket({ type: 'udp4', reuseAddr: true });
      sockets.push(sock);

      sock.on('message', (msg, rinfo) => {
        try {
          opts.onResponse(msg.toString('utf8'), rinfo);
        } catch (e) {
          log.debug(`[${opts.driverId}:${target.name}] onResponse threw: ${(e as Error).message}`);
        }
      });
      sock.on('error', (err) => {
        log.debug(`[${opts.driverId}:${target.name}] socket error: ${err.message}`);
      });

      const bindOpts: { port: number; address?: string; exclusive?: boolean } = {
        port: 0,
        ...(target.bind ? { address: target.bind } : {}),
        exclusive: false,
      };
      sock.bind(bindOpts, () => {
        try {
          sock.setBroadcast(true);
          if (target.bind) {
            sock.addMembership(mcastAddr, target.bind);
            sock.setMulticastInterface(target.bind);
          } else {
            try {
              sock.addMembership(mcastAddr);
            } catch {
              /* fallback: unicast-ответы всё равно дойдут */
            }
          }
        } catch (e) {
          log.debug(
            `[${opts.driverId}:${target.name}] multicast setup failed: ${(e as Error).message}`,
          );
        }
        sock.send(payload, 0, payload.length, mcastPort, mcastAddr, (err) => {
          if (err) {
            log.debug(
              `[${opts.driverId}:${target.name}] M-SEARCH to ${mcastAddr}:${mcastPort} failed: ${err.message}`,
            );
          }
        });
      });
    }
  });
}
