/**
 * Re-parse the Showdown replay attached to a recorded game and rewrite its
 * battle_stats through the shipped admin edit pipeline (`editGame`).
 *
 * Use after a replay-parser fix lands to repair stats recorded from the buggy
 * parser: the game's stored `replay_url` is fetched again, parsed with the
 * CURRENT parser, and the resulting rows are written through `editGame` — the
 * same path the admin game editor uses (PATCH /api/admin/games/[id]), so
 * aggregates roll back and re-apply, match status and gamification
 * re-evaluate, evolutions re-check (EPB debit/credit), and `stats_locked` is
 * set. The winner is left untouched: `editGame` derives `match_won` from the
 * game's unchanged `winner_id`.
 *
 * ---------------------------------------------------------------------------
 * Prerequisites
 * ---------------------------------------------------------------------------
 *   1. A reachable Supabase database with service-role env vars present
 *      (`.env.local` is auto-loaded):
 *        NEXT_PUBLIC_SUPABASE_URL
 *        SUPABASE_SERVICE_ROLE_KEY
 *   2. On a private-pack league: run from a checkout that carries the pack
 *      (`src/format-packs/private/`). The EPB evolution recheck inside
 *      `editGame` reads `epbPack`; under the public example pack a write run
 *      resolves stages with the wrong tuning.
 *   3. `--actor=<player uuid>` for `--apply` — the admin's own player id; it is
 *      recorded on the audit event and used for the status re-evaluation.
 *
 * ---------------------------------------------------------------------------
 * How to run
 * ---------------------------------------------------------------------------
 *   # DRY-RUN (default; READ-ONLY — prints stored vs re-parsed rows):
 *   npx tsx --tsconfig scripts/tsconfig.reparse.json scripts/reparse-game.ts --game=<uuid>
 *
 *   # WRITE run (replaces battle_stats through editGame):
 *   npx tsx --tsconfig scripts/tsconfig.reparse.json scripts/reparse-game.ts \
 *     --game=<uuid> --actor=<admin player uuid> --apply
 *
 *   # Write despite a species-set mismatch, a changed replay hash or stats_locked (see below):
 *   ... --apply --force
 *
 * ---------------------------------------------------------------------------
 * What it does and does not do
 * ---------------------------------------------------------------------------
 *   - Does NOT revalidate public pages: `revalidateMatchPages` needs a Next
 *     request context. Public read caches expire on their own within their
 *     TTL; to show the fix immediately, touch the match from the admin UI
 *     (any write there revalidates the same pages).
 *   - Side→player resolution votes from the stored rows' species ownership —
 *     the same mapping `replay-import` recorded — and refuses to write when a
 *     side cannot be resolved to a distinct match participant.
 *   - The species sets per side (from team preview) are compared against the
 *     stored sets per player. A mismatch means the re-parse emits different
 *     Pokémon rows than the game holds — refused without `--force` since that
 *     is usually a wrong replay, wrong game, or a parser change that wants a
 *     human look first.
 *   - Also refused without `--force`: a re-fetched replay whose hash differs
 *     from the stored `replay_hash` (the remote replay changed), and a game
 *     with `stats_locked` (an admin corrected its stats by hand).
 *   - Writes nothing when the re-parse matches the stored rows, and requires
 *     `--actor` to be an active admin.
 *   - Doubles: the parser attributes moves and KOs per side, not per slot
 *     (#53), so an Illusion split in a doubles game is not reliable yet.
 *
 * This script is READ-ONLY by default (dry-run). It only mutates data with
 * `--apply`. It never applies migrations.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ParsedBattleStats, BattleStat, EditBattleStatInput } from '@/types/game';
import type { MatchWithPlayers } from '@/types/match';

// ── Env loading (called from main() AFTER parseArgs()) ────────────────────
// Same as run-season-audit.ts: the shared `supabase` client reads
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY eagerly at module
// load, so `.env.local`/`.env` must be on process.env before the engine
// imports resolve.
function loadEnvFiles(): void {
  for (const name of ['.env.local', '.env']) {
    try {
      const content = readFileSync(resolve(process.cwd(), name), 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    } catch {
      // optional file
    }
  }
}

// ── Arg parsing ────────────────────────────────────────────────────────────

interface ReparseArgs {
  gameId: string;
  /** Admin's player id, required for --apply (audit + status re-eval). */
  actorId: string | null;
  apply: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): ReparseArgs {
  const getArg = (name: string): string | null =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;

  const gameId = getArg('game')?.trim() ?? null;
  const apply = argv.includes('--apply');
  const force = argv.includes('--force');
  const actorId = getArg('actor')?.trim() ?? null;

  const uuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!gameId || !uuid.test(gameId)) {
    console.error('Usage: reparse-game.ts --game=<game uuid> [--actor=<admin player uuid>] [--apply] [--force]');
    process.exit(1);
  }
  if (apply && (!actorId || !uuid.test(actorId))) {
    console.error('--apply requires --actor=<admin player uuid> (the edit is audited as theirs).');
    process.exit(1);
  }
  return { gameId, actorId, apply, force };
}

