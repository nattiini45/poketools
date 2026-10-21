/**
 * Namespace `draft/legacy/league-admin` (DL-UI-2, draft-frontend §8.5): terms shared by the
 * legacy league draft admin components in `src/components/league/`. The component texts live in
 * the sub-namespaces `pool` (pool, tier limits, point-buy list, workbook import), `evolution`
 * (evolution tiers, evolution points, draft-token admin) and `retired` (components DF7b unmounts
 * and the sweep deletes).
 */
export default {
  /** A power tier label: "S-Tier". */
  tier: '{tier}-Tier',
  pokemonCount: { one: '{count} Pokémon', other: '{count} Pokémon' },
} as const;
