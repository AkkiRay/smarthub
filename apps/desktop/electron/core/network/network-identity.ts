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

function detectSubnet(): string | null {
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs)) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}`;
      }
    }
  }
  return null;
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
