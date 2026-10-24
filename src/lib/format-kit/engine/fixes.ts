/**
 * Fix builders. A fix is a catalog id plus a JSON patch (RFC 6901 pointers, `patch.ts` semantics) that applies
 * to the stored definition. A fix never invents data the user has to choose: a diagnostic that needs such a
 * choice carries no fix at all, so every fix here has a non-empty patch.
 *
 * Patches use `add` for object members that may be absent in a stored document (the schema fills defaults), and
 * `replace` / `remove` only for members the diagnostic itself proves exist.
 */
import type { PatchOp } from '../patch';
import type { Fix } from './diagnostics';
import { ptr } from './diagnostics';

function fix(id: Fix['id'], params: Fix['params'], patch: PatchOp[]): Fix {
  return { id, params, patch };
}

/** Fixes whose diagnostics need a user decision and therefore carry no patch: none. */
export const USER_CHOICE_FIXES: readonly Fix['id'][] = [];

export function fixOddBestOf(pointer: string, bestOf: number, direction: 'lower' | 'higher'): Fix | null {
  const value = direction === 'lower' ? bestOf - 1 : bestOf + 1;
  if (value < 1 || value > 15) return null;
  return fix(direction === 'lower' ? 'use_lower_odd' : 'use_higher_odd', { best_of: value }, [
    { op: 'replace', path: pointer, value },
  ]);
}

export function fixRemoveDraw(stage: number, where: 'scoring' | 'series'): Fix {
  return where === 'scoring'
    ? fix('remove_draw', {}, [{ op: 'remove', path: ptr('stages', stage, 'scoring', 'draw') }])
    : fix('remove_draw', {}, [{ op: 'replace', path: ptr('stages', stage, 'series', 'allow_draw'), value: false }]);
}

export function fixRemoveForfeit(stage: number): Fix {
  return fix('remove_forfeit', {}, [{ op: 'remove', path: ptr('stages', stage, 'scoring', 'forfeit') }]);
}

export function fixSetTwoPlayers(stage: number): Fix {
  return fix('set_two_players', {}, [{ op: 'replace', path: ptr('stages', stage, 'players_per_match'), value: 2 }]);
}

export function fixRemoveRankStep(stage: number, step: number): Fix {
  return fix('remove_rank_step', {}, [{ op: 'remove', path: ptr('stages', stage, 'rank', step) }]);
}

export function fixAddCoinFlip(stage: number): Fix {
  return fix('add_coin_flip', {}, [{ op: 'add', path: ptr('stages', stage, 'rank', '-'), value: { kind: 'coin_flip' } }]);
}

export function fixAddWildcard(edge: number, n: number): Fix {
  return fix('add_wildcard', { n }, [
    { op: 'add', path: ptr('edges', edge, 'select', '-'), value: { kind: 'wildcard', n } },
  ]);
}

export function fixRemoveOverride(stage: number, override: number, round: number): Fix {
  return fix('remove_override', { round }, [{ op: 'remove', path: ptr('stages', stage, 'series', 'overrides', override) }]);
}

/** Moves a decision match to the end of the chain (remove, then append). */
export function fixMoveDecisionMatchLast(stage: number, step: number): Fix {
  return fix('move_decision_match_last', {}, [
    { op: 'remove', path: ptr('stages', stage, 'rank', step) },
    { op: 'add', path: ptr('stages', stage, 'rank', '-'), value: { kind: 'decision_match' } },
  ]);
}

export function fixAddPointsStep(stage: number): Fix {
  return fix('add_points_step', {}, [
    { op: 'add', path: ptr('stages', stage, 'rank'), value: [{ kind: 'metric', metric: 'points', direction: 'desc' }] },
  ]);
}

export function fixClearRank(stage: number): Fix {
  return fix('clear_rank', {}, [{ op: 'replace', path: ptr('stages', stage, 'rank'), value: [] }]);
}

export function fixReduceGroups(stage: number, groups: number): Fix {
  return fix('reduce_groups', { groups }, [
    { op: 'replace', path: ptr('stages', stage, 'groups', 'count'), value: groups },
  ]);
}

export function fixSetSwissRoundsAuto(stage: number): Fix {
  return fix('set_swiss_rounds_auto', {}, [
    { op: 'replace', path: ptr('stages', stage, 'pairing', 'rounds'), value: 'auto' },
  ]);
}

export function fixUseSeasonRuleset(stage: number): Fix {
  return fix('use_season_ruleset', {}, [
    { op: 'replace', path: ptr('stages', stage, 'ruleset'), value: { kind: 'season_default' } },
  ]);
}

export function fixUseEdgesSource(stage: number, current: string): Fix {
  const seeding = current === 'rating' || current === 'random' || current === 'manual' ? current : 'edge_order';
  return fix('use_edges_source', {}, [
    { op: 'replace', path: ptr('stages', stage, 'participants'), value: { from: 'edges', seeding } },
  ]);
}
