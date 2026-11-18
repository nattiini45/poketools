import { NextResponse, type NextRequest } from 'next/server';
import { readJsonBody } from '@/lib/api/json-body';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { requirePlayer } from '@/lib/auth/helpers';
import { expirePhaseReads } from '@/lib/revalidation';
import { getPhaseParticipants } from '@/lib/supabase/queries/league-phases';
import { getGroupsByPhase } from '@/lib/supabase/queries/phase-groups';
import { getPhaseMatchesByRound } from '@/lib/supabase/queries/phase-matches';
import { createPhaseRoundWithMatches, getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';
import { getSeasonGroups, seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { formatZodErrors, manualRoundSchema } from '@/lib/validation';
import type { ApiResult } from '@/types/api';
import type { PhaseRound } from '@/types/league-phase';
import { prepareManualKitRound } from '../_lib/kit-manual';
import { invalidPhaseRoundPath, loadRoundPhase, phaseRoundError, type PhaseParams } from '../_lib/scope';

export async function POST(request: NextRequest, { params }: { params: Promise<PhaseParams> }) {
  try {
    const actor = await requirePlayer();
    const path = await params;
    const invalid = invalidPhaseRoundPath(path);
    if (invalid) return invalid;
    const { season, phase } = await loadRoundPhase(path, actor);
    const json = await readJsonBody(request);
    if (!json.ok) return json.response;
    const parsed = manualRoundSchema.safeParse(json.value);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      throw new UserFacingError(issues, { code: 'validation_failed', params: { issues } });
    }
    const body = parsed.data;
    if (phase.status === 'completed') {
      throw new UserFacingError('Tournament is already completed', { code: 'tournament_already_completed' });
    }
    if (phase.bracket_type === 'round_robin' && await seasonHasGroups(season.id)) {
      throw new UserFacingError('This league has groups, so its table phase follows the week plan. Use Generate Next Round instead.', {
        code: 'rounds_manual_league_grouped', status: 409,
      });
    }

    const rounds = await getRoundsByPhase(phase.id);
    const kit = await prepareManualKitRound(request, season, phase, rounds, actor);
    const elimination = phase.bracket_type === 'single_elim' || phase.bracket_type === 'double_elim';
    if (elimination) {
      if (rounds.length === 0) {
        throw new UserFacingError('Elimination brackets are built by the bracket engine. Use Generate Bracket instead.', {
          code: 'BRACKET_V2_REQUIRED',
        });
      }
      if (rounds.some(round => round.bracket_side !== null)) {
        throw new UserFacingError('This bracket is managed by the bracket engine.', { code: 'BRACKET_V2_MANAGED' });
      }
    }
    const current = rounds.find(round => round.round_number === phase.current_round);
    if (current && phase.bracket_type !== 'round_robin') {
      if (current.status !== 'completed') {
        throw new UserFacingError(`Current round (${current.name}) is not yet completed`, {
          code: 'tournament_current_round_incomplete', params: { round: current.name },
        });
      }
      if (elimination) {
        const count = (await getPhaseMatchesByRound(current.id)).filter(match => match.status !== 'completed').length;
        if (count > 0) {
          throw new UserFacingError(`${current.name} still has ${count} unfinished match(es), so the next round cannot be built from it. Finish them first.`, {
            code: 'rounds_previous_matches_unfinished', params: { round: current.name, count }, status: 409,
          });
        }
      }
    }

    const participants = new Set((await getPhaseParticipants(phase.id)).map(player => player.id));
    const used = new Set<string>();
    const matches = body.pairings.map(({ player_1_id, player_2_id }) => {
      const one = player_1_id.toLowerCase();
      const two = player_2_id.toLowerCase();
      if (one === two) throw new UserFacingError('A player cannot be paired against themselves', { code: 'pairing_self' });
      for (const player of [one, two]) {
        if (!participants.has(player)) {
          throw new UserFacingError(`Player ${player} is not a participant`, {
            code: 'tournament_player_not_participant', params: { player },
          });
        }
        if (used.has(player)) {
          throw new UserFacingError(`Player ${player} appears in multiple pairings`, {
            code: 'pairing_player_repeated', params: { player },
          });
        }
        used.add(player);
      }
      return { player_1_id: one, player_2_id: two };
    });
    const unpaired = [...participants].filter(player => !used.has(player));
    if (unpaired.length > 1) {
      throw new UserFacingError(`All participants must be paired. ${unpaired.length} participants are not in any pairing.`, {
        code: 'pairing_players_unpaired', params: { count: unpaired.length },
      });
    }
    const roundNumber = phase.current_round + 1;
    const name = body.name || `Round ${roundNumber}`;
    const byes = phase.bracket_type === 'swiss' || phase.bracket_type === 'round_robin' ? unpaired : [];
    if (phase.bracket_type === 'swiss' && rounds.length === 0) {
      const leagueGroups = await getSeasonGroups(season.id);
      if (leagueGroups.length > 0) {
        const expected = new Map(leagueGroups.flatMap(group => group.player_ids
          .filter(player => participants.has(player)).map(player => [player, group.id] as const)));
        const missing = participants.size - expected.size;
        if (missing > 0) {
          throw new UserFacingError('Every trainer of this phase must be in a league group first', {
            code: 'PHASE_PLAYER_WITHOUT_LEAGUE_GROUP', status: 409, params: { count: missing },
          });
        }
        const groups = await getGroupsByPhase(phase.id);
        const mirrored = groups.flatMap(group => group.members.map(member => [member.player_id, group.season_group_id] as const));
        if (mirrored.length !== expected.size || new Set(mirrored.map(([player]) => player)).size !== expected.size
          || mirrored.some(([player, group]) => expected.get(player) !== group)) {
          throw new UserFacingError('The phase groups must mirror the league groups before creating its first round.', {
            code: 'PHASE_GROUPS_STALE', status: 409,
          });
        }
      }
    }
    let wrote = false;
    try {
      let round = await createPhaseRoundWithMatches({
        phase_id: phase.id, name, round_number: roundNumber,
        best_of: body.best_of ?? phase.bo_overrides[name] ?? phase.best_of_default,
        bye_player_ids: byes, matches, expected_revision: kit?.revision,
      });
      wrote = true;
      logAuditEvent({
        actor_id: actor.playerId, actor_name: actor.name, action: 'round.generate',
        resource_type: 'phase_round', resource_id: round.id, resource_name: round.name,
        metadata: { phase_id: phase.id, round_number: roundNumber, matches: matches.length, byes: byes.length, manual: true, ...(kit ? { engine: 'kit' } : {}) },
      });
      if (kit) round = await kit.afterWrite(round);
      return NextResponse.json<ApiResult<PhaseRound>>({ success: true, data: round }, { status: 201 });
    } finally {
      if (wrote) expirePhaseReads(phase.id, season.id);
    }
  } catch (error) {
    return phaseRoundError(error, 'Failed to create manual round');
  }
}
