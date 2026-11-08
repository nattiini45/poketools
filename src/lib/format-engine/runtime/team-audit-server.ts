/**
 * The post-match team audit of a kit league (`team-audit.ts` holds the rules): reads the teams a completed match was
 * played with, evaluates the stage's team constraints against them and opens a `team_audit` check per side that broke
 * them, differs from the replay, or could not be audited. Server only.
 *
 * It never fails a match for a rule break (a break is a check) or for a known permanent cause (reported as an
 * `audit_unavailable` check). Anything else that throws is transient: the call rejects, the hook reports `false` and the
 * auto-confirm heal calls it again, but only for `AUDIT_RETRY_WINDOW_MS` after the match finished; after that the failing
 * sides get an `audit_unavailable` check (`read_failed`) and count as done, so a failure that never goes away cannot hold
 * the heal's oldest-first batch forever. Checks are idempotent by key, so a retry opens nothing twice. A caller that is
 * not the heal chooses its own bound (`AuditRetry`): the cron backfill audits matches that finished long ago, and a
 * window that began at the match's end would give up on the first transient error.
 *
 * Where a lost audit is retried, and where it is not. A match is only finalized (its marker stamped) after the hook
 * reported success, and the hook reports the audit's transient failure as `false`: until the audit completed, reported or
 * opened its checks the match stays on the heal's worklist, so a transient failure on a finalized match cannot happen
 * through the live path. The cron backfill reaches finalized matches whose event never fired and audits them with
 * `always` and then `never`. The limit that remains: when opening an `audit_unavailable` check itself fails in both calls
 * of the backfill, the event key is already fired, so no later pass finds the match missing, and a clean audit leaves no
 * trace (no check, no marker) to tell it from one that never ran, so a sweep for "audit missing" cannot be built on the
 * state that exists. That case is logged (`match_completed backfill failed`) and counted as a failure of the run; an admin
 * has to look at the match.
 */
import 'server-only';

import { logger } from '@/lib/logger';
import { expireSeasonReads } from '@/lib/revalidation';
import { getBattleStatsByMatch, getGamesByMatch } from '@/lib/supabase/queries/games';
import { openFormatCheck } from '@/lib/supabase/queries/format-runtime';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getPlayerTeamForMatch, TeamRowConflictError } from '@/lib/supabase/queries/teams';
import type { Ruleset } from '@/types/ruleset';
import type { PokemonSet } from '@/types/team';
import type { HookTournament } from '../kit-candidate';
import { phaseById, type KitContext, type KitPhaseInfo } from './load';
import {
  auditViolations,
  auditsTeams,
  observedOffTeam,
  planTeamAuditChecks,
  stateBeforeCompletion,
  type TeamAuditCause,
  type TeamAuditCheck,
  type TeamAuditSide,
} from './team-audit';
import { evaluateKitConstraints, readPhaseRuleset } from './team-server';

const TAG = 'format-engine/team-audit';

/** How long after a match finished a transient audit failure is retried before the side is reported unavailable. */
export const AUDIT_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * What a transient failure does. `window` (the default): rethrow while the match finished less than
 * `AUDIT_RETRY_WINDOW_MS` ago, else report. `always`: rethrow. `never`: report at once. A caller whose retry is not the
 * heal (the cron backfill of a match that is already finalized) bounds its own attempts with the last two. Opening a
 * check can itself fail, in every mode (`never` included): that rejects, and a caller with no further retry (the
 * backfill) is left with its log only.
 */
export type AuditRetry = 'window' | 'always' | 'never';

export interface AuditMatchTeamsInput {
  tournament: HookTournament & { season_id: string };
  matchId: string;
  roundId: string;
  player1Id: string;
  player2Id: string;
  /** The completion generation of the match (`match_reverted` events fired before this completion). */
  generation: number;
  /** The context `onMatchCompleted` loaded: the state before this completion's own effects on a first run. */
  context: KitContext;
  /** Defaults to `window`. */
  retry?: AuditRetry;
}

interface Run {
  input: AuditMatchTeamsInput;
  phase: KitPhaseInfo;
  completionRef: string;
  evaluatedAt: string;
  /** 0 until the round was read. */
  round: number;
}

