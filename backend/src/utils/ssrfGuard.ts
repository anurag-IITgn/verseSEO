import { lookup } from 'node:dns/promises';
import { AppError } from './errors.js';

interface IpRange {
  start: number;
  end: number;
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const PRIVATE_IPV4_RANGES: IpRange[] = [
  { start: ipv4ToInt('0.0.0.0'), end: ipv4ToInt('0.255.255.255') }, // "this network"
  { start: ipv4ToInt('10.0.0.0'), end: ipv4ToInt('10.255.255.255') }, // RFC1918
  { start: ipv4ToInt('100.64.0.0'), end: ipv4ToInt('100.127.255.255') }, // CGNAT
  { start: ipv4ToInt('127.0.0.0'), end: ipv4ToInt('127.255.255.255') }, // loopback
  { start: ipv4ToInt('169.254.0.0'), end: ipv4ToInt('169.254.255.255') }, // link-local
  { start: ipv4ToInt('172.16.0.0'), end: ipv4ToInt('172.31.255.255') }, // RFC1918
  { start: ipv4ToInt('192.0.0.0'), end: ipv4ToInt('192.0.0.255') }, // IETF protocol assignments
  { start: ipv4ToInt('192.0.2.0'), end: ipv4ToInt('192.0.2.255') }, // documentation
  { start: ipv4ToInt('192.168.0.0'), end: ipv4ToInt('192.168.255.255') }, // RFC1918
  { start: ipv4ToInt('198.18.0.0'), end: ipv4ToInt('198.19.255.255') }, // benchmarking
  { start: ipv4ToInt('198.51.100.0'), end: ipv4ToInt('198.51.100.255') }, // documentation
  { start: ipv4ToInt('203.0.113.0'), end: ipv4ToInt('203.0.113.255') }, // documentation
  { start: ipv4ToInt('224.0.0.0'), end: ipv4ToInt('239.255.255.255') }, // multicast
  { start: ipv4ToInt('240.0.0.0'), end: ipv4ToInt('255.255.255.255') }, // reserved
];

export function isPrivateIpv4(ip: string): boolean {
  const int = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some((range) => int >= range.start && int <= range.end);
}

function ipv6ToLower(ip: string): string {
  return ip.toLowerCase();
}

export function isPrivateIp(ip: string): boolean {
  const value = ip.trim();

  // IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1.
  const v4Mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) {
    return isPrivateIpv4(v4Mapped[1]);
  }

  if (value.includes(':')) {
    const lower = ipv6ToLower(value);
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true; // link-local
    }
    if (lower === '::') return true; // unspecified
    if (lower.startsWith('::ffff:') === false && lower.startsWith('2001:db8:')) return true; // documentation
    return false;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    return isPrivateIpv4(value);
  }

  return false;
}

const LOCAL_HOSTNAMES = new Set(['localhost']);

export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost');
}

/**
 * Rejects hostnames that resolve (or are clearly known) to loopback, private,
 * link-local, or otherwise non-public addresses. Used to prevent SSRF against
 * localhost/private/internal network targets when initiating a crawl.
 */
export async function assertPublicTargetHostname(hostname: string): Promise<void> {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) {
    throw new AppError(400, 'Invalid website URL', 'INVALID_URL');
  }

  if (isLocalHostname(host)) {
    throw new AppError(400, 'Local and private network URLs are not allowed', 'SSRF_BLOCKED');
  }

  let addresses: string[];
  try {
    addresses = (await lookup(host, { all: true })).map((entry) => entry.address);
  } catch {
    // The host does not resolve. Let the crawl fail naturally rather than blocking.
    return;
  }

  if (addresses.some(isPrivateIp)) {
    throw new AppError(400, 'Local and private network URLs are not allowed', 'SSRF_BLOCKED');
  }
}

export async function assertPublicTargetUrl(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  await assertPublicTargetHostname(url.hostname);
}