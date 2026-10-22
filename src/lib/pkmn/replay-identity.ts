import { createHash } from 'node:crypto';

/**
 * Replay identity: the SHA-256 that binds one Showdown battle to at most one recorded game
 * (`games.replay_hash`, UNIQUE where set; migration `20261020100000_games_replay_hash.sql`).
 *
 * What is hashed is the battle, not the URL: the same battle linked as a bare id, a full URL,
 * a `.json` link, with `?p2` or `#turn-5`, as a private `-<password>` replay, or uploaded again
 * by the other player must give the same hash, and two different battles must not. The input is
 * the replay's `log` field (what `fetchReplay` returns), canonicalised by `canonicalReplayLog`:
 *
 * 1. Line endings are normalised (`\r\n` and `\r` become `\n`); trailing whitespace is trimmed.
 * 2. Only protocol lines are kept (lines that start with `|`); the bare `|` spacer line is dropped.
 * 3. Lines that are not battle events are dropped: chat (`c`, `c:`, `chat`), joins, leaves and
 *    renames (`j`, `J`, `join`, `l`, `L`, `leave`, `n`, `N`, `name`), server HTML (`raw`, `html`,
 *    `uhtml`, `uhtmlchange`), timer notices (`inactive`, `inactiveoff`), moderation
 *    (`hidelines`, `unlink`) and `bigerror`, `error`, `debug`. These change with who was in the
 *    room, when the replay was uploaded and later moderation, not with the battle.
 * 4. `|split|<side>` blocks keep only their public line: the marker and the secret line after it
 *    (exact HP for one player) are dropped, so a player-perspective log and a spectator log of
 *    the same battle canonicalise alike.
 * 5. Everything after the first `|win|` or `|tie|` line is dropped (post-battle rating lines and
 *    chat grow with every later upload).
 *
 * Everything else stays, in order, including the `|t:|` timestamps, `|player|` lines, team
 * preview and every turn: the timestamps make two otherwise identical short battles (say, the
 * same teams and a forfeit at team preview) distinct.
 *
 * The digest is `sha256(REPLAY_HASH_VERSION + "\n" + canonical lines joined by "\n")` as 64
 * lowercase hex characters. Changing any rule above changes every hash: bump
 * `REPLAY_HASH_VERSION` and re-run `scripts/backfill-replay-hashes.ts` against a cleared column.
 *
 * This module is dependency-free (Node's crypto only, no path aliases) so the backfill script
 * runs it under `tsx` exactly as the app does.
 */
export const REPLAY_HASH_VERSION = 'poketools-replay-hash-v1';

/** A stored hash: 64 lowercase hex characters (the CHECK constraint on `games.replay_hash`). */
export const REPLAY_HASH_PATTERN = /^[0-9a-f]{64}$/;

const NON_BATTLE_COMMANDS: ReadonlySet<string> = new Set([
  'c', 'c:', 'chat',
  'j', 'J', 'join',
  'l', 'L', 'leave',
  'n', 'N', 'name',
  'raw', 'html', 'uhtml', 'uhtmlchange',
  'inactive', 'inactiveoff',
  'hidelines', 'unlink',
  'bigerror', 'error', 'debug',
]);

const END_COMMANDS: ReadonlySet<string> = new Set(['win', 'tie']);

/** `|cmd|rest` → `cmd` (the text between the first two pipes). */
function commandOf(line: string): string {
  const end = line.indexOf('|', 1);
  return end === -1 ? line.slice(1) : line.slice(1, end);
}

/** The battle lines of a replay log, canonicalised as described in the module header. */
export function canonicalReplayLog(log: string): string[] {
  const lines = log.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let skipSecretLine = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (skipSecretLine) {
      skipSecretLine = false;
      continue;
    }
    if (!line.startsWith('|') || line === '|') continue;

    const cmd = commandOf(line);
    if (cmd === 'split') {
      skipSecretLine = true;
      continue;
    }
    if (NON_BATTLE_COMMANDS.has(cmd)) continue;

    out.push(line);
    if (END_COMMANDS.has(cmd)) break;
  }

  return out;
}

/**
 * The replay hash of a Showdown replay log (see the module header). Throws when the log holds
 * no battle line at all: such a log identifies no battle and must never be bound to a game.
 */
export function computeReplayHash(log: string): string {
  const lines = canonicalReplayLog(log);
  if (lines.length === 0) {
    throw new Error('Replay log holds no battle lines; it cannot be hashed');
  }
  return createHash('sha256')
    .update(`${REPLAY_HASH_VERSION}\n${lines.join('\n')}`, 'utf8')
    .digest('hex');
}

/** One game's replay hash (stored, or computed by the backfill). */
export interface ReplayHashBinding {
  game_id: string;
  replay_hash: string;
}

/** A hash claimed by more than one game: the unique index would refuse all but one. */
export interface ReplayHashCollision {
  replay_hash: string;
  game_ids: string[];
}

/**
 * Every hash bound to two or more games among `bindings` (the stored ones plus the ones a backfill
 * would write), game ids sorted. `scripts/backfill-replay-hashes.ts` writes nothing while this is
 * non-empty: which game keeps the battle is a maintainer's call, never the script's.
 */
export function findReplayHashCollisions(bindings: readonly ReplayHashBinding[]): ReplayHashCollision[] {
  const byHash = new Map<string, Set<string>>();
  for (const { game_id, replay_hash } of bindings) {
    const games = byHash.get(replay_hash) ?? new Set<string>();
    games.add(game_id);
    byHash.set(replay_hash, games);
  }
  const collisions: ReplayHashCollision[] = [];
  for (const [replay_hash, games] of byHash) {
    if (games.size > 1) collisions.push({ replay_hash, game_ids: [...games].sort() });
  }
  return collisions.sort((a, b) => a.replay_hash.localeCompare(b.replay_hash));
}
