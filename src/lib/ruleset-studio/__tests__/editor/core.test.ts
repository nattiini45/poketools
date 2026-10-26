import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogIndex } from '@/lib/pkmn/catalog-index';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import { banEntries } from '@/lib/ruleset-kit/ops';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import {
  clearCatalogCache,
  fetchCatalogIndex,
  fetchCatalogText,
  fetchPresetRules,
  indexUrl,
  peekCatalogIndex,
  peekPresetRules,
  textUrl,
} from '../../editor/catalog-client';
import { blankDocument, documentSignature, normalizeDraft } from '../../editor/document';
import { compileDraft, issueCounts, issuesInSection, publishGate, toIssueRows } from '../../editor/preview';
import { rulesetEditor } from '../../editor/state';
import { EDITOR_SECTIONS, errorId, fieldId, isListSection, jumpCandidates, sectionOfPointer } from '../../editor/targets';
import { CONFIRM_ABOVE, applyBulk, describeResult, needsConfirmation, resolveTargets } from '../../editor/picker/bulk';
import { EMPTY_HISTORY, HISTORY_LIMIT, canRedo, canUndo, record, recordDiff, redo, undo } from '../../editor/picker/history';
import { speciesIndex } from './picker/fixtures';

const PRESET: PresetRules = {
  id: 'gen9ou',
  name: 'Gen 9 OU',
  gen: 9,
  mod: 'gen9',
  universe: 'standard',
  doubles: false,
  source: 'showdown',
  clauses: ['speciesclause', 'sleepclausemod'],
  pokemon: { mode: 'block', ids: ['koraidon'] },
  moves: { mode: 'block', ids: [] },
  items: { mode: 'block', ids: [] },
  abilities: { mode: 'block', ids: [] },
  facts: {} as PresetRules['facts'],
  combination_bans: [],
  catalog_version: 'test',
};

const doc = () => newRulesetDocument('Test', 'en', 'gen9ou');

describe('targets', () => {
  it('maps a pointer to the section that shows it', () => {
    expect(sectionOfPointer('')).toBe('base');
    expect(sectionOfPointer('/identity/name')).toBe('base');
    expect(sectionOfPointer('/base/preset')).toBe('base');
    expect(sectionOfPointer('/clauses/add/0')).toBe('clauses');
    expect(sectionOfPointer('/pokemon/ban/3')).toBe('pokemon');
    expect(sectionOfPointer('/abilities')).toBe('abilities');
    expect(sectionOfPointer('/team_constraints/type_quotas')).toBe('constraints');
    expect(sectionOfPointer('/min_shared_type_pct')).toBe('constraints');
    expect(sectionOfPointer('/custom_rules')).toBe('notes');
    expect(sectionOfPointer('/unknown')).toBe('base');
  });

  it('has ruleset-prefixed field ids and jump candidates from the field up to its section', () => {
    expect(fieldId('/pokemon/ban/3')).toBe('rf-pokemon-ban-3');
    expect(errorId('/pokemon/ban/3')).toBe('rf-pokemon-ban-3-err');
    expect(jumpCandidates('/pokemon/ban/3')).toEqual(['rf-pokemon-ban-3', 'rf-pokemon-ban', 'rf-pokemon']);
    expect(EDITOR_SECTIONS.filter(isListSection)).toEqual(['pokemon', 'moves', 'items', 'abilities']);
  });
});

