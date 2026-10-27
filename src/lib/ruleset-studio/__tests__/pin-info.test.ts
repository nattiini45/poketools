import { describe, expect, it } from 'vitest';
import { rulesFromBans } from '@/lib/ruleset-kit/effective';
import { isEmptyChange, pinTargetCompleted, pinTargetStarted, summarizeChange } from '../pin-info';

const rules = (bans: string[], extra: Partial<Parameters<typeof rulesFromBans>[0]> = {}) =>
  rulesFromBans({ gen: 9, formatKey: 'gen9ou', clauses: ['Species Clause'], bans: { pokemon: bans }, ...extra });

describe('summarizeChange', () => {
  it('counts the entries a block list newly bans and no longer bans', () => {
    const change = summarizeChange(rules(['Garchomp', 'Koraidon']), rules(['Koraidon', 'Miraidon', 'Flutter Mane']));
    expect(change).toMatchObject({ banned: 2, unbanned: 1, allowed: 0, disallowed: 0, modeChanged: false });
  });

  it('counts an allowlist in the allowed and disallowed columns, never as bans', () => {
    const from = rules([], { allow: { pokemon: ['Pikachu', 'Raichu'] } });
    const to = rules([], { allow: { pokemon: ['Raichu', 'Pichu', 'Pikachu-Gmax'] } });
    expect(summarizeChange(from, to)).toMatchObject({ banned: 0, unbanned: 0, allowed: 2, disallowed: 1, modeChanged: false });
  });

  it('says that a list switched mode instead of counting two incomparable sets', () => {
    const change = summarizeChange(rules(['Garchomp']), rules([], { allow: { pokemon: ['Pikachu'] } }));
    expect(change.modeChanged).toBe(true);
    expect(change.banned + change.unbanned + change.allowed + change.disallowed).toBe(0);
  });

  it('counts clauses and notices a change nothing else shows (the notes)', () => {
    const from = rules([]);
    expect(summarizeChange(from, rules([], { clauses: ['Species Clause', 'Item Clause'] }))).toMatchObject({ clausesAdded: 1, clausesRemoved: 0 });
    expect(summarizeChange(rules([], { clauses: ['Species Clause', 'Item Clause'] }), from)).toMatchObject({ clausesAdded: 0, clausesRemoved: 1 });
    expect(summarizeChange(from, rules([], { customRules: 'No Dynamax' })).otherChanged).toBe(true);
  });

  it('a republish with the same rules is an empty change', () => {
    expect(isEmptyChange(summarizeChange(rules(['Garchomp']), rules(['Garchomp'])))).toBe(true);
    expect(isEmptyChange(summarizeChange(rules(['Garchomp']), rules([])))).toBe(false);
  });
});

describe('start and finish of a target', () => {
  it('only an upcoming target has not started; only a completed one is finished', () => {
    expect(pinTargetStarted('upcoming')).toBe(false);
    expect(pinTargetStarted('active')).toBe(true);
    expect(pinTargetStarted('completed')).toBe(true);
    expect(pinTargetCompleted('completed')).toBe(true);
    expect(pinTargetCompleted('active')).toBe(false);
  });
});
