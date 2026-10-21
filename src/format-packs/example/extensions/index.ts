/**
 * The example pack's extensions: none (docs/format-packs.md, "Pack extensions"). The public app
 * consults an extension member only when it is present, so this empty object keeps every page,
 * route and query budget exactly as it is without extensions. A pack that needs one adds an
 * `extensions/index.ts` of its own; read it only through `@/lib/pack-extensions`.
 */
import type { PackExtensions } from '@/lib/pack-extensions/types';

const exampleExtensions: PackExtensions = {};

export default exampleExtensions;