describe('document and state', () => {
  it('shows a valid draft and reports the issues of one the form cannot show', () => {
    expect(normalizeDraft(doc()).ok).toBe(true);
    const bad = normalizeDraft({ nope: true });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.length).toBeGreaterThan(0);
    expect(normalizeDraft(blankDocument('X', 'de')).ok).toBe(true);
  });

  it('is dirty exactly when the canonical document differs from the saved one', () => {
    let state = rulesetEditor.init(doc(), 1, { section: 'pokemon' });
    expect(rulesetEditor.isDirty(state)).toBe(false);
    const banned = banEntries(state.doc, 'pokemon', ['garchomp'], PRESET.pokemon).doc;
    state = rulesetEditor.reducer(state, { type: 'edit', next: banned });
    expect(rulesetEditor.isDirty(state)).toBe(true);
    state = rulesetEditor.reducer(state, { type: 'save_ok', rev: 2, saved: banned, at: 'now' });
    expect(rulesetEditor.isDirty(state)).toBe(false);
    expect(state.rev).toBe(2);
    // The same content with another key order has the same signature.
    expect(documentSignature({ ...banned, custom_rules: '' })).toBe(documentSignature(banned));
  });
});

describe('compileDraft', () => {
  it('compiles with the resolved preset, flags unknown ids only when the catalog is loaded and counts the issues', () => {
    const banned = banEntries(doc(), 'pokemon', ['garchomp', 'nosuchmon'], PRESET.pokemon).doc;
    const clean = compileDraft(banned, { preset: PRESET, presetPending: false });
    expect(clean.ok).toBe(true);
    expect(clean.diagnostics.some((d) => d.code === 'unknown_entry')).toBe(false);
    const checked = compileDraft(banned, { preset: PRESET, presetPending: false, known: { pokemon: new Set(['garchomp', 'koraidon']) } });
    expect(checked.diagnostics.filter((d) => d.code === 'unknown_entry').map((d) => d.params?.id)).toEqual(['nosuchmon']);
    expect(issueCounts(checked.diagnostics)).toMatchObject({ errors: 0, warnings: 1 });
    expect(issuesInSection(checked.diagnostics, 'pokemon')).toHaveLength(1);
    expect(issuesInSection(checked.diagnostics, 'moves')).toHaveLength(0);
  });

  it('does not judge the base while the preset rules are still loading', () => {
    const pending = compileDraft(doc(), { preset: null, presetPending: true });
    expect(pending.diagnostics.some((d) => d.code === 'preset_unknown')).toBe(false);
    expect(pending.ok).toBe(false);
    expect(compileDraft(doc(), { preset: null, presetPending: false }).diagnostics.some((d) => d.code === 'preset_unknown')).toBe(true);
  });

  it('orders the issue rows errors first and keeps document order inside a severity', () => {
    const broken = { ...doc(), pokemon: { ban: ['a', 'b'], unban: ['a'], allow: null }, clauses: { add: ['ohkoclause'], remove: [] } };
    const rows = toIssueRows(compileDraft(broken, { preset: PRESET, presetPending: false }).diagnostics);
    expect(rows[0].diagnostic.severity).toBe('error');
    const severities = rows.map((r) => r.diagnostic.severity);
    expect(severities).toEqual([...severities].sort((a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b)));
  });

  it('gates the publish on errors and on nothing new', () => {
    const ok = compileDraft(doc(), { preset: PRESET, presetPending: false });
    expect(publishGate(ok, null)).toEqual({ allowed: true, reason: null });
    expect(publishGate(ok, { contentHash: ok.content_hash as string, resolvedHash: ok.resolved_hash })).toEqual({ allowed: false, reason: 'nothing_new' });
    expect(publishGate(ok, { contentHash: ok.content_hash as string, resolvedHash: 'other' }).allowed).toBe(true);
    const broken = compileDraft({ nope: 1 }, { preset: null, presetPending: false });
    expect(publishGate(broken, null)).toEqual({ allowed: false, reason: 'errors' });
  });
});

