import 'server-only';
/**
 * Tournament readers (plan 3.6.2): `tournament_get`, `tournament_list`, `tournament_bracket_preview`.
 *
 * Standalone tournaments only for the list: `GET /api/tournaments?archived=true` leaks across resource admins, so no
 * archived read is offered. Participants leave as the public tournament-participant shape (id, name, seed), mapped
 * field by field from the query rows.
 */
import { z } from 'zod';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { toPublicTournamentParticipant } from '@/lib/players/public-player';
import { getParticipants, getTournamentWithDetails, listTournaments, listTournamentsByIds } from '@/lib/supabase/queries/tournaments';
import { buildBracketStructureForParticipants } from '@/lib/tournament/bracket-structure';
import { defineRunnable } from '../registry/define';
import { capped, code, id, label, uuidArg } from '../registry/atoms';
import { fenceLabel } from '../registry/fence';

const LIST_CAP = 200;
const PARTICIPANT_CAP = 64;

const tournamentNotFound = () => new UserFacingError('Tournament not found', { code: 'tournament_not_found', status: 404 });

// ─── tournament_get ──────────────────────────────────────────────────────────

export const tournamentGet = defineRunnable('tournament', {
  name: 'tournament_get',
  class: 'R',
  description:
    'Get one standalone tournament or league phase with its participants (id, name, seed, in seed order). Capped at 64 participants with a count of the rest. Settings include the bracket type, best-of, status and the pinned ruleset version.',
  args: z.strictObject({ tournament_id: uuidArg('Tournament or phase id') }),
  phase: 0,
  guard: (args) => ({ kind: 'tournament', id: args.tournament_id }),
  output: z.strictObject({
    tournament: z.strictObject({
      id: id(),
      label: label(),
      bracket_type: code(),
      status: code(),
      best_of_default: z.number().int(),
      is_doubles: z.boolean(),
      team_visibility: code(),
      archived: z.boolean(),
      league_id: id().nullable(),
      ruleset_id: id(),
      ruleset_label: label(),
      current_round: z.number().int(),
      participants: capped(z.strictObject({ id: id(), label: label(), seed: z.number().int().nullable(), starting_bracket: z.enum(['winners', 'losers']) })),
    }),
  }),
  async execute(args) {
    const tournament = await getTournamentWithDetails(args.tournament_id);
    if (tournament === null) throw tournamentNotFound();
    const rows = await getParticipants(tournament.id);
    const participants = rows.map((row) => toPublicTournamentParticipant(row));
    return {
      tournament: {
        id: tournament.id,
        label: fenceLabel(tournament.name),
        bracket_type: tournament.bracket_type,
        status: tournament.status,
        best_of_default: tournament.best_of_default,
        is_doubles: tournament.is_doubles,
        team_visibility: tournament.team_visibility,
        archived: tournament.archived,
        league_id: tournament.season_id,
        ruleset_id: tournament.ruleset_id,
        ruleset_label: fenceLabel(tournament.ruleset_name),
        current_round: tournament.current_round,
        participants: {
          items: participants.slice(0, PARTICIPANT_CAP).map((p) => ({ id: p.id, label: fenceLabel(p.name), seed: p.seed, starting_bracket: p.starting_bracket })),
          total: participants.length,
          truncated: participants.length > PARTICIPANT_CAP,
          cap: PARTICIPANT_CAP,
        },
      },
    };
  },
});

// ─── tournament_list ─────────────────────────────────────────────────────────

export const tournamentList = defineRunnable('any', {
  name: 'tournament_list',
  class: 'R',
  description:
    'List the active standalone tournaments the admin may manage, newest first (all of them for a site admin). League phases are not listed here: read the league. Archived tournaments are not offered. The read stops at 200 rows and the result says when it was cut.',
  args: z.strictObject({}),
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    tournaments: capped(
      z.strictObject({ id: id(), label: label(), bracket_type: code(), status: code(), participant_count: z.number().int(), ruleset_label: label() }),
    ),
  }),
  async execute(_args, guarded) {
    const scope = await getAdminScope(guarded.player);
    const rows =
      scope.tournamentIds === null
        ? await listTournaments()
        : await listTournamentsByIds(scope.tournamentIds, { archived: false, standaloneOnly: true });
    return {
      tournaments: {
        items: rows.slice(0, LIST_CAP).map((row) => ({
          id: row.id,
          label: fenceLabel(row.name),
          bracket_type: row.bracket_type,
          status: row.status,
          participant_count: row.participant_count,
          ruleset_label: fenceLabel(row.ruleset_name),
        })),
        total: rows.length >= LIST_CAP ? null : rows.length,
        truncated: rows.length >= LIST_CAP,
        cap: LIST_CAP,
      },
    };
  },
});

// ─── tournament_bracket_preview ──────────────────────────────────────────────

const BRACKET_ROUND_CAP = 30;

export const tournamentBracketPreview = defineRunnable('tournament', {
  name: 'tournament_bracket_preview',
  class: 'R',
  description:
    'Show the bracket structure a single or double elimination tournament would have with its current participants: round names and how many matches each round has, and the keys that best-of overrides must use. Round robin and Swiss tournaments have no bracket structure and report none. Nothing is written.',
  args: z.strictObject({ tournament_id: uuidArg('Tournament or phase id') }),
  phase: 0,
  guard: (args) => ({ kind: 'tournament', id: args.tournament_id }),
  output: z.strictObject({
    bracket_type: code(),
    has_structure: z.boolean(),
    participant_count: z.number().int(),
    rounds: capped(z.strictObject({ label: label(), side: code(), round_number: z.number().int(), matches: z.number().int() })),
  }),
  async execute(args) {
    const tournament = await getTournamentWithDetails(args.tournament_id);
    if (tournament === null) throw tournamentNotFound();
    const rows = await getParticipants(tournament.id);
    const structure = buildBracketStructureForParticipants(
      tournament.bracket_type,
      rows.map((row) => ({ seed: row.seed, starting_bracket: row.starting_bracket, name: row.name })),
      { bracketResetEnabled: tournament.bracket_reset_enabled ?? true },
    );
    if (structure === null) {
      return {
        bracket_type: tournament.bracket_type,
        has_structure: false,
        participant_count: rows.length,
        rounds: { items: [], total: 0, truncated: false, cap: BRACKET_ROUND_CAP },
      };
    }
    const matchesPerRound = new Map<string, number>();
    for (const slot of structure.slots) matchesPerRound.set(slot.round_name, (matchesPerRound.get(slot.round_name) ?? 0) + 1);
    return {
      bracket_type: tournament.bracket_type,
      has_structure: true,
      participant_count: rows.length,
      rounds: {
        items: structure.rounds.slice(0, BRACKET_ROUND_CAP).map((round) => ({
          label: fenceLabel(round.name),
          side: round.bracket_side,
          round_number: round.round_number,
          matches: matchesPerRound.get(round.name) ?? 0,
        })),
        total: structure.rounds.length,
        truncated: structure.rounds.length > BRACKET_ROUND_CAP,
        cap: BRACKET_ROUND_CAP,
      },
    };
  },
});

export const TOURNAMENT_READERS = [tournamentGet, tournamentList, tournamentBracketPreview] as const;
