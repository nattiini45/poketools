/**
 * The challenge ladder of a kit league (`pairing.challenge`): making, answering and withdrawing challenges, and expiring
 * the ones nobody answered. The rules are enforced by the database (`format_challenge_*`); this module reads what they
 * cannot, the stage's `challenge` settings and the players' places in the stage standings, and refreshes the public
 * pages after an accepted challenge created a match. Server only. The HTTP routes are not part of this module.
 */
import 'server-only';

import { expireTournamentReads } from '@/lib/revalidation';
import {
  cancelFormatChallenge,
  createFormatChallenge,
  expireFormatChallenges,
  FormatChallengeError,
  respondToFormatChallenge,
  type FormatChallengeRow,
} from '@/lib/supabase/queries/format-challenges';
import { challengeOf } from './challenge';
import { loadFreshKitContext, phaseById } from './runtime/load';
import { loadStageTable } from './runtime/stage-table';

export interface MakeChallengeInput {
  seasonId: string;
  /** The phase (tournament) that runs the challenge stage. */
  phaseId: string;
  challengerId: string;
  defenderId: string;
}

/**
 * Makes a challenge. Raises a `FormatChallengeError`: `challenge_not_ladder` (the phase is not a challenge stage, or the
 * league does not run a kit format), `challenge_phase_not_found`, `challenge_not_participant` (a player is not in the
 * stage table), and the database's rules (`challenge_rank_range`, `challenge_max_open`, `challenge_cooldown`, ...).
 */
export async function makeChallenge(input: MakeChallengeInput): Promise<FormatChallengeRow> {
  const ctx = await loadFreshKitContext(input.seasonId);
  if (ctx === null) throw new FormatChallengeError('challenge_not_ladder');
  const phase = phaseById(ctx, input.phaseId);
  if (phase === undefined) throw new FormatChallengeError('challenge_phase_not_found');
  const config = challengeOf(phase.stage.pairing);
  if (config === null) throw new FormatChallengeError('challenge_not_ladder');

  const table = await loadStageTable(ctx, input.phaseId);
  const challenger = table?.find((row) => row.player_id === input.challengerId);
  const defender = table?.find((row) => row.player_id === input.defenderId);
  if (challenger === undefined || defender === undefined) throw new FormatChallengeError('challenge_not_participant');

  return createFormatChallenge({
    seasonId: input.seasonId,
    phaseId: input.phaseId,
    challengerId: input.challengerId,
    defenderId: input.defenderId,
    challengerRank: challenger.rank,
    defenderRank: defender.rank,
    rankRange: config.rank_range,
    maxOpen: config.max_open,
    cooldownRounds: config.cooldown_rounds,
    acceptWindowHours: config.accept_window_hours,
  });
}

/** The defender answers. An accepted challenge created a match, so the public pages of the phase are refreshed. */
export async function answerChallenge(input: { challengeId: string; playerId: string; accept: boolean }): Promise<FormatChallengeRow> {
  const row = await respondToFormatChallenge(input);
  if (row.status === 'accepted') expireTournamentReads(row.phase_id, row.season_id);
  return row;
}

/** The challenger withdraws an open challenge (`playerId` null: an admin does it for them). */
export function withdrawChallenge(challengeId: string, playerId: string | null): Promise<FormatChallengeRow> {
  return cancelFormatChallenge(challengeId, playerId);
}

/**
 * Expires every open challenge past its accept window, in one league or (`seasonId` null) in all. Meant for the cron
 * pass; returns how many challenges it expired.
 */
export function expireChallenges(seasonId: string | null = null): Promise<number> {
  return expireFormatChallenges(seasonId);
}
