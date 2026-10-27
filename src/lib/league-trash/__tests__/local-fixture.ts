/**
 * Seeds one evolution-point-buy league that touches EVERY owned table of the league recycle bin, through supabase-js
 * (PostgREST) into a LOCAL stack. The TypeScript twin of `scripts/league-trash-lab/seed.sql`, used by the opt-in
 * `league-trash.local.test.ts`; not a unit test and not imported by anything that runs in CI.
 *
 * The league has two season groups (A, B), two initial + two redraft draft pools (group A's initial pool is drafting
 * with an active slot, group B's redraft pool is in its submissions phase), a circular redraft slot <-> pick pair,
 * `phases` round-robin phases with `rounds` rounds each (completed / pending-confirmation / scheduled matches with games,
 * battle stats, per-match rows and teams), polymorphic rows (resource admins, webhook, social integration, wiki notes),
 * derived rows (aggregates, ratings, aggregate jobs, streak pointers) and rows OUTSIDE the league that point into it
 * (a cast session, an agent suggestion, a forked team, a team on a league match).
 *
 * Every id is generated here, so nothing is read back. Rows go in chunks of `CHUNK`; a column a row leaves out takes its database default (`defaultToNull: false`),
 * not NULL, so rows of one batch may carry different keys.
 *
 * NOT seeded: `redraft_trade_requests`. It is a read-only archive (service_role holds no INSERT, `20261018140300_epb_retire_trades.sql`),
 * so only a superuser can write it: `scripts/league-trash-lab/` seeds it and proves its restore under `SET ROLE service_role`.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { insertLocalRuleset } from '@/test/local-rulesets';

export type Client = SupabaseClient;

export interface FixtureSize {
  /** Even, at least 4. */
  players: number;
  phases: number;
  /** Rounds per phase. */
  rounds: number;
  name: string;
}

export interface LeagueIds {
  seasonId: string;
  adminId: string;
  playerIds: string[];
  /** The id of the ruleset VERSION the league pins. */
  rulesetId: string;
  /** Its definition: league-owned (`season_id`), like a ruleset a format attach created. */
  rulesetDefinitionId: string;
  listVersionId: string;
  groupIds: [string, string];
  poolIds: string[];
  phaseIds: string[];
  tournamentGroupIds: string[];
  roundIds: string[];
  matchIds: string[];
  gameIds: string[];
  teamIds: string[];
  noteIds: string[];
  /** Rows outside the league that point into it. */
  outside: { castSessionId: string; suggestionId: string; forkTeamId: string; pointerTeamId: string; streakPlayerIds: string[] };
  counts: { matches: number; games: number; battleStats: number; teams: number };
}

const CHUNK = 1000;

const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function insert(client: Client, table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await client.from(table).insert(rows.slice(i, i + CHUNK), { defaultToNull: false });
    if (error) throw new Error(`[local-fixture] insert into ${table} failed: ${error.message} ${error.details ?? ''}`);
  }
}

async function upsert(client: Client, table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await client.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict, defaultToNull: false });
    if (error) throw new Error(`[local-fixture] upsert into ${table} failed: ${error.message} ${error.details ?? ''}`);
  }
}

