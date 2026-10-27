import 'server-only';
/**
 * League readers (plan 3.6.2): `league_list`, `league_get`, `league_roster_get`, `player_search`, `phase_get`.
 *
 * Every one runs its route's live guard through `guardFor` before reading, and returns a hand-built projection checked
 * by a strict output schema. Players leave only as `{id, label}` (the public ref); the roster comes from
 * `getPublicSeasonParticipants`, which never selects a private player column. Stored text is fenced (`fence.ts`).
 */
import { z } from 'zod';
import { getAdminScope, scopeAllowsSeason } from '@/lib/auth/admin-scope';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { toPublicPlayerRef } from '@/lib/players/public-player';
import { getLeagueTrashBySeason } from '@/lib/supabase/queries/league-trash';
import { listPlayers } from '@/lib/supabase/queries/players';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { getSeasonStartSignals } from '@/lib/supabase/queries/season-formats';
import { getPublicSeasonParticipants, getSeasonWithDetails, listSeasons } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId, getTournamentWithDetails } from '@/lib/supabase/queries/tournaments';
import { defineRunnable } from '../registry/define';
import { guardFor } from '../registry/guard';
import { capped, code, id, intArg, isoDateTime, label, textArg, userText, uuidArg } from '../registry/atoms';
import { fenceLabel, fenceText } from '../registry/fence';

/** `listSeasons` reads at most this many rows; a full page means the list may be cut. */
const LIST_SEASONS_CAP = 100;
const ROSTER_CAP = 128;
const PHASE_CAP = 40;
const GROUP_CAP = 26;

/** How a phase is enrolled: from the league roster, from a previous phase's standings, or by hand. */
function enrollmentOf(source: { type: string } | null): 'roster' | 'standings' | 'manual' {
  return source?.type === 'roster' ? 'roster' : source?.type === 'standings' ? 'standings' : 'manual';
}

const phaseNotFound = () => new UserFacingError('Phase not found', { code: 'tournament_not_found', status: 404 });

const leagueSummary = z.strictObject({
  id: id(),
  label: label(),
  format_type: code(),
  status: code(),
  archived: z.boolean(),
  is_test_season: z.boolean(),
  start_date: isoDateTime().nullable(),
  end_date: isoDateTime().nullable(),
  ruleset_label: label().nullable(),
  participant_count: z.number().int(),
  phase_count: z.number().int(),
  language: z.enum(['en', 'de']),
});

// ─── league_list ─────────────────────────────────────────────────────────────

export const leagueList = defineRunnable('any', {
  name: 'league_list',
  class: 'R',
  description:
    'List the leagues the admin may manage (all of them for a site admin), newest first, real leagues before test leagues. Archived leagues are not listed. The read stops at 100 rows and the result says when it was cut. Test leagues are labelled with is_test_season; pass include_test_leagues false to leave them out. Use name_contains to narrow by name; an empty filtered result does not prove the league is missing, so list without the filter before saying so.',
  args: z.strictObject({
    include_test_leagues: z.boolean().optional().describe('Default true'),
    name_contains: textArg('Part of a league name', 60).optional(),
  }),
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({ leagues: capped(leagueSummary) }),
  async execute(args, guarded) {
    const scope = await getAdminScope(guarded.player);
    const rows = await listSeasons({ includeTestSeasons: args.include_test_leagues !== false });
    const needle = args.name_contains?.toLowerCase();
    const visible = rows.filter(
      (row) => scopeAllowsSeason(scope, row.id) && (needle === undefined || row.name.toLowerCase().includes(needle)),
    );
    return {
      leagues: {
        items: visible.map((row) => ({
          id: row.id,
          label: fenceLabel(row.name),
          format_type: row.format_type,
          status: row.status,
          archived: row.archived,
          is_test_season: row.is_test_season,
          start_date: row.start_date,
          end_date: row.end_date,
          ruleset_label: row.ruleset_name === null ? null : fenceLabel(row.ruleset_name),
          participant_count: row.participant_count,
          phase_count: row.tournament_count,
          language: row.language,
        })),
        total: rows.length >= LIST_SEASONS_CAP ? null : visible.length,
        truncated: rows.length >= LIST_SEASONS_CAP,
        cap: LIST_SEASONS_CAP,
      },
    };
  },
});

// ─── league_get ──────────────────────────────────────────────────────────────

const phaseSummary = z.strictObject({
  id: id(),
  label: label(),
  bracket_type: code(),
  status: code(),
  stage_order: z.number().int(),
  current_round: z.number().int(),
  best_of_default: z.number().int(),
  team_visibility: code(),
  archived: z.boolean(),
  ruleset_id: id(),
  ruleset_label: label(),
  participant_count: z.number().int(),
  enrollment: z.enum(['roster', 'standings', 'manual']),
  enrollment_frozen: z.boolean(),
  advancement: z.strictObject({ type: code(), count: z.number().int(), per_group: z.boolean() }).nullable(),
});

