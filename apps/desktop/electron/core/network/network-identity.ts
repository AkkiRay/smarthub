/**
 * @fileoverview Identity текущей сети — SSID (для Wi-Fi) + первые 24 бита
 * локального IPv4 (для wired-фолбэка). Используется чтобы понять, в каком
 * физическом доме находится хаб.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import log from 'electron-log/main.js';

const pexec = promisify(exec);
const SHELL_TIMEOUT_MS = 3_000;

export interface NetworkSignature {
  /** Wi-Fi SSID если detection возможен и активен Wi-Fi. */
  ssid: string | null;
  /** "192.168.1" — первые 3 октета первого non-loopback IPv4. */
  subnet: string | null;
  detectedAt: string;
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
 * RFC1918 private ranges + link-local. Скоринг:
 *   - 10.x / 172.16-31.x / 192.168.x → priority 0 (real LAN)
 *   - 169.254.x (link-local) → reject
 *   - 198.18-19.x (TEST-NET-2 / benchmarking) → reject (часто Hamachi/VPN)
 *   - 192.0.2.x / 198.51.100.x / 203.0.113.x (TEST-NETs) → reject
 *   - virtual-likely interface name (vEthernet, VirtualBox, VMware, Hyper-V) → priority 2
 *   - остальные не-loopback → priority 1 (включая публичные IPv4)
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
  const ssid = await detectSsid();
  const subnet = detectSubnet();
  return { ssid, subnet, detectedAt: new Date().toISOString() };
}

/** Match если SSIDы известны и равны, либо subnet'ы равны (fallback для wired). */
export function networkMatches(a: NetworkSignature, b: NetworkSignature): boolean {
  if (a.ssid && b.ssid) return a.ssid === b.ssid;
  if (a.subnet && b.subnet) return a.subnet === b.subnet;
  return false;
}

/** Поиск household, к которому привязана текущая сеть. */
export function findHouseholdForNetwork(
  current: NetworkSignature,
  bindings: Record<string, NetworkSignature[]>,
): string | null {
  for (const [householdId, sigs] of Object.entries(bindings)) {
    if (sigs.some((sig) => networkMatches(sig, current))) return householdId;
  }
  return null;
}
