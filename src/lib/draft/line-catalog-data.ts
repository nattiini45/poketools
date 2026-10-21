/**
 * Line catalog data for the draft (draft-backend §7.9, B-LINE).
 *
 * `effectiveThresholds` gives the cumulative KO thresholds the draft RPCs and
 * the stage resolution use, with the league overrides applied (format pack `epb.lineOverrides`).
 * Applying the overrides is idempotent, so entries that already passed the
 * read layer (`getListEntries`) and raw rows give the same result.
 */

import { applyLeagueOverrides } from '@/lib/draft/league-overrides';
import { lineIdOfEntry, type LineId } from '@/lib/draft/line-identity';
import { toCumulativeThresholds } from '@/lib/draft/special-rules';

export interface EffectiveThresholds {
  line_id: LineId;
  /** Cumulative KOs to stage 2. */
  stage2_kos: number;
  /** Cumulative KOs to stage 3; null for a two-stage line. */
  stage3_kos: number | null;
}

export function effectiveThresholds(entry: {
  line_id?: LineId | null;
  base_pokemon: string;
  stage2_pokemon: string;
  stage3_pokemon: string | null;
  kills_to_stage2: number;
  additional_kills_to_stage3: number | null;
}): EffectiveThresholds {
  const lineId = lineIdOfEntry(entry);
  const applied = applyLeagueOverrides({
    line_id: lineId,
    kills_to_stage2: entry.kills_to_stage2,
    additional_kills_to_stage3: entry.additional_kills_to_stage3,
  });
  const cumulative = toCumulativeThresholds(applied.kills_to_stage2, applied.additional_kills_to_stage3);
  return { line_id: lineId, stage2_kos: cumulative.stage2_kos, stage3_kos: cumulative.stage3_kos };
}
