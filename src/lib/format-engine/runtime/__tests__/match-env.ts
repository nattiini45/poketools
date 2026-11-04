import type { FormatDefinition } from '@/lib/format-kit/types';
import { matchContext, type EnvBase, type MatchFacts } from '../expr-env';
import type { KitRuntimeState } from '../types';

export function envBase(def: FormatDefinition, state: KitRuntimeState, seed: string): EnvBase {
  return { def, state, seed, scope: 'test' };
}

export function matchSide(base: EnvBase, playerId: string, facts: Partial<MatchFacts> & Pick<MatchFacts, 'round' | 'won'>) {
  return {
    playerId,
    ctx: matchContext(base, playerId, { lost: !facts.won, forfeit: false, faints_dealt: 0, faints_taken: 0, opponent: 'other', ...facts }),
  };
}
