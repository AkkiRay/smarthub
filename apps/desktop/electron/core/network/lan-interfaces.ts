/**
 * @fileoverview Enumeration активных LAN-интерфейсов с фильтром виртуальных
 * adapter'ов. Используется discovery-сокетами для bind'а на конкретный IP
 * (mDNS, UDP-broadcast, SSDP).
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import log from 'electron-log/main.js';

const pexec = promisify(exec);
const SHELL_TIMEOUT_MS = 2_000;

const VIRTUAL_NAME = /vethernet|vmware|hyper-?v|wsl|docker|virtualbox|vbox|tap|tun|loopback|nordlynx|tailscale|zerotier|wireguard/i;
const HYPER_V_OUI = /^00:15:5d/i;

export interface LanInterface {
  /** Системное имя интерфейса (`Wi-Fi`, `Ethernet 2`, `eth0`). */
  name: string;
  /** IPv4-адрес интерфейса. */
  address: string;
  /** Netmask для расчёта directed broadcast. */
  netmask: string;
  /** Directed broadcast (`192.168.1.255`) для отправки UDP на этот сегмент. */
  broadcast: string;
  /** MAC в lowercase формате `aa:bb:cc:dd:ee:ff`. */
  mac: string;
  /** true если на интерфейсе зарегистрирован default route. */
  hasDefaultGateway: boolean;
}

/** Directed broadcast: `address | ~netmask`. */
function computeBroadcast(address: string, netmask: string): string {
  const a = address.split('.').map(Number);
  const m = netmask.split('.').map(Number);
  if (a.length !== 4 || m.length !== 4 || a.some(isNaN) || m.some(isNaN)) {
    return '255.255.255.255';
  }
  const out: number[] = [];
  for (let i = 0; i < 4; i++) out.push((a[i]! & m[i]!) | (~m[i]! & 0xff));
  return out.join('.');
}

/** IP всех default gateway'ев системы. На Windows может быть несколько. */
async function getDefaultGateways(): Promise<string[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await pexec('route print -4', { timeout: SHELL_TIMEOUT_MS });
      const out: string[] = [];
      const re = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(stdout)) !== null) {
        if (m[1] && !out.includes(m[1])) out.push(m[1]);
      }
      return out;
    }
    if (process.platform === 'darwin') {
      const { stdout } = await pexec('netstat -rn -f inet', { timeout: SHELL_TIMEOUT_MS });
      const m = stdout.match(/^default\s+(\d+\.\d+\.\d+\.\d+)/m);
      return m ? [m[1]!] : [];
    }
    if (process.platform === 'linux') {
      const { stdout } = await pexec('ip -4 route show default', { timeout: SHELL_TIMEOUT_MS });
      const m = stdout.match(/default via (\d+\.\d+\.\d+\.\d+)/);
      return m ? [m[1]!] : [];
    }
  } catch (e) {
    log.debug('getDefaultGateways failed', (e as Error).message);
  }
  return [];
}

/** Принадлежит ли `ip` подсети `address/netmask`. */
function ipInSubnet(ip: string, address: string, netmask: string): boolean {
  const ipParts = ip.split('.').map(Number);
  const addrParts = address.split('.').map(Number);
  const maskParts = netmask.split('.').map(Number);
  if (ipParts.length !== 4 || addrParts.length !== 4 || maskParts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    if ((ipParts[i]! & maskParts[i]!) !== (addrParts[i]! & maskParts[i]!)) return false;
  }
  return true;
}

let cache: { value: LanInterface[]; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

/** Сбросить cache (вызывается при старте discovery cycle и смене Wi-Fi). */
export function invalidateInterfaceCache(): void {
  cache = null;
}

/**
 * Active LAN-интерфейсы с TTL-cache 30s. Default-gateway interface всегда
 * первым в массиве. Виртуальные adapter'ы (vEthernet/Hyper-V/WSL/VBox/
 * Tailscale/WireGuard), link-local 169.254.x.x и интерфейсы с Hyper-V
 * MAC OUI (00:15:5d) исключаются.
 */
export async function getActiveLanInterfaces(): Promise<LanInterface[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const gateways = await getDefaultGateways();
  const ifaces = os.networkInterfaces();
  const result: LanInterface[] = [];

  for (const [name, list] of Object.entries(ifaces)) {
    if (!list || VIRTUAL_NAME.test(name)) continue;
    for (const iface of list) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (iface.address.startsWith('169.254.')) continue;
      if (HYPER_V_OUI.test(iface.mac ?? '')) continue;
      const broadcast = computeBroadcast(iface.address, iface.netmask);
      const hasDefaultGateway = gateways.some((g) =>
        ipInSubnet(g, iface.address, iface.netmask),
      );
      result.push({
        name,
        address: iface.address,
        netmask: iface.netmask,
        broadcast,
        mac: (iface.mac ?? '').toLowerCase(),
        hasDefaultGateway,
      });
    }
  }

  result.sort((a, b) => Number(b.hasDefaultGateway) - Number(a.hasDefaultGateway));

  cache = { value: result, at: Date.now() };
  if (result.length === 0) {
    log.warn('lan-interfaces: no active LAN found, discovery будет работать через 0.0.0.0');
  } else {
    log.info(
      `lan-interfaces: ${result.map((i) => `${i.name}=${i.address}${i.hasDefaultGateway ? '*' : ''}`).join(', ')}`,
    );
  }
  return result;
}

/** Default-gateway interface либо null если LAN недоступен. */
export async function getPrimaryLanInterface(): Promise<LanInterface | null> {
  const list = await getActiveLanInterfaces();
  return list[0] ?? null;
}