interface Shared {
  ruleset: Ruleset | null;
  /** Pokémon each player brought, by the replays' species names. */
  observed: ReadonlyMap<string, readonly string[]>;
  /** The submission time of the first replay, or null without games. */
  firstGameAt: number | null;
}

const unavailable = (playerId: string, cause: TeamAuditCause): TeamAuditSide => ({
  playerId,
  teamId: null,
  teamSource: 'none',
  teamUpdatedAt: null,
  editedAfterPlay: false,
  violations: [],
  offTeam: [],
  observedAny: false,
  deadlineCheckOpen: false,
  cause,
});

/**
 * A `deadline_missed` check of the `team` policy exists for the match (that policy owns "no team by the deadline", so the
 * audit does not add `no_registered_team` on top of it). A `match` policy check only says the match was unplayed past its
 * instant, and a rejected check no longer owns anything: neither suppresses the reason.
 */
function deadlineCheckOpenFor(ctx: KitContext, matchId: string): boolean {
  return ctx.state.checks.some((check) => {
    if (check.source !== 'deadline_missed' || check.status === 'rejected') return false;
    const subject = check.subject;
    return (
      typeof subject === 'object' &&
      subject !== null &&
      !Array.isArray(subject) &&
      subject.match_id === matchId &&
      subject.applies === 'team'
    );
  });
}

async function auditSide(run: Run, shared: Shared, playerId: string): Promise<TeamAuditSide> {
  const { input, phase } = run;
  if (shared.ruleset === null) return unavailable(playerId, 'ruleset_missing');

  let team;
  try {
    team = await getPlayerTeamForMatch(playerId, { id: input.matchId, tournament_id: phase.id });
  } catch (error) {
    if (error instanceof TeamRowConflictError) {
      logger.warn(TAG, 'a player has more than one team row for the match', { matchId: input.matchId, playerId, error });
      return unavailable(playerId, 'team_rows_duplicate');
    }
    throw error;
  }

  const observed = shared.observed.get(playerId) ?? [];
  const deadlineCheckOpen = deadlineCheckOpenFor(input.context, input.matchId);
  if (team === null) {
    return {
      playerId,
      teamId: null,
      teamSource: 'none',
      teamUpdatedAt: null,
      editedAfterPlay: false,
      violations: [],
      offTeam: [],
      observedAny: observed.length > 0,
      deadlineCheckOpen,
      cause: null,
    };
  }

  const ctx = { ...input.context, state: stateBeforeCompletion(input.context.state, run.completionRef) };
  const { issues, members } = evaluateKitConstraints({
    ctx,
    phase,
    playerId,
    roundNumber: run.round,
    pokemon: team.pokemon as PokemonSet[],
    ruleset: shared.ruleset,
  });
  for (const issue of issues) {
    if (issue.code === 'kit_constraint_expr') {
      logger.warn(TAG, 'a team constraint could not be evaluated', { matchId: input.matchId, constraint: issue.constraint_index, reason: issue.params.reason });
    }
  }
  const updatedAt = Date.parse(team.updated_at);
  return {
    playerId,
    teamId: team.id,
    teamSource: team.match_id === input.matchId ? 'match' : 'planned',
    teamUpdatedAt: team.updated_at,
    editedAfterPlay: shared.firstGameAt !== null && Number.isFinite(updatedAt) && updatedAt > shared.firstGameAt,
    violations: auditViolations(issues),
    offTeam: observedOffTeam(observed, members),
    observedAny: observed.length > 0,
    deadlineCheckOpen,
    cause: null,
  };
}

async function readShared(run: Run): Promise<Shared> {
  const { matchId } = run.input;
  const [ruleset, games, stats] = await Promise.all([readPhaseRuleset(run.phase.id), getGamesByMatch(matchId), getBattleStatsByMatch(matchId)]);
  const observed = new Map<string, string[]>();
  for (const rows of Object.values(stats)) {
    for (const row of rows) {
      if (!row.was_brought) continue;
      const names = observed.get(row.player_id) ?? [];
      names.push(row.pokemon_name);
      observed.set(row.player_id, names);
    }
  }
  const times = games.map((game) => Date.parse(game.created_at)).filter((time) => Number.isFinite(time));
  return { ruleset, observed, firstGameAt: times.length > 0 ? Math.min(...times) : null };
}

