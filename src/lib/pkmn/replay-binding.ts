import { fetchReplay, parseReplayLog } from '@/lib/pkmn/replay';
import { computeReplayHash } from '@/lib/pkmn/replay-identity';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { BattleStatInsert, ParsedBattleStats } from '@/types/game';

/**
 * A replay bound to its battle (owner decision 2026-10-20, audit lead F1): one fetched Showdown
 * log, its hash (`computeReplayHash`, docs in `replay-identity.ts`) and the stats parsed from that
 * same log. A game recorded from a replay takes its winner and its stats from here and stores the
 * hash on its `games` row in the same insert, so a recorded result can never come from a
 * different battle than the hash it carries, nor from a value the client sent.
 *
 * Only `bindReplay` (and `fetchBoundReplay`) produce one: the brand keeps a hand-built object with
 * a mismatched hash or edited stats from type-checking as a `BoundReplay`.
 */
declare const boundReplayBrand: unique symbol;

export interface BoundReplay {
  /** The URL or id the caller submitted (stored as `games.replay_url`). */
  readonly url: string;
  /** SHA-256 of the canonical battle log (stored as `games.replay_hash`). */
  readonly hash: string;
  /** Stats parsed from the same log the hash was computed from. */
  readonly parsed: ParsedBattleStats;
  readonly [boundReplayBrand]: true;
}

/** Hash and parse ONE log: the only way to make a `BoundReplay`. */
export function bindReplay(url: string, log: string): BoundReplay {
  return {
    url,
    hash: computeReplayHash(log),
    parsed: parseReplayLog(log),
  } as BoundReplay;
}

/** Fetch a Showdown replay once and bind it (`fetchReplay` + `bindReplay`). */
export async function fetchBoundReplay(url: string): Promise<BoundReplay> {
  const replay = await fetchReplay(url);
  return bindReplay(url, replay.log);
}

/** The replay names no winner among its two sides (a tie, or a log cut before the end). */
export class ReplayWinnerUnknownError extends UserFacingError {
  constructor() {
    super('Could not determine winner from replay', { code: 'replay_winner_unknown', status: 400 });
    this.name = 'ReplayWinnerUnknownError';
  }
}

/** Both replay sides resolve or were assigned to the same registered player. */
export class ReplaySidesNotDistinctError extends UserFacingError {
  constructor() {
    super('Both sides of the replay belong to the same player.', {
      code: 'replay_sides_not_distinct',
      status: 400,
    });
    this.name = 'ReplaySidesNotDistinctError';
  }
}

/** A replay side was assigned to a player outside the match. */
export class ReplaySidePlayerNotParticipantError extends UserFacingError<'match_player_not_participant'> {
  constructor(playerId: string) {
    super(`Player ${playerId} is not in this match`, {
      code: 'match_player_not_participant',
      params: { playerId },
      status: 400,
    });
    this.name = 'ReplaySidePlayerNotParticipantError';
  }
}

export interface ReplayResult {
  winner_id: string;
  /** One row per Pokémon per side, `game_id` left empty for the pipeline to set. */
  battle_stats: BattleStatInsert[];
}

/**
 * The game result a bound replay records when its side p1 is `sidePlayerIds[0]` and side p2 is
 * `sidePlayerIds[1]`: the winner is the player of the side the log's `|win|` line names, and the
 * stats are the parsed rows of each side, unchanged. The two ids must be the match's two
 * participants, one per side. Throws a `UserFacingError` (400) otherwise, or when the log names
 * no side as the winner. Pure: no read, no write.
 */
export function resultFromBoundReplay(
  replay: BoundReplay,
  sidePlayerIds: readonly [string, string],
  participants: readonly [string, string],
): ReplayResult {
  for (const playerId of sidePlayerIds) {
    if (playerId !== participants[0] && playerId !== participants[1]) {
      throw new ReplaySidePlayerNotParticipantError(playerId);
    }
  }
  if (sidePlayerIds[0] === sidePlayerIds[1]) throw new ReplaySidesNotDistinctError();

  const sides = replay.parsed.players;
  if (sides.length !== 2) throw new ReplayWinnerUnknownError();
  const winnerSide = sides.findIndex((side) => side.ps_username === replay.parsed.winner_ps_username);
  if (!replay.parsed.winner_ps_username || winnerSide === -1) throw new ReplayWinnerUnknownError();

  const battle_stats: BattleStatInsert[] = [];
  sides.forEach((side, index) => {
    const playerId = sidePlayerIds[index];
    for (const poke of side.pokemon) {
      battle_stats.push({
        game_id: '', // set by the pipeline
        player_id: playerId,
        pokemon_name: poke.pokemon_name,
        was_brought: poke.was_brought,
        was_lead: poke.was_lead,
        kos_dealt: poke.kos_dealt,
        was_koed: poke.was_koed,
        moves_used: poke.moves_used,
        turns_active: poke.turns_active,
      });
    }
  });

  return { winner_id: sidePlayerIds[winnerSide], battle_stats };
}
