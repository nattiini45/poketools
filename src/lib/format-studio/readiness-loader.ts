import 'server-only';

/**
 * The readiness state of a custom league: the attached format (its name, version and frozen hash, never its spec
 * or its seed), how many phases it created and the checklist of what is still missing before a first round.
 *
 * One wave after store selection: the attached row, the hand-made phase count, the start signals, and a total
 * count in native mode. A league of any other format type has no readiness and costs no read.
 */
import type { LText } from '@/lib/studio-core/ltext';
import { isSeasonStarted } from '@/lib/season/season-started';
import { getSeasonFormat, getSeasonManualPhaseCount, getSeasonNativePhaseCount, getSeasonStartSignals } from '@/lib/supabase/queries/season-formats';
import { isNativeSeasonStarted } from '@/lib/supabase/queries/season-start';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
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

export async function loadLeagueFormatState(league: SeasonWithDetails, now: Date = new Date()): Promise<LeagueFormatState | null> {
  if (league.format_type !== 'custom') return null;
  const mode = await getPhaseRouteMode();
  const native = mode === 'phase' || mode === 'frozen_phase';
  const [row, manualPhaseCount, started, phaseCount] = await Promise.all([
    getSeasonFormat(league.id),
    native ? getSeasonManualPhaseCount(league.id, 'native') : getSeasonManualPhaseCount(league.id),
    native ? isNativeSeasonStarted(league.id) : getSeasonStartSignals(league.id).then((signals) => signals !== null && isSeasonStarted(signals)),
    native ? getSeasonNativePhaseCount(league.id) : league.tournament_count,
  ]);
  const readiness = computeReadiness({
    formatType: league.format_type,
    started,
    participantCount: league.participant_count,
    seasonRulesetId: league.ruleset_id,
    attached: row === null ? null : { version_no: row.version_no, spec: row.spec },
    phaseCount,
    manualPhaseCount,
    seasonStartDate: league.start_date,
    now,
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
          createdPhases: Math.max(0, phaseCount - manualPhaseCount),
        };
  return { readiness, attached, manualPhaseCount, started };
}