// ── Side → player resolution ───────────────────────────────────────────────

/**
 * Map each parsed replay side (index 0 = p1, 1 = p2) to a match participant by
 * voting the stored rows' species ownership. A side whose species are all
 * unmapped falls back to the participant the other side did not resolve to.
 * Returns [p1 player_id, p2 player_id]; throws when it cannot resolve both
 * sides to the match's two distinct participants.
 */
function resolveSidePlayers(
  parsed: ParsedBattleStats,
  oldStats: BattleStat[],
  match: MatchWithPlayers,
): [string, string] {
  const participants = new Set([match.player_1_id, match.player_2_id]);
  const monToPlayer = new Map(oldStats.map((s) => [s.pokemon_name, s.player_id]));

  const resolved = parsed.players.map((side, idx) => {
    const votes = new Map<string, number>();
    for (const mon of side.pokemon) {
      const owner = monToPlayer.get(mon.pokemon_name);
      if (owner) votes.set(owner, (votes.get(owner) ?? 0) + 1);
    }
    let best: { player: string; count: number } | null = null;
    for (const [player, count] of votes) {
      if (!best || count > best.count) best = { player, count };
    }
    if (best) return best.player;
    // No mapped species: take the participant the other side did not claim.
    const other = parsed.players[1 - idx];
    const otherVotes = new Set(
      other.pokemon.map((m) => monToPlayer.get(m.pokemon_name)).filter(Boolean) as string[],
    );
    for (const participant of participants) {
      if (!otherVotes.has(participant)) return participant;
    }
    return null;
  });

  const [p1Player, p2Player] = resolved;
  if (
    !p1Player || !p2Player ||
    p1Player === p2Player ||
    !participants.has(p1Player) ||
    !participants.has(p2Player)
  ) {
    throw new Error(
      `Could not resolve replay sides to the match's participants ` +
        `(p1 → ${p1Player}, p2 → ${p2Player}; match has ${match.player_1_id} / ${match.player_2_id}).`,
    );
  }
  return [p1Player, p2Player];
}

// ── Diff printing ──────────────────────────────────────────────────────────

interface StatRow {
  was_brought: boolean;
  was_lead: boolean;
  kos_dealt: number;
  was_koed: boolean;
  turns_active: number;
  moves_used: string[];
}

function rowOf(s: StatRow): string {
  return `brought=${s.was_brought} lead=${s.was_lead} KOs=${s.kos_dealt} ` +
    `koed=${s.was_koed} turns=${s.turns_active} moves=[${s.moves_used.join(', ')}]`;
}

