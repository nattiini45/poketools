import 'server-only';
/**
 * League, phase and tournament previews (plan 3.6.3, P): `league_create_preview`, `phase_create_preview`,
 * `tournament_create_preview`, `round_schedule_preview`.
 *
 * Their arguments are the create routes' own Zod schemas (`seasonCreateRequestSchema`, `phaseCreateSchema`,
 * `tournamentCreateSchema`) with the keys that are not strict-tool compatible swapped for flat ones (a nullable becomes
 * an optional, the open `bo_overrides` map becomes a `bo_overrides_json` string). The checks are the routes' own shared
 * functions (`assertSeasonDateRange`, `assertRulesetUsable`, `assertCloneAllowed`, `assertPhaseNameFree`), so the preview
 * refuses what the route would refuse, with the route's own code. The route stays the authority; this is advisory.
 */
import { z } from 'zod';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { assertCloneAllowed } from '@/lib/season/clone';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { assertSeasonDateRange } from '@/lib/season/settings-guards';
import { getActiveListVersion } from '@/lib/supabase/queries/point-buy-lists';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { getSeasonById, listSeasons } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { buildBracketStructureForParticipants } from '@/lib/tournament/bracket-structure';
import { GroupScheduleError, planGroupSchedule } from '@/lib/tournament/group-schedule';
import { assertPhaseNameFree } from '@/lib/tournament/league-phase';
import { getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import { phaseCreateSchema, seasonCreateRequestSchema, tournamentCreateSchema, formatZodErrors } from '@/lib/validation';
import { defineRunnable, describeIssues } from '../registry/define';
import { guardFor } from '../registry/guard';
import { toolErrorFromThrown } from '../registry/errors';
import { id, intArg, label, uuidArg } from '../registry/atoms';
import { fenceLabel } from '../registry/fence';
import { check, finder, finding, type Finding } from './shared';

const EFFECTS = [
  'public_immediately',
  'creator_becomes_admin',
  'ensures_point_buy_battle_ruleset',
  'binds_active_point_buy_list',
  'point_buy_list_unbound',
  'clones_phases',
  'clones_roster',
  'enrolls_league_roster',
  'enrolls_previous_phase_standings',
  'private_ruleset_becomes_public',
] as const;
type Effect = (typeof EFFECTS)[number];

const rulesetOut = z.strictObject({
  version_id: id(),
  definition_id: id(),
  label: label(),
  version_no: z.number().int(),
  visibility: z.enum(['private', 'league', 'gallery']),
});

/** The pinned version, if the live admin may use it; otherwise the blocker the route would answer with. */
async function resolveRuleset(versionId: string | undefined): Promise<{ ruleset: z.infer<typeof rulesetOut> | null; blocker: Finding | null }> {
  if (versionId === undefined) return { ruleset: null, blocker: null };
  try {
    const guarded = await guardFor({ kind: 'rulesetUsable', versionId });
    const { definition, version_no } = guarded.usable;
    return {
      ruleset: {
        version_id: versionId,
        definition_id: definition.id,
        label: fenceLabel(definition.slug),
        version_no,
        visibility: definition.visibility,
      },
      blocker: null,
    };
  } catch (err) {
    const mapped = toolErrorFromThrown(err, 'preview ruleset');
    return { ruleset: null, blocker: finder(mapped.code, mapped.params) };
  }
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

// ─── league_create_preview ───────────────────────────────────────────────────

const leagueArgs = seasonCreateRequestSchema.extend({
  ruleset_id: uuidArg('Published ruleset VERSION id to pin').optional(),
  start_date: z.iso.date().optional().describe('Start date, YYYY-MM-DD. A label only: nothing starts the league on that date'),
  end_date: z.iso.date().optional().describe('End date, YYYY-MM-DD'),
});

export const leagueCreatePreview = defineRunnable('any', {
  name: 'league_create_preview',
  class: 'P',
  description:
    'Preview creating a league with the same body POST /api/seasons takes (name, format_type, optional ruleset_id of a PUBLISHED ruleset version, dates, language, clone_from). Checks the date order, that the admin may use the ruleset version, and the clone permission, and lists what creating it would do: it is public the moment it exists, the creator becomes league admin (non-site admins), an Evolution Point Buy league without a ruleset pins the shared Point Buy Battle ruleset and binds the active point-buy list, a private ruleset pinned by a league becomes publicly readable. Nothing is created. Ids are UUIDs.',
  args: leagueArgs,
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    valid: z.boolean(),
    blockers: z.array(finding),
    effects: z.array(z.enum(EFFECTS)),
    ruleset: rulesetOut.nullable(),
    active_point_buy_list: z.strictObject({ id: id(), label: label(), version: z.number().int() }).nullable(),
    name_in_use: z.boolean(),
  }),
  async execute(args, guarded) {
    const player = guarded.player;
    const blockers: Finding[] = [];
    const effects = new Set<Effect>(['public_immediately']);
    if (!player.isAdmin) effects.add('creator_becomes_admin');

    const dates = await check('league preview dates', () => assertSeasonDateRange(args.start_date, args.end_date));
    if (dates) blockers.push(dates);

    const { ruleset, blocker } = await resolveRuleset(args.ruleset_id ?? undefined);
    if (blocker) blockers.push(blocker);
    if (ruleset?.visibility === 'private') effects.add('private_ruleset_becomes_public');

    if (args.clone_from) {
      const clone = await check('league preview clone', () =>
        assertCloneAllowed(player, { sourceId: args.clone_from!.season_id, copyAdmins: args.clone_from!.copy_admins }),
      );
      if (clone) blockers.push(clone);
      effects.add('clones_phases');
      if (args.clone_from.copy_roster) effects.add('clones_roster');
    }

    let activeList: { id: string; label: string; version: number } | null = null;
    if (isEvolutionPointBuy(args.format_type)) {
      if (!args.ruleset_id) effects.add('ensures_point_buy_battle_ruleset');
      const list = await getActiveListVersion();
      if (list) {
        effects.add('binds_active_point_buy_list');
        activeList = { id: list.id, label: fenceLabel(list.name), version: list.version };
      } else {
        effects.add('point_buy_list_unbound');
      }
    }

    const wanted = args.name.trim().toLowerCase();
    const existing = await listSeasons({ includeTestSeasons: true });
    return {
      valid: blockers.length === 0,
      blockers,
      effects: EFFECTS.filter((effect) => effects.has(effect)),
      ruleset,
      active_point_buy_list: activeList,
      name_in_use: existing.some((season) => season.name.trim().toLowerCase() === wanted),
    };
  },
});

