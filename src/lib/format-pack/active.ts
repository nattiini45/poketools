/**
 * The active format pack (design spec §A). The ONLY module that imports `@format-pack`.
 *
 * `@format-pack` resolves to exactly one pack entry: in `next dev` / `next build` through
 * `turbopack.resolveAlias` (next.config.mjs, switchable with FORMAT_PACK), in Vitest per project
 * (vitest.config.ts: the public `app` project always gets the example pack), and for tsc, the IDE
 * and tsx through tsconfig `paths` (private first, then example). Both packs satisfy one contract
 * type, so type checking does not depend on which one is picked.
 *
 * The pack is validated at module load on the server (build, SSR, route handlers, scripts, Vitest)
 * and deep-frozen everywhere. Browser bundles skip the zod parse (`validate.browser.ts`): a pack
 * that fails validation already fails the build and the tests, and shipping zod to every route
 * cost about 70 kB gzip.
 */
import raw from '@format-pack';
import type { FormatPack } from './types';
// Server: the zod validator. Browser bundles: an identity (next.config.mjs aliases this path with
// the `browser` condition), so zod and the schema never reach a client bundle.
import { validatePack } from '@/lib/format-pack/validate';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const formatPack: FormatPack = deepFreeze(validatePack<FormatPack>(raw));