function sameStatRow(a: StatRow, b: StatRow): boolean {
  return (
    a.was_brought === b.was_brought &&
    a.was_lead === b.was_lead &&
    a.kos_dealt === b.kos_dealt &&
    a.was_koed === b.was_koed &&
    a.turns_active === b.turns_active &&
    a.moves_used.join('|') === b.moves_used.join('|')
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFiles();

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local/.env).');
    process.exit(1);
  }

  // Dynamic imports: env must be loaded first (supabase client reads it eagerly).
  const { getGameById, getBattleStatsByGame } = await import('@/lib/supabase/queries/games');
  const { getMatchById } = await import('@/lib/supabase/queries/matches');
  const { getPlayerById } = await import('@/lib/supabase/queries/players');
  const { fetchBoundReplay } = await import('@/lib/pkmn/replay-binding');
  const { editGame } = await import('@/lib/pkmn/game-pipeline');
  const { logAuditEvent } = await import('@/lib/audit/log');

  const game = await getGameById(args.gameId);
  if (!game) throw new Error(`Game ${args.gameId} not found`);
  if (!game.replay_url) throw new Error(`Game ${args.gameId} has no replay_url (source: ${game.source})`);

  const match = await getMatchById(game.match_id);
  if (!match) throw new Error(`Match ${game.match_id} for game ${args.gameId} not found`);

  const oldStats = await getBattleStatsByGame(args.gameId);

  console.log(`Game ${game.id} (match ${game.match_id}, game #${game.game_number}, source ${game.source})`);
  console.log(`Match: ${match.player_1_name} vs ${match.player_2_name} — status ${match.status}`);
  console.log(`Replay: ${game.replay_url}`);

  const bound = await fetchBoundReplay(game.replay_url);
  if (game.replay_hash && bound.hash !== game.replay_hash) {
    console.error(
      `The re-fetched replay hashes to ${bound.hash}, the stored replay_hash is ${game.replay_hash}: ` +
        `the remote replay changed since it was recorded, so this may not be the battle the game holds.`,
    );
    if (!args.force) {
      console.error('Refusing to write. Check the replay, or pass --force to proceed.');
      process.exit(1);
    }
    console.error('--force given: continuing despite the hash mismatch.');
  }

  const parsed = bound.parsed;
  const sidePlayers = resolveSidePlayers(parsed, oldStats, match);
  console.log(`Side players: p1 → ${sidePlayers[0]}, p2 → ${sidePlayers[1]}`);

  const newStats: EditBattleStatInput[] = parsed.players.flatMap((side, idx) =>
    side.pokemon.map((mon) => ({
      player_id: sidePlayers[idx],
      pokemon_name: mon.pokemon_name,
      was_brought: mon.was_brought,
      was_lead: mon.was_lead,
      kos_dealt: mon.kos_dealt,
      was_koed: mon.was_koed,
      moves_used: mon.moves_used,
      turns_active: mon.turns_active,
    })),
  );

  // Species-set sanity: the sets per side (team preview) must equal the sets
  // per player in the stored rows. Team preview is parser-independent, so a
  // mismatch means this is a different battle or a parser change that wants a
  // human look — refuse unless --force.
  const parsedSets = parsed.players.map(
    (side) => new Set(side.pokemon.map((m) => m.pokemon_name)),
  );
  const storedSets = new Map<string, Set<string>>();
  for (const s of oldStats) {
    let set = storedSets.get(s.player_id);
    if (!set) storedSets.set(s.player_id, (set = new Set()));
    set.add(s.pokemon_name);
  }
  const setMismatch = sidePlayers.some((playerId, idx) => {
    const stored = storedSets.get(playerId) ?? new Set<string>();
    const parsedSet = parsedSets[idx];
    if (stored.size !== parsedSet.size) return true;
    for (const name of parsedSet) if (!stored.has(name)) return true;
    return false;
  });
  if (setMismatch) {
    console.error('\nSpecies-set mismatch between stored rows and re-parse:');
    for (const [idx, playerId] of sidePlayers.entries()) {
      console.error(`  side p${idx + 1} (${playerId}):`);
      console.error(`    stored : ${[...(storedSets.get(playerId) ?? [])].sort().join(', ')}`);
      console.error(`    parsed : ${[...parsedSets[idx]].sort().join(', ')}`);
    }
    if (!args.force) {
      console.error('\nRefusing to write. Re-check the replay/game, or pass --force to proceed.');
      process.exit(1);
    }
    console.error('\n--force given: writing despite the mismatch.');
  }

  // Diff table (old rows keyed by player+species). newStats fields are
  // optional in EditBattleStatInput — normalize with the same defaults
  // writeGameEdit applies so the diff shows what would actually be stored.
  const oldByKey = new Map(oldStats.map((s) => [`${s.player_id}|${s.pokemon_name}`, s]));
  let changed = 0;
  console.log('\n── Stored → re-parsed ─────────────────────────────────────────');
  for (const s of newStats) {
    const stored: StatRow = {
      was_brought: s.was_brought ?? true,
      was_lead: s.was_lead ?? false,
      kos_dealt: s.kos_dealt ?? 0,
      was_koed: s.was_koed ?? false,
      turns_active: s.turns_active ?? 0,
      moves_used: s.moves_used ?? [],
    };
    const old = oldByKey.get(`${s.player_id}|${s.pokemon_name}`);
    const marker = old && sameStatRow(old, stored) ? ' ' : '*';
    if (marker === '*') changed++;
    console.log(`${marker} ${s.pokemon_name} (${s.player_id.slice(0, 8)}…)`);
    if (old) console.log(`    old: ${rowOf(old)}`);
    console.log(`    new: ${rowOf(stored)}`);
  }
  for (const s of oldStats) {
    if (!newStats.some((n) => n.player_id === s.player_id && n.pokemon_name === s.pokemon_name)) {
      console.log(`- ${s.pokemon_name} (${s.player_id.slice(0, 8)}…): removed by re-parse`);
      changed++;
    }
  }
  console.log(`\n${changed} of ${newStats.length} rows differ.${game.stats_locked ? ' (stats_locked is set)' : ''}`);

  if (changed === 0) {
    console.log('\nNothing to repair: the re-parse matches the stored rows. Nothing written.');
    return;
  }

  if (!args.apply) {
    console.log('\nDRY-RUN: nothing written. Pass --apply --actor=<admin player uuid> to write.');
    return;
  }

  // A locked game holds stats an admin corrected by hand: replacing them needs the same explicit --force.
  if (game.stats_locked && !args.force) {
    console.error('\nThe game has stats_locked set (hand-corrected stats). Refusing to replace them; pass --force to proceed.');
    process.exit(1);
  }

  const actor = await getPlayerById(args.actorId!);
  if (!actor) throw new Error(`--actor ${args.actorId} is not a known player`);
  if (!actor.is_admin || actor.status !== 'active') {
    throw new Error(`--actor ${args.actorId} is not an active admin; the audit event must name the admin responsible`);
  }

  const result = await editGame({
    game_id: args.gameId,
    admin_id: args.actorId!,
    battle_stats: newStats,
  });

  logAuditEvent({
    actor_id: args.actorId!,
    actor_name: actor.name,
    action: 'game.edit',
    resource_type: 'game',
    resource_id: args.gameId,
    resource_name: `${match.player_1_name} vs ${match.player_2_name} game ${game.game_number}`,
    metadata: {
      match_id: game.match_id,
      tournament_id: match.tournament_id,
      repair: 'reparse_replay',
      replay_url: game.replay_url,
      replay_hash: bound.hash,
      battle_stats_replaced: true,
      rows_changed: changed,
      match_status: result.match_status,
      match_winner_id: result.match_winner_id,
      ...(result.match_status_conflict ? { match_status_conflict: true } : {}),
    },
  });

  if (result.match_status_conflict) {
    console.warn(
      '\nWARNING: the match changed while the stats were written (match_status_conflict); its status was not ' +
        're-evaluated. Check the match in the admin UI.',
    );
  }
  console.log('\nApplied via editGame:');
  console.log(`  match_status   : ${result.match_status}`);
  console.log(`  match_winner_id: ${result.match_winner_id}`);
  console.log(`  evolution events: ${result.evolution_events.length}`);
  if (result.evolution_recheck_failed) {
    console.log('  WARNING: EPB evolution recheck failed (evolution_recheck_failed) — run the season reconcile.');
  }
  console.log(
    '\nNote: public pages are NOT revalidated from a script (Next request context only).\n' +
      'Read caches expire within their TTL; to show the fix now, touch the match in the admin UI.',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
