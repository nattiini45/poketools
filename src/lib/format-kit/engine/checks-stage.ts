/**
 * Per-stage checks: participant counts and groups, series length, the match-model gate (draws, forfeits,
 * players per match), scoring and the rank chain.
 *
 * Checks that need a count run only when the plan knows it. The gate reads `env.matchModel`; nothing else in the
 * kit encodes what the match model can do.
 */
import { getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import { MAX_RANK_STEPS } from '../limits';
import type { FormatDefinition, RankStep, Stage } from '../types';
import { diag, ptr, type Diagnostic } from './diagnostics';
import type { CompileEnv } from './env';
import {
  fixAddCoinFlip,
  fixAddPointsStep,
  fixClearRank,
  fixMoveDecisionMatchLast,
  fixOddBestOf,
  fixReduceGroups,
  fixRemoveDraw,
  fixRemoveForfeit,
  fixRemoveOverride,
  fixRemoveRankStep,
  fixSetSwissRoundsAuto,
  fixSetTwoPlayers,
} from './fixes';
import { isElimination, isExact, type CountRange, type PlanBuild } from './plan';

export type MetricProblem = 'unknown_metric' | 'needs_kill_stats' | 'needs_rating' | 'needs_opponents';

const ALWAYS_PRODUCED: ReadonlySet<string> = new Set(['points', 'wins', 'losses', 'games_played', 'seed']);

/** Why a stage cannot produce a metric, or `null` when it can. The production table of the standings engine. */
export function metricProblem(metric: string, stage: Stage | null, env: CompileEnv): MetricProblem | null {
  if (ALWAYS_PRODUCED.has(metric)) return null;
  if (metric === 'kill_differential') return env.features.killStats ? null : 'needs_kill_stats';
  if (metric === 'rating') return env.features.rating ? null : 'needs_rating';
  if (metric === 'buchholz') {
    // Without a stage (a view naming none that exists) there is nothing to judge the opponents by.
    if (stage === null) return null;
    const opponents =
      (stage.pairing.kind === 'round_robin' || stage.pairing.kind === 'swiss') && stage.players_per_match === 2;
    return opponents ? null : 'needs_opponents';
  }
  return 'unknown_metric';
}

const TERMINAL_STEPS: ReadonlySet<RankStep['kind']> = new Set(['coin_flip', 'decision_match', 'manual']);

function checkSeries(out: Diagnostic[], stage: Stage, i: number, rounds: CountRange | null): void {
  const key = stage.key;
  const evenCheck = (bestOf: number, pointer: string, scope: 'default' | 'override') => {
    if (bestOf % 2 !== 0) return;
    const fixes = [fixOddBestOf(pointer, bestOf, 'lower'), fixOddBestOf(pointer, bestOf, 'higher')].filter(
      (f): f is NonNullable<typeof f> => f !== null,
    );
    out.push(diag('series_even_best_of', pointer, { stage: key, best_of: bestOf, scope }, fixes));
  };
  evenCheck(stage.series.best_of, ptr('stages', i, 'series', 'best_of'), 'default');

  const seen = new Set<string>();
  stage.series.overrides.forEach((override, j) => {
    evenCheck(override.best_of, ptr('stages', i, 'series', 'overrides', j, 'best_of'), 'override');
    const id = `${override.from}:${override.round}`;
    if (seen.has(id)) {
      out.push(
        diag('series_override_duplicate', ptr('stages', i, 'series', 'overrides', j), {
          stage: key,
          round: override.round,
        }, [fixRemoveOverride(i, j, override.round)]),
      );
    }
    seen.add(id);
    if (isElimination(stage) && rounds && override.round > rounds.max) {
      out.push(
        diag('series_override_unreachable', ptr('stages', i, 'series', 'overrides', j), {
          stage: key,
          round: override.round,
          rounds: rounds.max,
        }),
      );
    }
  });
}

function checkGate(out: Diagnostic[], stage: Stage, i: number, env: CompileEnv): void {
  const key = stage.key;
  if (!env.matchModel.draws) {
    if (stage.scoring.draw !== undefined) {
      out.push(
        diag('draws_unsupported', ptr('stages', i, 'scoring', 'draw'), { stage: key, where: 'scoring' }, [
          fixRemoveDraw(i, 'scoring'),
        ]),
      );
    }
    if (stage.series.allow_draw) {
      out.push(
        diag('draws_unsupported', ptr('stages', i, 'series', 'allow_draw'), { stage: key, where: 'series' }, [
          fixRemoveDraw(i, 'series'),
        ]),
      );
    }
  }
  if (!env.matchModel.forfeits && stage.scoring.forfeit !== undefined) {
    out.push(diag('forfeits_unsupported', ptr('stages', i, 'scoring', 'forfeit'), { stage: key }, [fixRemoveForfeit(i)]));
  }
  if (stage.players_per_match > env.matchModel.maxPlayersPerMatch) {
    out.push(
      diag(
        'players_per_match_unsupported',
        ptr('stages', i, 'players_per_match'),
        { stage: key, players: stage.players_per_match, max: env.matchModel.maxPlayersPerMatch },
        [fixSetTwoPlayers(i)],
      ),
    );
  }
  if (stage.scoring.win <= stage.scoring.loss) {
    out.push(
      diag('scoring_win_not_better', ptr('stages', i, 'scoring', 'win'), {
        stage: key,
        win: stage.scoring.win,
        loss: stage.scoring.loss,
      }),
    );
  }
}

function checkRank(out: Diagnostic[], stage: Stage, i: number, env: CompileEnv): void {
  const key = stage.key;
  const rank = stage.rank;
  const bracket = isElimination(stage);

  if (rank.length === 0 && !bracket) {
    out.push(diag('rank_chain_empty', ptr('stages', i, 'rank'), { stage: key }, [fixAddPointsStep(i)]));
  }
  if (rank.length > 0 && bracket) {
    out.push(diag('rank_ignored_for_bracket', ptr('stages', i, 'rank'), { stage: key }, [fixClearRank(i)]));
  }

  rank.forEach((step, k) => {
    if (step.kind !== 'metric') return;
    const problem = metricProblem(step.metric, stage, env);
    if (problem !== null) {
      out.push(
        diag(
          'metric_unproduced',
          ptr('stages', i, 'rank', k, 'metric'),
          { stage: key, metric: step.metric, reason: problem, where: 'rank' },
          // Removing the only step of a non-bracket stage would swap this problem for an empty chain.
          bracket || rank.length > 1 ? [fixRemoveRankStep(i, k)] : [],
        ),
      );
    }
  });
  stage.columns.forEach((metric, k) => {
    const problem = metricProblem(metric, stage, env);
    if (problem !== null) {
      out.push(
        diag('metric_unproduced', ptr('stages', i, 'columns', k), { stage: key, metric, reason: problem, where: 'columns' }),
      );
    }
  });

  const decisions = rank.flatMap((step, k) => (step.kind === 'decision_match' ? [k] : []));
  for (const k of decisions) {
    if (k === rank.length - 1) continue;
    out.push(
      diag('rank_decision_match_position', ptr('stages', i, 'rank', k), { stage: key }, decisions.length === 1 ? [fixMoveDecisionMatchLast(i, k)] : []),
    );
  }

  if (bracket || rank.length === 0) return;

  const last = rank[rank.length - 1];
  if (!TERMINAL_STEPS.has(last.kind)) {
    out.push(
      diag('rank_open_ended', ptr('stages', i, 'rank'), { stage: key }, rank.length < MAX_RANK_STEPS ? [fixAddCoinFlip(i)] : []),
    );
  }

  const firstTerminal = rank.findIndex((step) => TERMINAL_STEPS.has(step.kind));
  if (firstTerminal >= 0) {
    for (let k = firstTerminal + 1; k < rank.length; k += 1) {
      out.push(diag('rank_step_unreachable', ptr('stages', i, 'rank', k), { stage: key }));
    }
  }

  const seen = new Set<string>();
  rank.forEach((step, k) => {
    const id = step.kind === 'metric' ? `metric:${step.metric}:${step.direction}` : step.kind === 'head_to_head' ? 'head_to_head' : null;
    if (id === null) return;
    if (seen.has(id)) out.push(diag('rank_duplicate_step', ptr('stages', i, 'rank', k), { stage: key }));
    seen.add(id);
  });
}

/** A cross-stage view sums one metric over several stages, so every stage it names must produce that metric. */
function checkViews(out: Diagnostic[], def: FormatDefinition, env: CompileEnv, first: ReadonlyMap<string, number>): void {
  def.views.forEach((view, i) => {
    const stages = view.stages.flatMap((key) => {
      const at = first.get(key);
      return at === undefined ? [] : [def.stages[at]];
    });
    let problem = metricProblem(view.metric, null, env);
    for (const stage of stages) {
      if (problem !== null) break;
      problem = metricProblem(view.metric, stage, env);
    }
    if (problem !== null) {
      out.push(
        diag('metric_unproduced', ptr('views', i, 'metric'), {
          view: view.key,
          metric: view.metric,
          reason: problem,
          where: 'view',
        }),
      );
    }
  });
}

export function checkStages(def: FormatDefinition, env: CompileEnv, plan: PlanBuild): Diagnostic[] {
  const out: Diagnostic[] = [];
  const first = new Map<string, number>();
  def.stages.forEach((stage, i) => {
    if (!first.has(stage.key)) first.set(stage.key, i);
  });

  def.stages.forEach((stage, i) => {
    const key = stage.key;
    // A later stage that reuses a key is reported by the structure check; the plan describes the first one.
    const stagePlan = first.get(key) === i ? plan.byKey.get(key) : undefined;
    const participants = stagePlan?.participants ?? null;

    if (participants && participants.max < 2) {
      out.push(
        diag('stage_too_few_participants', ptr('stages', i, 'participants'), {
          stage: key,
          count: participants.max,
          source: plan.sources.get(key) ?? 'edges',
        }),
      );
    }

    if (stage.groups && participants) {
      const groups = stage.groups.count;
      if (participants.max < groups * 2) {
        const reduced = Math.floor(participants.max / 2);
        out.push(
          diag(
            'groups_too_many',
            ptr('stages', i, 'groups', 'count'),
            { stage: key, groups, participants: participants.max },
            reduced >= 2 ? [fixReduceGroups(i, reduced)] : [],
          ),
        );
      } else if (isExact(participants) && participants.min % groups !== 0) {
        out.push(diag('groups_uneven', ptr('stages', i, 'groups'), { stage: key, groups, participants: participants.min }));
      }
    }

    // Repeats only matter when the pairing avoids them; a field of n can play getRoundRobinTotalRounds(n) rounds
    // (n - 1 for an even field, n for an odd one, because of the bye) before a pairing has to repeat.
    if (stage.pairing.kind === 'swiss' && stage.pairing.rounds !== 'auto' && stage.pairing.avoid_repeats && participants) {
      if (stage.pairing.rounds > getRoundRobinTotalRounds(participants.max)) {
        out.push(
          diag(
            'swiss_rounds_too_many',
            ptr('stages', i, 'pairing', 'rounds'),
            { stage: key, rounds: stage.pairing.rounds, participants: participants.max },
            [fixSetSwissRoundsAuto(i)],
          ),
        );
      }
    }

    checkSeries(out, stage, i, stagePlan?.rounds ?? null);
    checkGate(out, stage, i, env);
    checkRank(out, stage, i, env);
  });
  checkViews(out, def, env, first);

  return out;
}
