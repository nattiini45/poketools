/** Name of the request header the proxy (`src/proxy.ts`) sets to the requested path and query (issue #56). */
export const REQUEST_PATH_HEADER = 'x-poketools-path';

/**
 * The path and query a visitor asked for, as the proxy records it. Next's internal `_rsc` cache-busting parameter is
 * dropped: it belongs to a client navigation, not to the page the visitor wants to come back to.
 */
export function requestPathOf(url: { pathname: string; searchParams: URLSearchParams }): string {
  const params = new URLSearchParams(url.searchParams);
  params.delete('_rsc');
  const query = params.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}
