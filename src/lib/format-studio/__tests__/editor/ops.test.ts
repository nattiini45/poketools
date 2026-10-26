import { describe, expect, it } from 'vitest';
import {
  KEY_PATTERN,
  MAX_EDGES,
  MAX_OVERRIDES,
  MAX_RANK_STEPS,
  MAX_RULES,
  MAX_SELECTS,
  MAX_STAGES,
  MAX_TEXT_SECTIONS,
  PRESETS,
  deepFreeze,
  ltext,
  validateFormatDefinition,
  type Edge,
  type Stage,
} from '@/lib/format-kit/client';
import { intBetween, mulberry32, pick, type Rng } from '@/lib/format-kit/test-utils/prng';
import { documentSignature, normalizeDraft, type DraftDocument } from '../../editor/document';
import * as ops from '../../editor/ops';
import { compileDraft } from '../../editor/preview';

function preset(id: string): DraftDocument {
  const found = PRESETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  const result = normalizeDraft(structuredClone(found.definition));
  if (!result.ok) throw new Error('preset does not normalise');
  return result.doc;
}

const classic = () => preset('classic-league');
const cup = () => preset('cup');
const swiss = () => preset('swiss-top-cut');

const valid = (doc: DraftDocument): boolean => validateFormatDefinition(doc).ok;
const errorCodes = (doc: DraftDocument): string[] =>
  compileDraft(doc).diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);

const hasUndefined = (doc: DraftDocument): boolean => documentSignature(doc).startsWith('!');