// ─── tournament_create_preview ───────────────────────────────────────────────

const boOverridesJson = z.string().max(2000).optional().describe('JSON object of round name to odd best-of, e.g. {"Finals":5}');

const tournamentArgs = tournamentCreateSchema
  .omit({ season_id: true, stage_order: true, bo_overrides: true, ruleset_id: true })
  .extend({
    ruleset_id: uuidArg('Published ruleset VERSION id to pin'),
    bo_overrides_json: boOverridesJson,
    expected_participants: intArg('Expected number of participants, to check best-of override round names', 2, 256).optional(),
  });

/** Parses `bo_overrides_json` and checks the round names against the bracket a field of `n` players would have. */
function checkBoOverrides(bracketType: string, json: string | undefined, expected: number | undefined): { overrides: Record<string, number> | undefined; findings: Finding[] } {
  if (json === undefined) return { overrides: undefined, findings: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { overrides: undefined, findings: [finder('invalid_json')] };
  }
  const shape = z.record(z.string().max(60), tournamentCreateSchema.shape.best_of_default).safeParse(parsed);
  if (!shape.success) return { overrides: undefined, findings: [finder('validation_failed', { issues: describeIssues(shape.error) })] };
  const overrides = shape.data;
  const findings: Finding[] = [];
  if (expected !== undefined && (bracketType === 'single_elim' || bracketType === 'double_elim')) {
    const structure = buildBracketStructureForParticipants(
      bracketType,
      Array.from({ length: expected }, (_, index) => ({ seed: index + 1 })),
    );
    const names = new Set((structure?.rounds ?? []).map((round) => round.name));
    for (const key of Object.keys(overrides)) {
      if (!names.has(key)) findings.push(finder('bo_override_key_unknown', { key: fenceLabel(key) }));
    }
  }
  return { overrides, findings };
}

