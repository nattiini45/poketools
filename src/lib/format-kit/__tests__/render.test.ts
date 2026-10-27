import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from '../compile';
import { diag, DIAGNOSTIC_CODES, FIX_IDS, type Diagnostic, type DiagnosticCode, type Fix } from '../engine/diagnostics';
import { renderDiagnostic, renderFix, renderSeverity } from '../engine/render';
import { ltext } from '@/lib/studio-core/ltext';
import { describePrimitive } from '../registry/describe';
import { cup } from '../presets/cup';
import type { FormatDefinition } from '../types';
import { fixtureDiagnostics, NEGATIVE_FIXTURES, rosterEnv } from './fixtures/negative';

const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/;
// Double-encoding markers written as escapes so the repository's mojibake guard does not match this file.
const MOJIBAKE = /\u00c3|\u00c2|\u00e2\u20ac|\uFFFD/;

/** One real diagnostic per code, taken from the fixtures. */
const SAMPLES = new Map<DiagnosticCode, Diagnostic>();
for (const fixture of NEGATIVE_FIXTURES) {
  const hit = fixtureDiagnostics(fixture).find((d) => d.code === fixture.code && d.json_pointer === fixture.pointer);
  if (hit && !SAMPLES.has(fixture.code)) SAMPLES.set(fixture.code, hit);
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderDiagnostic', () => {
  it('has a sample for every code', () => {
    expect(DIAGNOSTIC_CODES.filter((code) => !SAMPLES.has(code))).toEqual([]);
  });

  it.each(DIAGNOSTIC_CODES.map((code) => [code] as const))('renders %s in English and German without leftovers', (code) => {
    const d = SAMPLES.get(code) as Diagnostic;
    const en = renderDiagnostic(d, 'en');
    const de = renderDiagnostic(d, 'de');
    for (const text of [en, de]) {
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(PLACEHOLDER);
      expect(text).not.toMatch(MOJIBAKE);
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('diagnostics.');
    }
    expect(de).not.toBe(en);
  });

  it('resolves stage keys to names in the viewer language when it has the definition', () => {
    const d = diag('stage_unreachable', '/stages/1', { stage: 'knockout' });
    expect(renderDiagnostic(d, 'en', cup)).toBe('Stage Knockout can never receive participants.');
    expect(renderDiagnostic(d, 'de', cup)).toBe('Stage K.-o.-Runde kann nie Teilnehmer erhalten.');
    expect(renderDiagnostic(d, 'en')).toBe('Stage knockout can never receive participants.');
    expect(renderDiagnostic(d, 'de')).toBe('Stage knockout kann nie Teilnehmer erhalten.');
  });

  it('falls back through the text fallback order when a stage name lacks the viewer language', () => {
    const def: FormatDefinition = JSON.parse(JSON.stringify(cup));
    def.stages[1].name = { base: 'en', en: { v: 'Finals', s: 'human' } };
    const d = diag('stage_unreachable', '/stages/1', { stage: 'knockout' });
    expect(renderDiagnostic(d, 'de', def)).toContain('Finals');
    def.stages[1].name = ltext('de', undefined, 'Endrunde');
    expect(renderDiagnostic(d, 'en', def)).toContain('Endrunde');
  });

  it('keeps a key it cannot resolve', () => {
    const missing = diag('stage_unreachable', '/stages/9', { stage: 'ghost' });
    expect(renderDiagnostic(missing, 'en', cup)).toContain('ghost');
    const edge = diag('advance_exceeds_source', '/edges/9/select/0', { edge: 'nowhere', requested: 9, available: 4 });
    expect(renderDiagnostic(edge, 'en', cup)).toBe('Advancement rule nowhere asks for 9 participants, but its source has only 4.');
  });

  it('names an advancement rule by the stages it connects, and by its key without a definition', () => {
    const edge = diag('advance_exceeds_source', '/edges/0/select/0', { edge: 'to_knockout', requested: 9, available: 4 });
    expect(renderDiagnostic(edge, 'en', cup)).toBe('Advancement rule Group stage → Knockout asks for 9 participants, but its source has only 4.');
    expect(renderDiagnostic(edge, 'de', cup)).toBe('Weiterkommens-Regel Gruppenphase → K.-o.-Runde verlangt 9 Teilnehmer, aber ihre Quelle hat nur 4.');
    expect(renderDiagnostic(edge, 'en')).toContain('Advancement rule to_knockout');
    const condition = diag('expr_shape', '/edges/0/select/0/when', { edge: 'to_knockout' });
    expect(renderDiagnostic(condition, 'en', cup)).toBe('The condition of advancement rule Group stage → Knockout is not a well-formed expression.');
    expect(renderDiagnostic(condition, 'de', cup)).toBe('Die Bedingung der Weiterkommens-Regel Gruppenphase → K.-o.-Runde ist kein wohlgeformter Ausdruck.');
  });

  it('never says edge or Kante in a sentence', () => {
    for (const code of DIAGNOSTIC_CODES) {
      const d = SAMPLES.get(code) as Diagnostic;
      // The JSON pointer of a schema message is a path, not a sentence.
      expect(renderDiagnostic(d, 'en').replace(d.json_pointer, '')).not.toMatch(/\bedges?\b/i);
      expect(renderDiagnostic(d, 'de')).not.toMatch(/Kante/);
    }
    for (const id of FIX_IDS) {
      const fix = { id, params: { n: 2, groups: 3, round: 1, best_of: 3 }, patch: [] } as Fix;
      expect(renderFix(fix, 'en')).not.toMatch(/\bedges?\b/i);
      expect(renderFix(fix, 'de')).not.toMatch(/Kante/);
    }
  });

  it.each([
    ['stage_too_few_participants', { stage: 's', count: 1, source: 'roster' }, 'would have only 1 participant;', 'hätte nur 1 Teilnehmer;'],
    ['stage_too_few_participants', { stage: 's', count: 0, source: 'roster' }, 'would have only 0 participants;', 'hätte nur 0 Teilnehmer;'],
    ['groups_too_many', { stage: 's', groups: 2, participants: 1 }, 'splits 1 participant into 2 groups', 'teilt 1 Teilnehmer in 2 Gruppen'],
    ['groups_too_many', { stage: 's', groups: 2, participants: 3 }, 'splits 3 participants into 2 groups', 'teilt 3 Teilnehmer in 2 Gruppen'],
    ['advance_exceeds_source', { edge: 'e', requested: 1, available: 0 }, 'asks for 1 participant,', 'verlangt 1 Teilnehmer,'],
    ['advance_exceeds_source', { edge: 'e', requested: 2, available: 1 }, 'asks for 2 participants,', 'verlangt 2 Teilnehmer,'],
    ['advance_bracket_byes', { stage: 's', incoming: 7, bracket_size: 8, byes: 1 }, '1 player gets a bye', '1 Spieler erhält ein Freilos'],
    ['advance_bracket_byes', { stage: 's', incoming: 6, bracket_size: 8, byes: 2 }, '2 players get a bye', '2 Spieler erhalten ein Freilos'],
    ['advance_overlap', { stage: 's', requested: 1, available: 0 }, 'ask for 1 participant in total', 'verlangen zusammen 1 Teilnehmer'],
    ['series_override_unreachable', { stage: 's', round: 3, rounds: 1 }, 'plays only 1 round.', 'spielt aber nur 1 Runde.'],
    ['series_override_unreachable', { stage: 's', round: 5, rounds: 2 }, 'plays only 2 rounds.', 'spielt aber nur 2 Runden.'],
  ] as const)('renders the count of %s in the right number', (code, params, en, de) => {
    const d = diag(code, '/x', params);
    expect(renderDiagnostic(d, 'en')).toContain(en);
    expect(renderDiagnostic(d, 'de')).toContain(de);
  });

  it('chooses the singular and plural label of the wildcard fix', () => {
    const wildcard = (n: number) => ({ id: 'add_wildcard', params: { n }, patch: [] }) as Fix;
    expect(renderFix(wildcard(1), 'en')).toBe('Add 1 wildcard spot to fill the bracket');
    expect(renderFix(wildcard(3), 'en')).toBe('Add 3 wildcard spots to fill the bracket');
    expect(renderFix(wildcard(1), 'de')).toBe('1 Wildcard-Platz hinzufügen, um das Turnier aufzufüllen');
    expect(renderFix(wildcard(3), 'de')).toBe('3 Wildcard-Plätze hinzufügen, um das Turnier aufzufüllen');
  });

  it('labels a metric the same way in a diagnostic as in a description', () => {
    const d = diag('metric_unproduced', '/x', { stage: 's', metric: 'buchholz', reason: 'needs_opponents', where: 'rank' });
    expect(renderDiagnostic(d, 'en')).toContain('Buchholz score');
    expect(renderDiagnostic(d, 'de')).toContain('Buchholz-Wertung');
    for (const metric of ['games_played', 'seed', 'rating']) {
      const m = diag('metric_unproduced', '/x', { stage: 's', metric, reason: 'unknown_metric', where: 'rank' });
      for (const locale of ['en', 'de'] as const) {
        const label = describePrimitive('rank.metric', { kind: 'metric', metric, direction: 'desc' }, locale);
        const word = renderDiagnostic(m, locale).match(/^(?:The metric|Die Kennzahl) (.+?) (?:cannot|lässt)/)?.[1];
        expect(word, locale + ' ' + metric).toBeDefined();
        expect(label, locale + ' ' + metric).toContain(word as string);
      }
    }
  });

  it('shows metric and reason as labels from the catalog, and unknown metrics as typed', () => {
    const known = diag('metric_unproduced', '/x', { stage: 's', metric: 'kill_differential', reason: 'needs_kill_stats', where: 'rank' });
    expect(renderDiagnostic(known, 'en')).toBe('The metric kill differential cannot be used here: this league does not record kill statistics.');
    expect(renderDiagnostic(known, 'de')).toContain('Kill-Differenz');
    const unknown = diag('metric_unproduced', '/x', { stage: 's', metric: 'mystery', reason: 'unknown_metric', where: 'rank' });
    expect(renderDiagnostic(unknown, 'en')).toContain('mystery');
  });

  it('formats numbers and booleans through the translator', () => {
    const d = diag('groups_too_many', '/x', { stage: 'g', groups: 4, participants: 12345 });
    expect(renderDiagnostic(d, 'en')).toContain('12,345');
    expect(renderDiagnostic(d, 'de')).toContain('12.345');
    const flag = diag('key_duplicate', '/x', { scope: 'rules', key: 'a', extra: true });
    expect(renderDiagnostic(flag, 'en')).toBe('The key a is used more than once in rules.');
  });

  it('puts the pointer into schema messages', () => {
    const d = diag('schema_required', '/stages/0/key', {});
    expect(renderDiagnostic(d, 'en')).toBe('A required value is missing at /stages/0/key.');
    expect(renderDiagnostic(diag('schema_required', '', {}), 'en')).toBe('A required value is missing at /.');
  });

  it('returns the key for a code the catalog does not know instead of throwing', () => {
    const unknown = { severity: 'error', code: 'brand_new_code', params: {}, json_pointer: '', fixes: [] } as unknown as Diagnostic;
    expect(renderDiagnostic(unknown, 'en')).toBe('diagnostics.brand_new_code');
    expect(renderDiagnostic(unknown, 'de')).toBe('diagnostics.brand_new_code');
  });

  it('renders what compile produced for a real document', () => {
    const result = compile(cup, rosterEnv(6));
    for (const d of result.diagnostics) {
      for (const locale of ['en', 'de'] as const) expect(renderDiagnostic(d, locale, result.definition ?? undefined)).not.toMatch(PLACEHOLDER);
    }
    expect(result.diagnostics.some((d) => d.code === 'groups_too_many')).toBe(true);
  });
});

