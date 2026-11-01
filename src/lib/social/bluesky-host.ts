/**
 * Which Bluesky (AT Protocol) servers an integration may talk to.
 *
 * `credentials.service_url` is admin-supplied and the provider POSTs the
 * account's app password to it, so it is not a free-form URL: it must be an
 * https origin whose host is `bsky.social` or listed in the operator's
 * `BLUESKY_SERVICE_HOST_ALLOWLIST`. Everything else is refused with a distinct
 * reason, at write time and again at send time (a stored row may predate the
 * rule or have bypassed it). Pure: no I/O, no environment read.
 */

export const DEFAULT_BLUESKY_SERVICE_URL = 'https://bsky.social';
const DEFAULT_BLUESKY_HOST = 'bsky.social';

export type BlueskyServiceUrlRejection =
  | 'invalid_url'
  | 'not_https'
  | 'userinfo'
  | 'port'
  | 'path'
  | 'ip_literal'
  | 'local_host'
  | 'host_not_allowed';

export type BlueskyServiceUrlResult =
  | { ok: true; origin: string }
  | { ok: false; reason: BlueskyServiceUrlRejection };

const IPV4_LIKE = /^[\d.]+$/;

function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || IPV4_LIKE.test(hostname);
}

function isLocalName(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  );
}

/**
 * Whether the raw authority of an absolute URL carries a `:` port separator
 * (`host:443`, `host:`, `host:8443`), which `new URL` normalises away for the
 * default or an empty port. Mirrors the parser: tab/newline are dropped and
 * `\` ends the authority like `/`; userinfo is everything up to the last `@`;
 * a `:` inside an IPv6 literal's brackets is not a port.
 */
function hasExplicitPort(raw: string): boolean {
  const cleaned = raw.replace(/[\t\n\r]/g, '').trim();
  const afterScheme = cleaned.replace(/^[a-z][a-z0-9+.-]*:[/\\]*/i, '');
  const authority = afterScheme.split(/[/\\?#]/, 1)[0];
  const host = authority.slice(authority.lastIndexOf('@') + 1);
  const hostEnd = host.startsWith('[') ? host.indexOf(']') + 1 : 0;
  return host.indexOf(':', hostEnd) !== -1;
}

/**
 * The extra hosts an operator allows, from a comma-separated list. An entry
 * that is not a plain public hostname (an IP, `localhost`, `*.local`,
 * `*.internal`, a port, a scheme, a path) is dropped: the allowlist can widen
 * the set of providers, never reach a private address.
 */
export function parseHostAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  const hosts: string[] = [];
  for (const entry of raw.split(',')) {
    const host = entry.trim().toLowerCase();
    if (host === '' || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) continue;
    if (isIpLiteral(host) || isLocalName(host)) continue;
    hosts.push(host);
  }
  return hosts;
}

/**
 * Validate a stored or submitted `service_url`. An omitted or blank value means
 * the default server. On success `origin` is the `https://host` base the
 * provider appends `/xrpc/...` to.
 */
export function checkBlueskyServiceUrl(
  value: string | null | undefined,
  allowlist: readonly string[] = [],
): BlueskyServiceUrlResult {
  if (value === undefined || value === null || value.trim() === '') {
    return { ok: true, origin: DEFAULT_BLUESKY_SERVICE_URL };
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (url.username || url.password) return { ok: false, reason: 'userinfo' };
  // The parser drops `:443` and an empty `:`, so `url.port` cannot see them.
  if (url.port || hasExplicitPort(value)) return { ok: false, reason: 'port' };
  if (isIpLiteral(url.hostname)) return { ok: false, reason: 'ip_literal' };
  if (isLocalName(url.hostname)) return { ok: false, reason: 'local_host' };
  if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    return { ok: false, reason: 'path' };
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== DEFAULT_BLUESKY_HOST && !allowlist.includes(hostname)) {
    return { ok: false, reason: 'host_not_allowed' };
  }

  return { ok: true, origin: `https://${hostname}` };
}
