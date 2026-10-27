import { describe, expect, it } from 'vitest';
import { applyPlanPatch, applyPlanSet, applyPlanSetJson, clearPlanRef, isPatchablePath, setPlanRef, PLAN_PATCH_LIMITS } from '../edit';
import { deepFreeze } from '@/lib/studio-core/json';
import type { PlanDocument } from '../schema';
import { SEASON_ID, parseOrThrow, uid, workedExample } from './fixtures';

const patch = (plan: PlanDocument, ops: unknown) => applyPlanPatch(plan, JSON.stringify(ops));
const built = (plan: PlanDocument, ...keys: string[]): PlanDocument => {
  let current = plan;
  for (const key of keys) {
    const result = setPlanRef(current, key, { entity_type: 'season', entity_id: SEASON_ID });
    if (!result.ok) throw new Error('ref');
    current = result.plan;
  }
  return current;
};

describe('applyPlanSet', () => {
  it('replaces a slot wholesale, fills defaults and reports the changed slot', () => {
    const plan = workedExample();
    const result = applyPlanSet(plan, {
      slot: 'groups',
      value: { mode: 'serpentine', count: 2 },
    });
    expect(result.ok && result.plan.slots.groups).toEqual({ mode: 'serpentine', count: 2 });
    expect(result.ok && result.changedSlots).toEqual(['groups']);

    const phases = applyPlanSet(plan, {
      slot: 'phases',
      value: [{ key: 'only', name: 'Only', bracket_type: 'swiss', best_of: 1, is_doubles: false, advancement_rule: { type: 'top_n', count: 2 }, ruleset: 'plan' }],
    });
    expect(phases.ok && phases.plan.slots.phases?.[0].advancement_rule?.per_group).toBe(false);
    expect(phases.ok && phases.changedSlots).toEqual(['phases']);
  });

  it('does not mutate its input', () => {
    const plan = deepFreeze(workedExample());
    expect(applyPlanSet(plan, { slot: 'groups', value: { mode: 'none' } }).ok).toBe(true);
    expect(plan.slots.groups).toBeUndefined();
  });

  it('reports no change when the value is the same', () => {
    const plan = workedExample();
    const result = applyPlanSet(plan, { slot: 'league', value: plan.slots.league });
    expect(result.ok && result.changedSlots).toEqual([]);
  });

  it('refuses an unknown slot and an invalid value with machine-coded issues', () => {
    const plan = workedExample();
    expect(applyPlanSet(plan, { slot: 'refs', value: {} })).toEqual({ ok: false, error: { kind: 'plan_slot_unknown', slot: 'refs' } });
    const bad = applyPlanSet(plan, { slot: 'phases', value: [{ key: 'a', name: 'A', bracket_type: 'swiss', best_of: 2, is_doubles: false, ruleset: 'plan', legs: 2 }] });
    expect(bad.ok).toBe(false);
    if (bad.ok || bad.error.kind !== 'plan_invalid') throw new Error('expected plan_invalid');
    expect(bad.error.issues).toContainEqual({ path: '/slots/phases/0/legs', code: 'unrecognized_keys' });
    expect(bad.error.issues.some((i) => i.path === '/slots/phases/0/best_of')).toBe(true);
  });

  it('freezes built slots: the live row wins', () => {
    const plan = built(workedExample(), 'league', 'phase.regular_season');
    const league = { ...plan.slots.league!, name: 'Renamed' };
    expect(applyPlanSet(plan, { slot: 'league', value: league })).toEqual({ ok: false, error: { kind: 'slot_already_built', refKey: 'league' } });

    // A built phase cannot change or disappear, but a new phase can be added after it.
    const phases = plan.slots.phases!;
    const renamed = [{ ...phases[0], name: 'Renamed' }, phases[1]];
    expect(applyPlanSet(plan, { slot: 'phases', value: renamed })).toEqual({ ok: false, error: { kind: 'slot_already_built', refKey: 'phase.regular_season' } });
    expect(applyPlanSet(plan, { slot: 'phases', value: [phases[1]] }).ok).toBe(false);
    const extended = applyPlanSet(plan, {
      slot: 'phases',
      value: [...phases, { key: 'finals', name: 'Finals', bracket_type: 'single_elim', best_of: 5, is_doubles: false, ruleset: 'plan' }],
    });
    expect(extended.ok).toBe(true);
  });

  it('freezes a built roster and a built draft pool by their own key', () => {
    const withDraft = parseOrThrow({
      ...workedExample(),
      slots: { ...workedExample().slots, draft: [{ engine: 'legacy', draft_type: 'snake' }] },
    });
    const plan = built(withDraft, 'roster', 'draft.all');
    expect(applyPlanSet(plan, { slot: 'roster', value: { entries: [] } })).toEqual({ ok: false, error: { kind: 'slot_already_built', refKey: 'roster' } });
    expect(applyPlanSet(plan, { slot: 'draft', value: [{ engine: 'legacy', draft_type: 'budget', budget: 100 }] })).toEqual({
      ok: false,
      error: { kind: 'slot_already_built', refKey: 'draft.all' },
    });
    expect(applyPlanSet(plan, { slot: 'groups', value: { mode: 'none' } }).ok).toBe(true);
  });
});

