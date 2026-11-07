/**
 * Queries behind the challenge ladder (`format_challenges`, 20261106090000_format_challenges.sql). Server only.
 *
 * The writes are the Postgres functions of the migration, one transaction each. Their domain signals (`P0001`, message =
 * code) leave this module as `FormatChallengeError`; anything else goes through `mapFormatRuntimeDbError` and is
 * rethrown unchanged when it is not a format signal. A response after the accept window is not an error of the
 * database: it stores `expired` and returns that row, and `respondToFormatChallenge` raises `challenge_expired` for it.
 * An acceptance after a player left the phase works the same way: the row comes back `cancelled` (no match) and
 * `respondToFormatChallenge` raises `challenge_player_not_enrolled`.
 * A withdrawal after the accept window does the same (`cancelFormatChallenge`): the challenge is stored as expired, which
 * the cooldown counts, never as cancelled, which it ignores.
 * The ladder runs only on the kit engine: making a challenge and accepting one are refused (409 `challenge_ladder_inactive`)
 * while the league's `season_formats.engine` is not `kit`, decided by the database inside the transaction. The refused
 * challenge stays open (declining and withdrawing still work); it is answerable again when the engine goes back to `kit`.
 */
import 'server-only';

import { supabase } from '../client';
import { readBoundedPages } from '../read-bounded-pages';
import type { Tables } from '@/types/database';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { parseDbError } from '@/lib/studio-core/db-errors';
import { isValidUuid } from '@/lib/utils/uuid';
import { mapFormatRuntimeDbError } from './format-runtime';

export type FormatChallengeRow = Tables<'format_challenges'>;
export type FormatChallengeStatus = 'open' | 'accepted' | 'declined' | 'expired' | 'cancelled';

export const FORMAT_CHALLENGE_ERROR_CODES = [
  'challenge_self',
  'challenge_phase_not_found',
  'challenge_phase_closed',
  'challenge_not_participant',
  'challenge_no_open_round',
  'challenge_ladder_inactive',
  'challenge_rank_range',
  'challenge_max_open',
  'challenge_already_open',
  'challenge_cooldown',
  'challenge_not_found',
  'challenge_not_defender',
  'challenge_not_challenger',
  'challenge_not_open',
  'challenge_expired',
  'challenge_player_not_enrolled',
  'challenge_not_ladder',
] as const;
export type FormatChallengeErrorCode = (typeof FORMAT_CHALLENGE_ERROR_CODES)[number];

const FORMAT_CHALLENGE_ERROR_STATUS: { readonly [C in FormatChallengeErrorCode]: number } = {
  challenge_self: 400,
  challenge_phase_not_found: 404,
  challenge_phase_closed: 409,
  challenge_not_participant: 400,
  challenge_no_open_round: 409,
  challenge_ladder_inactive: 409,
  challenge_rank_range: 400,
  challenge_max_open: 409,
  challenge_already_open: 409,
  challenge_cooldown: 409,
  challenge_not_found: 404,
  challenge_not_defender: 403,
  challenge_not_challenger: 403,
  challenge_not_open: 409,
  challenge_expired: 409,
  challenge_player_not_enrolled: 409,
  challenge_not_ladder: 409,
};

/** A refusal of the challenge functions that the viewer can act on; `safeErrorResponse` passes its code and text. */
export class FormatChallengeError<C extends FormatChallengeErrorCode = FormatChallengeErrorCode> extends UserFacingError<C> {
  constructor(code: C) {
    super(errorsSeasons.en[code], { code, status: FORMAT_CHALLENGE_ERROR_STATUS[code] });
    this.name = 'FormatChallengeError';
  }
}

const CHALLENGE_SIGNALS: ReadonlySet<string> = new Set(FORMAT_CHALLENGE_ERROR_CODES);

function isChallengeCode(message: string): message is FormatChallengeErrorCode {
  return CHALLENGE_SIGNALS.has(message);
}

/** Maps a PostgREST error of the challenge functions to a typed error; anything else is returned as `mapFormatRuntimeDbError` does. */
export function mapFormatChallengeDbError(error: unknown): unknown {
  const signal = parseDbError(error);
  if (signal?.code === 'P0001' && signal.message !== undefined && isChallengeCode(signal.message)) {
    return new FormatChallengeError(signal.message);
  }
  return mapFormatRuntimeDbError(error);
}

// ---------------------------------------------------------------------------------------------------------------
// Reads

export interface ListFormatChallengesFilter {
  phaseId?: string;
  status?: FormatChallengeStatus;
  /** Challenges the player made or received. */
  playerId?: string;
}

/** Every challenge of one league, oldest first, paged under PostgREST `max_rows`. */
export async function listFormatChallenges(seasonId: string, filter: ListFormatChallengesFilter = {}): Promise<FormatChallengeRow[]> {
  if (!isValidUuid(seasonId)) return [];
  if ((filter.phaseId !== undefined && !isValidUuid(filter.phaseId)) || (filter.playerId !== undefined && !isValidUuid(filter.playerId))) return [];
  const { rows } = await readBoundedPages<FormatChallengeRow>(
    (from, to) => {
      let query = supabase.from('format_challenges').select('*').eq('season_id', seasonId);
      if (filter.phaseId !== undefined) query = query.eq('phase_id', filter.phaseId);
      if (filter.status !== undefined) query = query.eq('status', filter.status);
      if (filter.playerId !== undefined) query = query.or(`challenger_id.eq.${filter.playerId},defender_id.eq.${filter.playerId}`);
      return query.order('created_at').order('id').range(from, to);
    },
    { label: 'format-challenges list' },
  );
  return rows;
}

