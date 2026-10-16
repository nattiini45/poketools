/** Example pack: UI defaults of the legacy `draft` format (evolution tiers, wildcards, tier limits). */
import type { FormatPack } from '@/lib/format-pack/types';

export const exampleDraftFormat = {
  tierLimitDefaults: { S: 1, A: 1, B: 2, C: 2 },
  newTier: { stage2Kos: 2, stage3Kos: 5, tier: 'C' },
  newWildcard: { stage2Kos: 2, stage3Kos: 5 },
  hintSpecies: ['Bulbasaur', 'Pichu'],
} satisfies FormatPack['draftFormat'];
