/**
 * The build id the service worker is versioned with: `NEXT_PUBLIC_BUILD_ID`, which `next.config.mjs` derives from
 * `VERCEL_GIT_COMMIT_SHA` (`dev` locally). It is not a variable anyone sets. Reading it at call time keeps tests free
 * of module-load state.
 */
export function pwaBuildId(): string {
  const raw = (process.env.NEXT_PUBLIC_BUILD_ID ?? '').trim();
  return /^[A-Za-z0-9._-]{1,64}$/.test(raw) ? raw : 'dev';
}