export async function getFormatChallenge(challengeId: string): Promise<FormatChallengeRow | null> {
  if (!isValidUuid(challengeId)) return null;
  const { data, error } = await supabase.from('format_challenges').select('*').eq('id', challengeId).maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------------------------------------------
// Writes

/** The generated RPC types mark every parameter non-null although the functions accept NULL for these. */
const nullable = (value: string | null): string => value as string;

export interface CreateFormatChallengeInput {
  seasonId: string;
  phaseId: string;
  challengerId: string;
  defenderId: string;
  /** Places in the stage standings (1 = first), computed by the caller. */
  challengerRank: number;
  defenderRank: number;
  rankRange: number;
  maxOpen: number;
  cooldownRounds: number;
  acceptWindowHours: number;
}

/**
 * Makes a challenge in the phase's open round. Raises `challenge_self`, `challenge_phase_not_found`,
 * `challenge_ladder_inactive` (the league's engine is not kit), `challenge_phase_closed`, `challenge_not_participant`, `challenge_no_open_round`, `challenge_rank_range`,
 * `challenge_already_open`, `challenge_max_open`, `challenge_cooldown`.
 */
export async function createFormatChallenge(input: CreateFormatChallengeInput): Promise<FormatChallengeRow> {
  const { data, error } = await supabase.rpc('format_challenge_create', {
    p_season_id: input.seasonId,
    p_phase_id: input.phaseId,
    p_challenger: input.challengerId,
    p_defender: input.defenderId,
    p_challenger_rank: input.challengerRank,
    p_defender_rank: input.defenderRank,
    p_rank_range: input.rankRange,
    p_max_open: input.maxOpen,
    p_cooldown_rounds: input.cooldownRounds,
    p_accept_window_hours: input.acceptWindowHours,
  });
  if (error) throw mapFormatChallengeDbError(error);
  return data;
}

export interface RespondFormatChallengeInput {
  /** The league the challenge belongs to: a challenge of another league is `challenge_not_found`. */
  seasonId: string;
  challengeId: string;
  /** The signed-in defender. */
  playerId: string;
  accept: boolean;
}

/**
 * The defender accepts (a scheduled match is created in the open round) or declines. A challenge of another league is
 * `challenge_not_found`, so a route scoped to one league cannot reach the challenges of another. Raises `challenge_not_found`,
 * `challenge_not_defender`, `challenge_not_open`, `challenge_phase_closed`, `challenge_no_open_round`,
 * `challenge_ladder_inactive` (an acceptance while the league's engine is not kit: no match, the challenge stays open), and
 * `challenge_expired` when the accept window had run out (the challenge is stored as expired), and
 * `challenge_player_not_enrolled` when an acceptance finds the challenger or the defender no longer enrolled in the phase
 * (the challenge is stored as cancelled and no match is made).
 */
export async function respondToFormatChallenge(input: RespondFormatChallengeInput): Promise<FormatChallengeRow> {
  const { data, error } = await supabase.rpc('format_challenge_respond', {
    p_season_id: input.seasonId,
    p_challenge_id: input.challengeId,
    p_player: input.playerId,
    p_accept: input.accept,
  });
  if (error) throw mapFormatChallengeDbError(error);
  if (data.status === 'expired') throw new FormatChallengeError('challenge_expired');
  // Only an acceptance can come back cancelled (a decline is `declined`): one of the players left the phase.
  if (data.status === 'cancelled') throw new FormatChallengeError('challenge_player_not_enrolled');
  return data;
}

/**
 * The challenger (or an admin, `playerId` null) withdraws an open challenge of the league. A challenge of another league
 * is `challenge_not_found`, so a route scoped to one league cannot reach the challenges of another. Raises
 * `challenge_expired` when the accept window had already run out: the challenge is stored as expired, not cancelled, so
 * the cooldown of its pair still counts it (a lapsed challenge cannot be withdrawn to skip the cooldown).
 */
export async function cancelFormatChallenge(seasonId: string, challengeId: string, playerId: string | null): Promise<FormatChallengeRow> {
  const { data, error } = await supabase.rpc('format_challenge_cancel', {
    p_season_id: seasonId,
    p_challenge_id: challengeId,
    p_player: nullable(playerId),
  });
  if (error) throw mapFormatChallengeDbError(error);
  if (data.status === 'expired') throw new FormatChallengeError('challenge_expired');
  return data;
}

/** Marks the open challenges past their accept window expired (one league, or all when `seasonId` is null). Returns how many. */
export async function expireFormatChallenges(seasonId: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('format_challenges_expire', { p_season_id: nullable(seasonId) });
  if (error) throw mapFormatChallengeDbError(error);
  return data;
}
