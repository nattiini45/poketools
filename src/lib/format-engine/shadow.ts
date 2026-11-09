/**
 * The shadow mode's comparison: for every phase of a custom league's attached format, and for the season table, the
 * rows where the legacy table and the kit table disagree on place or points. Admin only (the Format tab): it costs
 * the kit reads plus the league's stages, participants and matches, so no public page calls it.
 *
 * Works on every engine: a `legacy` league shows what switching would change, a `shadow` league what it would
 * change today, a `kit` league what the legacy table would still say.
 */
import 'server-only';

import type { SeasonFormatEngine } from '@/lib/format-studio/library-types';
import { getSeasonKitHead } from '@/lib/supabase/queries/format-engine';
import { getMatchesByTournamentIds } from '@/lib/supabase/queries/matches';
import { getPublicSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { scoringByeRecordsForStages } from '@/lib/tournament/byes';
import { loadSeasonSwissByeRounds } from '@/lib/tournament/scoring-byes';
import { computeStandingsFromContext, type SeasonStandingsContext } from '@/lib/tournament/season-standings';
import type { MatchRecord } from '@/lib/tournament/types';
import type { MatchWithPlayers } from '@/types/match';
import { diffStandings, kitForPhase, type KitStandingsData, type StandingsDiffRow } from './context';
import { loadKitStandingsData } from './load';

export interface ShadowPhaseDiff {
  phase_id: string;
  phase_name: string;
  stage_key: string;
  completed_matches: number;
  rows: StandingsDiffRow[];
}

export interface ShadowDiffReport {
  engine: SeasonFormatEngine;
  phases: ShadowPhaseDiff[];
  /** The season table (every phase's matches scored by its own stage). */
  season: StandingsDiffRow[];
}

function toRecord(match: MatchWithPlayers): MatchRecord {
  return {
    match_id: match.id,
    player_1_id: match.player_1_id,
    player_2_id: match.player_2_id,
    winner_id: match.winner_id,
    round_number: 0,
  };
}

const LEGACY: SeasonStandingsContext = { formatType: 'custom' };

/** The diff of a league's attached format, or null when none is attached. */
export async function loadShadowDiff(seasonId: string): Promise<ShadowDiffReport | null> {
  const head = await getSeasonKitHead(seasonId);
  if (head === null) return null;
  const loaded = await loadKitStandingsData(seasonId, { includeLegacy: true });
  if (!loaded) return null;
  const kit: KitStandingsData = { ...loaded, engine: 'kit' };
  const phaseIds = Object.keys(kit.stages);

  const [stages, participants, matchesByStage] = await Promise.all([
    getStagesBySeasonId(seasonId),
    getPublicSeasonParticipants(seasonId),
    getMatchesByTournamentIds(phaseIds),
  ]);
  const phases = stages.filter((stage) => kit.stages[stage.id] !== undefined);
  const byeRounds = phases.some((stage) => stage.bracket_type === 'swiss')
    ? await loadSeasonSwissByeRounds(seasonId)
    : new Map();

  const names: Record<string, string> = {};
  for (const participant of participants) names[participant.id] = participant.name;

  const out: ShadowPhaseDiff[] = [];
  const allRecords: MatchRecord[] = [];
  for (const phase of phases) {
    const matches = matchesByStage.get(phase.id) ?? [];
    const records = matches.filter((match) => match.status === 'completed').map(toRecord);
    allRecords.push(...records);
    const playerIds = [...new Set(matches.flatMap((match) => [match.player_1_id, match.player_2_id]))].filter(
      (id): id is string => typeof id === 'string',
    );
    const options = { byes: scoringByeRecordsForStages([phase], byeRounds) };
    const legacy = computeStandingsFromContext(LEGACY, playerIds, names, records, {}, options);
    const ranked = computeStandingsFromContext(
      { formatType: 'custom', kit: kitForPhase(kit, phase.id) },
      playerIds,
      names,
      records,
      {},
      options,
    );
    out.push({
      phase_id: phase.id,
      phase_name: phase.name,
      stage_key: kit.stages[phase.id].key,
      completed_matches: records.length,
      rows: diffStandings(legacy, ranked),
    });
  }

  const seasonIds = participants.map((participant) => participant.id);
  const seasonOptions = { byes: scoringByeRecordsForStages(phases, byeRounds) };
  const season = diffStandings(
    computeStandingsFromContext(LEGACY, seasonIds, names, allRecords, {}, seasonOptions),
    computeStandingsFromContext({ formatType: 'custom', kit }, seasonIds, names, allRecords, {}, seasonOptions),
  );
  return { engine: head.engine, phases: out, season };
}
