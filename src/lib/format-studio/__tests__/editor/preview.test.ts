import { describe, expect, it } from 'vitest';
import { CURRENT_ENV, PRESETS, compile, type Diagnostic } from '@/lib/format-kit/client';
import { NEGATIVE_FIXTURES } from '@/lib/format-kit/__tests__/fixtures/negative';
import { normalizeDraft, type DraftDocument } from '../../editor/document';
import { applyFix, removeAtPointer, setRuleset, updateStage } from '../../editor/ops';
import {
  METRIC_KEYS,
  compileDraft,
  editorEnv,
  issueCounts,
  issuesByPointer,
  issuesUnder,
  publishGate,
  scheduleFor,
  toIssueRows,
} from '../../editor/preview';

function preset(id: string): DraftDocument {
  const found = PRESETS.find((entry) => entry.id === id);
  const result = normalizeDraft(structuredClone(found?.definition));
  if (!result.ok) throw new Error('preset does not normalise');
  return result.doc;
}

const key = (d: Diagnostic) => `${d.code}@${d.json_pointer}`;
const errorKeys = (diagnostics: readonly Diagnostic[]) => diagnostics.filter((d) => d.severity === 'error').map(key);

describe('editorEnv and compileDraft', () => {
  it('is today\'s environment plus the ruleset ids', () => {
    expect(editorEnv()).toEqual(CURRENT_ENV);
    const ids = new Set(['a']);
    expect(editorEnv(ids)).toEqual({ ...CURRENT_ENV, rulesetIds: ids });
  });

  it('compiles a valid preset without an error', () => {
    for (const { id } of PRESETS) {
      expect(compileDraft(preset(id)).ok, id).toBe(true);
    }
  });

  it('never throws for junk', () => {
    for (const junk of [null, 1, 'x', [], {}, { a: undefined }]) {
      expect(() => compileDraft(junk)).not.toThrow();
      expect(compileDraft(junk).ok).toBe(false);
    }
  });

  it('flags a ruleset id that does not exist, before attach does', () => {
    const id = '3f2b8c1e-5a47-4d09-9b6e-7c1d2a4e8f10';
    const named = updateStage(preset('classic-league'), 0, (s) => setRuleset(s, { kind: 'ruleset', id }));
    expect(compileDraft(named).ok).toBe(true);
    const missing = compileDraft(named, new Set());
    expect(missing.diagnostics.some((d) => d.code === 'ruleset_not_found' && d.json_pointer.startsWith('/stages/0'))).toBe(true);
    expect(missing.ok).toBe(false);
    expect(compileDraft(named, new Set([id])).ok).toBe(true);
  });
});

describe('issue rows', () => {
  const doc = (): DraftDocument => {
    const base = preset('classic-league') as unknown as Record<string, unknown>;
    return { ...base, note: 1, attributes: [] } as unknown as DraftDocument;
  };

  it('keeps the compiler order and gives every row a unique id', () => {
    const diagnostics = compileDraft(doc()).diagnostics;
    const rows = toIssueRows(diagnostics);
    expect(rows.map((r) => `${r.code}@${r.pointer}`)).toEqual(diagnostics.map(key));
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows[0].severity).toBe('error');
  });

  it('marks unknown and reserved members as removable, and only those', () => {
    const rows = toIssueRows(compileDraft(doc()).diagnostics);
    const removable = rows.filter((r) => r.canRemove);
    expect(removable.map((r) => r.code).sort()).toEqual(['schema_not_available_yet', 'schema_unknown_key']);
    expect(removable.map((r) => r.pointer).sort()).toEqual(['/attributes', '/note']);
    expect(rows.filter((r) => !r.canRemove).every((r) => r.code !== 'schema_unknown_key')).toBe(true);
  });

  it('maps a row to the part of the form it belongs to', () => {
    const broken = updateStage(preset('classic-league'), 0, (s) => ({ ...s, series: { ...s.series, best_of: 2 } }));
    const row = toIssueRows(compileDraft(broken).diagnostics).find((r) => r.code === 'series_even_best_of');
    expect(row?.selection).toEqual({ section: 'stage', index: 0 });
    expect(row?.fixes.length).toBeGreaterThan(0);
  });

  it('numbers rows that share a code and a pointer', () => {
    const d = (code: Diagnostic['code']): Diagnostic => ({ severity: 'warning', code, params: {}, json_pointer: '/x', fixes: [] });
    const rows = toIssueRows([d('groups_uneven'), d('groups_uneven'), d('ltext_untranslated')]);
    expect(rows.map((r) => r.id)).toEqual(['groups_uneven:/x:0', 'groups_uneven:/x:1', 'ltext_untranslated:/x:0']);
  });

  it('returns nothing for no diagnostics', () => {
    expect(toIssueRows([])).toEqual([]);
  });
});

