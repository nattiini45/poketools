/**
 * Backfill `games.replay_hash` for games recorded from a replay before the replay binding
 * (owner decision 2026-10-20, audit lead F1; migration
 * supabase/migrations/20261020100000_games_replay_hash.sql).
 *
 * For every game with a non-empty `replay_url` and no `replay_hash`, the script fetches the replay
 * from replay.pokemonshowdown.com with the app's own `fetchReplay` and hashes its log with the
 * app's own `computeReplayHash` (src/lib/pkmn/replay-identity.ts), one request at a time, at most
 * one per `--delay-ms` (default and minimum 1000 ms).
 *
 * DRY RUN BY DEFAULT: it prints the plan and writes nothing. `--write` applies it, and only when
 * the plan holds no collision: if two games (stored hashes included) would carry the same hash,
 * the script lists them and exits 1 without writing anything. Which game keeps that battle is a
 * maintainer's call (the admin game delete), never the script's. Each write is fenced on
 * `replay_hash IS NULL`, so a game that got its hash meanwhile is left alone, and the unique index
 * still refuses a duplicate. A replay that cannot be fetched (deleted, private, not a Showdown
 * URL) is reported and left NULL.
 *
 * Writing a game's hash moves its `updated_at` (trigger trg_games_updated): an admin game editor
 * open on that game during the run answers 409 `admin_game_edit_stale` and is reloaded.
 *
 * It talks to Supabase only when a maintainer runs it, with the service-role credentials given in
 * the environment. It never reads a .env file by itself; pass one explicitly:
 *
 *   npx tsx --env-file=.env.local scripts/backfill-replay-hashes.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/backfill-replay-hashes.ts --write    # apply
 *
 * Options: --write, --limit <n> (only the first n games without a hash), --delay-ms <ms> (>= 1000).
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';
import { fetchReplay } from '../src/lib/pkmn/replay';
import {
  computeReplayHash,
  findReplayHashCollisions,
  type ReplayHashBinding,
} from '../src/lib/pkmn/replay-identity';

const TAG = '[backfill-replay-hashes]';
const PAGE_SIZE = 1000;
const MIN_DELAY_MS = 1000;

interface Options {
  write: boolean;
  limit: number | null;
  delayMs: number;
}

interface GameRow {
  id: string;
  match_id: string;
  game_number: number;
  replay_url: string;
  replay_hash: string | null;
}

function parseOptions(argv: readonly string[]): Options {
  const options: Options = { write: false, limit: null, delayMs: MIN_DELAY_MS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write') {
      options.write = true;
    } else if (arg === '--limit' || arg === '--delay-ms') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) throw new Error(`${arg} needs a positive integer`);
      if (arg === '--limit') options.limit = value;
      else options.delayMs = Math.max(MIN_DELAY_MS, value);
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return options;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`${TAG} NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (pass --env-file).`);
    return 2;
  }
  console.log(`${TAG} target ${new URL(url).host}; ${options.write ? 'WRITE' : 'dry run (pass --write to apply)'}`);

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  // 1. Every game with a replay URL, paged past max_rows.
  const games: GameRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('games')
      .select('id, match_id, game_number, replay_url, replay_hash')
      .neq('replay_url', '')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    games.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  const stored: ReplayHashBinding[] = games
    .filter((g): g is GameRow & { replay_hash: string } => g.replay_hash !== null)
    .map((g) => ({ game_id: g.id, replay_hash: g.replay_hash }));
  let pending = games.filter((g) => g.replay_hash === null);
  if (options.limit !== null) pending = pending.slice(0, options.limit);
  console.log(`${TAG} ${games.length} games with a replay URL, ${stored.length} already hashed, ${pending.length} to fetch`);

  // 2. Fetch and hash, one request per delay.
  const planned: (ReplayHashBinding & { replay_url: string })[] = [];
  const failed: { game_id: string; replay_url: string; reason: string }[] = [];
  for (const [index, game] of pending.entries()) {
    if (index > 0) await sleep(options.delayMs);
    try {
      const replay = await fetchReplay(game.replay_url);
      const replay_hash = computeReplayHash(replay.log);
      planned.push({ game_id: game.id, replay_hash, replay_url: game.replay_url });
      console.log(`${TAG} ${index + 1}/${pending.length} game ${game.id} (match ${game.match_id} #${game.game_number}) ${replay_hash}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ game_id: game.id, replay_url: game.replay_url, reason });
      console.warn(`${TAG} ${index + 1}/${pending.length} game ${game.id}: ${game.replay_url} could not be hashed: ${reason}`);
    }
  }

  // 3. Collisions among stored and planned hashes: refuse to write any of them.
  const collisions = findReplayHashCollisions([...stored, ...planned]);
  if (failed.length > 0) {
    console.warn(`${TAG} ${failed.length} replays could not be fetched or hashed; their games keep replay_hash NULL:`);
    for (const f of failed) console.warn(`  ${f.game_id} ${f.replay_url} (${f.reason})`);
  }
  if (collisions.length > 0) {
    console.error(`${TAG} ${collisions.length} battles are bound to more than one game; nothing is written:`);
    const urlOf = new Map(games.map((g) => [g.id, g.replay_url]));
    for (const c of collisions) {
      console.error(`  ${c.replay_hash}`);
      for (const gameId of c.game_ids) console.error(`    game ${gameId} ${urlOf.get(gameId) ?? ''}`);
    }
    return 1;
  }

  console.log(`${TAG} plan: ${planned.length} hashes to write, no collision`);
  if (!options.write) return 0;

  // 4. Write, fenced on replay_hash IS NULL.
  let written = 0;
  let skipped = 0;
  for (const p of planned) {
    const { data, error } = await supabase
      .from('games')
      .update({ replay_hash: p.replay_hash })
      .eq('id', p.game_id)
      .is('replay_hash', null)
      .select('id');
    if (error) {
      console.error(`${TAG} game ${p.game_id}: write failed after ${written} writes; stopping`, error);
      return 1;
    }
    if (data.length === 0) skipped++;
    else written++;
  }
  console.log(`${TAG} wrote ${written} hashes; ${skipped} games already had one (left alone)`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`${TAG} failed`, err);
    process.exit(1);
  },
);
