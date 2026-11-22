/**
 * Next.js client instrumentation: `register()` runs in the browser once,
 * before hydration. It sets zod's `jitless` flag so the library never probes
 * `new Function`: the production CSP forbids it (report-only today, enforced
 * under `CSP_ENFORCE`), and even the caught probe posts a `script-src`
 * violation report (`securitypolicyviolation`). With `jitless` zod validates
 * interpreted — the probe never runs, so nothing reaches `/api/csp-report`.
 * The server bundle keeps JIT: this file ships only to the client.
 *
 * The flag is written straight to `globalThis.__zod_globalConfig` — the
 * object zod's own `z.config()` assigns into — instead of importing zod
 * here, which would pull zod into the client runtime of every route (the
 * repo keeps browser code zod-free; see docs/format-kit.md's client
 * boundary). `allowsEval` reads the flag at probe time, so writing it before
 * hydration is enough; no zod module needs to be loaded first.
 *
 * Issue: #137 (the teambuilder's two eval-policy reports after a format fork
 * came from zod's `allowsEval` feature detection, not a dependency bug).
 */

declare global {
  var __zod_globalConfig: { jitless?: boolean } | undefined;
}

export function register(): void {
  // Mutate, never replace: zod's `globalConfig` export captures the object
  // identity at module load, so assigning a new object leaves zod's copy stale.
  const config = (globalThis.__zod_globalConfig ??= {});
  config.jitless = true;
}