describe('stages', () => {
  it('addStage appends a valid default stage with a fresh key and a numbered name', () => {
    const { doc, index, key } = ops.addStage(classic());
    expect(index).toBe(2);
    expect(key).toBe('stage_3');
    expect(doc.stages).toHaveLength(3);
    expect(doc.stages[2].name.en?.v).toBe('Stage 3');
    expect(valid(doc)).toBe(true);
  });

  it('addStage names a stage in the language the document is written in', () => {
    const base = normalizeDraft({ ...classic(), identity: { name: ltext('de', undefined, 'Liga') } });
    if (!base.ok) throw new Error('shape');
    expect(ops.addStage(base.doc).doc.stages[2].name.de?.v).toBe('Phase 3');
  });

  it('addStage can insert after a stage', () => {
    const { doc, index } = ops.addStage(classic(), { after: 0 });
    expect(index).toBe(1);
    expect(doc.stages.map((s) => s.key)).toEqual(['league', 'stage_3', 'playoffs']);
  });

  it('addStage takes a key that is not taken', () => {
    const base = ops.updateStage(classic(), 0, (s) => ({ ...s, key: 'stage_3' }));
    expect(ops.addStage(base).key).toBe('stage_3_2');
  });

  it('duplicateStage copies the stage under a new key and adds the suffix words per language', () => {
    const { doc, index, key } = ops.duplicateStage(classic(), 0, { en: ' (copy)', de: ' (Kopie)' });
    expect(index).toBe(1);
    expect(key).toBe('league_copy');
    expect(doc.stages[1].name.en?.v).toBe('League phase (copy)');
    expect(doc.stages[1].name.de?.v).toBe('Ligaphase (Kopie)');
    expect(doc.stages[1].pairing).toEqual(doc.stages[0].pairing);
    expect(doc.stages[1]).not.toBe(doc.stages[0]);
    expect(doc.edges).toHaveLength(1);
  });

  it('duplicateStage copies the name as it is without suffix words', () => {
    expect(ops.duplicateStage(classic(), 0).doc.stages[1].name).toEqual(classic().stages[0].name);
  });

  it('duplicate keys stay unique and short after 40 duplicates', () => {
    let doc: DraftDocument = classic();
    for (let i = 0; i < 40; i += 1) doc = ops.duplicateStage(doc, 0).doc;
    const keys = doc.stages.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => KEY_PATTERN.test(k))).toBe(true);
    let long: DraftDocument = ops.updateStage(classic(), 0, (s) => ({ ...s, key: 'k'.repeat(32) }));
    for (let i = 0; i < 12; i += 1) long = ops.duplicateStage(long, 0).doc;
    expect(new Set(long.stages.map((s) => s.key)).size).toBe(long.stages.length);
    expect(long.stages.every((s) => KEY_PATTERN.test(s.key))).toBe(true);
  });

  it('refuses to add or duplicate at the stage limit', () => {
    let doc: DraftDocument = classic();
    while (doc.stages.length < MAX_STAGES) doc = ops.addStage(doc).doc;
    expect(doc.stages).toHaveLength(MAX_STAGES);
    expect(ops.addStage(doc)).toEqual({ doc, index: -1, key: '' });
    expect(ops.addStage(doc).doc).toBe(doc);
    expect(ops.duplicateStage(doc, 0).index).toBe(-1);
    expect(ops.duplicateStage(doc, 0).doc).toBe(doc);
  });

  describe('removeStage', () => {
    const rich = (): DraftDocument => {
      let doc = cup();
      doc = {
        ...doc,
        rules: [
          { kind: 'rule.custom', id: 'r1', text: ltext('en', 'A'), scope: { kind: 'stage', stage: 'groups' }, verify: 'none', when: 'once', visible_to_players: true },
          { kind: 'rule.custom', id: 'r2', text: ltext('en', 'B'), scope: { kind: 'stage', stage: 'knockout' }, verify: 'none', when: 'once', visible_to_players: true },
          { kind: 'rule.custom', id: 'r3', text: ltext('en', 'C'), scope: { kind: 'season' }, verify: 'none', when: 'once', visible_to_players: true },
        ],
        text: {
          sections: [
            { id: 's1', title: ltext('en', 'T'), body: ltext('en', 'B'), stage: 'groups' },
            { id: 's2', title: ltext('en', 'T'), body: ltext('en', 'B') },
          ],
        },
        views: [{ key: 'v1', label: ltext('en', 'View'), stages: ['groups', 'knockout'], metric: 'points', combine: 'sum' }],
      };
      return doc;
    };

    it('previews what removing a stage touches', () => {
      expect(ops.previewRemoveStage(rich(), 0)).toEqual({ edges: 1, ruleCards: 1, textSections: 1, views: 1 });
      expect(ops.previewRemoveStage(rich(), 9)).toEqual({ edges: 0, ruleCards: 0, textSections: 0, views: 0 });
    });

    it('drops the edges, moves rule cards to the season, unlinks sections and drops thin views', () => {
      const { doc, removed } = ops.removeStage(rich(), 0);
      expect(removed).toEqual({ edges: 1, ruleCards: 1, textSections: 1, views: 1 });
      expect(doc.stages.map((s) => s.key)).toEqual(['knockout']);
      expect(doc.edges).toEqual([]);
      expect(doc.rules[0].scope).toEqual({ kind: 'season' });
      expect(doc.rules[1].scope).toEqual({ kind: 'stage', stage: 'knockout' });
      expect(doc.rules[2].scope).toEqual({ kind: 'season' });
      expect(doc.text.sections[0]).not.toHaveProperty('stage');
      expect(doc.text.sections[1]).not.toHaveProperty('stage');
      expect(doc.views).toEqual([]);
      expect(hasUndefined(doc)).toBe(false);
    });

    it('keeps a view that still has two stages', () => {
      const base = { ...rich(), views: [{ key: 'v1', label: ltext('en', 'View'), stages: ['groups', 'knockout', 'extra'], metric: 'points', combine: 'sum' as const }] };
      const { doc } = ops.removeStage(base, 0);
      expect(doc.views[0].stages).toEqual(['knockout', 'extra']);
    });

    it('leaves the references alone when another stage carries the same key', () => {
      const dup = ops.updateStage(classic(), 1, (s) => ({ ...s, key: 'league' }));
      const { doc, removed } = ops.removeStage(dup, 0);
      expect(removed).toEqual({ edges: 0, ruleCards: 0, textSections: 0, views: 0 });
      expect(doc.edges).toHaveLength(1);
    });

    it('out of range removes nothing', () => {
      const doc = classic();
      expect(ops.removeStage(doc, 5).doc).toBe(doc);
      expect(ops.removeStage(doc, -1).doc).toBe(doc);
    });
  });

  describe('moveStage', () => {
    it('moves and clamps', () => {
      expect(ops.moveStage(classic(), 0, 1).stages.map((s) => s.key)).toEqual(['playoffs', 'league']);
      expect(ops.moveStage(classic(), 0, 99).stages.map((s) => s.key)).toEqual(['playoffs', 'league']);
      expect(ops.moveStage(classic(), 1, -5).stages.map((s) => s.key)).toEqual(['playoffs', 'league']);
    });

    it('is a no-op when nothing moves', () => {
      const doc = classic();
      expect(ops.moveStage(doc, 0, 0)).toBe(doc);
      expect(ops.moveStage(doc, 7, 0)).toBe(doc);
      expect(ops.moveStage(doc, 0, Number.NaN)).toBe(doc);
    });
  });

  describe('renameStageKey', () => {
    it('rewrites every reference', () => {
      const base: DraftDocument = {
        ...cup(),
        rules: [{ kind: 'rule.custom', id: 'r1', text: ltext('en', 'A'), scope: { kind: 'stage', stage: 'groups' }, verify: 'none', when: 'once', visible_to_players: true }],
        text: { sections: [{ id: 's1', title: ltext('en', 'T'), body: ltext('en', 'B'), stage: 'groups' }] },
        views: [{ key: 'v1', label: ltext('en', 'View'), stages: ['groups', 'knockout'], metric: 'points', combine: 'sum' }],
      };
      const result = ops.renameStageKey(base, 0, 'pool');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.doc.stages[0].key).toBe('pool');
      expect(result.doc.edges[0].from).toBe('pool');
      expect(result.doc.edges[0].to).toBe('knockout');
      expect(result.doc.rules[0].scope).toEqual({ kind: 'stage', stage: 'pool' });
      expect(result.doc.text.sections[0].stage).toBe('pool');
      expect(result.doc.views[0].stages).toEqual(['pool', 'knockout']);
      expect(errorCodes(result.doc)).toEqual([]);
    });

    it('renames the target of an edge too', () => {
      const result = ops.renameStageKey(classic(), 1, 'finals');
      expect(result.ok && result.doc.edges[0].to).toBe('finals');
    });

    it('rejects a bad pattern, a taken key and an unchanged key', () => {
      expect(ops.renameStageKey(classic(), 0, 'Bad Key')).toEqual({ ok: false, reason: 'pattern' });
      expect(ops.renameStageKey(classic(), 0, '')).toEqual({ ok: false, reason: 'pattern' });
      expect(ops.renameStageKey(classic(), 0, '__proto__')).toEqual({ ok: false, reason: 'pattern' });
      expect(ops.renameStageKey(classic(), 0, 'playoffs')).toEqual({ ok: false, reason: 'taken' });
      expect(ops.renameStageKey(classic(), 0, 'league')).toEqual({ ok: false, reason: 'unchanged' });
      expect(ops.renameStageKey(classic(), 9, 'x')).toEqual({ ok: false, reason: 'unchanged' });
    });
  });

  it('updateStage returns the same document for the same stage and for a bad index', () => {
    const doc = classic();
    expect(ops.updateStage(doc, 0, (s) => s)).toBe(doc);
    expect(ops.updateStage(doc, 5, (s) => ({ ...s, doubles: true }))).toBe(doc);
  });
});

