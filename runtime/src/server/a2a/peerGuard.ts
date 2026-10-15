import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Outbound peer guard.
 *
 * Every A2A feature that reaches out — handshake probes, agent-card discovery,
 * pathway pings, task delegation — takes a peer-supplied URL. Unguarded, that is
 * a server-side request forgery primitive: on a hosted deployment a peer can aim
 * JACO at 169.254.169.254 and read the instance metadata credentials, or sweep
 * the provider's internal network from inside the perimeter.
 *
 * Policy enforced here:
 *  - http/https only, no credentials in the URL, no non-standard ports below 1024
 *    other than 80/443;
 *  - every resolved address is checked against private, loopback, link-local,
 *    CGNAT, multicast and unique-local ranges before the socket is opened;
 *  - loopback targets are allowed only when explicitly enabled (local dev and the
 *    documented loopback strategist bridges depend on it);
 *  - an optional host allowlist (JACO_A2A_PEER_HOSTS) narrows it further;
 *  - responses are bounded in time and size so a hostile peer cannot pin a
 *    request thread or feed an unbounded body into memory.
 */

export interface PeerGuardOptions {
  allowLoopback?: boolean;
  allowedHosts?: string[];
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface PeerCheck {
  allowed: boolean;
  reason?: string;
  url?: URL;
  resolvedAddresses?: string[];
}

const BLOCKED_V4 = [
  { cidr: '0.0.0.0/8', label: 'this-network' },
  { cidr: '10.0.0.0/8', label: 'private' },
  { cidr: '100.64.0.0/10', label: 'cgnat' },
  { cidr: '127.0.0.0/8', label: 'loopback' },
  { cidr: '169.254.0.0/16', label: 'link-local / cloud metadata' },
  { cidr: '172.16.0.0/12', label: 'private' },
  { cidr: '192.0.0.0/24', label: 'ietf-protocol' },
  { cidr: '192.168.0.0/16', label: 'private' },
  { cidr: '198.18.0.0/15', label: 'benchmark' },
  { cidr: '224.0.0.0/4', label: 'multicast' },
  { cidr: '240.0.0.0/4', label: 'reserved' },
];

function v4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inCidr(address: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const target = v4ToInt(address);
  const base = v4ToInt(range);
  if (target === null || base === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (target & mask) === (base & mask);
}

/** Classifies an IP literal. Returns null when the address is publicly routable. */
export function blockedAddressReason(address: string, allowLoopback: boolean): string | null {
  const version = net.isIP(address);
  if (version === 4) {
    if (allowLoopback && inCidr(address, '127.0.0.0/8')) return null;
    const hit = BLOCKED_V4.find((entry) => inCidr(address, entry.cidr));
    return hit ? `${address} is in a blocked range (${hit.label})` : null;
  }
  if (version === 6) {
    const normalised = address.toLowerCase().replace(/^\[|\]$/g, '');
    if (normalised === '::1') return allowLoopback ? null : '::1 is loopback';
    if (normalised === '::') return ':: is unspecified';
    if (normalised.startsWith('fe80')) return `${address} is link-local`;
    if (/^f[cd]/.test(normalised)) return `${address} is unique-local`;
    if (normalised.startsWith('ff')) return `${address} is multicast`;
    // IPv4-mapped: ::ffff:169.254.169.254 must not slip through.
    const mapped = normalised.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blockedAddressReason(mapped[1], allowLoopback);
    return null;
  }
  return `${address} is not a valid IP address`;
}

export function parsePeerHostAllowlist(raw: string | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export async function checkPeerUrl(rawUrl: string, options: PeerGuardOptions = {}): Promise<PeerCheck> {
  const allowLoopback = options.allowLoopback === true;

  let url: URL;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch {
    return { allowed: false, reason: 'peer endpoint is not a valid absolute URL' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { allowed: false, reason: `protocol ${url.protocol} is not permitted for peer traffic` };
  }
  if (url.username || url.password) {
    return { allowed: false, reason: 'credentials embedded in a peer URL are rejected' };
  }
  if (url.protocol === 'http:' && !allowLoopback) {
    return { allowed: false, reason: 'plaintext http is permitted only for loopback peers' };
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { allowed: false, reason: 'peer port is out of range' };
  }
  if (port < 1024 && port !== 80 && port !== 443) {
    return { allowed: false, reason: `privileged port ${port} is not permitted for peer traffic` };
  }

  const allowedHosts = options.allowedHosts ?? [];
  const hostname = url.hostname.toLowerCase();
  if (allowedHosts.length > 0) {
    const permitted = allowedHosts.some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
    if (!permitted) return { allowed: false, reason: `host ${hostname} is not in JACO_A2A_PEER_HOSTS` };
  }

  // Literal address: classify directly. Hostname: resolve every record first.
  if (net.isIP(hostname)) {
    const reason = blockedAddressReason(hostname, allowLoopback);
    return reason ? { allowed: false, reason } : { allowed: true, url, resolvedAddresses: [hostname] };
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return allowLoopback
      ? { allowed: true, url, resolvedAddresses: ['127.0.0.1'] }
      : { allowed: false, reason: 'localhost peers are disabled in this deployment' };
  }

  let addresses: string[];
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = records.map((record) => record.address);
  } catch (error) {
    return { allowed: false, reason: `peer hostname did not resolve: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (addresses.length === 0) return { allowed: false, reason: 'peer hostname resolved to no addresses' };

  for (const address of addresses) {
    const reason = blockedAddressReason(address, allowLoopback);
    if (reason) return { allowed: false, reason: `${hostname} resolves into a blocked range: ${reason}` };
  }

  return { allowed: true, url, resolvedAddresses: addresses };
}

export interface GuardedFetchResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  bodyText: string;
  truncated: boolean;
  contentType: string;
  error?: string;
  resolvedAddresses?: string[];
}

/**
 * Performs an outbound peer request only after the URL passes the guard, with a
 * hard timeout and a streamed size cap.
 *
 * Note on DNS rebinding: the guard resolves before the request and Node resolves
 * again when the socket opens, so a hostile resolver can in principle return a
 * different answer between the two. Deployments that treat peers as hostile
 * should also set JACO_A2A_PEER_HOSTS, which is enforced on the hostname itself
 * and is therefore not subject to that race.
 */
export async function guardedPeerFetch(
  rawUrl: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  options: PeerGuardOptions = {},
): Promise<GuardedFetchResult> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxResponseBytes = options.maxResponseBytes ?? 512_000;
  const started = Date.now();

  const check = await checkPeerUrl(rawUrl, options);
  if (!check.allowed || !check.url) {
    return { ok: false, status: 0, latencyMs: Date.now() - started, bodyText: '', truncated: false, contentType: '', error: check.reason };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(check.url, {
      method: init.method || 'GET',
      headers: { accept: 'application/json', ...(init.headers || {}) },
      body: init.body,
      signal: controller.signal,
      redirect: 'manual', // a redirect could aim at a blocked range that was never checked
    });

    const declared = Number(response.headers.get('content-length') || '0');
    if (declared > maxResponseBytes) {
      return {
        ok: false,
        status: response.status,
        latencyMs: Date.now() - started,
        bodyText: '',
        truncated: true,
        contentType: response.headers.get('content-type') || '',
        error: `peer response declares ${declared} bytes, over the ${maxResponseBytes} byte cap`,
        resolvedAddresses: check.resolvedAddresses,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const truncated = buffer.byteLength > maxResponseBytes;
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      bodyText: buffer.subarray(0, maxResponseBytes).toString('utf8'),
      truncated,
      contentType: response.headers.get('content-type') || '',
      resolvedAddresses: check.resolvedAddresses,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      bodyText: '',
      truncated: false,
      contentType: '',
      error: controller.signal.aborted ? `peer did not answer within ${timeoutMs} ms` : message,
      resolvedAddresses: check.resolvedAddresses,
    };
  } finally {
    clearTimeout(timer);
  }
}
