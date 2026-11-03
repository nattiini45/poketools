import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextConfig } from 'next';

// Next's work-store module picks a stub unless the runtime exposes this global, as its own servers do.
Object.assign(globalThis, { AsyncLocalStorage });
const { unstable_getResponseFromNextConfig: responseFromNextConfig } = await import('next/experimental/testing/server');

/** The headers `next.config.mjs` adds to a request for `path`, as the framework's own route matching resolves them. */
export async function nextConfigHeaders(path: string) {
  const { default: nextConfig } = await import('../../../../next.config.mjs');
  const response = await responseFromNextConfig({
    url: `https://poketools.test${path}`,
    nextConfig: nextConfig as NextConfig,
  });
  return response.headers;
}