describe('stage setters', () => {
  const preset0 = classic();
  const base = () => preset0.stages[0];
  const edgeStage = () => preset0.stages[1];

  it('setStageName edits one language and the empty base language stays flagged', () => {
    const named = ops.setStageName(base(), 'de', 'Liga A', 'en');
    expect(named.name.de?.v).toBe('Liga A');
    expect(named.name.en?.v).toBe('League phase');
    const only = { ...base(), name: ltext('en', 'Solo') };
    const emptied = ops.setStageName(only, 'en', '', 'en');
    expect(emptied.name.en?.v).toBe('');
    expect(valid({ ...classic(), stages: [emptied, classic().stages[1]] })).toBe(false);
  });

  it('setParticipantsFrom switches the source and resets the seeding', () => {
    const toEdges = ops.setParticipantsFrom({ ...base(), participants: { from: 'roster', seeding: 'signup', expected_count: 12 } }, 'edges');
    expect(toEdges.participants).toEqual({ from: 'edges', seeding: 'edge_order' });
    const toRoster = ops.setParticipantsFrom(edgeStage(), 'roster');
    expect(toRoster.participants).toEqual({ from: 'roster', seeding: 'rating' });
    expect(ops.setParticipantsFrom(base(), 'roster')).toBe(base());
  });

  it('setSeeding accepts a value of the current source only', () => {
    expect(ops.setSeeding(base(), 'random').participants.seeding).toBe('random');
    expect(ops.setSeeding(base(), 'edge_order')).toBe(base());
    expect(ops.setSeeding(base(), 'nonsense')).toBe(base());
    expect(ops.setSeeding(edgeStage(), 'rating').participants.seeding).toBe('rating');
    expect(ops.setSeeding(edgeStage(), 'signup')).toBe(edgeStage());
  });

  it('setExpectedCount sets and removes the member without writing undefined', () => {
    const set = ops.setExpectedCount(base(), 12);
    expect(set.participants).toEqual({ from: 'roster', seeding: 'signup', expected_count: 12 });
    const cleared = ops.setExpectedCount(set, undefined);
    expect(cleared.participants).toEqual({ from: 'roster', seeding: 'signup' });
    expect('expected_count' in cleared.participants).toBe(false);
    expect(ops.setExpectedCount(edgeStage(), 4)).toBe(edgeStage());
    expect(ops.setExpectedCount(base(), undefined)).toBe(base());
    expect(ops.setExpectedCount(base(), Number.NaN)).toBe(base());
  });

  it('setGroups turns groups on and off', () => {
    const on = ops.setGroups(base(), ops.DEFAULT_GROUPS);
    expect(on.groups).toEqual({ count: 2, method: 'serpentine' });
    expect(on.groups).not.toBe(ops.DEFAULT_GROUPS);
    const off = ops.setGroups(on, undefined);
    expect('groups' in off).toBe(false);
    expect(ops.setGroups(base(), undefined)).toBe(base());
  });

  it.each([
    ['round_robin', { kind: 'round_robin', legs: 1, mirror_legs: true }],
    ['swiss', { kind: 'swiss', rounds: 'auto', avoid_repeats: true }],
    ['single_elim', { kind: 'single_elim', third_place: false }],
    ['double_elim', { kind: 'double_elim', bracket_reset: false }],
    ['manual', { kind: 'manual' }],
  ] as const)('setPairingKind(%s) sets the kind defaults and keeps series, scoring and rank', (kind, expected) => {
    const start = ops.setPairingKind(base(), kind === 'round_robin' ? 'swiss' : 'round_robin');
    const next = ops.setPairingKind(start, kind);
    expect(next.pairing).toEqual(expected);
    expect(next.series).toEqual(base().series);
    expect(next.scoring).toEqual(base().scoring);
    expect(next.rank).toEqual(base().rank);
    expect(next.participants).toEqual(base().participants);
  });

  it('setPairingKind to the current kind changes nothing', () => {
    expect(ops.setPairingKind(base(), 'round_robin')).toBe(base());
  });

  it('patchPairing sets members of the current kind only', () => {
    expect(ops.patchPairing(base(), { legs: 3 }).pairing).toEqual({ kind: 'round_robin', legs: 3, mirror_legs: true });
    expect(ops.patchPairing(base(), { mirror_legs: false }).pairing).toMatchObject({ mirror_legs: false });
    expect(ops.patchPairing(base(), { third_place: true, rounds: 4, kind: 'swiss' })).toBe(base());
    const swissStage = ops.setPairingKind(base(), 'swiss');
    expect(ops.patchPairing(swissStage, { rounds: 5, avoid_repeats: false }).pairing).toEqual({ kind: 'swiss', rounds: 5, avoid_repeats: false });
    expect(ops.patchPairing(ops.setPairingKind(base(), 'single_elim'), { third_place: true }).pairing).toEqual({ kind: 'single_elim', third_place: true });
    expect(ops.patchPairing(ops.setPairingKind(base(), 'double_elim'), { bracket_reset: true }).pairing).toEqual({ kind: 'double_elim', bracket_reset: true });
    expect(ops.patchPairing(ops.setPairingKind(base(), 'manual'), { legs: 2 }).pairing).toEqual({ kind: 'manual' });
    expect(ops.patchPairing(base(), { legs: undefined })).toBe(base());
  });

  it('setBestOf sets the length', () => {
    expect(ops.setBestOf(base(), 5).series.best_of).toBe(5);
    expect(ops.setBestOf(base(), 1)).toBe(base());
  });

  it('series exceptions add, patch and remove, up to the limit', () => {
    let s = base();
    s = ops.addOverride(s);
    s = ops.addOverride(s);
    expect(s.series.overrides.map((o) => o.round)).toEqual([1, 2]);
    expect(s.series.overrides[0]).toEqual({ round: 1, from: 'start', best_of: 1 });
    s = ops.patchOverride(s, 1, { round: 4, from: 'end', best_of: 3 });
    expect(s.series.overrides[1]).toEqual({ round: 4, from: 'end', best_of: 3 });
    expect(ops.patchOverride(s, 1, { round: 4 })).toBe(s);
    expect(ops.patchOverride(s, 9, { round: 4 })).toBe(s);
    s = ops.removeOverride(s, 0);
    expect(s.series.overrides).toHaveLength(1);
    expect(ops.removeOverride(s, 5)).toBe(s);
    let full = base();
    for (let i = 0; i < MAX_OVERRIDES + 3; i += 1) full = ops.addOverride(full);
    expect(full.series.overrides).toHaveLength(MAX_OVERRIDES);
    expect(ops.addOverride(full)).toBe(full);
  });

  it('setRuleset sets a named or the default ruleset', () => {
    const id = '3f2b8c1e-5a47-4d09-9b6e-7c1d2a4e8f10';
    expect(ops.setRuleset(base(), { kind: 'ruleset', id }).ruleset).toEqual({ kind: 'ruleset', id });
    expect(ops.setRuleset(base(), { kind: 'season_default' }).ruleset).toEqual({ kind: 'season_default' });
  });

  it('setRulesetPreset plays the stage under a format: ruleset, doubles and two players, series untouched', () => {
    const s = ops.setRulesetPreset(base(), 'gen9doublesou');
    expect(s.ruleset).toEqual({ kind: 'preset', preset: 'gen9doublesou' });
    expect(s.doubles).toBe(true);
    expect(s.players_per_match).toBe(2);
    expect(s.series).toBe(base().series);
    expect(ops.setRulesetPreset(s, 'gen9doublesou')).toBe(s);
    expect(ops.setRulesetPreset(s, 'gen9ou').doubles).toBe(false);
    expect(ops.setRulesetPreset(base(), 'gen99xx')).toBe(base());
    expect(valid(ops.updateStage(classic(), 0, (stage) => ops.setRulesetPreset(stage, 'gen9vgc')))).toBe(true);
  });

  it('setScoreValue sets win, loss and bye', () => {
    expect(ops.setScoreValue(base(), 'win', 2).scoring.win).toBe(2);
    expect(ops.setScoreValue(base(), 'loss', -1).scoring.loss).toBe(-1);
    expect(ops.setScoreValue(base(), 'bye', 1).scoring.bye).toBe(1);
    expect(ops.setScoreValue(base(), 'win', 3)).toBe(base());
    expect(ops.setScoreValue(base(), 'win', Number.NaN)).toBe(base());
  });

  it('setDoubles toggles', () => {
    expect(ops.setDoubles(base(), true).doubles).toBe(true);
    expect(ops.setDoubles(base(), false)).toBe(base());
  });

  describe('rank chain', () => {
    it('addRankStep builds each kind', () => {
      const none = { ...base(), rank: [] };
      expect(ops.addRankStep(none, 'metric').rank).toEqual([{ kind: 'metric', metric: 'points', direction: 'desc' }]);
      expect(ops.addRankStep(none, 'head_to_head').rank).toEqual([{ kind: 'head_to_head', scope: 'pairwise' }]);
      expect(ops.addRankStep(none, 'coin_flip').rank).toEqual([{ kind: 'coin_flip' }]);
      expect(ops.addRankStep(none, 'decision_match').rank).toEqual([{ kind: 'decision_match' }]);
      expect(ops.addRankStep(none, 'manual').rank).toEqual([{ kind: 'manual' }]);
    });

    it('patchRankStep edits the members of the step kind only', () => {
      const s = ops.patchRankStep(base(), 0, { metric: 'wins', direction: 'asc', scope: 'pairwise' });
      expect(s.rank[0]).toEqual({ kind: 'metric', metric: 'wins', direction: 'asc' });
      expect(ops.patchRankStep(base(), 1, { scope: 'pairwise' }).rank[1]).toEqual({ kind: 'head_to_head', scope: 'pairwise' });
      expect(ops.patchRankStep(base(), 4, { metric: 'wins' })).toBe(base());
      expect(ops.patchRankStep(base(), 99, { metric: 'wins' })).toBe(base());
      expect(ops.patchRankStep(base(), 0, { metric: undefined })).toBe(base());
    });

    it('removes, moves and clamps', () => {
      const removed = ops.removeRankStep(base(), 1);
      expect(removed.rank).toHaveLength(base().rank.length - 1);
      expect(ops.removeRankStep(base(), 99)).toBe(base());
      const moved = ops.moveRankStep(base(), 0, 1);
      expect(moved.rank[1]).toEqual(base().rank[0]);
      expect(ops.moveRankStep(base(), 0, 0)).toBe(base());
      expect(ops.moveRankStep(base(), 0, 99).rank[base().rank.length - 1]).toEqual(base().rank[0]);
    });

    it('stops adding at the limit', () => {
      let s = { ...base(), rank: [] as Stage['rank'] };
      for (let i = 0; i < MAX_RANK_STEPS + 2; i += 1) s = ops.addRankStep(s, 'manual');
      expect(s.rank).toHaveLength(MAX_RANK_STEPS);
      expect(ops.addRankStep(s, 'manual')).toBe(s);
    });
  });

  it('every setter leaves a valid document valid', () => {
    const variants: Array<(s: Stage) => Stage> = [
      (s) => ops.setStageName(s, 'de', 'Neu', 'en'),
      (s) => ops.setSeeding(s, 'random'),
      (s) => ops.setExpectedCount(s, 12),
      (s) => ops.setGroups(s, ops.DEFAULT_GROUPS),
      (s) => ops.setPairingKind(s, 'swiss'),
      (s) => ops.setPairingKind(s, 'single_elim'),
      (s) => ops.setPairingKind(s, 'double_elim'),
      (s) => ops.setPairingKind(s, 'manual'),
      (s) => ops.patchPairing(s, { legs: 2 }),
      (s) => ops.setBestOf(s, 3),
      (s) => ops.addOverride(s),
      (s) => ops.setRuleset(s, { kind: 'season_default' }),
      (s) => ops.setRulesetPreset(s, 'gen9ou'),
      (s) => ops.setScoreValue(s, 'win', 5),
      (s) => ops.setDoubles(s, true),
      (s) => ops.addRankStep(s, 'coin_flip'),
      (s) => ops.moveRankStep(s, 0, 1),
    ];
    for (const variant of variants) {
      const doc = ops.updateStage(classic(), 0, variant);
      expect(valid(doc)).toBe(true);
      expect(hasUndefined(doc)).toBe(false);
    }
  });
});

