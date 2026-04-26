/**
 * @fileoverview Identity текущей сети: gateway MAC (надёжный) + SSID (Wi-Fi) +
 * subnet (слабый fallback). Match priority: MAC → SSID → subnet-only-if-no-ssid.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import log from 'electron-log/main.js';

const pexec = promisify(exec);
const SHELL_TIMEOUT_MS = 3_000;

export interface NetworkSignature {
  /** SHA-уникальный fingerprint роутера: lowercase `aa:bb:cc:dd:ee:ff`. */
  gatewayMac: string | null;
  /** Wi-Fi SSID если detection возможен и активен Wi-Fi. */
  ssid: string | null;
  /** "192.168.1" — первые 3 октета первого non-loopback IPv4. */
  subnet: string | null;
  detectedAt: string;
}

const MAC_REGEX = /([0-9a-f]{2}[:-][0-9a-f]{2}[:-][0-9a-f]{2}[:-][0-9a-f]{2}[:-][0-9a-f]{2}[:-][0-9a-f]{2})/i;
const normalizeMac = (raw: string): string => raw.replace(/-/g, ':').toLowerCase();

async function detectGatewayIp(): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await pexec('route print -4', { timeout: SHELL_TIMEOUT_MS });
      const m = stdout.match(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/m);
      return m?.[1] ?? null;
    }
    if (process.platform === 'darwin') {
      const { stdout } = await pexec('route -n get default', { timeout: SHELL_TIMEOUT_MS });
      const m = stdout.match(/gateway:\s+(\d+\.\d+\.\d+\.\d+)/);
      return m?.[1] ?? null;
    }
    if (process.platform === 'linux') {
      const { stdout } = await pexec('ip -4 route show default', { timeout: SHELL_TIMEOUT_MS });
      const m = stdout.match(/default via (\d+\.\d+\.\d+\.\d+)/);
      return m?.[1] ?? null;
    }
  } catch (e) {
    log.debug('detectGatewayIp failed', (e as Error).message);
  }
  return null;
}

async function detectGatewayMac(): Promise<string | null> {
  const gateway = await detectGatewayIp();
  if (!gateway) return null;
  try {
    if (process.platform === 'win32') {
      // ARP-prime через ping (1 echo, 200ms timeout) — без него запись может отсутствовать.
      await pexec(`ping -n 1 -w 200 ${gateway}`, { timeout: SHELL_TIMEOUT_MS }).catch(() => undefined);
      const { stdout } = await pexec(`arp -a ${gateway}`, { timeout: SHELL_TIMEOUT_MS });
      const m = stdout.match(MAC_REGEX);
      return m ? normalizeMac(m[1]!) : null;
    }
    if (process.platform === 'darwin') {
      const { stdout } = await pexec(`arp -n ${gateway}`, { timeout: SHELL_TIMEOUT_MS });
      const m = stdout.match(MAC_REGEX);
      return m ? normalizeMac(m[1]!) : null;
    }
    if (process.platform === 'linux') {
      const { stdout } = await pexec(`ip neigh show ${gateway}`, { timeout: SHELL_TIMEOUT_MS });
      const m = stdout.match(MAC_REGEX);
      return m ? normalizeMac(m[1]!) : null;
    }
  } catch (e) {
    log.debug('detectGatewayMac failed', (e as Error).message);
  }
  return null;
}

async function detectSsid(): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await pexec('netsh wlan show interfaces', { timeout: SHELL_TIMEOUT_MS });
      const m = stdout.match(/^\s*SSID\s+:\s+(.+)$/m);
      return m?.[1]?.trim() || null;
    }
    if (process.platform === 'darwin') {
      const { stdout } = await pexec(
        '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I',
        { timeout: SHELL_TIMEOUT_MS },
      );
      const m = stdout.match(/^\s+SSID:\s+(.+)$/m);
      return m?.[1]?.trim() || null;
    }
    if (process.platform === 'linux') {
      const { stdout } = await pexec('iwgetid -r', { timeout: SHELL_TIMEOUT_MS });
      return stdout.trim() || null;
    }
  } catch (e) {
    log.debug('detectSsid failed', (e as Error).message);
  }
  return null;
}

/**
 * Score: RFC1918 physical=0, RFC1918 virtual / public physical=1,
 * public virtual=2; reject link-local 169.254 + TEST-NETs (198.18/15, 192.0.2,
 * 198.51.100, 203.0.113). Меньше — лучше.
 */
function scoreInterface(name: string, ip: string): number | null {
  const [a, b] = ip.split('.').map(Number) as [number, number, number, number];
  if (a === 169 && b === 254) return null;
  if (a === 198 && (b === 18 || b === 19)) return null;
  if (a === 192 && b === 0 && Number(ip.split('.')[2]) === 2) return null;
  if (a === 198 && b === 51 && Number(ip.split('.')[2]) === 100) return null;
  if (a === 203 && b === 0 && Number(ip.split('.')[2]) === 113) return null;
  const isPrivate =
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  const isVirtual = /vethernet|virtualbox|vmware|hyper-?v|tap|tun|wsl|docker|loopback/i.test(name);
  if (isPrivate) return isVirtual ? 1 : 0;
  return isVirtual ? 2 : 1;
}

function detectSubnet(): string | null {
  const ifs = os.networkInterfaces();
  let best: { score: number; subnet: string } | null = null;
  for (const [name, list] of Object.entries(ifs)) {
    for (const iface of list ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const score = scoreInterface(name, iface.address);
      if (score === null) continue;
      const parts = iface.address.split('.');
      if (parts.length !== 4) continue;
      const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
      if (!best || score < best.score) best = { score, subnet };
    }
  }
  return best?.subnet ?? null;
}

export async function detectCurrentNetwork(): Promise<NetworkSignature> {
  const [ssid, gatewayMac] = await Promise.all([detectSsid(), detectGatewayMac()]);
  const subnet = detectSubnet();
  return { gatewayMac, ssid, subnet, detectedAt: new Date().toISOString() };
}

/**
 * Priority: gatewayMac → SSID → subnet (только если у обоих SSID нет, чтобы
 * не считать домашний и friendly Wi-Fi одной сетью только из-за общего 192.168.1.x).
 */
export function networkMatches(a: NetworkSignature, b: NetworkSignature): boolean {
  if (a.gatewayMac && b.gatewayMac) return a.gatewayMac === b.gatewayMac;
  if (a.ssid && b.ssid) return a.ssid === b.ssid;
  if (!a.ssid && !b.ssid && !a.gatewayMac && !b.gatewayMac && a.subnet && b.subnet) {
    return a.subnet === b.subnet;
  }
  return false;
}

/** Тип binding-записи (gatewayMac optional из-за legacy данных без него). */
export type StoredNetworkSignature = Omit<NetworkSignature, 'gatewayMac'> & {
  gatewayMac?: string | null;
};

const normalizeStored = (s: StoredNetworkSignature): NetworkSignature => ({
  gatewayMac: s.gatewayMac ?? null,
  ssid: s.ssid,
  subnet: s.subnet,
  detectedAt: s.detectedAt,
});

/** Поиск household, к которому привязана текущая сеть. */
export function findHouseholdForNetwork(
  current: NetworkSignature,
  bindings: Record<string, StoredNetworkSignature[]>,
): string | null {
  for (const [householdId, sigs] of Object.entries(bindings)) {
    if (sigs.some((sig) => networkMatches(normalizeStored(sig), current))) return householdId;
  }
  return null;
}
