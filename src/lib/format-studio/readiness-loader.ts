import 'server-only';

/**
 * The readiness state of a custom league: the attached format (its name, version and frozen hash, never its spec
 * or its seed), how many phases it created and the checklist of what is still missing before a first round.
 *
 * One wave of three reads (the attached row, the hand-made phase count, the start signals); the league row comes
 * from the caller. A league of any other format type has no readiness and costs no read.
 */
import type { LText } from '@/lib/studio-core/ltext';
import { isSeasonStarted } from '@/lib/season/season-started';
import { getSeasonFormat, getSeasonManualPhaseCount, getSeasonStartSignals } from '@/lib/supabase/queries/season-formats';
import type { SeasonWithDetails } from '@/types/season';
import { computeReadiness, type ReadinessResult } from './editor/readiness';

export interface AttachedFormatInfo {
  /** Null once the source definition was deleted; the frozen copy lives on. */
  definition_id: string | null;
  version_no: number;
  spec_hash: string;
  frozen_at: string;
  /** The name in the frozen copy, so a deleted or private source changes nothing. */
  name: LText;
  stageCount: number;
  /** Phases that were created from the format. */
  createdPhases: number;
}

export interface LeagueFormatState {
  readiness: ReadinessResult;
  attached: AttachedFormatInfo | null;
  /** Phases that were not created from a format. */
  manualPhaseCount: number;
  started: boolean;
}

const UNNAMED: LText = { base: 'en' };

export async function loadLeagueFormatState(league: SeasonWithDetails): Promise<LeagueFormatState | null> {
  if (league.format_type !== 'custom') return null;
  const [row, manualPhaseCount, signals] = await Promise.all([
    getSeasonFormat(league.id),
    getSeasonManualPhaseCount(league.id),
    getSeasonStartSignals(league.id),
  ]);
  const started = signals !== null && isSeasonStarted(signals);
  const readiness = computeReadiness({
    formatType: league.format_type,
    started,
    participantCount: league.participant_count,
    seasonRulesetId: league.ruleset_id,
    attached: row === null ? null : { version_no: row.version_no, spec: row.spec },
    phaseCount: league.tournament_count,
    manualPhaseCount,
  });
  // Only these fields leave the loader: the spec and the seed stay here.
  const attached: AttachedFormatInfo | null =
    row === null
      ? null
      : {
          definition_id: row.definition_id,
          version_no: row.version_no,
          spec_hash: row.spec_hash,
          frozen_at: row.frozen_at,
          name: row.spec.identity?.name ?? UNNAMED,
          stageCount: row.spec.stages.length,
          createdPhases: Math.max(0, league.tournament_count - manualPhaseCount),
        };
  return { readiness, attached, manualPhaseCount, started };
}