describe('edges', () => {
  it('addEdge builds a valid default edge between the first two stages', () => {
    const base = { ...classic(), edges: [] as Edge[] };
    const { doc, index, key } = ops.addEdge(base);
    expect(index).toBe(0);
    expect(key).toBe('edge_1');
    expect(doc.edges[0]).toEqual({ key: 'edge_1', from: 'league', to: 'playoffs', select: [{ kind: 'top_n', n: 2 }], seeding: 'rank', gate: 'admin_confirm' });
    expect(valid(doc)).toBe(true);
  });

  it('addEdge honours from and to, and finds a target after the source', () => {
    const base = { ...cup(), edges: [] as Edge[] };
    expect(ops.addEdge(base, { from: 'groups', to: 'groups' }).doc.edges[0]).toMatchObject({ from: 'groups', to: 'groups' });
    expect(ops.addEdge(base, { from: 'knockout' }).doc.edges[0]).toMatchObject({ from: 'knockout', to: 'groups' });
  });

  it('addEdge never repeats a key', () => {
    let doc: DraftDocument = classic();
    for (let i = 0; i < 12; i += 1) doc = ops.addEdge(doc).doc;
    const keys = doc.edges.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => KEY_PATTERN.test(k))).toBe(true);
  });

  it('stops at the edge limit', () => {
    let doc: DraftDocument = classic();
    while (doc.edges.length < MAX_EDGES) doc = ops.addEdge(doc).doc;
    expect(ops.addEdge(doc)).toEqual({ doc, index: -1, key: '' });
  });

  it('removes, moves and updates', () => {
    let doc: DraftDocument = ops.addEdge(classic(), { from: 'playoffs', to: 'league' }).doc;
    expect(doc.edges).toHaveLength(2);
    expect(ops.moveEdge(doc, 0, 1).edges[1].key).toBe('to_playoffs');
    expect(ops.moveEdge(doc, 0, 0)).toBe(doc);
    expect(ops.removeEdge(doc, 0).edges).toHaveLength(1);
    expect(ops.removeEdge(doc, 7)).toBe(doc);
    expect(ops.updateEdge(doc, 0, (e) => ({ ...e, gate: 'auto' })).edges[0].gate).toBe('auto');
    expect(ops.updateEdge(doc, 0, (e) => e)).toBe(doc);
    expect(ops.updateEdge(doc, 9, (e) => ({ ...e, gate: 'auto' }))).toBe(doc);
    doc = ops.removeEdge(doc, 1);
    expect(doc.edges).toHaveLength(1);
  });

  describe('selections', () => {
    const edge0 = classic().edges[0];
    const edge = (): Edge => edge0;

    it('addSelect builds each editable kind and stops at the limit', () => {
      expect(ops.addSelect(edge(), 'per_group').select[1]).toEqual({ kind: 'per_group', n: 2 });
      expect(ops.addSelect(edge(), 'wildcard').select[1]).toEqual({ kind: 'wildcard', n: 2 });
      expect(ops.addSelect(edge(), 'bottom_n').select[1]).toEqual({ kind: 'bottom_n', n: 2 });
      expect(ops.addSelect(edge(), 'top_n').select[1]).toEqual({ kind: 'top_n', n: 2 });
      expect(ops.addSelect(edge(), 'manual_list').select[1]).toEqual({ kind: 'manual_list' });
      let e = edge();
      for (let i = 0; i < MAX_SELECTS + 2; i += 1) e = ops.addSelect(e, 'wildcard');
      expect(e.select).toHaveLength(MAX_SELECTS);
      expect(ops.addSelect(e, 'wildcard')).toBe(e);
    });

    it('removeSelect removes by index', () => {
      const two = ops.addSelect(edge(), 'wildcard');
      expect(ops.removeSelect(two, 0).select).toEqual([{ kind: 'wildcard', n: 2 }]);
      expect(ops.removeSelect(two, 5)).toBe(two);
    });

    it('patchSelect sets the number and keeps the kind', () => {
      expect(ops.patchSelect(edge(), 0, { n: 8 }).select[0]).toEqual({ kind: 'top_n', n: 8 });
      expect(ops.patchSelect(edge(), 0, { n: 4 })).toBe(edge());
      expect(ops.patchSelect(edge(), 0, { n: Number.NaN })).toBe(edge());
      expect(ops.patchSelect(edge(), 3, { n: 8 })).toBe(edge());
    });

    it('patchSelect changes between the counted kinds keeping n', () => {
      for (const kind of ['per_group', 'wildcard', 'bottom_n', 'top_n'] as const) {
        const changed = ops.patchSelect(ops.patchSelect(edge(), 0, { n: 6 }), 0, { kind });
        expect(changed.select[0]).toEqual({ kind, n: 6 });
      }
    });

    it('patchSelect moves to and from a hand-picked list', () => {
      const list = ops.patchSelect(edge(), 0, { kind: 'manual_list' });
      expect(list.select[0]).toEqual({ kind: 'manual_list' });
      const counted = ops.patchSelect(list, 0, { count: 3 });
      expect(counted.select[0]).toEqual({ kind: 'manual_list', count: 3 });
      expect(ops.patchSelect(counted, 0, { n: 9 })).toBe(counted);
      const cleared = ops.patchSelect(counted, 0, { count: undefined });
      expect(cleared.select[0]).toEqual({ kind: 'manual_list' });
      expect('count' in cleared.select[0]).toBe(false);
      expect(ops.patchSelect(counted, 0, { kind: 'top_n' }).select[0]).toEqual({ kind: 'top_n', n: 2 });
      expect(ops.patchSelect(edge(), 0, { count: 5 })).toBe(edge());
    });

    it('never touches a threshold selection, but it can be removed', () => {
      const threshold: Edge = { ...edge(), select: [{ kind: 'threshold', when: { k: 'bool', v: true } }] };
      expect(ops.patchSelect(threshold, 0, { n: 3 })).toBe(threshold);
      expect(ops.patchSelect(threshold, 0, { kind: 'top_n' })).toBe(threshold);
      expect(ops.patchSelect(threshold, 0, { count: 3 })).toBe(threshold);
      expect(ops.removeSelect(threshold, 0).select).toEqual([]);
    });
  });
});