describe('history', () => {
  const entryFor = (before: ReturnType<typeof doc>, after: ReturnType<typeof doc>) =>
    recordDiff(EMPTY_HISTORY, before, after, 'pokemon', { count: 1, firstId: 'garchomp', action: 'ban' });

  it('undoes and redoes a list edit exactly', () => {
    const before = doc();
    const after = banEntries(before, 'pokemon', ['garchomp'], PRESET.pokemon).doc;
    const history = entryFor(before, after);
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);
    const undone = undo(history, after);
    expect(undone?.doc.pokemon).toEqual(before.pokemon);
    expect(canRedo(undone?.history ?? EMPTY_HISTORY)).toBe(true);
    const redone = redo(undone?.history ?? EMPTY_HISTORY, undone?.doc ?? before);
    expect(redone?.doc.pokemon).toEqual(after.pokemon);
    expect(undo(EMPTY_HISTORY, before)).toBeNull();
    expect(redo(EMPTY_HISTORY, before)).toBeNull();
  });

  it('records nothing when the list did not change, and drops the redo side on a new edit', () => {
    const d = doc();
    expect(recordDiff(EMPTY_HISTORY, d, d, 'pokemon', { count: 0, firstId: null, action: 'ban' })).toBe(EMPTY_HISTORY);
    const after = banEntries(d, 'pokemon', ['garchomp'], PRESET.pokemon).doc;
    const undone = undo(entryFor(d, after), after);
    const next = recordDiff(undone?.history ?? EMPTY_HISTORY, d, banEntries(d, 'pokemon', ['pikachu'], PRESET.pokemon).doc, 'pokemon', { count: 1, firstId: 'pikachu', action: 'ban' });
    expect(canRedo(next)).toBe(false);
  });

  it('keeps at most the limit', () => {
    let history = EMPTY_HISTORY;
    const d = doc();
    for (let i = 0; i < HISTORY_LIMIT + 25; i += 1) {
      history = record(history, { target: 'pokemon', before: d.pokemon, after: d.pokemon, count: i, firstId: null, action: 'ban' });
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0].count).toBe(25);
  });
});

describe('bulk', () => {
  const index = speciesIndex();

  it('covers the clicked entry, the selection or the filtered result, with or without the whole family', () => {
    const base = { entryId: 'charizard', selectedIds: ['rattata'], filteredIds: ['garchomp', 'charmander'], speciesIndex: index };
    expect(resolveTargets({ ...base, scope: 'entry', includeFormes: false })).toEqual(['charizard']);
    expect(resolveTargets({ ...base, scope: 'entry', includeFormes: true }).sort()).toEqual(['charizard', 'charizardmegax', 'charizardmegay']);
    expect(resolveTargets({ ...base, scope: 'selection', includeFormes: true }).sort()).toEqual(['rattata', 'rattataalola']);
    expect(resolveTargets({ ...base, scope: 'filtered', includeFormes: false })).toEqual(['garchomp', 'charmander']);
    expect(resolveTargets({ ...base, entryId: null, scope: 'entry', includeFormes: false })).toEqual([]);
  });

  it('asks for a confirmation above the threshold', () => {
    expect(needsConfirmation(CONFIRM_ABOVE)).toBe(false);
    expect(needsConfirmation(CONFIRM_ABOVE + 1)).toBe(true);
  });

  it('applies the action through the kit and describes the result for the history', () => {
    const result = applyBulk(doc(), 'pokemon', 'ban', ['garchomp', 'pikachu'], PRESET.pokemon);
    expect(result.doc.pokemon.ban).toEqual(['garchomp', 'pikachu']);
    expect(describeResult('ban', result)).toEqual({ count: 2, firstId: 'garchomp', action: 'ban' });
    const unbanned = applyBulk(result.doc, 'pokemon', 'unban', ['koraidon'], PRESET.pokemon);
    expect(describeResult('unban', unbanned).action).toBe('unban');
    const toggled = applyBulk(unbanned.doc, 'pokemon', 'toggle', ['garchomp'], PRESET.pokemon);
    expect(describeResult('toggle', toggled).action).toBe('unban');
    expect(applyBulk(toggled.doc, 'pokemon', 'reset', ['koraidon'], PRESET.pokemon).doc.pokemon.unban).toEqual([]);
  });
});