describe('grouping and counting', () => {
  const d = (severity: Diagnostic['severity'], pointer: string): Diagnostic => ({ severity, code: 'schema_type', params: {}, json_pointer: pointer, fixes: [] });
  const list = [d('error', '/stages/0'), d('warning', '/stages/0/pairing'), d('info', '/stages/01'), d('error', '/edges/0'), d('warning', '')];

  it('issuesByPointer groups by the exact pointer', () => {
    const map = issuesByPointer([...list, d('info', '/stages/0')]);
    expect(map.get('/stages/0')).toHaveLength(2);
    expect(map.get('/stages/0/pairing')).toHaveLength(1);
    expect(map.get('/stages')).toBeUndefined();
    expect(map.get('')).toHaveLength(1);
  });

  it('issuesUnder takes the pointer and what is below it, not a pointer that only starts the same', () => {
    expect(issuesUnder(list, '/stages/0').map((x) => x.json_pointer)).toEqual(['/stages/0', '/stages/0/pairing']);
    expect(issuesUnder(list, '/stages').map((x) => x.json_pointer)).toEqual(['/stages/0', '/stages/0/pairing', '/stages/01']);
    expect(issuesUnder(list, '/nothing')).toEqual([]);
  });

  it('issueCounts counts by severity', () => {
    expect(issueCounts(list)).toEqual({ errors: 2, warnings: 2, notes: 1 });
    expect(issueCounts([])).toEqual({ errors: 0, warnings: 0, notes: 0 });
  });
});

describe('publishGate', () => {
  it('allows a clean draft that is new', () => {
    const result = compileDraft(preset('cup'));
    expect(publishGate(result, null)).toEqual({ allowed: true, reason: null });
    expect(publishGate(result, 'a'.repeat(64))).toEqual({ allowed: true, reason: null });
  });

  it('refuses a draft with an error', () => {
    const broken = compileDraft(updateStage(preset('cup'), 0, (s) => ({ ...s, series: { ...s.series, best_of: 2 } })));
    expect(publishGate(broken, null)).toEqual({ allowed: false, reason: 'errors' });
  });

  it('refuses a draft that has no definition at all', () => {
    expect(publishGate(compileDraft({}), null)).toEqual({ allowed: false, reason: 'errors' });
  });

  it('refuses a draft equal to the published version', () => {
    const result = compileDraft(preset('cup'));
    expect(result.hash).not.toBeNull();
    expect(publishGate(result, result.hash)).toEqual({ allowed: false, reason: 'nothing_new' });
  });

  it('reports errors before nothing_new', () => {
    const broken = compileDraft(updateStage(preset('cup'), 0, (s) => ({ ...s, series: { ...s.series, best_of: 2 } })));
    expect(publishGate(broken, broken.hash).reason).toBe('errors');
  });
});