describe('rule cards and text sections', () => {
  const bare = (): DraftDocument => ({ ...classic(), rules: [], text: { sections: [] } });

  it('addRuleCard builds a card with the defaults and an empty text', () => {
    const { doc, index, id } = ops.addRuleCard(bare(), 'de');
    expect(index).toBe(0);
    expect(id).toBe('rule_1');
    expect(doc.rules[0]).toEqual({
      kind: 'rule.custom',
      id: 'rule_1',
      text: { base: 'de', de: { v: '', s: 'human' } },
      scope: { kind: 'season' },
      verify: 'admin_checklist',
      when: 'once',
      visible_to_players: true,
    });
    // An empty text is the one documented way an op creates an issue.
    expect(valid(doc)).toBe(false);
    const filled = ops.updateRuleCard(doc, 0, (card) => ({ ...card, text: ltext('en', 'No pineapple pizza') }));
    expect(valid(filled)).toBe(true);
  });

  it('rule cards update, remove, move and duplicate', () => {
    let doc = ops.addRuleCard(bare(), 'en').doc;
    doc = ops.addRuleCard(doc, 'en').doc;
    expect(doc.rules.map((r) => r.id)).toEqual(['rule_1', 'rule_2']);
    expect(ops.moveRuleCard(doc, 0, 1).rules.map((r) => r.id)).toEqual(['rule_2', 'rule_1']);
    expect(ops.moveRuleCard(doc, 0, 0)).toBe(doc);
    const copy = ops.duplicateRuleCard(doc, 0);
    expect(copy.index).toBe(1);
    expect(copy.id).toBe('rule_1_copy');
    expect(copy.doc.rules.map((r) => r.id)).toEqual(['rule_1', 'rule_1_copy', 'rule_2']);
    expect(ops.removeRuleCard(doc, 0).rules.map((r) => r.id)).toEqual(['rule_2']);
    expect(ops.removeRuleCard(doc, 8)).toBe(doc);
    expect(ops.duplicateRuleCard(doc, 8)).toEqual({ doc, index: -1, id: '' });
    expect(ops.updateRuleCard(doc, 8, (c) => ({ ...c, when: 'per_match' }))).toBe(doc);
    expect(ops.updateRuleCard(doc, 0, (c) => c)).toBe(doc);
  });

  it('rule card ids stay unique and fit the key pattern after many duplicates', () => {
    let doc = ops.addRuleCard(bare(), 'en').doc;
    for (let i = 0; i < 30; i += 1) doc = ops.duplicateRuleCard(doc, 0).doc;
    const ids = doc.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => KEY_PATTERN.test(id))).toBe(true);
  });

  it('stops at the rule limit', () => {
    let doc: DraftDocument = bare();
    while (doc.rules.length < MAX_RULES) doc = ops.addRuleCard(doc, 'en').doc;
    expect(ops.addRuleCard(doc, 'en')).toEqual({ doc, index: -1, id: '' });
    expect(ops.duplicateRuleCard(doc, 0).index).toBe(-1);
  });

  it('text sections add, update, move and remove, up to the limit', () => {
    let doc = ops.addTextSection(bare(), 'en').doc;
    doc = ops.addTextSection(doc, 'en').doc;
    expect(doc.text.sections).toHaveLength(2);
    const ids = doc.text.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const last = doc.text.sections.length - 1;
    expect(ops.moveTextSection(doc, last, 0).text.sections[0].id).toBe(ids[last]);
    expect(ops.moveTextSection(doc, 0, 0)).toBe(doc);
    expect(ops.removeTextSection(doc, 0).text.sections).toHaveLength(last);
    expect(ops.removeTextSection(doc, 50)).toBe(doc);
    const updated = ops.updateTextSection(doc, last, (s) => ({ ...s, stage: 'league' }));
    expect(updated.text.sections[last].stage).toBe('league');
    expect(ops.updateTextSection(doc, 50, (s) => s)).toBe(doc);
    expect(ops.updateTextSection(doc, 0, (s) => s)).toBe(doc);

    let full: DraftDocument = bare();
    while (full.text.sections.length < MAX_TEXT_SECTIONS) full = ops.addTextSection(full, 'en').doc;
    expect(ops.addTextSection(full, 'en')).toEqual({ doc: full, index: -1, id: '' });
  });
});

