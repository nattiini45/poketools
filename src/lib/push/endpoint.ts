/**
 * Which push-service endpoints PokéTools accepts (docs/push.md, "Endpoint allow-list").
 *
 * A subscription's `endpoint` is a URL the SERVER later POSTs to, so an unchecked one would turn the
 * subscribe route into a server-side request forgery primitive (internal hosts, metadata services, a
 * port scan through failure counts). Only https URLs on the browser vendors' push services pass:
 *
 * - Chrome, Edge, Opera, Brave, Android: `fcm.googleapis.com` (and `jmt17.google.com`, which current
 *   Chrome builds also hand out)
 * - Firefox: `*.push.services.mozilla.com`
 * - Edge and Windows: `*.notify.windows.com`
 * - Safari on macOS and iOS/iPadOS (Home Screen web apps): `web.push.apple.com`, `*.push.apple.com`
 *
 * Matching is on the parsed hostname, on a dot boundary (`evilfcm.googleapis.com` and
 * `fcm.googleapis.com.evil.test` both fail), with no credentials, no explicit port and no fragment.
 * When a vendor adds a host, a legitimate subscribe fails with `push_endpoint_not_allowed`: extend the
 * lists below and the test, nothing else.
 *
 * Pure and client-safe.
 */

export const PUSH_ENDPOINT_MAX_LENGTH = 1024;

/** Hosts matched exactly. */
const EXACT_HOSTS: readonly string[] = ['fcm.googleapis.com', 'jmt17.google.com', 'web.push.apple.com'];

/** Hosts matched as a subdomain (the label before the suffix is required). */
const HOST_SUFFIXES: readonly string[] = ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];

/** The parsed endpoint URL when it passes every check, else null. */
export function parsePushEndpoint(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > PUSH_ENDPOINT_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  // `new URL('https://host:443')` drops the default port, so a remaining port is a non-default one.
  if (url.port !== '') return null;
  if (url.hash !== '') return null;
  const host = url.hostname;
  const allowed = EXACT_HOSTS.includes(host) || HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
  return allowed ? url : null;
}

export function isAllowedPushEndpoint(raw: unknown): raw is string {
  return parsePushEndpoint(raw) !== null;
}

/** The push service's host, for logs (never the full endpoint: its path is the device's capability). */
export function pushEndpointHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return 'invalid';
  }
}