/** Opens the planned checks; the count of the ones that did not exist before. */
async function openPlanned(seasonId: string, checks: readonly TeamAuditCheck[], revision: number): Promise<number> {
  let opened = 0;
  for (const check of checks) {
    const id = await openFormatCheck({
      seasonId,
      source: check.source,
      ruleId: check.rule_id,
      dedupeKey: check.dedupe_key,
      subject: check.subject,
      revision,
    });
    if (id !== null) opened += 1;
  }
  return opened;
}

const planFor = (run: Run, sides: readonly TeamAuditSide[]): TeamAuditCheck[] =>
  planTeamAuditChecks({
    stage: run.phase.stage.key,
    phaseId: run.phase.id,
    matchId: run.input.matchId,
    generation: run.input.generation,
    completionRef: run.completionRef,
    round: run.round,
    evaluatedAt: run.evaluatedAt,
    sides,
  });

/**
 * A transient failure for `playerIds`: rethrown while the match is inside the retry window, else the sides are
 * reported as `audit_unavailable` (`read_failed`). Resolves with the number of checks opened.
 */
async function reportOrRethrow(run: Run, playerIds: readonly string[], error: unknown): Promise<number> {
  const { input } = run;
  const retry = input.retry ?? 'window';
  if (retry === 'always') throw error;
  let match;
  try {
    match = await getMatchById(input.matchId);
  } catch {
    throw error;
  }
  if (match === null) {
    logger.warn(TAG, 'the match is gone, nothing to audit', { matchId: input.matchId });
    return 0;
  }
  const finished = Date.parse(match.confirmed_at ?? match.updated_at);
  if (retry === 'window' && (!Number.isFinite(finished) || Date.now() - finished <= AUDIT_RETRY_WINDOW_MS)) throw error;
  logger.error(TAG, 'team audit gave up after the retry window', { matchId: input.matchId, playerIds, error });
  return openPlanned(input.tournament.season_id, planFor(run, playerIds.map((id) => unavailable(id, 'read_failed'))), input.context.revision);
}

/**
 * Opens the `team_audit` checks of a completed match. Resolves when every side was audited or reported; rejects only on
 * a transient failure inside the retry window (the checks of the sides that did finish are opened first). A rule break
 * is a check, never an error. A phase whose stage has no team constraints is not audited and reads nothing.
 */
export async function auditMatchTeams(input: AuditMatchTeamsInput): Promise<{ opened: number }> {
  const phase = phaseById(input.context, input.tournament.id);
  if (phase === undefined || !auditsTeams(phase)) return { opened: 0 };
  const seasonId = input.tournament.season_id;
  const players = [input.player1Id, input.player2Id];
  const run: Run = {
    input,
    phase,
    completionRef: input.generation === 0 ? input.matchId : `${input.matchId}:${input.generation}`,
    evaluatedAt: new Date().toISOString(),
    round: 0,
  };

  let shared: Shared;
  try {
    const [round, outcome] = await Promise.all([getRoundById(input.roundId), getMatchOutcome(input.matchId)]);
    if (round === null) throw new Error(`team audit: round ${input.roundId} of match ${input.matchId} was not found`);
    run.round = round.round_number;
    // The outcome kind is per match: a forfeit or no-show audits neither side.
    if (outcome?.kind === 'forfeit' || outcome?.kind === 'no_show') return { opened: 0 };
    shared = await readShared(run);
  } catch (error) {
    const opened = await reportOrRethrow(run, players, error);
    if (opened > 0) expireSeasonReads(seasonId);
    return { opened };
  }

  const settled = await Promise.allSettled(players.map((playerId) => auditSide(run, shared, playerId)));
  const sides: TeamAuditSide[] = [];
  const failed: { playerId: string; error: unknown }[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') sides.push(result.value);
    else failed.push({ playerId: players[index], error: result.reason });
  });

  const errors: unknown[] = [];
  let opened = 0;
  try {
    opened += await openPlanned(seasonId, planFor(run, sides), input.context.revision);
  } catch (error) {
    errors.push(error);
  }
  if (failed.length > 0) {
    try {
      opened += await reportOrRethrow(
        run,
        failed.map((f) => f.playerId),
        failed[0].error,
      );
    } catch (error) {
      errors.push(error);
    }
  }
  if (opened > 0) expireSeasonReads(seasonId);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'team audit failed');
  return { opened };
}
