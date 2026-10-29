/**
 * The fixture loader of the local-stack eval stages (plan 7.2 "Local stack": `baseline`, and the per-case seeds).
 *
 * `supabase/seed.sql` is intentionally empty, so the fixtures are ours. The loader talks to the database through the small
 * `LoaderDb` interface below (a thin adapter over the service-role client lives in `stack.ts`, a fake serves the unit test),
 * and is idempotent: every row it writes has a stable id (`evalUuid`, the same ids the plan stage's fixture world uses, so a
 * recording's `{{player:03}}` means the same player on both stages) and is upserted by that id. Run
 * `npx supabase db reset --local` before a full run: the loader never resets or truncates anything.
 *
 * `baseline`: 24 `Eval Player NN` players, a site admin, a league admin of the ready league L1, a tournament admin of the
 * ready tournament T1, the standard rulesets as site-catalog definitions (kind `preset`, `gallery`) with a published
 * version each, league L1 (12 players, two phases, nothing generated) and tournament T1 (8 players, single elimination).
 * No webhooks and no social integrations are written, so an unrecorded path would send nothing.
 *
 * Seeds (`seedFor`): state that a case CONSUMES (a started phase, a generated bracket, a published ruleset) cannot sit in the
 * baseline, or a second run of the case (`--repeat 3`) would meet a league that already started. A case lists the seeds it needs and
 * gets fresh entities whose names carry the case id and a run tag, created before its first turn.
 */
import type { EvalSeed } from '@/lib/ai/admin-agent/eval/types';
import { evalUuid, WORLD_RULESET_PRESETS, type WorldRuleset } from '@/lib/ai/admin-agent/eval/world';

export type Row = Record<string, unknown>;

/** The database as the loader needs it. */
export interface LoaderDb {
  /** Inserts or updates rows by the unique column(s) in `onConflict` (comma separated). */
  upsert(table: string, rows: Row[], onConflict: string): Promise<void>;
  /** Rows of `table` whose columns equal `match`. */
  find(table: string, match: Row): Promise<Row[]>;
}

export interface PublishedRuleset {
  definitionId: string;
  versionId: string;
}

