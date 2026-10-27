/**
 * The request bodies a Plan slot becomes (plan 4.3 mapping, 3.9 test 9): one function per route the Build saga
 * calls. They are the only place where Plan names turn into route names (`best_of` to `best_of_default`, slot
 * `ruleset` to `ruleset_id`, a VERSION id on all three create schemas), so the parity table in ./parity.ts and
 * `plan_validate` read the same mapping the saga executes.
 *
 * A body may hold symbolic references `{ "$ref": "league.id" }` for values that only exist after an earlier step ran
 * (the new league's id, the ruleset version an Evolution Point Buy league pinned, a group's id). The executor resolves
 * them from the ledger result of an `ok` step of the same proposal; the template, not the resolved value, is hashed.
 */
import type { JsonValue } from '@/lib/studio-core/json';
import type { PlanDocument, PlanDraftEntry, PlanLeague, PlanPhase, PlanRulesetRef, PlanTournament } from './schema';

/** A symbolic reference to a value an earlier step produces. */
export type PlanRefObject = { $ref: string };

/** The paths a `$ref` may name (whitelisted per operation in the executor; the Plan only ever emits these). */
export const REF_PATH_PATTERN = /^(?:league\.(?:id|ruleset_id)|groups\.[A-Z]\.id)$/;

export const refTo = (path: string): PlanRefObject => ({ $ref: path });
export const isRefObject = (value: unknown): value is PlanRefObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as { $ref?: unknown }).$ref === 'string';

/** What a body field that names a ruleset VERSION holds. `null`: the Plan cannot name a pinnable version yet. */
export type RulesetIdValue = string | PlanRefObject | null;

/** The version a phase or tournament pins, or `null` while the slot is not a published version. */
export function rulesetIdFor(plan: PlanDocument, target: PlanRulesetRef): RulesetIdValue {
  if (target !== 'plan') return target.id;
  const slot = plan.slots.ruleset;
  if (slot?.mode === 'existing') return slot.version_id;
  // The create route ensures the shared battle ruleset; later steps read the version the league pinned.
  if (slot?.mode === 'auto_epb') return refTo('league.ruleset_id');
  return null;
}

/** The version the league itself is created with: only an explicit published version (`auto_epb` omits it). */
export function leagueRulesetId(plan: PlanDocument): string | null {
  const slot = plan.slots.ruleset;
  return slot?.mode === 'existing' ? slot.version_id : null;
}

type Body = { [key: string]: JsonValue };

function put(body: Body, key: string, value: JsonValue | undefined): void {
  if (value !== undefined) body[key] = value;
}

/** `POST /api/seasons`: `seasonCreateRequestSchema`. `route_theme` is never sent; `copy_admins` is always false. */
export function toLeagueCreateBody(plan: PlanDocument, league: PlanLeague): Body {
  const body: Body = { name: league.name, format_type: league.format_type, language: league.language };
  put(body, 'description', league.description);
  put(body, 'start_date', league.start_date);
  put(body, 'end_date', league.end_date);
  put(body, 'ruleset_id', leagueRulesetId(plan) ?? undefined);
  if (league.clone_from) {
    body.clone_from = { season_id: league.clone_from.season_id, copy_roster: league.clone_from.copy_roster, copy_admins: false };
  }
  return body;
}

/** `POST /api/seasons/[id]/participants` (bulk): `seasonParticipantBulkAddSchema`, 1 to 50 ids. */
export const ROSTER_CHUNK = 50;
export function toRosterAddBody(playerIds: readonly string[]): Body {
  return { player_ids: [...playerIds] };
}

/** `POST /api/seasons/[id]/phases`: `phaseCreateSchema`. `insert_at` and `stage_order` are never sent. */
export function toPhaseCreateBody(plan: PlanDocument, phase: PlanPhase): Body {
  const body: Body = { name: phase.name, bracket_type: phase.bracket_type };
  put(body, 'description', phase.description);
  const rulesetId = rulesetIdFor(plan, phase.ruleset);
  put(body, 'ruleset_id', rulesetId ?? undefined);
  body.best_of_default = phase.best_of;
  put(body, 'bo_overrides', phase.bo_overrides);
  body.is_doubles = phase.is_doubles;
  body.team_visibility = phase.team_visibility ?? 'hidden_until_match';
  put(body, 'bracket_reset_enabled', phase.bracket_reset_enabled);
  if (phase.advancement_rule) {
    body.advancement_rule = { type: 'top_n', count: phase.advancement_rule.count, per_group: phase.advancement_rule.per_group };
  }
  return body;
}

/** `PUT /api/seasons/[id]/groups`: `seasonGroupsReplaceSchema`, serpentine mode. */
export function toGroupsBody(groupCount: number): Body {
  return { mode: 'serpentine', group_count: groupCount };
}

/**
 * `POST /api/drafts`. The queue engine (Evolution Point Buy) creates the initial pool with an optional config and, for a
 * league with groups, the group it seats; the legacy engine takes the pricing type, turn order and budget. `rounds`,
 * `name` and `pool_template_id` are never sent (the legacy route ignores them).
 */
export function toDraftCreateBody(seasonId: string | PlanRefObject, entry: PlanDraftEntry): Body {
  if (entry.engine === 'queue') {
    const body: Body = { season_id: seasonId, kind: 'initial' };
    const config: Body = {};
    put(config, 'budget', entry.budget);
    put(config, 'participant_order', entry.participant_order);
    if (Object.keys(config).length > 0) body.config = config;
    if (entry.group_key !== undefined) body.season_group_id = refTo(`groups.${entry.group_key}.id`);
    return body;
  }
  const body: Body = { season_id: seasonId, draft_type: entry.draft_type ?? 'snake' };
  put(body, 'pick_order', entry.pick_order);
  put(body, 'budget', entry.budget);
  return body;
}

/** `POST /api/tournaments`: `tournamentCreateSchema`. `season_id` and `stage_order` are never sent. */
export function toTournamentCreateBody(plan: PlanDocument, tournament: PlanTournament): Body {
  const body: Body = { name: tournament.name, bracket_type: tournament.bracket_type };
  put(body, 'description', tournament.description);
  put(body, 'ruleset_id', rulesetIdFor(plan, tournament.ruleset) ?? undefined);
  body.best_of_default = tournament.best_of;
  put(body, 'bo_overrides', tournament.bo_overrides);
  body.is_doubles = tournament.is_doubles;
  body.team_visibility = tournament.team_visibility;
  put(body, 'bracket_reset_enabled', tournament.bracket_reset_enabled);
  return body;
}
