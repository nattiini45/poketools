/** Example pack: Core Liga UI defaults (type cores, per-type quotas, the Eviolite cap). */
import type { FormatPack } from '@/lib/format-pack/types';

export const exampleCoreLiga = {
  newTripleDefault: ['Normal', 'Fighting', 'Flying'],
  typeQuotaDefault: { source: 'player_core', min: 1, multiCount: false },
  evioliteCapTierDefault: 'UU',
} satisfies FormatPack['coreLiga'];
