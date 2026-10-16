/**
 * The draft line catalog (draft-frontend §4.8). Pure and client-safe; built on the server from
 * `getListEntries` + `getSeasonLineThresholds` and passed to the pick screen as props.
 *
 * Narrow on purpose: no rationale, historical data, sources or ratings (SPEC:378-379). Stage names are the
 * list's canonical English names (the list is authoritative, never dex prevo/evos). `specialRules` is
 * localized for the UI locale on the server (`specialRulesTextFor`, critique S14).
 */
import type { Locale } from '@/i18n/config';
import type { LineId } from '@/types/draft-queue';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { SeasonLineThresholds } from '@/lib/draft/epb-thresholds';
import { effectiveThresholds } from '@/lib/draft/line-catalog-data';
import { foldId, lineIdOfEntry } from '@/lib/draft/line-identity';
import { proseHash, specialRulesTextFor } from '@/lib/draft/special-rules-text';
import { bannedMoveIdSet } from '@/lib/draft/utility-categories';

export interface DraftLineCatalogEntry {
  lineId: LineId;
  entryId: string;
  lineNumber: number;
  price: number;
  /** From the list (authoritative), canonical English names. */
  stages: { stage: 1 | 2 | 3; name: string; speciesId: string }[];
  /** As stored/overridden (non-cumulative), for display; `cumulative` is the running total after league overrides. */
  thresholds: { toStage2: number; additionalToStage3: number | null; cumulative: [number, number | null] };
  flags: { cosmog: boolean; noRedraft: boolean; scatterbugCocoon: boolean };
  /** specialRulesTextFor(entry, uiLocale) (B-LINE, critique S14); null when the line has no text. */
  specialRules: { text: string; lang: Locale } | null;
  /** groupKey = base species id; count > 1 => show the branch marker. */
  branch: { groupKey: string; count: number };
}

export interface DraftLineCatalog {
  listVersionId: string;
  lines: DraftLineCatalogEntry[];
  /** The season's banned move ids (sorted). */
  bannedMoves: string[];
}

function byLineNumber(a: PointBuyListEntry, b: PointBuyListEntry): number {
  return a.line_number - b.line_number;
}

function stagesOf(entry: PointBuyListEntry): DraftLineCatalogEntry['stages'] {
  const ids = entry.species_ids;
  const stages: DraftLineCatalogEntry['stages'] = [
    { stage: 1, name: entry.base_pokemon, speciesId: ids?.base || foldId(entry.base_pokemon) },
    { stage: 2, name: entry.stage2_pokemon, speciesId: ids?.stage2 || foldId(entry.stage2_pokemon) },
  ];
  if (entry.stage3_pokemon) {
    stages.push({ stage: 3, name: entry.stage3_pokemon, speciesId: ids?.stage3 || foldId(entry.stage3_pokemon) });
  }
  return stages;
}

/**
 * `entries` as returned by `getListEntries` (overrides applied), `thresholds` from `getSeasonLineThresholds`,
 * `banned` the season's banned moves (English names or ids).
 */
export function buildLineCatalog(
  entries: readonly PointBuyListEntry[],
  thresholds: readonly SeasonLineThresholds[],
  banned: readonly string[],
  uiLocale: Locale,
): DraftLineCatalog {
  const sorted = [...entries].sort(byLineNumber);
  const cumulativeByLine = new Map<string, [number, number | null]>();
  for (const t of thresholds) {
    if (t.line_id) cumulativeByLine.set(t.line_id, [t.stage2_kos, t.stage3_kos]);
  }
  const branchCounts = new Map<string, number>();
  for (const e of sorted) {
    const key = stagesOf(e)[0].speciesId;
    branchCounts.set(key, (branchCounts.get(key) ?? 0) + 1);
  }

  const lines = sorted.map((entry): DraftLineCatalogEntry => {
    const lineId = lineIdOfEntry(entry);
    const stages = stagesOf(entry);
    const fallback = effectiveThresholds(entry);
    const rules = specialRulesTextFor(entry, uiLocale);
    return {
      lineId,
      entryId: entry.id,
      lineNumber: entry.line_number,
      price: entry.price,
      stages,
      thresholds: {
        toStage2: entry.kills_to_stage2,
        additionalToStage3: entry.stage3_pokemon ? entry.additional_kills_to_stage3 : null,
        cumulative: cumulativeByLine.get(lineId) ?? [fallback.stage2_kos, fallback.stage3_kos],
      },
      flags: {
        cosmog: entry.special_rules?.cosmog === true,
        noRedraft: entry.special_rules?.no_redraft === true,
        scatterbugCocoon: entry.special_rules?.scatterbug === true,
      },
      specialRules: rules.text ? { text: rules.text, lang: rules.lang } : null,
      branch: { groupKey: stages[0].speciesId, count: branchCounts.get(stages[0].speciesId) ?? 1 },
    };
  });

  return {
    listVersionId: sorted[0]?.list_version_id ?? '',
    lines,
    bannedMoves: [...bannedMoveIdSet(banned)].sort(),
  };
}

/**
 * The search-index cache buster (draft-backend §3.2 rule 3, critique F6): FNV-1a 32-bit (8 hex) over, per
 * entry in `line_number` order, `line_id|price|base|stage2|stage3|species_ids.base|species_ids.stage2|species_ids.stage3`
 * joined by `\n`. The page builds the index URL with it and the route keys its memo by it, so an edit of an
 * upcoming season's list version changes the URL.
 */
export function hashCatalog(entries: readonly PointBuyListEntry[]): string {
  const rows = [...entries].sort(byLineNumber).map((e) =>
    [
      lineIdOfEntry(e),
      e.price,
      e.base_pokemon,
      e.stage2_pokemon,
      e.stage3_pokemon ?? '',
      e.species_ids?.base ?? '',
      e.species_ids?.stage2 ?? '',
      e.species_ids?.stage3 ?? '',
    ].join('|'),
  );
  return proseHash(rows.join('\n'));
}