describe('catalog client', () => {
  beforeEach(() => clearCatalogCache());

  const response = (data: unknown, ok = true, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(ok ? { success: true, data } : { success: false, error: 'x', code: 'unknown_error' }), { status }));

  const index: CatalogIndex<'species'> = { v: 1, kind: 'species', gen: 9, scope: 'standard', preset: null, rows: [] };

  it('builds the URLs', () => {
    expect(indexUrl({ kind: 'species', gen: 9, scope: 'national' })).toBe('/api/pkmn/catalog/species?gen=9&scope=national');
    expect(indexUrl({ kind: 'moves', gen: 3, scope: 'standard', preset: 'gen9championsdraft' })).toBe('/api/pkmn/catalog/moves?gen=3&scope=standard&preset=gen9championsdraft');
    expect(textUrl({ kind: 'items', gen: 9, scope: 'standard', lang: 'de' })).toBe('/api/pkmn/catalog/items?gen=9&scope=standard&part=text&lang=de');
  });

  it('fetches once for the same key, even while the first request is in flight', async () => {
    let calls = 0;
    const f = () => {
      calls += 1;
      return response(index);
    };
    const [a, b] = await Promise.all([
      fetchCatalogIndex({ kind: 'species', gen: 9, scope: 'standard' }, { fetch: f }),
      fetchCatalogIndex({ kind: 'species', gen: 9, scope: 'standard' }, { fetch: f }),
    ]);
    await fetchCatalogIndex({ kind: 'species', gen: 9, scope: 'standard' }, { fetch: f });
    expect(calls).toBe(1);
    expect(a.ok && b.ok).toBe(true);
    expect(peekCatalogIndex({ kind: 'species', gen: 9, scope: 'standard' })).toEqual(index);
    expect(peekCatalogIndex({ kind: 'species', gen: 8, scope: 'standard' })).toBeUndefined();
  });

  it('does not cache a failure, so a retry asks again', async () => {
    let calls = 0;
    const f = () => {
      calls += 1;
      return calls === 1 ? response(null, false, 500) : response(index);
    };
    const first = await fetchCatalogIndex({ kind: 'species', gen: 9, scope: 'standard' }, { fetch: f });
    expect(first.ok).toBe(false);
    const second = await fetchCatalogIndex({ kind: 'species', gen: 9, scope: 'standard' }, { fetch: f });
    expect(second.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('an aborted caller stops waiting while the request still fills the cache', async () => {
    const controller = new AbortController();
    let release: (value: Response) => void = () => undefined;
    const f = () => new Promise<Response>((resolve) => (release = resolve));
    const waiting = fetchCatalogIndex({ kind: 'species', gen: 9, scope: 'standard' }, { fetch: f, signal: controller.signal });
    controller.abort();
    expect((await waiting).ok).toBe(false);
    release(await response(index));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(peekCatalogIndex({ kind: 'species', gen: 9, scope: 'standard' })).toEqual(index);
    expect((await fetchCatalogIndex({ kind: 'species', gen: 9, scope: 'standard' }, { fetch: f, signal: new AbortController().signal })).ok).toBe(true);
  });

  it('caches texts and preset rules per key', async () => {
    let calls = 0;
    const f = (url: string) => {
      calls += 1;
      return response(url.includes('presets') ? PRESET : { v: 1, kind: 'items', gen: 9, scope: 'standard', lang: 'en', text: {}, fallback: [] });
    };
    await fetchCatalogText({ kind: 'items', gen: 9, scope: 'standard', lang: 'en' }, { fetch: f });
    await fetchCatalogText({ kind: 'items', gen: 9, scope: 'standard', lang: 'en' }, { fetch: f });
    await fetchCatalogText({ kind: 'items', gen: 9, scope: 'standard', lang: 'de' }, { fetch: f });
    await fetchPresetRules('gen9ou', { fetch: f });
    await fetchPresetRules('gen9ou', { fetch: f });
    expect(calls).toBe(3);
    expect(peekPresetRules('gen9ou')?.id).toBe('gen9ou');
    expect(peekPresetRules('gen9uu')).toBeUndefined();
  });
});
