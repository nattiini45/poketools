import { getGeneration, listNationalSpecies } from './dex';
import { getPreset, getTierInfo } from './format-catalog';
import { parseFormatId } from './format-id';
import { resolvePresetRules } from './preset-rules.server';
import type { SpeciesSearchResult } from './dex';

// ── Format-aware species listing ────────────────────────────────────
//
// Server-only (imports @pkmn/dex transitively). Enriches the full-dex listing
// with a display `tier` and a `legal` flag for a given format so the
// teambuilder picker can show tiers, sort by them, group by them, and hide
// Pokémon that are illegal in the selected meta.
//
// A National Dex preset (`universe: 'national'` in the catalog) lists the generation's whole National Dex, past
// species included (`listNationalSpecies`); every other format lists the generation's own species. Legality
// comes from the preset's resolved rules (`resolvePresetRules`): a banned Pokémon is illegal, and where the
// preset lists the legal Pokémon instead (a roster, Little Cup, NFE) only those are legal.
//
// This is a leaf module: it depends on dex.ts + the preset rules but nothing here
// depends on it, avoiding the dex → formats → tiers → dex cycle that would
// arise from extending dex.ts directly.

export interface FormatSpeciesListItem extends SpeciesSearchResult {
  /** Display tier: 'OU', 'UUBL', 'NFE', 'LC', 'DOU', … ; null = untiered/illegal-marker */
  tier: string | null;
  /** Legal in the supplied format. Always true when no format is supplied. */
  legal: boolean;
}

// Raw tiers that mean "no competitive classification" → display as untiered.
const UNTIERED_RAW = new Set(['Illegal', 'Unreleased']);

/**
 * Normalise a raw `species.tier` value to a display tier.
 *
 * Deliberately differs from `normalizeTier` in `./tiers.ts` (which maps NFE/LC
 * to null for the constraint engine) — here NFE/LC are kept as display values.
 * Parenthesised tiers (`'(PU)'`, `'(DUU)'`, …) historically mean "unused in
 * this tier" and collapse to the lowest tier of the active family.
 */
function toDisplayTier(raw: string | undefined | null, isDoubles: boolean): string | null {
  if (!raw) return null;
  if (UNTIERED_RAW.has(raw)) return null;
  if (raw.startsWith('(') && raw.endsWith(')')) return isDoubles ? 'DPU' : 'ZU';
  return raw;
}

/**
 * List every species in a generation, enriched with display tier and legality
 * for `format`. When `format` is absent/unparseable, every species is legal and
 * tier comes from the standard singles `tier` field.
 */
export function listSpeciesForFormat(
  gen: number,
  format?: string | null,
): FormatSpeciesListItem[] {
  const parsed = format ? parseFormatId(format) : null;
  const tierKey = parsed !== null && parsed.key !== '' ? parsed.key : null;
  const preset = format ? getPreset(format) : undefined;
  const national = preset?.universe === 'national';

  // Which @pkmn tier field drives the display tier for this format family: doubles formats read the doubles tier,
  // the National Dex singles formats the National Dex tier.
  const isDoubles = tierKey !== null && getTierInfo(tierKey)?.is_doubles === true;
  const tierField: 'tier' | 'doublesTier' | 'natDexTier' = isDoubles ? 'doublesTier' : national ? 'natDexTier' : 'tier';

  // The preset's Pokémon rule (empty for vgc/ag/cap/blank/unknown → all legal).
  const rule = (format ? resolvePresetRules(format)?.pokemon : undefined) ?? { mode: 'block' as const, ids: [] };
  const listed = new Set(rule.ids);
  const isLegalByRule = (id: string) => (rule.mode === 'allow' ? listed.has(id) : !listed.has(id));

  const results: FormatSpeciesListItem[] = [];
  for (const species of national ? listNationalSpecies(gen) : Array.from(getGeneration(gen).species)) {
    // Mirror listAllSpeciesRich: skip cosmetic/battle-only and non-standard forms. The National Dex universe is made of
    // species the generation calls non-standard (Past), so there only the battle-only formes are skipped.
    if (species.battleOnly || (!national && species.isNonstandard)) continue;

    const rawTier = species[tierField] as string | undefined;
    const tier = toDisplayTier(rawTier, isDoubles);

    // Everything the format rules in or out is in the preset's resolved list: the banned tiers, a roster, and the
    // Little Cup / NFE species lists. "Lower tiers stay legal" falls out of getBannedPokemonForTier only collecting
    // tiers strictly above the selected one.
    const legal = isLegalByRule(species.id);

    results.push({
      name: species.name,
      id: species.id,
      types: species.types.slice(),
      baseStats: { ...species.baseStats },
      tier,
      legal,
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
