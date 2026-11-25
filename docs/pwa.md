# PWA (service worker support)

The client-safe pieces of the service worker (`public/sw.js`): the build id the worker is versioned with and the Cache Storage rules of the app shell. Nothing runs at module load; the worker itself is plain JS in `public/` and cannot import these — the lifecycle test runs both sides against one contract.

## File Structure

```
src/lib/pwa/
├── build-id.ts    # The build id the service worker is versioned with (NEXT_PUBLIC_BUILD_ID)
└── caches.ts      # Cache Storage owned by the worker: the poketools-shell-<build id> caches and the shell entries
```

## Core Functions/Classes

- **`build-id.ts`** — `NEXT_PUBLIC_BUILD_ID`, which `next.config.mjs` derives from `VERCEL_GIT_COMMIT_SHA` (`dev` locally). Reading it at call time keeps tests free of module-load state. A new build id means a new cache generation, so an old shell never serves a new deployment.
- **`caches.ts`** — every cache the worker creates starts with `poketools-shell-<build id>` (`PWA_CACHE_PREFIX`); `isPwaShellEntry()` names the entries kept for every visitor (the offline page and the static files served cache-first). Same rule as `isShellEntry` in `public/sw-routing.js` — the lifecycle test runs both against one worker.

## Testing

- **Test Files — `src/lib/pwa/`**: `src/lib/pwa/__tests__/` (4 test files): `build-id.test.ts`, `caches.test.ts`, `sw-offline-lifecycle.test.ts`, `sw-routing.test.ts`.
- **Running Tests**: `npx vitest run src/lib/pwa/__tests__`

## Related Modules

- [Push](./push.md) — web push, the other half of the worker's job.
- [Security Patterns](./security-patterns.md) — the caching rules of authenticated responses.
