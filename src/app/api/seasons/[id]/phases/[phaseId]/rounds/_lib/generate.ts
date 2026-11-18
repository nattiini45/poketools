import { NextResponse, type NextRequest } from 'next/server';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { requirePlayer } from '@/lib/auth/helpers';
import { emitPhaseDiscordEvent } from '@/lib/discord/notify';
import { ENABLE_KALE_CABBAGE } from '@/lib/feature-flags';
import { loadPairingAids } from '@/lib/format-engine/pairing-server';
import { pairNativeRound, pairNativeRoundBatch, planNativeRoundGroups } from '@/lib/league-phase/round-pairing';
import { loadNativeSeasonStandingsContext } from '@/lib/league-phase/standings-context';
import { logger } from '@/lib/logger';
import { expirePhaseReads } from '@/lib/revalidation';
import { startSeasonIfUpcoming } from '@/lib/season/start-season';
import { emitPhaseSocialEvent } from '@/lib/social/notify';
import { getPhaseParticipants } from '@/lib/supabase/queries/league-phases';
import { getNativeKitMatchFacts } from '@/lib/supabase/queries/phase-format-runtime';
import { getGroupsByPhase } from '@/lib/supabase/queries/phase-groups';
import { getRoundsByPhase, RoundAlreadyWrittenError, updatePhaseRoundStatus, writeGeneratedPhaseRound, writeGeneratedPhaseRoundBatch } from '@/lib/supabase/queries/phase-rounds';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { startingBracketsFromParticipants } from '@/lib/tournament/double-elim';
import { parseGenerateOptions } from '@/lib/tournament/generate-options';
import type { ApiResult, ApiWarning } from '@/types/api';
import type { PhaseRound } from '@/types/league-phase';
import type { PhaseDiscordEventPayload } from '@/types/phase-events';
import { nativeRoundServices } from './effects';
import { invalidPhaseRoundPath, loadRoundPhase, phaseRoundError, type PhaseParams } from './scope';
import { prepareNativeGenerationKit } from './generation-kit';