/** A plain `string` (not randomUUID's template-literal type), so ids can be looked up by any string. */
const uuid = (): string => randomUUID();

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export async function seedLeague(client: Client, size: FixtureSize): Promise<LeagueIds> {
  const { players: playerCount, phases: phaseCount, rounds: roundCount, name } = size;
  if (playerCount < 4 || playerCount % 2 !== 0) throw new Error('[local-fixture] players must be even and at least 4');
  const half = playerCount / 2;
  const tag = uuid().slice(0, 8);

  const seasonId = uuid();
  const rulesetId = uuid();
  const rulesetDefinitionId = uuid();
  const listVersionId = uuid();
  const groupIds: [string, string] = [uuid(), uuid()];
  const playerIds = Array.from({ length: playerCount }, () => uuid());
  const adminId = playerIds[0];
  const groupOf = (i: number) => (i < half ? 0 : 1);
  const groupMembers = (g: 0 | 1) => playerIds.slice(g * half, (g + 1) * half);

  // Parents outside the league.
  await insert(client, 'players', playerIds.map((id, i) => ({ id, name: `ltt_${tag}_${i}`, is_guest: true })));
  const ruleset = await insertLocalRuleset(client, { id: rulesetId, definitionId: rulesetDefinitionId, seasonId, name: `lt ruleset ${rulesetId}` });
  if (ruleset.error) throw new Error(`[seed rulesets] ${JSON.stringify(ruleset.error)}`);
  await insert(client, 'point_buy_list_versions', [{ id: listVersionId, name: `lt list ${listVersionId}` }]);
  const entries = Array.from({ length: 40 }, (_, k) => ({
    id: uuid(),
    list_version_id: listVersionId,
    line_number: k + 1,
    base_pokemon: `mon${k + 1}`,
    stage2_pokemon: `mon${k + 1}b`,
    price: 5,
    kills_to_stage2: 3,
    price_group: 'A',
    line_id: `mon${k + 1}--mon${k + 1}b`,
  }));
  await insert(client, 'point_buy_list_entries', entries);
  const entryByLine = new Map(entries.map((e) => [e.line_id, e.id]));

  // The league.
  await insert(client, 'seasons', [
    {
      id: seasonId,
      name,
      format_type: 'evolution_point_buy',
      ruleset_id: rulesetId,
      status: 'active',
      point_buy_list_id: listVersionId,
      description: 'synthetic',
    },
  ]);
  await insert(client, 'season_participants', playerIds.map((player_id) => ({ season_id: seasonId, player_id })));
  await insert(client, 'season_groups', [
    { id: groupIds[0], season_id: seasonId, name: 'A', sort_order: 1 },
    { id: groupIds[1], season_id: seasonId, name: 'B', sort_order: 2 },
  ]);
  await insert(client, 'season_group_members', playerIds.map((player_id, i) => ({ season_id: seasonId, group_id: groupIds[groupOf(i)], player_id })));

  await insert(client, 'format_rules', [{ season_id: seasonId }]);
  await insert(client, 'season_formats', [{ season_id: seasonId, version_no: 1, spec: {}, spec_hash: 'a'.repeat(64), seed: 'seedseed1' }]);
  await insert(client, 'evolution_tiers', Array.from({ length: 20 }, (_, g) => ({ season_id: seasonId, base_pokemon: `b${g}`, stage2_pokemon: `s${g}`, stage2_kos: 3 })));
  await insert(client, 'draft_tier_limits', ['S', 'A', 'B', 'C'].map((power_tier) => ({ season_id: seasonId, power_tier, max_picks: 3 })));
  await insert(client, 'draft_pool_entries', Array.from({ length: 150 }, (_, g) => ({ season_id: seasonId, pokemon_name: `pool${g}` })));
  await insert(client, 'legacy_standings', playerIds.map((player_id, i) => ({ season_id: seasonId, player_id, rank: i + 1 })));
  await insert(client, 'epb_kill_credit_epochs', [{ season_id: seasonId }]);
  await insert(client, 'epb_token_grants', playerIds.map((player_id) => ({ season_id: seasonId, player_id, grant_type: 'draft_token' })));
  await insert(client, 'season_storylines', Array.from({ length: 5 }, (_, g) => ({ season_id: seasonId, title: `story ${g}`, body: 'body', created_by: adminId })));

  // Draft pools: [initial A, redraft A, initial B, redraft B]. A's initial pool is drafting (round 10 active), B's is complete.
  const poolIds: string[] = [];
  const poolRows: Record<string, unknown>[] = [];
  for (const g of [0, 1] as const) {
    const initial = uuid();
    const redraft = uuid();
    poolIds.push(initial, redraft);
    const common = {
      season_id: seasonId,
      draft_type: 'snake',
      engine: 'queue',
      mode: 'slow',
      season_group_id: groupIds[g],
      list_version_id: listVersionId,
      roster_size: 10,
      pick_seconds: 3600,
      created_by: adminId,
    };
    poolRows.push({ ...common, id: initial, kind: 'initial', phase: g === 0 ? 'drafting' : 'complete', status: 'in_progress', started_at: at(-3 * DAY) });
    poolRows.push({
      ...common,
      id: redraft,
      kind: 'redraft',
      phase: g === 0 ? 'setup' : 'submissions',
      status: 'pending',
      parent_pool_id: initial,
      submission_deadline_at: g === 1 ? at(2 * DAY) : null,
      token_purchase_closes_at: at(5 * DAY),
    });
  }
  // A redraft pool references its initial pool: parents first.
  await insert(client, 'draft_pools', poolRows.filter((p) => p.kind === 'initial'));
  await insert(client, 'draft_pools', poolRows.filter((p) => p.kind === 'redraft'));

  const slotRows: Record<string, unknown>[] = [];
  const draftParticipantRows: Record<string, unknown>[] = [];
  const pickRows: Record<string, unknown>[] = [];
  const redraftSlotRows: Record<string, unknown>[] = [];
  const restrictionRows: Record<string, unknown>[] = [];
  for (const g of [0, 1] as const) {
    const [initial, redraft] = [poolIds[g * 2], poolIds[g * 2 + 1]];
    const members = groupMembers(g);
    members.forEach((player_id, seat) => {
      draftParticipantRows.push({ draft_pool_id: initial, player_id, seat: seat + 1 });
      draftParticipantRows.push({ draft_pool_id: redraft, player_id, seat: seat + 1 });
    });
    for (let n = 1; n <= 10 * half; n += 1) {
      const round = Math.floor((n - 1) / half) + 1;
      const done = g === 1 || round <= 9;
      const active = !done && n === 9 * half + 1;
      const id = uuid();
      slotRows.push({
        id,
        draft_pool_id: initial,
        player_id: members[(n - 1) % half],
        sort_key: n,
        round,
        nominal_pick_number: n,
        status: done ? 'done' : active ? 'active' : 'pending',
        timer_seconds: 3600,
        deadline_at: g === 0 && active ? at(40 * 60_000) : null,
        started_at: at(-2 * DAY),
      });
      if (done) {
        const line_id = `mon${n}--mon${n}b`;
        pickRows.push({
          id: uuid(),
          draft_pool_id: initial,
          player_id: members[(n - 1) % half],
          pokemon_name: `mon${n}`,
          pick_number: n,
          round,
          points_spent: 5,
          line_id,
          line_entry_id: entryByLine.get(line_id) ?? null,
          slot_id: id,
          made_by: members[(n - 1) % half],
          made_by_role: 'player',
        });
      }
    }
    restrictionRows.push({ draft_pool_id: initial, player_id: playerIds[0], line_id: 'line1', reason: 'admin', created_by: adminId });
    members.forEach((player_id) =>
      redraftSlotRows.push({
        id: uuid(),
        draft_pool_id: redraft,
        season_id: seasonId,
        player_id,
        label: 'A',
        dropped_line_id: 'line1',
        dropped_price: 5,
        transferred_real_kills: 0,
        dropped_stage: 1,
        dropped_tracker_snapshot: {},
      }),
    );
  }
  await insert(client, 'draft_participants', draftParticipantRows);
  await insert(client, 'draft_slots', slotRows);
  await insert(client, 'redraft_slots', redraftSlotRows);
  // The circular pair: group A's redraft slots are filled by each player's first pick, which points back at the slot.
  const aRedraftSlotByPlayer = new Map(redraftSlotRows.filter((s) => s.draft_pool_id === poolIds[1]).map((s) => [s.player_id as string, s.id as string]));
  const linkedPickByPlayer = new Map<string, string>();
  for (const pick of pickRows.slice().sort((a, b) => (a.pick_number as number) - (b.pick_number as number))) {
    const player = pick.player_id as string;
    if (aRedraftSlotByPlayer.has(player) && !linkedPickByPlayer.has(player)) {
      linkedPickByPlayer.set(player, pick.id as string);
      pick.redraft_slot_id = aRedraftSlotByPlayer.get(player);
    }
  }
  await insert(client, 'draft_picks', pickRows);
  await upsert(
    client,
    'redraft_slots',
    redraftSlotRows.map((s) => (linkedPickByPlayer.has(s.player_id as string) && s.draft_pool_id === poolIds[1] ? { ...s, filled_by_pick_id: linkedPickByPlayer.get(s.player_id as string) } : s)),
    'id',
  );
  await insert(client, 'draft_replay_events', pickRows.map((p) => ({ draft_pool_id: p.draft_pool_id, event_type: 'pick', sequence_number: p.pick_number, pick_id: p.id })));
  await insert(client, 'draft_line_restrictions', restrictionRows);

  // EPB trackers: one per pick.
  const groupByPlayer = new Map(playerIds.map((p, i) => [p, groupIds[groupOf(i)]]));
  const trackerRows = pickRows.map((p) => ({
    id: uuid(),
    season_id: seasonId,
    player_id: p.player_id,
    base_pokemon: `mon${p.pick_number}`,
    current_form: `mon${p.pick_number}`,
    line_id: `${p.line_id}_${p.pick_number}`,
    season_group_id: groupByPlayer.get(p.player_id as string),
    real_kills: 1,
    redraft_slot_id: null as string | null,
  }));
  const firstTrackerByPlayer = new Map<string, (typeof trackerRows)[number]>();
  for (const t of trackerRows) if (!firstTrackerByPlayer.has(t.player_id as string)) firstTrackerByPlayer.set(t.player_id as string, t);
  for (const [player, slotId] of aRedraftSlotByPlayer) {
    const t = firstTrackerByPlayer.get(player);
    if (t) t.redraft_slot_id = slotId;
  }
  await insert(client, 'evolution_tracker', trackerRows);
  const trackerByPlayer = new Map<string, string[]>();
  for (const t of trackerRows) trackerByPlayer.set(t.player_id as string, [...(trackerByPlayer.get(t.player_id as string) ?? []), t.id]);

  const bGroup = new Set(groupMembers(1));
  await insert(
    client,
    'redraft_submissions',
    trackerRows.filter((t) => bGroup.has(t.player_id as string)).slice(0, 20).map((t) => ({ draft_pool_id: poolIds[3], player_id: t.player_id, tracker_id: t.id, line_id: t.line_id })),
  );
  await insert(
    client,
    'redraft_history',
    trackerRows.slice(0, 10).map((t) => ({ season_id: seasonId, player_id: t.player_id, to_base_pokemon: 'x', transfer_type: 'free_swap', draft_pool_id: poolIds[1], from_tracker_id: t.id })),
  );
  await insert(
    client,
    'evolution_events',
    trackerRows.slice(0, 50).map((t) => ({ season_id: seasonId, player_id: t.player_id, base_pokemon: t.base_pokemon, previous_form: t.current_form, new_form: `${t.current_form}b`, new_stage: 2, tracker_id: t.id })),
  );
  await insert(client, 'evo_progress_log', trackerRows.map((t) => ({ season_id: seasonId, tracker_id: t.id, source: 'real_kill', amount: 1, created_by: adminId })));
  await insert(
    client,
    'epb_draft_token_purchases',
    trackerRows.slice(0, 30).map((t) => ({ season_id: seasonId, player_id: t.player_id, line_id: t.line_id, points_spent: 1, client_request_id: uuid(), tracker_id: t.id, created_by: adminId })),
  );
  await insert(
    client,
    'epb_comeback_token_spends',
    trackerRows.slice(0, 30).map((t) => ({ season_id: seasonId, player_id: t.player_id, line_id: t.line_id, amount: 1, client_request_id: uuid(), tracker_id: t.id, created_by: adminId })),
  );

  // Phases, their groups, rounds and matches.
  const phaseIds = Array.from({ length: phaseCount }, () => uuid());
  await insert(
    client,
    'tournaments',
    phaseIds.map((id, i) => ({ id, name: `Phase ${i + 1}`, season_id: seasonId, bracket_type: 'round_robin', ruleset_id: rulesetId, status: 'active', stage_order: i + 1, format_stage_key: `p${i + 1}` })),
  );
  await insert(client, 'tournament_participants', phaseIds.flatMap((tournament_id) => playerIds.map((player_id) => ({ tournament_id, player_id }))));
  const tournamentGroupIds: string[] = [];
  const tgRows: Record<string, unknown>[] = [];
  const tgmRows: Record<string, unknown>[] = [];
  for (const tournament_id of phaseIds) {
    for (const g of [0, 1] as const) {
      const id = uuid();
      tournamentGroupIds.push(id);
      tgRows.push({ id, tournament_id, name: g === 0 ? 'A' : 'B', group_number: g + 1, season_group_id: groupIds[g] });
      groupMembers(g).forEach((player_id) => tgmRows.push({ group_id: id, player_id }));
    }
  }
  await insert(client, 'tournament_groups', tgRows);
  await insert(client, 'tournament_group_members', tgmRows);

  const roundRows: Record<string, unknown>[] = [];
  const matchRows: Record<string, unknown>[] = [];
  for (const tournament_id of phaseIds) {
    for (let r = 1; r <= roundCount; r += 1) {
      const round_id = uuid();
      roundRows.push({ id: round_id, name: `R${r}`, tournament_id, round_number: r, best_of: 3, status: 'active', deadline: at(r * DAY), pairings_generated: true });
      for (let a = 1; a <= playerCount; a += 1) {
        const b = ((a - 1 + r) % half) + 1 + (a <= half ? 0 : half);
        if (a >= b) continue;
        const kind = (a + r) % 4; // 0,1 completed; 2 pending confirmation; 3 scheduled
        matchRows.push({
          id: uuid(),
          round_id,
          tournament_id,
          player_1_id: playerIds[a - 1],
          player_2_id: playerIds[b - 1],
          status: ['completed', 'completed', 'pending_confirmation', 'scheduled'][kind],
          winner_id: kind <= 1 ? playerIds[a - 1] : null,
          date_played: at(-DAY),
          auto_confirm_at: kind === 2 ? at(20 * 3_600_000) : null,
          confirmed_at: kind <= 1 ? at(-DAY) : null,
          finalized_at: kind <= 1 ? at(-DAY) : null,
          scheduled_at: at(DAY),
        });
      }
    }
  }
  await insert(client, 'rounds', roundRows);
  await insert(client, 'matches', matchRows);

  // Games, stats, queue rows, derived history and the per-match rows.
  const played = matchRows.filter((m) => m.status === 'completed' || m.status === 'pending_confirmation');
  const completed = matchRows.filter((m) => m.status === 'completed');
  const scheduled = matchRows.filter((m) => m.status === 'scheduled');
  const gameRows = played.flatMap((m) =>
    [1, 2].map((game_number) => ({
      id: uuid(),
      match_id: m.id,
      game_number,
      winner_id: m.winner_id,
      source: 'ps_replay',
      parsed: true,
      aggregate_applied_at: game_number === 1 ? at(-DAY) : null,
      exclude_all_time: false,
      replay_hash: sha(`${m.id as string}${game_number}`),
      replay_url: `https://replay.example/${m.id as string}-${game_number}`,
    })),
  );
  await insert(client, 'games', gameRows);
  const matchById = new Map(matchRows.map((m) => [m.id as string, m]));
  const statRows: Record<string, unknown>[] = [];
  for (const g of gameRows) {
    const m = matchById.get(g.match_id as string);
    if (!m) continue;
    for (const player_id of [m.player_1_id, m.player_2_id]) {
      for (let k = 1; k <= 6; k += 1) statRows.push({ game_id: g.id, player_id, pokemon_name: `mon${k}`, was_brought: true, was_lead: k === 1, kos_dealt: k % 3 });
    }
  }
  await insert(client, 'battle_stats', statRows);
  await insert(
    client,
    'aggregate_jobs',
    gameRows.map((g) => ({ game_id: g.id, tournament_id: matchById.get(g.match_id as string)?.tournament_id, season_id: seasonId, status: g.aggregate_applied_at ? 'completed' : 'pending' })),
  );
  await insert(
    client,
    'rating_history',
    completed.map((m) => ({ player_id: m.player_1_id, match_id: m.id, rating_before: 1500, rating_after: 1510, rd_before: 100, rd_after: 95, opponent_id: m.player_2_id, opponent_rating: 1500, result: 'win' })),
  );
  const trackerRowById = new Map(trackerRows.map((t) => [t.id, t]));
  await insert(
    client,
    'match_evolution_snapshots',
    completed.flatMap((m) =>
      (trackerByPlayer.get(m.player_1_id as string) ?? []).slice(0, 3).map((tracker_id) => ({
        match_id: m.id,
        player_id: m.player_1_id,
        base_pokemon: trackerRowById.get(tracker_id)?.base_pokemon,
        species_at_match: trackerRowById.get(tracker_id)?.current_form,
        stage_at_match: 1,
        tracker_id,
      })),
    ),
  );
  const every = <T,>(rows: T[], n: number) => rows.filter((_, i) => i % n === 0);
  await insert(client, 'match_analyses', every(completed, 3).map((m) => ({ match_id: m.id, model_id: 'mdl' })));
  await insert(client, 'match_prep_analyses', every(scheduled, 3).map((m) => ({ match_id: m.id, player_id: m.player_1_id, model_id: 'mdl' })));
  await insert(client, 'match_prep_teams', every(scheduled, 3).map((m) => ({ match_id: m.id, player_id: m.player_1_id })));
  await insert(client, 'match_proposals', every(scheduled, 3).map((m) => ({ match_id: m.id, proposer_id: m.player_1_id, responder_id: m.player_2_id, proposed_at: at(0), expires_at: at(2 * DAY), status: 'pending' })));
  await insert(client, 'epb_animation_views', every(completed, 5).map((m) => ({ player_id: m.player_1_id, match_id: m.id })));
  await insert(client, 'broadcast_moments', every(gameRows, 20).map((g) => ({ match_id: g.match_id, moment_type: 'highlight', created_by: adminId, game_id: g.id })));
  await insert(
    client,
    'tournament_reports',
    roundRows.map((r) => ({ tournament_id: r.tournament_id, round_id: r.id, report_type: 'round_recap', model_id: 'mdl', status: 'completed' })),
  );

  // Teams: one per played match (p1's side), draft teams, plus two OUTSIDE teams that point into the league.
  const teamRows = played.map((m) => ({ id: uuid(), player_id: m.player_1_id, tournament_id: m.tournament_id, season_id: seasonId, match_id: m.id, pokemon: [{ species: 'x' }], name: `team ${m.id as string}` }));
  const draftTeamRows = groupMembers(0).map((player_id, i) => ({ id: uuid(), player_id, season_id: seasonId, draft_pool_id: poolIds[0], is_draft_team: true, pokemon: [], name: `draft ${i}` }));
  await insert(client, 'teams', [...teamRows, ...draftTeamRows]);
  const forkTeamId = uuid();
  const pointerTeamId = uuid();
  const pointerMatch = completed.find((m) => !teamRows.some((t) => t.player_id === playerIds[1] && t.match_id === m.id));
  await insert(client, 'teams', [
    { id: forkTeamId, player_id: playerIds[0], pokemon: [], name: 'fork', forked_from_team_id: teamRows[0]?.id ?? null },
    { id: pointerTeamId, player_id: playerIds[1], pokemon: [], name: 'ptr', match_id: pointerMatch?.id ?? null },
  ]);

  // Polymorphic rows (no foreign key to the league).
  await insert(client, 'resource_admins', [
    { player_id: playerIds[0], resource_type: 'season', resource_id: seasonId },
    { player_id: playerIds[1], resource_type: 'season', resource_id: seasonId },
    ...phaseIds.map((resource_id) => ({ player_id: playerIds[2], resource_type: 'tournament', resource_id })),
  ]);
  await insert(client, 'discord_webhooks', [
    { scope_type: 'season', scope_id: seasonId, webhook_url: 'https://hook.example/season' },
    { scope_type: 'tournament', scope_id: phaseIds[0], webhook_url: 'https://hook.example/t' },
  ]);
  await insert(client, 'social_integrations', [{ provider: 'x', scope_type: 'season', scope_id: seasonId, label: 'lt social' }]);
  const noteIds = [uuid(), uuid()];
  await insert(client, 'wiki_notes', [
    { id: noteIds[0], entity_type: 'pokemon', entity_name: 'pikachu', author_id: playerIds[0], content: 'note', scope_type: 'league', scope_id: seasonId },
    { id: noteIds[1], entity_type: 'move', entity_name: 'tackle', author_id: playerIds[0], content: 'note', scope_type: 'tournament', scope_id: phaseIds[0] },
  ]);
  await insert(client, 'wiki_note_reports', [{ note_id: noteIds[0], reporter_id: playerIds[1], reason: 'spam' }]);

  // Derived rows.
  const aggs = (scope_type: string, scope_id: string) => Array.from({ length: 20 }, (_, g) => ({ scope_type, scope_id, pokemon_name: `mon${g + 1}`, total_appearances: 10 }));
  await insert(client, 'aggregates', [...aggs('league', seasonId), ...phaseIds.flatMap((p) => aggs('tournament', p))]);
  await insert(client, 'player_aggregates', [
    ...playerIds.map((player_id) => ({ scope_type: 'league', scope_id: seasonId, player_id, pokemon_name: 'mon1', total_appearances: 2 })),
    ...phaseIds.map((scope_id) => ({ scope_type: 'tournament', scope_id, player_id: playerIds[0], pokemon_name: 'mon1', total_appearances: 2 })),
  ]);

  // Pointers from outside: streaks (NO ACTION before the trash migration), a cast session, an agent suggestion.
  const streakRows = playerIds.flatMap((player_id) => {
    const m = completed.find((c) => c.player_1_id === player_id || c.player_2_id === player_id);
    return m ? [{ player_id, last_match_id: m.id }] : [];
  });
  await upsert(client, 'player_streaks', streakRows, 'player_id');
  const castSessionId = uuid();
  await insert(client, 'cast_sessions', [{ id: castSessionId, owner_id: adminId, season_id: seasonId, tournament_id: phaseIds[0], match_id: matchRows[0]?.id, name: 'cast' }]);
  const conversationId = uuid();
  const suggestionId = uuid();
  await insert(client, 'agent_conversations', [{ id: conversationId, player_id: adminId, persona: 'p', messages: [] }]);
  await insert(client, 'agent_suggestions', [{ id: suggestionId, player_id: adminId, conversation_id: conversationId, match_id: matchRows[0]?.id, context_format: 'gen9' }]);

  return {
    seasonId,
    adminId,
    playerIds,
    rulesetId,
    rulesetDefinitionId,
    listVersionId,
    groupIds,
    poolIds,
    phaseIds,
    tournamentGroupIds,
    roundIds: roundRows.map((r) => r.id as string),
    matchIds: matchRows.map((m) => m.id as string),
    gameIds: gameRows.map((g) => g.id),
    teamIds: [...teamRows, ...draftTeamRows].map((t) => t.id),
    noteIds,
    outside: { castSessionId, suggestionId, forkTeamId, pointerTeamId, streakPlayerIds: streakRows.map((s) => s.player_id) },
    counts: { matches: matchRows.length, games: gameRows.length, battleStats: statRows.length, teams: teamRows.length + draftTeamRows.length },
  };
}