describe('identity and theme', () => {
  it('setIdentityText edits a language of the name', () => {
    const doc = ops.setIdentityText(classic(), 'name', 'de', 'Neue Liga');
    expect(doc.identity.name.de?.v).toBe('Neue Liga');
    expect(doc.identity.name.en?.v).toBe('Classic league');
  });

  it('setIdentityText creates the summary when it is typed and removes it when emptied', () => {
    const base = normalizeDraft({ ...classic(), identity: { name: classic().identity.name } });
    if (!base.ok) throw new Error('shape');
    const typed = ops.setIdentityText(base.doc, 'summary', 'en', 'A short line');
    expect(typed.identity.summary).toEqual({ base: 'en', en: { v: 'A short line', s: 'human' } });
    const emptied = ops.setIdentityText(typed, 'summary', 'en', '');
    expect('summary' in emptied.identity).toBe(false);
    expect(ops.setIdentityText(base.doc, 'summary', 'en', '')).toBe(base.doc);
    // A summary with a second language is not removed by emptying one of them.
    const both = ops.setIdentityText(typed, 'summary', 'de', 'Eine Zeile');
    expect(ops.setIdentityText(both, 'summary', 'en', '').identity.summary).toEqual({ base: 'de', de: { v: 'Eine Zeile', s: 'human' } });
    expect(hasUndefined(emptied)).toBe(false);
  });

  it('setTheme sets the world', () => {
    expect(ops.setTheme(classic(), 'sakura').theme.world).toBe('sakura');
    expect(ops.setTheme(classic(), 'auto')).toEqual(classic());
    const doc = classic();
    expect(ops.setTheme(doc, 'auto')).toBe(doc);
    expect(valid(ops.setTheme(doc, 'sakura'))).toBe(true);
  });
});

