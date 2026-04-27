/**
 * @fileoverview SSRF/network-egress-фильтры для драйверов, ходящих по
 * URL'ам, которые SSDP/mDNS/upnp могут подсунуть.
 *
 * Атакующий в LAN способен advertise'ить SSDP-LOCATION на внутренний admin-IP
 * (например `http://10.0.0.1:8080/management`) — драйвер послушно скачает
 * содержимое и выложит его в логи/UI. Гард ограничивает egress LAN-CIDR'ами:
 * 10/8, 172.16/12, 192.168/16, 169.254/16 (link-local), 127/8, fd00::/8.
 */

const PRIVATE_V4_RANGES: Array<{ start: bigint; end: bigint }> = [
  v4Range('10.0.0.0', 8),
  v4Range('172.16.0.0', 12),
  v4Range('192.168.0.0', 16),
  v4Range('169.254.0.0', 16), // link-local
  v4Range('127.0.0.0', 8), // loopback
];

function v4Range(base: string, prefix: number): { start: bigint; end: bigint } {
  const baseInt = ipv4ToInt(base);
  const mask = prefix === 0 ? 0n : (~0n << BigInt(32 - prefix)) & 0xffffffffn;
  const start = baseInt & mask;
  const end = start | (~mask & 0xffffffffn);
  return { start, end };
}

function ipv4ToInt(ip: string): bigint {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) {
    return -1n;
  }
  return (
    (BigInt(parts[0]!) << 24n) |
    (BigInt(parts[1]!) << 16n) |
    (BigInt(parts[2]!) << 8n) |
    BigInt(parts[3]!)
  );
}

/**
 * Возвращает true если hostname — IPv4 в private/loopback-диапазоне ИЛИ
 * IPv6 link-local/loopback/ULA. Public-IP / DNS-имена вне `*.local`/`*.lan`/
 * `*.home` отвергаются (driver-discovery работает только в LAN).
 */
export function isPrivateLanHost(hostname: string): boolean {
  if (!hostname || typeof hostname !== 'string') return false;
  // IPv4 literal.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const v = ipv4ToInt(hostname);
    if (v < 0n) return false;
    return PRIVATE_V4_RANGES.some((r) => v >= r.start && v <= r.end);
  }
  // IPv6 literal.
  if (hostname.includes(':')) {
    const lower = hostname.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fd') || lower.startsWith('fc')) return true;
    return false;
  }
  // mDNS / LAN-style names.
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower.endsWith('.local') ||
    lower.endsWith('.lan') ||
    lower.endsWith('.home') ||
    lower.endsWith('.local.')
  );
}

/**
 * Throws если URL ведёт за пределы LAN-CIDR'ов.
 *
 * Использовать перед axios.get/fetch на user-controlled / SSDP-controlled URL.
 */
export function assertPrivateLanUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refused non-HTTP scheme: ${parsed.protocol}`);
  }
  if (!isPrivateLanHost(parsed.hostname)) {
    throw new Error(`Refused egress to non-LAN host: ${parsed.hostname}`);
  }
  return parsed;
}
