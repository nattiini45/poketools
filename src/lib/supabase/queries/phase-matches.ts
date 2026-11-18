import { supabase } from '../client';
import { assertValidUuid } from '@/lib/utils/uuid';
import { postgrestQuoted } from '@/lib/supabase/postgrest-filter';
import { readAllPages } from '../read-all-pages';
import type { Tables } from '@/types/database';
import type { MatchStatus, GameSummary, GameSource } from '@/types/match';
import type { PhaseMatch, PhaseMatchWithPlayers, PhaseMatchWithRoundNumber } from '@/types/league-phase-match';
import { AUTO_CONFIRM_FROM, matchTimestampsFor } from '@/lib/tournament/match-state';
import { phaseMatchMachine, type PhaseMatchActor } from '@/lib/league-phase/phase-match-state';
import type { PhaseMatchChildrenEffects } from './phase-match-children';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logger } from '@/lib/logger';
type MatchRow = Tables<'phase_matches'>;

function toMatch(row: MatchRow): PhaseMatch {
  return {
    id: row.id,
    round_id: row.round_id,
    phase_id: row.phase_id,
    player_1_id: row.player_1_id,
    player_2_id: row.player_2_id,
    winner_id: row.winner_id,
    status: row.status as MatchStatus,
    submitter_id: row.submitter_id,
    date_played: row.date_played,
    scheduled_at: row.scheduled_at,
    auto_confirm_at: row.auto_confirm_at,
    confirmed_at: row.confirmed_at,
    notes: row.notes,
    social_image_url: row.social_image_url,
    bracket_side: (row.bracket_side as PhaseMatch['bracket_side']) ?? null,
    bracket_pos: row.bracket_pos,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type PlayerJoin = { name: string; avatar_url?: string | null };
type GameJoin = {
  id: string;
  game_number: number;
  winner_id: string | null;
  replay_url: string;
  source: string;
  stats_locked: boolean;
};
type RoundJoin = { status: string; round_number?: number };
type MatchWithPlayersRow = MatchRow & {
  player_1: PlayerJoin;
  player_2: PlayerJoin;
  winner: PlayerJoin | null;
  games: GameJoin[];
  round: RoundJoin;
};

function toMatchWithPlayers(row: MatchWithPlayersRow): PhaseMatchWithRoundNumber {
  return {
    ...toMatch(row),
    player_1_name: row.player_1.name,
    player_2_name: row.player_2.name,
    player_1_avatar_url: row.player_1.avatar_url ?? null,
    player_2_avatar_url: row.player_2.avatar_url ?? null,
    winner_name: row.winner?.name ?? null,
    round_status: (row.round?.status ?? 'pending') as PhaseMatchWithPlayers['round_status'],
    ...(row.round?.round_number === undefined ? {} : { round_number: row.round.round_number }),
    games: (row.games ?? [])
      .sort((a, b) => a.game_number - b.game_number)
      .map((g): GameSummary => ({
        id: g.id,
        game_number: g.game_number,
        winner_id: g.winner_id,
        replay_url: g.replay_url,
        source: g.source as GameSource,
        stats_locked: g.stats_locked ?? false,
      })),
  };
}

const MATCH_WITH_PLAYERS_SELECT = `
  *,
  player_1:players!phase_matches_player_1_id_fkey ( name, avatar_url ),
  player_2:players!phase_matches_player_2_id_fkey ( name, avatar_url ),
  winner:players!phase_matches_winner_id_fkey ( name ),
  games:phase_games ( id, game_number, winner_id, replay_url, source, stats_locked ),
  round:phase_rounds!phase_matches_phase_round_fkey ( status, round_number )
`;

export async function getPhaseMatchesByRound(roundId: string): Promise<PhaseMatchWithPlayers[]> {
  const { data, error } = await supabase
    .from('phase_matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .eq('round_id', roundId);

  if (error) throw error;
  return data.map((row: MatchWithPlayersRow) => toMatchWithPlayers(row));
}

export async function getPhaseMatchById(id: string): Promise<PhaseMatchWithPlayers | null> {
  const { data, error } = await supabase
    .from('phase_matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toMatchWithPlayers(data as MatchWithPlayersRow) : null;
}

export async function getPhaseMatchesByIds(ids: string[]): Promise<PhaseMatchWithPlayers[]> {
  const unique = [...new Set(ids)];
  for (const id of unique) assertValidUuid(id, 'matchId');
  const rows: MatchWithPlayersRow[] = [];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const chunk = unique.slice(offset, offset + 100);
    const page = await readAllPages((from, to) => supabase.from('phase_matches')
      .select(MATCH_WITH_PLAYERS_SELECT).in('id', chunk).order('id').range(from, to));
    rows.push(...page as MatchWithPlayersRow[]);
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  return unique.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toMatchWithPlayers(row)] : [];
  });
}

export async function createPhaseMatch(input: {
  round_id: string;
  phase_id: string;
  player_1_id: string;
  player_2_id: string;
}): Promise<PhaseMatch> {
  const { data, error } = await supabase
    .from('phase_matches')
    .insert({
      round_id: input.round_id,
      phase_id: input.phase_id,
      player_1_id: input.player_1_id,
      player_2_id: input.player_2_id,
    })
    .select()
    .single();

  if (error) throw error;
  return toMatch(data);
}

export async function updatePhaseMatchStatus(
  id: string,
  status: MatchStatus,
  winnerId: string | null | undefined,
  submitterId: string | null | undefined,
  notes: string | null | undefined,
  expectedStatus: MatchStatus,
  actor: PhaseMatchActor = 'system'
): Promise<PhaseMatch | null> {
  phaseMatchMachine.assertTransition(expectedStatus, status, actor);
  const updates: Record<string, unknown> = { status, ...matchTimestampsFor(expectedStatus, status) };
  if (winnerId !== undefined) updates.winner_id = winnerId;
  if (submitterId !== undefined) updates.submitter_id = submitterId;
  if (notes !== undefined) updates.notes = notes;

  const { data, error } = await supabase
    .from('phase_matches')
    .update(updates)
    .eq('id', id)
    .eq('status', expectedStatus)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? toMatch(data) : null;
}

export async function resetPhaseMatchFields(id: string, expectedStatus: MatchStatus): Promise<PhaseMatch | null> {
  phaseMatchMachine.assertTransition(expectedStatus, 'scheduled', 'admin');
  const { data, error } = await supabase
    .from('phase_matches')
    .update({
      status: 'scheduled' as MatchStatus,
      winner_id: null,
      submitter_id: null,
      ...matchTimestampsFor(expectedStatus, 'scheduled'),
    })
    .eq('id', id)
    .eq('status', expectedStatus)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data ? toMatch(data) : null;
}

export async function clearPhaseMatchSocialImage(matchId: string): Promise<void> {
  const { error } = await supabase
    .from('phase_matches')
    .update({ social_image_url: null })
    .eq('id', matchId);

  if (error) throw error;
}

export interface MatchStatusTransition {
  expectedStatus: MatchStatus;
  status: Exclude<MatchStatus, 'completed'>;
  winnerId?: string | null;
  submitterId?: string | null;
  autoConfirmAt?: string | null;
}

export async function transitionPhaseMatchStatus(
  id: string,
  transition: MatchStatusTransition,
  actor: PhaseMatchActor = 'system'
): Promise<PhaseMatch | null> {
  assertValidUuid(id, 'match id');
  phaseMatchMachine.assertTransition(transition.expectedStatus, transition.status, actor);

  const updates: Record<string, unknown> = {
    status: transition.status,
    ...matchTimestampsFor(transition.expectedStatus, transition.status, { autoConfirmAt: transition.autoConfirmAt }),
  };
  if (transition.winnerId !== undefined) updates.winner_id = transition.winnerId;
  if (transition.submitterId !== undefined) updates.submitter_id = transition.submitterId;

  const { data, error } = await supabase
    .from('phase_matches')
    .update(updates)
    .eq('id', id)
    .eq('status', transition.expectedStatus)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data ? toMatch(data) : null;
}

export async function listPhaseMatchesReadyForAutoConfirm(
  nowIso = new Date().toISOString(),
  limit = 50
): Promise<PhaseMatchWithPlayers[]> {
  const { data, error } = await supabase
    .from('phase_matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .eq('status', AUTO_CONFIRM_FROM)
    .not('auto_confirm_at', 'is', null)
    .lte('auto_confirm_at', nowIso)
    .order('auto_confirm_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data.map((row) => toMatchWithPlayers(row as MatchWithPlayersRow));
}

export interface FinalizeWorklistCursor {
  updated_at: string;
  id: string;
}

export async function listPhaseMatchesNeedingFinalize(
  updatedBeforeIso: string,
  limit = 25,
  after?: FinalizeWorklistCursor
): Promise<PhaseMatchWithPlayers[]> {
  let query = supabase
    .from('phase_matches')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .eq('status', 'completed')
    .is('finalized_at', null)
    .lte('updated_at', updatedBeforeIso);

  if (after) {
    assertValidUuid(after.id, 'cursor match id');
    const at = postgrestQuoted(after.updated_at);
    query = query.or(`updated_at.gt.${at},and(updated_at.eq.${at},id.gt.${postgrestQuoted(after.id)})`);
  }

  const { data, error } = await query
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data.map((row) => toMatchWithPlayers(row as MatchWithPlayersRow));
}

export async function markPhaseMatchFinalized(
  id: string,
  finalizedAt = new Date().toISOString(),
  completion?: { confirmedAt: string | null }
): Promise<boolean> {
  assertValidUuid(id, 'match id');

  let query = supabase
    .from('phase_matches')
    .update({ finalized_at: finalizedAt })
    .eq('id', id)
    .eq('status', 'completed');
  if (completion) {
    query = completion.confirmedAt === null ? query.is('confirmed_at', null) : query.eq('confirmed_at', completion.confirmedAt);
  }
  const { data, error } = await query.select('id');

  if (error) throw error;
  return data.length > 0;
}


export async function getMatchesByPhase(phaseId: string): Promise<PhaseMatchWithRoundNumber[]> {
  const rows = await readAllPages((from, to) => supabase.from('phase_matches').select(MATCH_WITH_PLAYERS_SELECT)
    .eq('phase_id', phaseId).order('created_at').order('id').range(from, to));
  return rows.map((row) => toMatchWithPlayers(row as MatchWithPlayersRow));
}

export async function getPhaseHeadToHead(phaseId: string, playerA: string, playerB: string) {
  assertValidUuid(phaseId, 'phaseId');
  assertValidUuid(playerA, 'playerA');
  assertValidUuid(playerB, 'playerB');
  const a = postgrestQuoted(playerA);
  const b = postgrestQuoted(playerB);
  return readAllPages((from, to) => supabase.from('phase_matches')
    .select('id, phase_id, winner_id, games:phase_games(winner_id)')
    .eq('phase_id', phaseId)
    .eq('status', 'completed')
    .or(`and(player_1_id.eq.${a},player_2_id.eq.${b}),and(player_1_id.eq.${b},player_2_id.eq.${a})`)
    .order('created_at').order('id').range(from, to));
}

export async function deletePhaseMatchesByIds(ids: string[], effects: PhaseMatchChildrenEffects): Promise<void> {
  if (!ids.length) return;
  if (typeof effects?.releaseTeams !== 'function') throw new Error('Native phase team release effect is required before match deletion');
  const unique = [...new Set(ids)];
  for (const id of unique) assertValidUuid(id, 'match id');
  for (const id of unique) await effects.releaseTeams(id);
  const { error } = await supabase.rpc('phase_matches_delete_scheduled', { p_match_ids: unique });
  if (error) {
    if (error.code === 'P0001' && error.message === 'phase_match_delete_changed') {
      logger.warn('phase-match/delete', 'Native match deletion refused after team release', { error, matchIds: unique });
      throw new UserFacingError('A match of this round changed while it was being deleted, so nothing was deleted. Reload the round and try again.', { code: 'round_changed', status: 409 });
    }
    throw error;
  }
}

export interface DownstreamPhaseMatchSnapshot {
  phase_id: string;
  winner_id: string | null;
  round_id: string;
}

export async function hasDownstreamPhaseMatches(matchId: string, snapshot?: DownstreamPhaseMatchSnapshot): Promise<boolean> {
  let source = snapshot;
  if (!source) {
    const { data, error } = await supabase.from('phase_matches').select('phase_id, winner_id, round_id').eq('id', matchId).single();
    if (error) throw error;
    source = data;
  }
  if (!source.winner_id) return false;
  assertValidUuid(source.winner_id, 'winner id');
  const { data: round, error } = await supabase.from('phase_rounds').select('round_number')
    .eq('phase_id', source.phase_id).eq('id', source.round_id).single();
  if (error) throw error;
  const later = await readAllPages((from, to) => supabase.from('phase_rounds').select('id')
    .eq('phase_id', source.phase_id).gt('round_number', round.round_number).order('id').range(from, to));
  for (let offset = 0; offset < later.length; offset += 100) {
    const { data, error: downstreamError } = await supabase.from('phase_matches').select('id')
      .eq('phase_id', source.phase_id).in('round_id', later.slice(offset, offset + 100).map((row) => row.id))
      .or(`player_1_id.eq.${source.winner_id},player_2_id.eq.${source.winner_id}`).limit(1);
    if (downstreamError) throw downstreamError;
    if (data.length) return true;
  }
  return false;
}

export async function createPhaseMatchBatch(inputs: { round_id: string; phase_id: string; player_1_id: string; player_2_id: string; bracket_side?: PhaseMatch['bracket_side']; bracket_pos?: number | null }[]): Promise<PhaseMatch[]> {
  if (!inputs.length) return [];
  const { data, error } = await supabase.from('phase_matches').insert(inputs).select();
  if (error) throw error;
  return data.map(toMatch);
}
export async function updatePhaseMatchPlayers(
  id: string,
  player1Id: string,
  player2Id: string
): Promise<PhaseMatch | null> {
  const { data, error } = await supabase
    .from('phase_matches')
    .update({
      player_1_id: player1Id,
      player_2_id: player2Id,
      winner_id: null,
      status: 'scheduled' as MatchStatus,
      finalized_at: null,
    })
    .eq('id', id)
    .eq('status', 'scheduled')
    .select()
    .maybeSingle();

  if (error) throw error;
  return data ? toMatch(data) : null;
}

export async function repairPhaseMatchPairing(
  id: string,
  player1Id: string,
  player2Id: string,
  expected: { status: MatchStatus; player_1_id: string; player_2_id: string }
): Promise<PhaseMatchWithPlayers | null> {
  if (expected.status !== 'scheduled') phaseMatchMachine.assertTransition(expected.status, 'scheduled', 'admin');
  const { data, error } = await supabase
    .from('phase_matches')
    .update({
      player_1_id: player1Id,
      player_2_id: player2Id,
      winner_id: null,
      submitter_id: null,
      date_played: null,
      scheduled_at: null,
      auto_confirm_at: null,
      confirmed_at: null,
      finalized_at: null,
      status: 'scheduled' as MatchStatus,
    })
    .eq('id', id)
    .eq('status', expected.status)
    .eq('player_1_id', expected.player_1_id)
    .eq('player_2_id', expected.player_2_id)
    .select(MATCH_WITH_PLAYERS_SELECT)
    .maybeSingle();

  if (error) throw error;
  return data ? toMatchWithPlayers(data as MatchWithPlayersRow) : null;
}

export async function updatePhaseMatchSchedule(
  id: string,
  scheduledAt: string | null
): Promise<PhaseMatchWithPlayers> {
  assertValidUuid(id, 'match id');

  const { data, error } = await supabase
    .from('phase_matches')
    .update({ scheduled_at: scheduledAt })
    .eq('id', id)
    .select(MATCH_WITH_PLAYERS_SELECT)
    .single();

  if (error) throw error;
  return toMatchWithPlayers(data as MatchWithPlayersRow);
}

export async function updateOpenPhaseMatchSchedule(
  id: string,
  scheduledAt: string | null
): Promise<PhaseMatchWithPlayers | null> {
  assertValidUuid(id, 'match id');

  const { data, error } = await supabase
    .from('phase_matches')
    .update({ scheduled_at: scheduledAt })
    .eq('id', id)
    .neq('status', 'completed')
    .select(MATCH_WITH_PLAYERS_SELECT)
    .maybeSingle();

  if (error) throw error;
  return data ? toMatchWithPlayers(data as MatchWithPlayersRow) : null;
}

export async function setPhaseMatchScheduledAtIfOpen(id: string, scheduledAt: string): Promise<PhaseMatch | null> {
  return updateOpenPhaseMatchSchedule(id, scheduledAt);
}

export async function updatePhaseMatchNotesIfUnchanged(
  id: string,
  expectedUpdatedAt: string,
  notes: string
): Promise<PhaseMatch | null> {
  assertValidUuid(id, 'match id');
  const { data, error } = await supabase
    .from('phase_matches')
    .update({ notes })
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? toMatch(data) : null;
}

export async function updatePhaseMatchSocialImageUrl(
  matchId: string,
  socialImageUrl: string | null,
): Promise<void> {
  assertValidUuid(matchId);
  const { error } = await supabase
    .from('phase_matches')
    .update({ social_image_url: socialImageUrl })
    .eq('id', matchId);
  if (error) throw error;
}