describe('renderFix and renderSeverity', () => {
  const fixes = new Map<string, Fix>();
  for (const d of SAMPLES.values()) for (const fix of d.fixes) if (!fixes.has(fix.id)) fixes.set(fix.id, fix);
  for (const fixture of NEGATIVE_FIXTURES) {
    for (const d of fixtureDiagnostics(fixture)) for (const fix of d.fixes) if (!fixes.has(fix.id)) fixes.set(fix.id, fix);
  }

  it.each(FIX_IDS.map((id) => [id] as const))('renders the %s fix in both languages', (id) => {
    const fix = fixes.get(id) as Fix;
    expect(fix).toBeDefined();
    const en = renderFix(fix, 'en');
    const de = renderFix(fix, 'de');
    for (const text of [en, de]) {
      expect(text.length).toBeGreaterThan(5);
      expect(text).not.toMatch(PLACEHOLDER);
      expect(text).not.toMatch(MOJIBAKE);
    }
    expect(de).not.toBe(en);
  });

  it('puts the new value into the label', () => {
    const fix = fixes.get('use_lower_odd') as Fix;
    expect(renderFix(fix, 'en')).toBe('Use best of 1');
    expect(renderFix(fix, 'de')).toBe('Best of 1 verwenden');
  });

  it('renders severities and unknown fix ids safely', () => {
    expect(renderSeverity('error', 'en')).toBe('Error');
    expect(renderSeverity('warning', 'de')).toBe('Warnung');
    expect(renderSeverity('info', 'de')).toBe('Hinweis');
    expect(renderFix({ id: 'nope' as Fix['id'], params: {}, patch: [] }, 'en')).toBe('fixes.nope');
  });
});