export async function generatePhaseRounds(request: NextRequest, params: Promise<PhaseParams>, batch: boolean) {
  try {
    const actor = await requirePlayer();
    const path = await params;
    const invalid = invalidPhaseRoundPath(path);
    if (invalid) return invalid;
    const { season, phase } = await loadRoundPhase(path, actor);
    const options = await parseGenerateOptions(request);
    if (!options.ok) return options.response;
    if (batch && phase.bracket_type !== 'round_robin') {
      throw new UserFacingError('Generate-all-rounds is only supported for round_robin tournaments', { code: 'rounds_round_robin_only' });
    }
    if (phase.status === 'completed') {
      throw new UserFacingError('Tournament is already completed', { code: 'tournament_already_completed' });
    }
    const bracket = phase.bracket_type;
    const elimination = bracket === 'single_elim' || bracket === 'double_elim';
    const rounds = await getRoundsByPhase(phase.id);
    if (elimination && rounds.length === 0) {
      throw new UserFacingError('Elimination brackets are built by the bracket engine. Use Generate Bracket instead.', { code: 'BRACKET_V2_REQUIRED' });
    }

    if (rounds.some(round => round.bracket_side != null)) {
      throw new UserFacingError('This tournament bracket is managed by the bracket engine. Use Generate Bracket or Regenerate Bracket instead.', { code: 'BRACKET_V2_MANAGED' });
    }
    const current = rounds.find(round => round.round_number === phase.current_round);
    if (elimination && (!current || phase.current_round < 1)) {
      throw new UserFacingError('Round not found', { code: 'round_not_found', status: 409 });
    }
    if (elimination && phase.archived) {
      throw new UserFacingError('Archived phase is read-only', { code: 'phase_bracket_archived', status: 409 });
    }
    const matches = elimination ? await getNativeKitMatchFacts(phase.id, true) : await getNativeKitMatchFacts(phase.id);
    const services = nativeRoundServices(phase);
    const format = await prepareNativeGenerationKit({ request, season, phase, actor, rounds, matches, kit: services.matches.kit });
    if (bracket !== 'round_robin' && current && current.status !== 'completed') {
      throw new UserFacingError(`Current round (${current.name}) is not yet completed`, {
        code: 'tournament_current_round_incomplete', params: { round: current.name },
      });
    }
    if (elimination && current) {
      const count = matches.filter(match => match.round_id === current.id && match.status !== 'completed').length;
      if (count > 0) {
        throw new UserFacingError(`${current.name} still has ${count} unfinished match(es), so the next round cannot be built from it. Finish them first.`, {
          code: 'rounds_previous_matches_unfinished', params: { round: current.name, count }, status: 409,
        });
      }
    }

    const [enrolled, groups, leagueGroups] = await Promise.all([
      getPhaseParticipants(phase.id), getGroupsByPhase(phase.id), getSeasonGroups(season.id),
    ]);
    if (enrolled.length < 2) {
      throw new UserFacingError('Need at least 2 participants', { code: 'tournament_participants_too_few' });
    }
    const participants = enrolled.map(({ id, name, seed, starting_bracket }) => ({
      id, name, seed, ...(elimination ? { starting_bracket } : {}),
    }));
    const playerIds = participants.map(player => player.id);
    const names = Object.fromEntries(participants.map(player => [player.id, player.name]));
    const groupLayout = groups.map(({ id, name, group_number, season_group_id, members }) => ({
      id, name, group_number, season_group_id, members: members.map(({ player_id, seed }) => ({ player_id, seed })),
    }));
    const kit = format?.pairing ?? null;
    const schedule = elimination
      ? { groups: groupLayout, replacement: undefined }
      : planNativeRoundGroups(groupLayout, leagueGroups, playerIds, rounds.length === 0, kit);
    const pairing = {
      phase, kit, participantIds: playerIds, participantNames: names,
      startingBrackets: elimination ? startingBracketsFromParticipants(enrolled) : undefined,
      context: {
        rounds, matches, groups: schedule.groups.map(group => ({
          ...group, members: group.members.map(member => ({ ...member, player_name: names[member.player_id] })),
        })),
      },
      aidsFor: async (roundNumber: number) => format?.pairing
        ? loadPairingAids({ seasonId: season.id, stage: format.pairing.stage, roundNumber, playerIds }, async () => format.context)
        : {},
      loadStandingsContext: () => loadNativeSeasonStandingsContext(season.id),
    } satisfies Parameters<typeof pairNativeRound>[0];
    const generated = batch ? await pairNativeRoundBatch(pairing) : [await pairNativeRound(pairing)];
    const byNumber = new Map(rounds.map(round => [round.round_number, round]));
    const withFixtures = new Set(matches.map(match => match.round_id));
    const plans = generated.map(({ round_number: number, round_name: name, pairings, bye_player_ids: byes }) => {
      const existing = byNumber.get(number);
      if (existing?.status === 'completed' && !withFixtures.has(existing.id)) {
        throw new UserFacingError(`${existing.name} is already completed and holds no matches. Delete it to generate it again.`, {
          code: 'rounds_round_completed', params: { round: existing.name }, status: 409,
        });
      }
      if (existing && (withFixtures.has(existing.id)
        || (existing.pairings_generated && (existing.bye_player_ids.length > 0 || kit?.stage.pairing.kind === 'filter')))) {
        throw new RoundAlreadyWrittenError(existing.name);
      }
      return {
        round_id: existing?.id ?? null, name, round_number: number, best_of: phase.bo_overrides[name] ?? phase.best_of_default,
        bye_player_ids: byes, matches: pairings, deadline: !existing?.deadline && format?.pairing ? format.deadline(number) : null,
      };
    });
    const scope = {
      phase_id: phase.id, season_id: season.id, phase_status: phase.status,
      expected_revision: format?.revision, expected_updated_at: phase.updated_at, replacement_groups: schedule.replacement,
      inputs: {
        phase: {
          status: phase.status, current_round: phase.current_round, bracket_type: bracket, stage_spec: phase.stage_spec,
          name: phase.name, bo_overrides: phase.bo_overrides, best_of_default: phase.best_of_default,
        },
        season: { start_date: season.start_date, format_type: season.format_type },
        participants: [...participants].sort(byId),
        matches: [...matches].sort(byId),
        rounds: rounds.map(({ id, round_number, status, bye_player_ids, pairings_generated, bracket_side }) =>
          ({ id, round_number, status, bye_player_ids, pairings_generated, bracket_side })).sort(byId),
        groups: groupLayout,
        league_groups: leagueGroups.map(({ id, name, sort_order, player_ids }) => ({ id, name, sort_order, player_ids: [...player_ids].sort() })),
      },
    };
    const written = batch
      ? await writeGeneratedPhaseRoundBatch(scope, plans)
      : [await writeGeneratedPhaseRound({ ...scope, ...plans[0] })];
    try {
      if (phase.status === 'upcoming') {
        try {
          await startSeasonIfUpcoming(season.id);
        } catch (error) {
          logger.error('phase-rounds/generate', 'Could not start the league after writing the first round', { phaseId: phase.id, error });
        }
      }
      let started = false;
      if (options.startRound && written[0].status === 'pending') {
        try {
          written[0] = await updatePhaseRoundStatus(written[0].id, 'active', 'pending');
          started = true;
        } catch (error) {
          logger.error('phase-rounds/generate', 'Failed to start the new round', { phaseId: phase.id, roundId: written[0].id, error });
        }
      }
      const owner = { kind: 'phase', phase_id: phase.id, season_id: season.id } as const;
      for (const [index, round] of written.entries()) {
        const { round_number: number, pairings, bye_player_ids: byes, rematches = 0, forbidden = 0 } = generated[index];
        logAuditEvent({
          actor_id: actor.playerId, actor_name: actor.name, action: 'round.generate',
          resource_type: 'phase_round', resource_id: round.id, resource_name: round.name,
          metadata: { phase_id: phase.id, round_number: number, matches: pairings.length, byes: byes.length, started: index === 0 && started,
            ...(kit ? { engine: 'kit', rematches, forbidden } : {}) },
        });
        if (format?.pairing) await format.afterWrite(generated[index], index === 0);
        if (batch) continue;
        const payload: PhaseDiscordEventPayload = {
          version: 1, owner, event_type: 'round_generated', data: {
            kind: 'round_generated', phase_name: phase.name, round_name: round.name,
            pairings: pairings.map(pair => ({ player_1_name: names[pair.player_1_id], player_2_name: names[pair.player_2_id] })),
          },
        };
        emitPhaseDiscordEvent(payload);
        emitPhaseSocialEvent(payload);
        if (index === 0 && phase.status === 'upcoming') {
          const startedPayload: PhaseDiscordEventPayload = {
            version: 1, owner, event_type: 'phase_started', data: { kind: 'phase_status', phase_name: phase.name, new_status: 'active' },
          };
          emitPhaseDiscordEvent(startedPayload);
          emitPhaseSocialEvent(startedPayload);
        }
        if (ENABLE_KALE_CABBAGE) services.triggerReport(phase.id, round.id, 'round_forecast');
      }
      const warnings: ApiWarning[] = [];
      const rematches = generated.reduce((sum, round) => sum + (round.rematches ?? 0), 0);
      const forbidden = generated.reduce((sum, round) => sum + (round.forbidden ?? 0), 0);
      if (kit && rematches > 0) warnings.push({ code: 'swiss_rematches', params: { count: rematches } });
      if (forbidden > 0) warnings.push({ code: 'pairing_forbidden', params: { count: forbidden } });
      return NextResponse.json<ApiResult<PhaseRound | PhaseRound[]>>({
        success: true, data: batch ? written : written[0], ...(warnings.length ? { warnings } : {}),
      }, { status: 201 });
    } finally {
      expirePhaseReads(phase.id, season.id);
    }
  } catch (error) {
    return phaseRoundError(error, batch ? 'Failed to generate all rounds' : 'Failed to generate round');
  }
}

function byId(a: { id: string }, b: { id: string }) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