export const tournamentCreatePreview = defineRunnable('any', {
  name: 'tournament_create_preview',
  class: 'P',
  description:
    'Preview creating a standalone tournament with the same body POST /api/tournaments takes (name, bracket_type, ruleset_id of a PUBLISHED ruleset version, best_of_default which must be odd, is_doubles, team_visibility), plus bo_overrides_json for per-round best-of and expected_participants to check those round names against the bracket. Checks that the admin may use the ruleset. A tournament is public the moment it exists and has no registration or check-in. Nothing is created. Ids are UUIDs.',
  args: tournamentArgs,
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    valid: z.boolean(),
    blockers: z.array(finding),
    effects: z.array(z.enum(EFFECTS)),
    ruleset: rulesetOut.nullable(),
  }),
  async execute(args, guarded) {
    const blockers: Finding[] = [];
    const effects = new Set<Effect>(['public_immediately']);
    if (!guarded.player.isAdmin) effects.add('creator_becomes_admin');
    const { ruleset, blocker } = await resolveRuleset(args.ruleset_id);
    if (blocker) blockers.push(blocker);
    if (ruleset?.visibility === 'private') effects.add('private_ruleset_becomes_public');
    const overrides = checkBoOverrides(args.bracket_type, args.bo_overrides_json, args.expected_participants);
    blockers.push(...overrides.findings);
    return { valid: blockers.length === 0, blockers, effects: EFFECTS.filter((effect) => effects.has(effect)), ruleset };
  },
});

// ─── phase_create_preview ────────────────────────────────────────────────────

const phaseArgs = phaseCreateSchema
  .omit({ bo_overrides: true, advancement_rule: true, ruleset_id: true })
  .extend({
    league_id: uuidArg('League the phase belongs to'),
    ruleset_id: uuidArg('Published ruleset VERSION id to pin'),
    advancement_count: intArg('Advance the top N to the next phase', 1, 256).optional(),
    advancement_per_group: z.boolean().optional().describe('Count the top N per group (default false)'),
    bo_overrides_json: boOverridesJson,
    expected_participants: intArg('Expected number of participants, to check best-of override round names', 2, 256).optional(),
  });

export const phaseCreatePreview = defineRunnable('season', {
  name: 'phase_create_preview',
  class: 'P',
  description:
    'Preview adding a phase to a league with the body POST /api/seasons/{id}/phases takes, flattened (advancement_count and advancement_per_group instead of an advancement rule, bo_overrides_json for round best-of). Checks that the name is free in the league, that the admin may use the ruleset version, where the phase would be inserted (never before a phase that has started), and the best-of round names. A phase created after the first is filled from the previous phase\'s standings with zero results; the first is filled from the league roster. Nothing is created. Ids are UUIDs.',
  args: phaseArgs,
  phase: 0,
  guard: (args) => ({ kind: 'season', id: args.league_id }),
  output: z.strictObject({
    valid: z.boolean(),
    blockers: z.array(finding),
    effects: z.array(z.enum(EFFECTS)),
    ruleset: rulesetOut.nullable(),
    insert_at: z.number().int(),
    phase_count: z.number().int(),
  }),
  async execute(args) {
    const blockers: Finding[] = [];
    const effects = new Set<Effect>();
    const season = await getSeasonById(args.league_id);
    if (season === null) throw new UserFacingError('League not found', { code: 'SEASON_NOT_FOUND', status: 404 });

    const overrides = checkBoOverrides(args.bracket_type, args.bo_overrides_json, args.expected_participants);
    blockers.push(...overrides.findings);

    // Validate the assembled body with the route's real schema, so every route constraint applies (an even best-of, ...).
    const body = {
      name: args.name,
      description: args.description,
      bracket_type: args.bracket_type,
      ruleset_id: args.ruleset_id,
      best_of_default: args.best_of_default,
      bo_overrides: overrides.overrides,
      is_doubles: args.is_doubles,
      team_visibility: args.team_visibility,
      bracket_reset_enabled: args.bracket_reset_enabled,
      insert_at: args.insert_at,
      advancement_rule:
        args.advancement_count === undefined
          ? undefined
          : { type: 'top_n' as const, count: args.advancement_count, per_group: args.advancement_per_group ?? false },
    };
    const parsed = phaseCreateSchema.safeParse(body);
    if (!parsed.success) blockers.push(finder('validation_failed', { issues: formatZodErrors(parsed.error).slice(0, 300) }));

    const existing = await getStagesBySeasonId(args.league_id);
    const nameTaken = await check('phase preview name', () => assertPhaseNameFree(args.name, existing));
    if (nameTaken) blockers.push(nameTaken);

    const { ruleset, blocker } = await resolveRuleset(args.ruleset_id);
    if (blocker) blockers.push(blocker);
    if (ruleset?.visibility === 'private') effects.add('private_ruleset_becomes_public');

    // Same position rule as the route: from the highest stage_order, refused before a phase that has started.
    const maxOrder = Math.max(0, ...existing.map((phase) => phase.stage_order));
    const insertAt = args.insert_at ?? maxOrder + 1;
    if (insertAt < 1 || insertAt > maxOrder + 1) blockers.push(finder('PHASE_INSERT_INVALID'));
    else if (existing.some((phase) => phase.stage_order >= insertAt && phase.status !== 'upcoming')) blockers.push(finder('PHASE_INSERT_LOCKED'));

    effects.add(existing.length === 0 ? 'enrolls_league_roster' : 'enrolls_previous_phase_standings');
    return {
      valid: blockers.filter(notNull).length === 0,
      blockers,
      effects: EFFECTS.filter((effect) => effects.has(effect)),
      ruleset,
      insert_at: insertAt,
      phase_count: existing.length,
    };
  },
});

