/**
 * Capability derivation: the same 15-flag shape as `getFormatCapabilities` in `src/lib/season/format-capabilities.ts`.
 *
 * A kit document starts with every flag off: attributes, cores and drafts do not exist in a Phase 1/2 document, so
 * `participantTypeAssignment` and `typeCores` are false on purpose (unlike the legacy baseline, where they are
 * true). Each `module.legacy` adapter then turns on the flags of the legacy format it stands for, flag by flag.
 *
 * `format-capabilities.ts` holds type imports only, which keeps this file browser-safe.
 */
import { getFormatCapabilities, type FormatCapabilities } from '@/lib/season/format-capabilities';
import type { FormatDefinition, LegacyModule } from '../types';

const FLAGS = Object.keys(getFormatCapabilities('singles')) as (keyof FormatCapabilities)[];

const ADAPTER_FORMAT = {
  epb: 'evolution_point_buy',
  legacy_draft: 'draft',
  core_liga: 'singles',
} as const satisfies Record<LegacyModule['adapter'], Parameters<typeof getFormatCapabilities>[0]>;

function emptyCapabilities(): FormatCapabilities {
  return Object.fromEntries(FLAGS.map((flag) => [flag, false])) as unknown as FormatCapabilities;
}

export function deriveCapabilities(def: FormatDefinition): FormatCapabilities {
  const result = emptyCapabilities();
  for (const legacyModule of def.modules) {
    const legacy = getFormatCapabilities(ADAPTER_FORMAT[legacyModule.adapter]);
    for (const flag of FLAGS) result[flag] = result[flag] || legacy[flag];
  }
  return result;
}