describe('fixes', () => {
  it('applyFix applies a patch and fails on a path that is gone', () => {
    const doc = classic();
    const fix = { id: 'remove_rank_step', params: {}, patch: [{ op: 'remove', path: '/stages/0/rank/0' }] } as const;
    const applied = ops.applyFix(doc, fix);
    expect(applied.ok && applied.doc.stages[0].rank).toHaveLength(doc.stages[0].rank.length - 1);
    expect(doc.stages[0].rank).toHaveLength(5);
    expect(ops.applyFix(doc, { ...fix, patch: [{ op: 'remove', path: '/stages/9/rank/0' }] })).toEqual({ ok: false });
  });

  it('applyFix refuses a path that reaches the prototype', () => {
    const fix = { id: 'clear_rank', params: {}, patch: [{ op: 'replace', path: '/__proto__/x', value: 1 }] } as const;
    expect(ops.applyFix(classic(), fix)).toEqual({ ok: false });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('removeAtPointer removes an unknown member and refuses the root and a missing path', () => {
    const doc = { ...classic(), extra: 1 } as unknown as DraftDocument;
    const result = ops.removeAtPointer(doc, '/extra');
    expect(result.ok && 'extra' in result.doc).toBe(false);
    expect(ops.removeAtPointer(doc, '')).toEqual({ ok: false });
    expect(ops.removeAtPointer(doc, '/nothing')).toEqual({ ok: false });
    expect(ops.removeAtPointer(doc, '/__proto__')).toEqual({ ok: false });
    expect(ops.removeAtPointer(doc, 'bad')).toEqual({ ok: false });
  });
});

// ─── Cross-cutting properties ────────────────────────────────────────────────────────────────────

/** Every operation as `(doc, rng) => doc`, with indexes drawn from just outside the valid range. */
const OPERATIONS: ReadonlyArray<[string, (doc: DraftDocument, rng: Rng) => DraftDocument]> = [
  ['addStage', (d, r) => ops.addStage(d, r() < 0.5 ? { after: intBetween(r, -1, d.stages.length) } : undefined).doc],
  ['duplicateStage', (d, r) => ops.duplicateStage(d, intBetween(r, -1, d.stages.length), { en: ' (copy)', de: ' (Kopie)' }).doc],
  ['removeStage', (d, r) => (d.stages.length > 1 ? ops.removeStage(d, intBetween(r, -1, d.stages.length)).doc : d)],
  ['moveStage', (d, r) => ops.moveStage(d, intBetween(r, -1, d.stages.length), intBetween(r, -2, d.stages.length + 1))],
  [
    'renameStageKey',
    (d, r) => {
      const next = pick(r, ['pool', 'finals', 'Bad Key', 'x'.repeat(33), 'league', 'stage_9', '']);
      const result = ops.renameStageKey(d, intBetween(r, -1, d.stages.length), next);
      return result.ok ? result.doc : d;
    },
  ],
  ['setStageName', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.setStageName(s, pick(r, ['en', 'de'] as const), pick(r, ['', 'Named', 'Benannt']), 'en'))],
  ['setParticipantsFrom', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.setParticipantsFrom(s, pick(r, ['roster', 'edges'] as const)))],
  ['setSeeding', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.setSeeding(s, pick(r, ['rating', 'random', 'manual', 'signup', 'edge_order', 'nonsense'])))],
  ['setExpectedCount', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.setExpectedCount(s, pick(r, [undefined, 4, 8, 16])))],
  ['setGroups', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.setGroups(s, pick(r, [undefined, ops.DEFAULT_GROUPS, { count: 4, method: 'straight' as const }])))],
  ['setPairingKind', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.setPairingKind(s, pick(r, ['round_robin', 'swiss', 'single_elim', 'double_elim', 'manual'] as const)))],
  ['patchPairing', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.patchPairing(s, { legs: intBetween(r, 1, 4), rounds: intBetween(r, 1, 6), third_place: r() < 0.5, bracket_reset: r() < 0.5 }))],
  ['setBestOf', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.setBestOf(s, intBetween(r, 1, 7)))],
  ['addOverride', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), ops.addOverride)],
  ['patchOverride', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.patchOverride(s, intBetween(r, -1, s.series.overrides.length), { round: intBetween(r, 1, 6), from: pick(r, ['start', 'end'] as const) }))],
  ['removeOverride', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.removeOverride(s, intBetween(r, -1, s.series.overrides.length)))],
  ['setScoreValue', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.setScoreValue(s, pick(r, ['win', 'loss', 'bye'] as const), intBetween(r, -3, 6)))],
  ['addRankStep', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.addRankStep(s, pick(r, ['metric', 'head_to_head', 'coin_flip', 'decision_match', 'manual'] as const)))],
  ['patchRankStep', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.patchRankStep(s, intBetween(r, -1, s.rank.length), { metric: pick(r, ['wins', 'points', 'buchholz']), direction: pick(r, ['asc', 'desc']), scope: 'mini_table' }))],
  ['removeRankStep', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.removeRankStep(s, intBetween(r, -1, s.rank.length)))],
  ['moveRankStep', (d, r) => ops.updateStage(d, intBetween(r, 0, d.stages.length), (s) => ops.moveRankStep(s, intBetween(r, -1, s.rank.length), intBetween(r, -1, s.rank.length + 1)))],
  ['addEdge', (d, r) => ops.addEdge(d, r() < 0.5 ? { from: pick(r, d.stages.map((s) => s.key)) } : undefined).doc],
  ['removeEdge', (d, r) => ops.removeEdge(d, intBetween(r, -1, d.edges.length))],
  ['moveEdge', (d, r) => ops.moveEdge(d, intBetween(r, -1, d.edges.length), intBetween(r, -1, d.edges.length + 1))],
  ['addSelect', (d, r) => ops.updateEdge(d, intBetween(r, 0, d.edges.length), (e) => ops.addSelect(e, pick(r, ['top_n', 'per_group', 'wildcard', 'bottom_n', 'manual_list'] as const)))],
  ['patchSelect', (d, r) => ops.updateEdge(d, intBetween(r, 0, d.edges.length), (e) => ops.patchSelect(e, intBetween(r, -1, e.select.length), { n: intBetween(r, 1, 8), kind: pick(r, ['top_n', 'manual_list', 'bottom_n'] as const) }))],
  ['removeSelect', (d, r) => ops.updateEdge(d, intBetween(r, 0, d.edges.length), (e) => ops.removeSelect(e, intBetween(r, -1, e.select.length)))],
  ['addRuleCard', (d) => ops.addRuleCard(d, 'en').doc],
  ['duplicateRuleCard', (d, r) => ops.duplicateRuleCard(d, intBetween(r, -1, d.rules.length)).doc],
  ['removeRuleCard', (d, r) => ops.removeRuleCard(d, intBetween(r, -1, d.rules.length))],
  ['moveRuleCard', (d, r) => ops.moveRuleCard(d, intBetween(r, -1, d.rules.length), intBetween(r, -1, d.rules.length + 1))],
  ['addTextSection', (d) => ops.addTextSection(d, 'de').doc],
  ['removeTextSection', (d, r) => ops.removeTextSection(d, intBetween(r, -1, d.text.sections.length))],
  ['moveTextSection', (d, r) => ops.moveTextSection(d, intBetween(r, -1, d.text.sections.length), intBetween(r, -1, d.text.sections.length + 1))],
  ['setIdentityText', (d, r) => ops.setIdentityText(d, pick(r, ['name', 'summary'] as const), pick(r, ['en', 'de'] as const), pick(r, ['', 'Text', 'Text 2']))],
  ['setTheme', (d, r) => ops.setTheme(d, pick(r, ['auto', 'sakura', 'plaza']))],
];