describe('applyPlanSetJson', () => {
  it('parses the slot value from a JSON string and then behaves like plan_set', () => {
    const plan = workedExample();
    const ok = applyPlanSetJson(plan, { slot: 'groups', valueJson: '{"mode":"serpentine","count":3}' });
    expect(ok.ok && ok.plan.slots.groups).toEqual({ mode: 'serpentine', count: 3 });
    expect(applyPlanSetJson(plan, { slot: 'groups', valueJson: '{oops' })).toEqual({ ok: false, error: { kind: 'plan_patch_json_invalid' } });
    expect(applyPlanSetJson(plan, { slot: 'groups', valueJson: ' '.repeat(PLAN_PATCH_LIMITS.chars + 1) })).toEqual({ ok: false, error: { kind: 'plan_patch_too_large' } });
    expect(applyPlanSetJson(plan, { slot: 'groups', valueJson: '{"mode":"serpentine"}' })).toMatchObject({ ok: false, error: { kind: 'plan_invalid' } });
  });
});

describe('applyPlanPatch', () => {
  it('applies add, replace and remove through the studio patch applier', () => {
    const plan = workedExample();
    const result = patch(plan, [
      { op: 'replace', path: '/slots/league/name', value: 'Renamed League' },
      { op: 'add', path: '/slots/phases/-', value: { key: 'finals', name: 'Finals', bracket_type: 'single_elim', best_of: 5, is_doubles: false, ruleset: 'plan' } },
      { op: 'add', path: '/assumptions/-', value: { key: 'phases.finals', value: true, source: 'default', confirmed: false } },
    ]);
    expect(result.ok && result.plan.slots.league?.name).toBe('Renamed League');
    expect(result.ok && result.plan.slots.phases?.map((p) => p.key)).toEqual(['regular_season', 'playoffs', 'finals']);
    expect(result.ok && result.plan.assumptions.at(-1)?.key).toBe('phases.finals');
    expect(result.ok && result.changedSlots).toEqual(['league', 'phases']);
  });

  it('removes a whole slot and a field', () => {
    const plan = workedExample();
    const result = patch(plan, [{ op: 'remove', path: '/slots/league/start_date' }, { op: 'remove', path: '/slots/roster' }]);
    expect(result.ok && result.plan.slots.league?.start_date).toBeUndefined();
    expect(result.ok && result.plan.slots.roster).toBeUndefined();
  });

  it('can change the top-level labels', () => {
    const result = patch(workedExample(), [
      { op: 'replace', path: '/title', value: 'New title' },
      { op: 'replace', path: '/intent', value: 'mixed' },
      { op: 'replace', path: '/contentLocale', value: 'en' },
    ]);
    expect(result.ok && [result.plan.title, result.plan.intent, result.plan.contentLocale]).toEqual(['New title', 'mixed', 'en']);
  });

  it('refuses paths outside the allowed set before applying anything', () => {
    const plan = workedExample();
    for (const path of ['', '/v', '/refs', '/refs/league', '/slots', '/slots/unknown', '/slots/unknown/x', '/title/x', '/__proto__/x', 'slots/league']) {
      expect(patch(plan, [{ op: 'replace', path, value: 1 }]), path).toMatchObject({ ok: false, error: { kind: 'plan_patch_path_forbidden', index: 0 } });
    }
    // The second op is the bad one: nothing is applied.
    expect(patch(plan, [{ op: 'replace', path: '/title', value: 'x' }, { op: 'add', path: '/refs/league', value: {} }])).toMatchObject({
      ok: false,
      error: { kind: 'plan_patch_path_forbidden', index: 1 },
    });
    expect(isPatchablePath('/slots/phases/0/best_of')).toBe(true);
    expect(isPatchablePath('/assumptions')).toBe(true);
  });

  it('names the failure reason and op index of the patch applier', () => {
    const plan = workedExample();
    expect(patch(plan, [{ op: 'replace', path: '/slots/phases/9/name', value: 'x' }])).toEqual({
      ok: false,
      error: { kind: 'plan_patch_failed', index: 0, reason: 'path_not_found' },
    });
    expect(patch(plan, [{ op: 'add', path: '/slots/phases/9', value: {} }])).toMatchObject({ error: { kind: 'plan_patch_failed', reason: 'index_out_of_range' } });
    expect(patch(plan, [{ op: 'remove', path: '/slots/tournament/name' }])).toMatchObject({ error: { kind: 'plan_patch_failed', reason: 'path_not_found' } });
    expect(patch(plan, [{ op: 'replace', path: '/slots/league/__proto__', value: {} }])).toMatchObject({
      error: { kind: 'plan_patch_failed', reason: 'forbidden_segment' },
    });
  });

  it('validates the whole document after the patch', () => {
    const plan = workedExample();
    const result = patch(plan, [{ op: 'replace', path: '/slots/phases/0/best_of', value: 2 }]);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== 'plan_invalid') throw new Error('expected plan_invalid');
    expect(result.error.issues.some((i) => i.path === '/slots/phases/0/best_of')).toBe(true);
    // Removing a required field is a document error, not a patch error.
    expect(patch(plan, [{ op: 'remove', path: '/slots/league/name' }])).toMatchObject({ error: { kind: 'plan_invalid' } });
  });

  it('refuses malformed, oversized and mis-shaped ops_json', () => {
    const plan = workedExample();
    expect(applyPlanPatch(plan, '{not json')).toEqual({ ok: false, error: { kind: 'plan_patch_json_invalid' } });
    expect(applyPlanPatch(plan, JSON.stringify([{ op: 'replace', path: '/title', value: 'x'.repeat(PLAN_PATCH_LIMITS.chars) }]))).toEqual({
      ok: false,
      error: { kind: 'plan_patch_too_large' },
    });
    for (const ops of [[], {}, [{ op: 'move', from: '/a', path: '/b' }], [{ op: 'replace', path: '/title' }], [{ op: 'remove', path: '/title', value: 1 }], [{ op: 'add', path: '/title', value: 1, extra: true }]]) {
      expect(patch(plan, ops), JSON.stringify(ops)).toMatchObject({ ok: false, error: { kind: 'plan_patch_ops_invalid' } });
    }
    expect(patch(plan, Array.from({ length: PLAN_PATCH_LIMITS.ops + 1 }, () => ({ op: 'replace', path: '/title', value: 'x' })))).toMatchObject({
      error: { kind: 'plan_patch_ops_invalid' },
    });
  });

  it('applies the same freeze on built slots', () => {
    const plan = built(workedExample(), 'league');
    expect(patch(plan, [{ op: 'replace', path: '/slots/league/language', value: 'en' }])).toEqual({
      ok: false,
      error: { kind: 'slot_already_built', refKey: 'league' },
    });
    expect(patch(plan, [{ op: 'replace', path: '/slots/phases/0/best_of', value: 3 }]).ok).toBe(true);
  });

  it('does not mutate its input', () => {
    const plan = deepFreeze(workedExample());
    expect(patch(plan, [{ op: 'replace', path: '/slots/league/name', value: 'Other' }]).ok).toBe(true);
    expect(plan.slots.league?.name).toBe('Gen 9 OU League');
  });
});

describe('plan refs', () => {
  it('records and clears the entity a slot became', () => {
    const plan = workedExample();
    const result = setPlanRef(plan, 'phase.playoffs', { entity_type: 'tournament', entity_id: uid(77) });
    expect(result.ok && result.plan.refs['phase.playoffs']).toEqual({ entity_type: 'tournament', entity_id: uid(77) });
    expect(result.ok && result.changedSlots).toEqual([]);
    if (!result.ok) throw new Error('ref');
    expect(clearPlanRef(result.plan, 'phase.playoffs').refs).toEqual({});
  });

  it('refuses a bad ref key and a bad entity', () => {
    const plan = workedExample();
    expect(setPlanRef(plan, 'ruleset', { entity_type: 'season', entity_id: SEASON_ID })).toEqual({ ok: false, error: { kind: 'plan_ref_invalid' } });
    expect(setPlanRef(plan, 'league', { entity_type: 'season', entity_id: 'nope' })).toEqual({ ok: false, error: { kind: 'plan_ref_invalid' } });
  });
});
