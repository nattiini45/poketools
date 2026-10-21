import { getGeneration } from './dex';
import { getFormatDefaults } from './formats';
import type { SpeciesSearchResult } from './dex';
import type { BaseFormat } from '@/types/ruleset';

// ── Format-aware species listing ────────────────────────────────────
//
// Server-only (imports @pkmn/dex transitively). Enriches the full-dex listing
// with a display `tier` and a `legal` flag for a given format so the
// teambuilder picker can show tiers, sort by them, group by them, and hide
// Pokémon that are illegal in the selected meta.
//
// This is a leaf module: it depends on dex.ts + formats.ts but nothing here
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
  const match = format ? /^gen(\d+)([a-z0-9]+)$/.exec(format) : null;
  const tierKey = match ? match[2] : null;

  // Which @pkmn tier field drives the display tier for this format family.
  const tierField: 'tier' | 'doublesTier' | 'natDexTier' =
    tierKey === 'doublesou' || tierKey === 'vgc'
      ? 'doublesTier'
      : tierKey === 'nationaldex'
        ? 'natDexTier'
        : 'tier';
  const isDoubles = tierField === 'doublesTier';

  // Banned set for the format (empty for vgc/ag/cap/blank/unknown → all legal).
  const banned = new Set(
    (format ? getFormatDefaults(format as BaseFormat).banned_pokemon : []).map((n) =>
      n.toLowerCase(),
    ),
  );

  const results: FormatSpeciesListItem[] = [];
  for (const species of Array.from(getGeneration(gen).species)) {
    // Mirror listAllSpeciesRich: skip cosmetic/battle-only and non-standard forms.
    if (species.battleOnly || species.isNonstandard) continue;

    const rawTier = species[tierField] as string | undefined;
    const tier = toDisplayTier(rawTier, isDoubles);
    const nameLower = species.name.toLowerCase();

    let legal: boolean;
    if (!tierKey) {
      legal = true;
    } else if (tierKey === 'lc') {
      legal = rawTier === 'LC' && !banned.has(nameLower);
    } else if (tierKey === 'nfe') {
      legal = (species.evos?.length ?? 0) > 0 && !banned.has(nameLower);
    } else {
      // Standard tiers, monotype, 1v1, doublesou, nationaldex, vgc, ag, cap, …
      // "Lower tiers stay legal" falls out of getBannedPokemonForTier only
      // collecting tiers strictly above the selected one.
      legal = !banned.has(nameLower);
    }

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