function assertKeys(doc: DraftDocument, context: string): void {
  const groups: Array<[string, string[]]> = [
    ['stage', doc.stages.map((s) => s.key)],
    ['edge', doc.edges.map((e) => e.key)],
    ['rule', doc.rules.map((r) => r.id)],
    ['section', doc.text.sections.map((s) => s.id)],
  ];
  for (const [kind, keys] of groups) {
    expect(new Set(keys).size, `${context}: duplicate ${kind} key in ${keys.join(',')}`).toBe(keys.length);
    for (const key of keys) expect(KEY_PATTERN.test(key), `${context}: bad ${kind} key "${key}"`).toBe(true);
  }
}

describe('properties', () => {
  it('every operation leaves a frozen input untouched and never throws', () => {
    for (const [name, op] of OPERATIONS) {
      const frozen = deepFreeze(structuredClone(classic()));
      const before = documentSignature(frozen);
      const rng = mulberry32(7);
      for (let i = 0; i < 20; i += 1) {
        expect(() => op(frozen, rng), name).not.toThrow();
      }
      expect(documentSignature(frozen), name).toBe(before);
    }
  });

  it('an operation that changes nothing returns the very same document', () => {
    const doc = classic();
    expect(ops.removeEdge(doc, 99)).toBe(doc);
    expect(ops.removeRuleCard(doc, -3)).toBe(doc);
    expect(ops.removeTextSection(doc, 7)).toBe(doc);
    expect(ops.moveEdge(doc, 0, 0)).toBe(doc);
  });

  it('out-of-range indexes return the input', () => {
    const doc = swiss();
    for (const bad of [-1, 99, 1.5, Number.NaN]) {
      expect(ops.removeEdge(doc, bad)).toBe(doc);
      expect(ops.moveStage(doc, bad, 0)).toBe(doc);
      expect(ops.moveRuleCard(doc, bad, 0)).toBe(doc);
      expect(ops.moveTextSection(doc, bad, 0)).toBe(doc);
      expect(ops.updateStage(doc, bad, (s) => ({ ...s, doubles: true }))).toBe(doc);
      expect(ops.updateEdge(doc, bad, (e) => ({ ...e, gate: 'auto' }))).toBe(doc);
      expect(ops.removeStage(doc, bad).doc).toBe(doc);
      expect(ops.duplicateStage(doc, bad).doc).toBe(doc);
    }
  });

  it('500 seeded random operations never throw, repeat a key, break the key pattern or write undefined', () => {
    for (const [seed, start] of [[20261024, classic], [4711, cup], [99, swiss]] as const) {
      const rng = mulberry32(seed);
      let doc: DraftDocument = start();
      for (let step = 0; step < 500; step += 1) {
        const [name, op] = pick(rng, OPERATIONS);
        const before = doc;
        const snapshot = documentSignature(before);
        try {
          doc = op(doc, rng);
        } catch (error) {
          throw new Error(`step ${step} (${name}) threw: ${String(error)}`);
        }
        expect(documentSignature(before), `step ${step} (${name}) mutated its input`).toBe(snapshot);
        assertKeys(doc, `seed ${seed} step ${step} (${name})`);
        expect(hasUndefined(doc), `step ${step} (${name}) wrote a value that is not JSON`).toBe(false);
        expect(doc.stages.length).toBeLessThanOrEqual(MAX_STAGES);
        expect(doc.edges.length).toBeLessThanOrEqual(MAX_EDGES);
      }
    }
  }, 60_000);
});
