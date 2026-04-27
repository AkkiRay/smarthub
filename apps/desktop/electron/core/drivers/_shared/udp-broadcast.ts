/**
 * @fileoverview Multi-interface UDP-broadcast discovery. Открывает по
 * `dgram` socket на каждый active LAN, биндит к IP интерфейса, шлёт payload
 * на directed broadcast (`192.168.1.255`) и опционально на `255.255.255.255`.
 * Слушает unicast-ответы до timeout/abort.
 *
 * @example
 * ```ts
 * await broadcastDiscover({
 *   driverId: 'lifx',
 *   port: 56700,
 *   payload: probePacket,
 *   timeoutMs: 2500,
 *   signal,
 *   onMessage: (msg, rinfo) => parseLifxState(msg, rinfo),
 * });
 * ```
 */

import { createSocket, type Socket as DgramSocket, type RemoteInfo } from 'node:dgram';
import log from 'electron-log/main.js';
import { getActiveLanInterfaces } from '../../network/lan-interfaces.js';

export interface BroadcastDiscoverOptions {
  /** UDP destination port. */
  port: number;
  /** Один payload для всех интерфейсов. */
  payload: Buffer;
  /** Окно ожидания responses. */
  timeoutMs: number;
  signal: AbortSignal;
  /** Callback на каждое входящее сообщение (включая non-protocol мусор). */
  onMessage: (msg: Buffer, rinfo: RemoteInfo) => void;
  /** Дублировать send на `255.255.255.255` (default true). */
  alsoLimitedBroadcast?: boolean;
  /** Метка для grep'а в логах. */
  driverId: string;
}

/**
 * Открывает socket на каждый interface, шлёт probe на directed broadcast
 * (и `255.255.255.255` если флаг включён), слушает входящие пакеты до
 * timeout либо abort. Закрытие сокетов гарантировано.
 */
export async function broadcastDiscover(opts: BroadcastDiscoverOptions): Promise<void> {
  const interfaces = await getActiveLanInterfaces();
  const sockets: DgramSocket[] = [];

  const targets =
    interfaces.length > 0
      ? interfaces.map((i) => ({ bind: i.address, broadcast: i.broadcast, name: i.name }))
      : [{ bind: undefined, broadcast: '255.255.255.255', name: '0.0.0.0' }];

  await new Promise<void>((resolve) => {
    let settled = false;
    let pendingBinds = targets.length;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      for (const sock of sockets) {
        try {
          sock.close();
        } catch {
          /* already closed */
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
          opts.onMessage(msg, rinfo);
        } catch (e) {
          log.debug(`[${opts.driverId}:${target.name}] onMessage threw: ${(e as Error).message}`);
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
        } catch (e) {
          log.debug(
            `[${opts.driverId}:${target.name}] setBroadcast failed: ${(e as Error).message}`,
          );
        }
        sock.send(opts.payload, 0, opts.payload.length, opts.port, target.broadcast, (err) => {
          if (err) {
            log.debug(
              `[${opts.driverId}:${target.name}] send to ${target.broadcast}:${opts.port} failed: ${err.message}`,
            );
          }
        });
        if (opts.alsoLimitedBroadcast !== false && target.broadcast !== '255.255.255.255') {
          sock.send(opts.payload, 0, opts.payload.length, opts.port, '255.255.255.255', (err) => {
            if (err) {
              log.debug(
                `[${opts.driverId}:${target.name}] send to 255.255.255.255:${opts.port} failed: ${err.message}`,
              );
            }
          });
        }
        pendingBinds--;
        if (pendingBinds === 0 && sockets.length === 0) finish();
      });
    }
  });
}