describe('scheduleFor', () => {
  it('compiles with the roster size and estimates', () => {
    const at8 = scheduleFor(preset('classic-league'), 8, 7);
    expect(at8?.players).toBe(8);
    expect(at8?.totals.matches).toEqual({ min: 59, max: 59 });
    const at12 = scheduleFor(preset('classic-league'), 12, 7);
    expect(at12?.stages[0].matches).toEqual({ min: 132, max: 132 });
  });

  it('the roster size beats a stage\'s expected count', () => {
    const doc = updateStage(preset('classic-league'), 0, (s) => ({ ...s, participants: { from: 'roster', seeding: 'signup', expected_count: 4 } }));
    expect(scheduleFor(doc, 8, 7)?.stages[0].participants).toEqual({ min: 8, max: 8 });
  });

  it('follows the cadence and clamps the players', () => {
    expect(scheduleFor(preset('classic-league'), 8, 14)?.totals.weeks).toEqual({ min: 32, max: 32 });
    expect(scheduleFor(preset('classic-league'), 1, 7)?.players).toBe(2);
    expect(scheduleFor(preset('classic-league'), Number.NaN, 7)?.players).toBe(2);
  });

  it('is null for a document that does not compile far enough', () => {
    expect(scheduleFor({}, 8, 7)).toBeNull();
    expect(scheduleFor(null, 8, 7)).toBeNull();
  });
});

describe('applyFix twin of the kit fixes test', () => {
  // Every negative fixture whose diagnostic carries a fix, on the document the editor would hold.
  const cases = NEGATIVE_FIXTURES.flatMap((fixture) => {
    if (fixture.engineOnly) return [];
    const env = fixture.env ?? CURRENT_ENV;
    const normalised = normalizeDraft(fixture.input);
    if (!normalised.ok) return [];
    const hit = compile(normalised.doc, env).diagnostics.find(
      (d) => d.code === fixture.code && d.json_pointer === fixture.pointer && d.fixes.length > 0,
    );
    return hit ? hit.fixes.map((fix) => ({ name: `${fixture.id} / ${fix.id}`, doc: normalised.doc, env, hit, fix })) : [];
  });

  it('finds fixtures to run', () => {
    expect(cases.length).toBeGreaterThan(15);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s removes its diagnostic and adds no error', (_name, c) => {
    const applied = applyFix(c.doc, c.fix);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const before = compile(c.doc, c.env);
    const after = compile(applied.doc, c.env);
    expect(after.diagnostics.map(key)).not.toContain(key(c.hit));
    expect(errorKeys(after.diagnostics).filter((k) => !errorKeys(before.diagnostics).includes(k))).toEqual([]);
    expect(after.definition).not.toBeNull();
  });
});

describe('removeAtPointer clears what the schema does not know', () => {
  it('removes an unknown top-level member, a nested one and a reserved section', () => {
    const base = preset('swiss-top-cut') as unknown as Record<string, unknown>;
    const stages = (base.stages as Array<Record<string, unknown>>).map((s, i) => (i === 0 ? { ...s, mystery: true } : s));
    const doc = { ...base, stages, extra: 'x', attributes: [{ key: 'a' }] } as unknown as DraftDocument;

    const before = compileDraft(doc).diagnostics.filter((d) => d.code === 'schema_unknown_key' || d.code === 'schema_not_available_yet');
    expect(before.map((d) => d.json_pointer).sort()).toEqual(['/attributes', '/extra', '/stages/0/mystery']);

    let current = doc;
    for (const d of before) {
      const result = removeAtPointer(current, d.json_pointer);
      expect(result.ok, d.json_pointer).toBe(true);
      if (result.ok) current = result.doc;
    }
    expect(compileDraft(current).diagnostics.filter((d) => d.code === 'schema_unknown_key' || d.code === 'schema_not_available_yet')).toEqual([]);
    expect(compileDraft(current).ok).toBe(true);
  });
});

describe('METRIC_KEYS', () => {
  it('lists the eight builtin metrics', () => {
    expect([...METRIC_KEYS].sort()).toEqual(['buchholz', 'games_played', 'kill_differential', 'losses', 'points', 'rating', 'seed', 'wins']);
  });
});
