import { describe, expect, it } from 'vitest';
import { evaluate } from '@/lib/format-kit/expr/eval';
import { entryContext, eventContext, matchContext, pairContext, playerContext, teamContext, type EnvBase } from '../expr-env';
import { SEED, stateFor, wichtelDef } from './helpers';

const def = wichtelDef();
const base: EnvBase = { def, state: stateFor(def), seed: SEED, scope: 'test' };
const draw = (ctx: ReturnType<typeof playerContext>) => {
  const result = evaluate({ k: 'rand', key: 'k' }, ctx, 'number');
  if (!result.ok) throw new Error(result.issue.code);
  return result.value;
};

describe('the rand() scope of an env names its subject', () => {
  it('draws differently for two players in the player, match and team env', () => {
    expect(draw(playerContext(base, 'p1'))).not.toBe(draw(playerContext(base, 'p2')));
    const facts = { round: 1, won: true, lost: false, forfeit: false, faints_dealt: 0, faints_taken: 0, opponent: 'p9' };
    expect(draw(matchContext(base, 'p1', facts))).not.toBe(draw(matchContext(base, 'p2', facts)));
    expect(draw(teamContext(base, 'p1', 1))).not.toBe(draw(teamContext(base, 'p2', 1)));
  });

  it('draws the same value for the same player every time', () => {
    expect(draw(playerContext(base, 'p1'))).toBe(draw(playerContext(base, 'p1')));
    expect(draw(playerContext(base, 'p1'))).toBe(draw(playerContext({ ...base }, 'p1')));
  });

  it('draws per entry in the entry env', () => {
    expect(draw(entryContext(base, { id: 'garchomp', attrs: [] }))).not.toBe(draw(entryContext(base, { id: 'rotom', attrs: [] })));
  });

  it('draws per pair, whatever the order of the two players', () => {
    const ab = draw(pairContext(base, { a: 'p1', b: 'p2', round: 1 }));
    expect(draw(pairContext(base, { a: 'p2', b: 'p1', round: 1 }))).toBe(ab);
    expect(draw(pairContext(base, { a: 'p1', b: 'p3', round: 1 }))).not.toBe(ab);
  });

  it('keeps one draw per event in an env without a subject', () => {
    expect(draw(eventContext(base, 1))).toBe(draw(eventContext(base, 2)));
  });
});