export const leagueGet = defineRunnable('season', {
  name: 'league_get',
  class: 'R',
  description:
    'Get one league: its settings, the pinned ruleset version (id and name), its phases in order with their status, enrollment and advancement, its groups and whether it has started. A league in the recycle bin is reported as trashed with its purge date instead of as missing.',
  args: z.strictObject({ league_id: uuidArg('League id') }),
  phase: 0,
  guard: (args) => ({ kind: 'season', id: args.league_id }),
  output: z.strictObject({
    found: z.boolean(),
    trash: z.strictObject({ purge_after: isoDateTime() }).nullable(),
    league: leagueSummary
      .extend({
        description_user_text: userText(),
        ruleset_id: id().nullable(),
        point_buy_list_bound: z.boolean(),
        started: z.boolean(),
        phases: capped(phaseSummary),
        groups: capped(z.strictObject({ id: id(), label: label(), member_count: z.number().int() })),
      })
      .nullable(),
  }),
  async execute(args) {
    const season = await getSeasonWithDetails(args.league_id);
    if (season === null) {
      const trashed = await getLeagueTrashBySeason(args.league_id);
      return { found: false, trash: trashed === null ? null : { purge_after: trashed.purge_after }, league: null };
    }
    const [stages, groups, signals] = await Promise.all([
      getStagesBySeasonId(season.id),
      getSeasonGroups(season.id),
      getSeasonStartSignals(season.id),
    ]);
    const started =
      signals !== null && (signals.status !== 'upcoming' || signals.phases.some((phase) => phase.status !== 'upcoming' || phase.rounds_total > 0));
    return {
      found: true,
      trash: null,
      league: {
        id: season.id,
        label: fenceLabel(season.name),
        format_type: season.format_type,
        status: season.status,
        archived: season.archived,
        is_test_season: season.is_test_season,
        start_date: season.start_date,
        end_date: season.end_date,
        ruleset_label: season.ruleset_name === null ? null : fenceLabel(season.ruleset_name),
        participant_count: season.participant_count,
        phase_count: season.tournament_count,
        language: season.language,
        description_user_text: fenceText(season.description),
        ruleset_id: season.ruleset_id,
        point_buy_list_bound: season.point_buy_list_id !== null,
        started,
        phases: {
          items: stages.slice(0, PHASE_CAP).map((stage) => ({
            id: stage.id,
            label: fenceLabel(stage.name),
            bracket_type: stage.bracket_type,
            status: stage.status,
            stage_order: stage.stage_order,
            current_round: stage.current_round,
            best_of_default: stage.best_of_default,
            team_visibility: stage.team_visibility,
            archived: stage.archived,
            ruleset_id: stage.ruleset_id,
            ruleset_label: fenceLabel(stage.ruleset_name),
            participant_count: stage.participant_count,
            enrollment: enrollmentOf(stage.enrollment_source),
            enrollment_frozen: stage.enrollment_source?.frozen ?? false,
            advancement: stage.advancement_rule
              ? { type: stage.advancement_rule.type, count: stage.advancement_rule.count, per_group: stage.advancement_rule.per_group }
              : null,
          })),
          total: stages.length,
          truncated: stages.length > PHASE_CAP,
          cap: PHASE_CAP,
        },
        groups: {
          items: groups.slice(0, GROUP_CAP).map((group) => ({ id: group.id, label: fenceLabel(group.name), member_count: group.player_ids.length })),
          total: groups.length,
          truncated: groups.length > GROUP_CAP,
          cap: GROUP_CAP,
        },
      },
    };
  },
});

// ─── league_roster_get ───────────────────────────────────────────────────────

export const leagueRosterGet = defineRunnable('season', {
  name: 'league_roster_get',
  class: 'R',
  description:
    'Get the roster of a league: each player as an id and a name, with the gym type when the league uses one, and the group they are in. Public player data only; nothing about accounts, bans or logins is available. Capped at 128 players with a count of the rest.',
  args: z.strictObject({ league_id: uuidArg('League id') }),
  phase: 0,
  guard: (args) => ({ kind: 'season', id: args.league_id }),
  output: z.strictObject({
    players: capped(z.strictObject({ id: id(), label: label(), gym_type: code().nullable(), group_id: id().nullable() })),
  }),
  async execute(args) {
    const [roster, groups] = await Promise.all([getPublicSeasonParticipants(args.league_id), getSeasonGroups(args.league_id)]);
    const groupOf = new Map<string, string>();
    for (const group of groups) for (const playerId of group.player_ids) groupOf.set(playerId, group.id);
    const sorted = [...roster].sort((a, b) => a.name.localeCompare(b.name));
    return {
      players: {
        items: sorted.slice(0, ROSTER_CAP).map((participant) => ({
          id: participant.id,
          label: fenceLabel(participant.name),
          gym_type: participant.gym_type,
          group_id: groupOf.get(participant.id) ?? null,
        })),
        total: sorted.length,
        truncated: sorted.length > ROSTER_CAP,
        cap: ROSTER_CAP,
      },
    };
  },
});