/** What the loader needs from the ruleset library: publish a catalog preset as a site ruleset (version 1). */
export interface LoaderDeps {
  publishPresetRuleset(input: { preset: string; name: string }): Promise<PublishedRuleset>;
  /** A short tag of this run, so seeded names do not collide with an earlier run's. */
  runTag: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export interface LoadedBaseline {
  players: Array<{ id: string; name: string }>;
  admins: Record<'site_admin' | 'league_admin' | 'tournament_admin', { id: string; name: string; discordId: string }>;
  rulesets: WorldRuleset[];
  leagueId: string;
  phaseIds: [string, string];
  tournamentId: string;
}

export const ADMIN_IDENTITIES = {
  site_admin: { name: 'Eval Site Admin', discordId: 'eval-discord-site-admin' },
  league_admin: { name: 'Eval League Admin', discordId: 'eval-discord-league-admin' },
  tournament_admin: { name: 'Eval Tournament Admin', discordId: 'eval-discord-tournament-admin' },
} as const;

const L1_NAME = 'Eval League One';
const T1_NAME = 'Eval Tournament One';

async function ensureRuleset(db: LoaderDb, deps: LoaderDeps, preset: string, name: string): Promise<WorldRuleset> {
  const existing = await db.find('ruleset_definitions', { slug: preset, kind: 'preset' });
  let definitionId: string;
  let versionId: string;
  if (existing.length > 0 && typeof existing[0].current_version_id === 'string') {
    definitionId = String(existing[0].id);
    versionId = existing[0].current_version_id;
  } else {
    const published = await deps.publishPresetRuleset({ preset, name });
    definitionId = published.definitionId;
    versionId = published.versionId;
  }
  const versions = await db.find('ruleset_definition_versions', { id: versionId });
  const versionNo = typeof versions[0]?.version_no === 'number' ? versions[0].version_no : 1;
  return { preset, definitionId, versionId, versionNo, name };
}

/** The baseline, loaded once per run. */
export async function loadBaseline(db: LoaderDb, deps: LoaderDeps, presetName: (preset: string) => string): Promise<LoadedBaseline> {
  const players = Array.from({ length: 24 }, (_, i) => ({ id: evalUuid('player', pad(i + 1)), name: `Eval Player ${pad(i + 1)}` }));
  // A registered player needs an identity (`players_identity_check`); these have a Discord id that exists only here.
  await db.upsert('players', players.map((p, index) => ({ id: p.id, name: p.name, discord_id: `eval-discord-player-${pad(index + 1)}`, is_guest: false })), 'id');

  const admins = Object.fromEntries(
    (Object.keys(ADMIN_IDENTITIES) as Array<keyof typeof ADMIN_IDENTITIES>).map((actor) => [actor, { id: evalUuid('admin', actor), ...ADMIN_IDENTITIES[actor] }]),
  ) as LoadedBaseline['admins'];
  await db.upsert(
    'players',
    (Object.keys(admins) as Array<keyof typeof admins>).map((actor) => ({ id: admins[actor].id, name: admins[actor].name, discord_id: admins[actor].discordId, is_admin: actor === 'site_admin', is_guest: false })),
    'id',
  );

  const rulesets: WorldRuleset[] = [];
  for (const preset of WORLD_RULESET_PRESETS) rulesets.push(await ensureRuleset(db, deps, preset, presetName(preset)));
  const ou = rulesets[0];

  const leagueId = evalUuid('league', 'L1');
  const phaseIds: [string, string] = [evalUuid('phase', 'L1-1'), evalUuid('phase', 'L1-2')];
  await db.upsert('seasons', [{ id: leagueId, name: L1_NAME, description: 'A friendly singles league for the weekend.', format_type: 'singles', status: 'upcoming', start_date: '2026-11-02', ruleset_id: ou.versionId, language: 'en' }], 'id');
  await db.upsert('season_participants', players.slice(0, 12).map((p) => ({ season_id: leagueId, player_id: p.id })), 'season_id,player_id');
  await db.upsert(
    'tournaments',
    [
      { id: phaseIds[0], season_id: leagueId, name: 'Regular Season', bracket_type: 'round_robin', best_of_default: 3, status: 'upcoming', ruleset_id: ou.versionId, stage_order: 1 },
      { id: phaseIds[1], season_id: leagueId, name: 'Playoffs', bracket_type: 'single_elim', best_of_default: 3, status: 'upcoming', ruleset_id: ou.versionId, stage_order: 2, advancement_rule: { type: 'top_n', count: 4, per_group: false } },
    ],
    'id',
  );
  await db.upsert('tournament_participants', players.slice(0, 12).map((p) => ({ tournament_id: phaseIds[0], player_id: p.id })), 'tournament_id,player_id');

  const tournamentId = evalUuid('tournament', 'T1');
  await db.upsert('tournaments', [{ id: tournamentId, season_id: null, name: T1_NAME, bracket_type: 'single_elim', best_of_default: 3, status: 'upcoming', ruleset_id: ou.versionId }], 'id');
  await db.upsert('tournament_participants', players.slice(0, 8).map((p, index) => ({ tournament_id: tournamentId, player_id: p.id, seed: index + 1 })), 'tournament_id,player_id');

  // The resource admins: the league admin manages L1, the tournament admin manages T1.
  await db.upsert('resource_admins', [{ player_id: admins.league_admin.id, resource_type: 'season', resource_id: leagueId }], 'player_id,resource_type,resource_id');
  await db.upsert('resource_admins', [{ player_id: admins.tournament_admin.id, resource_type: 'tournament', resource_id: tournamentId }], 'player_id,resource_type,resource_id');

  return { players, admins, rulesets, leagueId, phaseIds, tournamentId };
}

// ─── Seeds ───────────────────────────────────────────────────────────

export type SeedKind = EvalSeed;

/** What a seed created: its id and name (a case's `say` names it with `{{seedname:KIND}}`), and the ids a recording may need. */
export interface SeededEntity {
  id: string;
  name: string;
  /** Phase ids of a seeded league, first phase first. */
  phaseIds?: string[];
  /** The ruleset definition and version of `started_league_ruleset`. */
  rulesetDefinitionId?: string;
  rulesetVersionId?: string;
  rulesetName?: string;
}

const LABEL: Record<SeedKind, string> = { ready_league: 'Ready League', ready_tournament: 'Ready Cup', started_league_ruleset: 'Started League' };

/**
 * Creates the entities a case lists in `seed`, named `<case id> <label> <run tag>` (so the case finds only its own rows). Ids derive
 * from the same name, so a retried load of the same run tag is a no-op.
 */
export async function seedFor(db: LoaderDb, deps: LoaderDeps, baseline: LoadedBaseline, caseId: string, repeat: number, kind: SeedKind): Promise<SeededEntity> {
  const tag = `${deps.runTag}${repeat}`;
  const name = `${caseId} ${LABEL[kind]} ${tag}`;
  const key = `${caseId}:${tag}:${kind}`;
  const ou = baseline.rulesets[0];

  if (kind === 'ready_tournament') {
    const id = evalUuid('seed-tournament', key);
    await db.upsert('tournaments', [{ id, season_id: null, name, bracket_type: 'single_elim', best_of_default: 3, status: 'upcoming', ruleset_id: ou.versionId }], 'id');
    await db.upsert('tournament_participants', baseline.players.slice(0, 8).map((p, index) => ({ tournament_id: id, player_id: p.id, seed: index + 1 })), 'tournament_id,player_id');
    return { id, name };
  }

  const leagueId = evalUuid('seed-league', key);
  const phaseIds = [evalUuid('seed-phase', `${key}:1`), evalUuid('seed-phase', `${key}:2`)];
  let rulesetVersionId = ou.versionId;
  let rulesetDefinitionId: string | undefined;
  let rulesetName: string | undefined;
  if (kind === 'started_league_ruleset') {
    rulesetName = `${caseId} Gen 9 OU ${tag}`;
    const published = await deps.publishPresetRuleset({ preset: 'gen9ou', name: rulesetName });
    rulesetVersionId = published.versionId;
    rulesetDefinitionId = published.definitionId;
  }
  const started = kind === 'started_league_ruleset';
  await db.upsert('seasons', [{ id: leagueId, name, description: 'A seeded league of the eval.', format_type: 'singles', status: started ? 'active' : 'upcoming', start_date: started ? '2026-10-19' : '2026-11-02', ruleset_id: rulesetVersionId, language: 'en' }], 'id');
  const roster = baseline.players.slice(0, 12);
  await db.upsert('season_participants', roster.map((p) => ({ season_id: leagueId, player_id: p.id })), 'season_id,player_id');
  await db.upsert(
    'tournaments',
    [
      { id: phaseIds[0], season_id: leagueId, name: 'Regular Season', bracket_type: 'round_robin', best_of_default: 3, status: started ? 'active' : 'upcoming', ruleset_id: rulesetVersionId, stage_order: 1 },
      { id: phaseIds[1], season_id: leagueId, name: 'Playoffs', bracket_type: 'single_elim', best_of_default: 3, status: 'upcoming', ruleset_id: rulesetVersionId, stage_order: 2, advancement_rule: { type: 'top_n', count: 4, per_group: false } },
    ],
    'id',
  );
  await db.upsert('tournament_participants', roster.map((p) => ({ tournament_id: phaseIds[0], player_id: p.id })), 'tournament_id,player_id');
  return { id: leagueId, name, phaseIds, ...(rulesetDefinitionId === undefined ? {} : { rulesetDefinitionId, rulesetVersionId, rulesetName }) };
}
