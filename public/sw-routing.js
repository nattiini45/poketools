/*
 * Which requests the service worker (`sw.js`) touches, as pure functions. `sw.js` loads this with
 * `importScripts`, and the Vitest suite runs the same file (src/lib/pwa/__tests__/sw-routing.test.ts),
 * so the policy below is tested without a browser. No `self`, `caches` or `fetch` in here.
 */
(function (root) {
  'use strict';

  // Content-hashed build output and the fixed PWA icons: the only things served cache-first.
  var STATIC_PREFIXES = ['/_next/static/', '/pwa/'];

  /** True only for `/_next/static/**` and `/pwa/**`. Images, avatars and fonts from anywhere else are never stored. */
  function isStaticAsset(pathname) {
    for (var i = 0; i < STATIC_PREFIXES.length; i++) {
      if (pathname.indexOf(STATIC_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  /**
   * Whether a navigation response may be written to Cache Storage. Never: the HTML of `/dashboard`, `/admin`, a
   * shared team link or any signed-in page would outlive the session and show the next person on the device
   * the previous viewer's data. A failed navigation falls back to `/offline.html` instead.
   */
  function shouldCacheNavigation() {
    return false;
  }

  /**
   * How the worker handles a request: 'navigation' (network first, `/offline.html` when the network is gone),
   * 'static' (cache first) or 'pass' (not intercepted).
   */
  function routeRequest(request, origin) {
    if (request.method !== 'GET') return 'pass';
    var url = new URL(request.url);
    if (url.origin !== origin) return 'pass';
    if (url.pathname.indexOf('/api/') === 0) return 'pass';
    if (request.mode === 'navigate') return 'navigation';
    return isStaticAsset(url.pathname) ? 'static' : 'pass';
  }

  var api = { isStaticAsset: isStaticAsset, shouldCacheNavigation: shouldCacheNavigation, routeRequest: routeRequest };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PokeToolsSwRouting = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);