// ─── player_search ───────────────────────────────────────────────────────────

const SEARCH_LIMIT = 20;

export const playerSearch = defineRunnable('any', {
  name: 'player_search',
  class: 'R',
  description:
    'Search players by name to put them on a roster. Returns at most 20 hits as id, name and whether the row is a guest. A site admin searches every account; a league or tournament admin must name the league or the tournament they are working in and sees only active, non-test accounts. Never pick a fuzzy match on the admin\'s behalf: show the hits and ask.',
  args: z
    .strictObject({
      query: textArg('Part of a player name', 64),
      league_id: uuidArg('League the roster belongs to').optional(),
      tournament_id: uuidArg('Tournament the roster belongs to').optional(),
      limit: intArg('Hits to return', 1, SEARCH_LIMIT).optional(),
    })
    .refine((a) => !(a.league_id && a.tournament_id), { message: 'league_id and tournament_id are mutually exclusive', path: ['tournament_id'] }),
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    hits: z.array(z.strictObject({ id: id(), label: label(), is_guest: z.boolean() })),
    total: z.number().int(),
    truncated: z.boolean(),
  }),
  async execute(args, guarded) {
    if (!guarded.player.isAdmin) {
      // Same scope rule as GET /api/admin/player-search: the scope is a guard, not a filter.
      if (args.league_id) await guardFor({ kind: 'season', id: args.league_id });
      else if (args.tournament_id) await guardFor({ kind: 'tournament', id: args.tournament_id });
      else throw new UserFacingError('A league or tournament is required', { code: 'validation_failed', params: { issues: 'league_id: league_id or tournament_id is required' }, status: 400 });
    }
    const limit = args.limit ?? 10;
    const { data, total } = await listPlayers({
      limit,
      offset: 0,
      search: args.query,
      ...(guarded.player.isAdmin ? {} : { visibleOnly: true }),
    });
    return {
      hits: data.map((row) => {
        const ref = toPublicPlayerRef(row);
        return { id: ref.id, label: fenceLabel(ref.name), is_guest: row.is_guest === true };
      }),
      total,
      truncated: total > data.length,
    };
  },
});

// ─── phase_get ───────────────────────────────────────────────────────────────

export const phaseGet = defineRunnable('tournament', {
  name: 'phase_get',
  class: 'R',
  description:
    'Get one phase of a league (or one standalone tournament) by its tournament id: bracket type, status, best-of settings, the pinned ruleset version, enrollment, advancement and how many participants it has. Use tournament_get for the participant list.',
  args: z.strictObject({ tournament_id: uuidArg('Phase or tournament id') }),
  phase: 0,
  guard: (args) => ({ kind: 'tournament', id: args.tournament_id }),
  output: z.strictObject({
    phase: phaseSummary.extend({
        league_id: id().nullable(),
        league_label: label().nullable(),
        is_doubles: z.boolean(),
        bo_overrides: z.array(z.strictObject({ round_label: label(), best_of: z.number().int() })),
        bracket_reset_enabled: z.boolean(),
        description_user_text: userText(),
      }),
  }),
  async execute(args) {
    const tournament = await getTournamentWithDetails(args.tournament_id);
    if (tournament === null) throw phaseNotFound();
    return {
      phase: {
        id: tournament.id,
        label: fenceLabel(tournament.name),
        bracket_type: tournament.bracket_type,
        status: tournament.status,
        stage_order: tournament.stage_order,
        current_round: tournament.current_round,
        best_of_default: tournament.best_of_default,
        team_visibility: tournament.team_visibility,
        archived: tournament.archived,
        ruleset_id: tournament.ruleset_id,
        ruleset_label: fenceLabel(tournament.ruleset_name),
        participant_count: tournament.participant_count,
        enrollment: enrollmentOf(tournament.enrollment_source),
        enrollment_frozen: tournament.enrollment_source?.frozen ?? false,
        advancement: tournament.advancement_rule
          ? { type: tournament.advancement_rule.type, count: tournament.advancement_rule.count, per_group: tournament.advancement_rule.per_group }
          : null,
        league_id: tournament.season_id,
        league_label: tournament.season_name === null ? null : fenceLabel(tournament.season_name),
        is_doubles: tournament.is_doubles,
        bo_overrides: Object.entries(tournament.bo_overrides)
          .slice(0, 20)
          .map(([round, bestOf]) => ({ round_label: fenceLabel(round), best_of: bestOf })),
        bracket_reset_enabled: tournament.bracket_reset_enabled ?? true,
        description_user_text: fenceText(tournament.description),
      },
    };
  },
});

export const LEAGUE_READERS = [leagueList, leagueGet, leagueRosterGet, playerSearch, phaseGet] as const;
