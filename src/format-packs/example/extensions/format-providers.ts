/**
 * The example pack's format providers: none (docs/format-packs.md, "Pack extensions"). The public app reads a
 * provider only when it is present, so this empty object keeps preset resolution exactly as it is without a pack.
 * A pack that ships format presets or rule-preset overrides adds an `extensions/format-providers.ts` of its own;
 * read it only through `@/lib/pack-extensions/format-providers`.
 */
import type { PackFormatProviders } from '@/lib/pack-extensions/types';

const exampleFormatProviders: PackFormatProviders = {};

export default exampleFormatProviders;