// ─── round_schedule_preview ──────────────────────────────────────────────────

export const roundSchedulePreview = defineRunnable('any', {
  name: 'round_schedule_preview',
  class: 'P',
  description:
    'Preview how many rounds a round robin needs. With participant_count it answers for one group of that size: the engine plays ONE circle, so N players need N-1 rounds (N if odd); a double round robin is not supported. With league_id it plans the weeks of the league\'s groups (cross_group true schedules cross-group weeks). Nothing is written.',
  args: z
    .strictObject({
      participant_count: intArg('Number of players in one round robin', 2, 256).optional(),
      league_id: uuidArg('League whose groups to schedule').optional(),
      cross_group: z.boolean().optional(),
    })
    .refine((a) => a.participant_count !== undefined || a.league_id !== undefined, { message: 'participant_count or league_id is required', path: ['participant_count'] }),
  phase: 2,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    circles: z.number().int(),
    total_rounds: z.number().int().nullable(),
    first_half_last_week: z.number().int().nullable(),
    cross_group: z.boolean().nullable(),
    blockers: z.array(finding),
  }),
  async execute(args) {
    const blockers: Finding[] = [];
    let totalRounds: number | null = null;
    let firstHalf: number | null = null;
    let cross: boolean | null = null;
    if (args.league_id !== undefined) {
      await guardFor({ kind: 'season', id: args.league_id });
      const groups = await getSeasonGroups(args.league_id);
      if (groups.length === 0) {
        blockers.push(finder('SEASON_GROUP_NOT_FOUND'));
      } else {
        try {
          const plan = planGroupSchedule(
            groups.map((group) => ({ id: group.id, memberIds: group.player_ids })),
            { crossGroup: args.cross_group ?? false },
          );
          totalRounds = plan.totalWeeks;
          firstHalf = plan.firstHalfLastWeek;
          cross = plan.crossGroup;
        } catch (err) {
          if (err instanceof GroupScheduleError) blockers.push(finder('validation_failed', { issues: err.code }));
          else throw err;
        }
      }
    } else if (args.participant_count !== undefined) {
      totalRounds = getRoundRobinTotalRounds(args.participant_count);
    }
    return { circles: 1, total_rounds: totalRounds, first_half_last_week: firstHalf, cross_group: cross, blockers };
  },
});

export const LEAGUE_PREVIEWS = [leagueCreatePreview, phaseCreatePreview, tournamentCreatePreview, roundSchedulePreview] as const;
