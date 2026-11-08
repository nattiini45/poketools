import { describe, expect, it } from 'vitest';
import type { JsonValue, PatchOp } from '@/lib/studio-core/patch';
import { applyPatch } from '@/lib/studio-core/patch';
import { compile } from '../compile';
import { compile as compileBrowser } from '../compile.browser';
import { checkPublicRelationReads, hasHiddenSide, relationsRead } from '../engine/checks-privacy';
import type { Diagnostic } from '../engine/diagnostics';
import { renderDiagnostic } from '../engine/render';
import { classicLeague } from '../presets/classic-league';
import { cup } from '../presets/cup';
import { swissTopCut } from '../presets/swiss-top-cut';
import { wichtelcup } from '../presets/wichtelcup';
import type { FormatDefinition } from '../types';
import { giftExchangeDoc, wichtelcupDoc } from './fixtures/docs';

const CODE = 'public_expr_reads_hidden_relation';

const str = (v: string) => ({ k: 'str', v });
/** `rel(key, "a", "b")`: literal operands type-check in every environment. */
const rel = (relation: string, a = 'a', b = 'b') => ({ k: 'rel', relation, a: str(a), b: str(b) });

function patched(doc: unknown, ops: readonly PatchOp[]): unknown {
  const copy = JSON.parse(JSON.stringify(doc)) as JsonValue;
  const result = applyPatch(copy, ops);
  if (!result.ok) throw new Error(`patch failed at op ${result.index}: ${result.reason}`);
  return result.value;
}

const privacy = (diagnostics: readonly Diagnostic[]) => diagnostics.filter((d) => d.code === CODE);

/** The gift exchange (hidden Secret Santa, default visibility) with one expression swapped for `rel('santa', ...)`. */
function gift(ops: readonly PatchOp[]) {
  return compile(patched(giftExchangeDoc(), ops));
}

const THRESHOLD_STAGE_OPS: PatchOp[] = [
  {
    op: 'add',
    path: '/stages/-',
    value: {
      key: 'finals',
      name: { base: 'en', en: { v: 'Finals', s: 'human' } },
      participants: { from: 'edges', seeding: 'edge_order' },
      pairing: { kind: 'single_elim' },
      series: { best_of: 1 },
      scoring: { win: 1 },
    },
  },
  {
    op: 'add',
    path: '/edges',
    value: [{ key: 'up', from: 'main', to: 'finals', select: [{ kind: 'threshold', when: rel('santa') }] }],
  },
];

describe('a public rule reading a relation with a hidden side', () => {
  const sites: ReadonlyArray<{
    id: string;
    ops: PatchOp[];
    pointer: string;
    params: Record<string, string>;
  }> = [
    {
      id: 'an attribute assignment',
      ops: [{ op: 'replace', path: '/attributes/2/assign', value: { kind: 'expr', expr: rel('santa') } }],
      pointer: '/attributes/2/assign/expr',
      params: { context: 'attr_assign', owner_kind: 'attr', owner: 'veteran' },
    },
    {
      id: 'a metric',
      ops: [{ op: 'replace', path: '/metrics/0/expr', value: { k: 'if', cond: rel('santa'), then: { k: 'num', v: 1 }, else: { k: 'num', v: 0 } } }],
      pointer: '/metrics/0/expr',
      params: { context: 'metric', owner_kind: 'metric', owner: 'gift_score' },
    },
    {
      id: 'a progression step',
      ops: [{ op: 'replace', path: '/metrics/1/steps/0/when', value: rel('santa') }],
      pointer: '/metrics/1/steps/0/when',
      params: { context: 'track_step', owner_kind: 'metric', owner: 'milestones' },
    },
    {
      id: 'a pairing filter',
      ops: [{ op: 'replace', path: '/stages/0/pairing', value: { kind: 'filter', base: { kind: 'swiss', rounds: 3 }, allow: { k: 'not', a: rel('santa') } } }],
      pointer: '/stages/0/pairing/allow',
      params: { context: 'pair_filter', owner_kind: 'stage', owner: 'main' },
    },
    {
      id: 'a stage end condition',
      ops: [{ op: 'add', path: '/stages/0/end_when', value: { kind: 'expr', when: rel('santa') } }],
      pointer: '/stages/0/end_when/when',
      params: { context: 'stage_end', owner_kind: 'stage', owner: 'main' },
    },
    {
      id: 'an advancement threshold',
      ops: THRESHOLD_STAGE_OPS,
      pointer: '/edges/0/select/0/when',
      params: { context: 'threshold', owner_kind: 'edge', owner: 'up' },
    },
    {
      id: 'an event condition',
      ops: [{ op: 'replace', path: '/rules/1/when', value: rel('santa') }],
      pointer: '/rules/1/when',
      params: { context: 'event_condition', owner_kind: 'rule', owner: 'midway' },
    },
    {
      id: 'an effect target',
      ops: [{ op: 'replace', path: '/rules/1/effects/0/to/where', value: rel('santa') }],
      pointer: '/rules/1/effects/0/to/where',
      params: { context: 'effect_target', owner_kind: 'rule', owner: 'midway' },
    },
  ];

  it.each(sites)('warns for $id, naming the relation and the rule, and does not block', ({ ops, pointer, params }) => {
    const result = gift(ops);
    const hits = privacy(result.diagnostics);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: 'warning', json_pointer: pointer, params: { relation: 'santa', ...params } });
    expect(result.ok).toBe(true);
    expect(result.definition).not.toBeNull();
  });

  it.each(sites)('gives the same warning in the browser compile for $id', ({ ops }) => {
    const input = patched(giftExchangeDoc(), ops);
    expect(compileBrowser(input).diagnostics).toEqual(compile(input).diagnostics);
  });

  it('stays quiet about the same expression when it is private to one viewer or to admins', () => {
    const choose = (giftExchangeDoc().rules as { kind: string; id?: string }[]).findIndex((r) => r.id === 'choose_gift');
    const vets = (giftExchangeDoc().rules as { kind: string; id?: string }[]).findIndex((r) => r.id === 'vets');
    expect(choose).toBeGreaterThan(0);
    expect(vets).toBeGreaterThan(0);
    const result = gift([
      // The picker of the player who acts, an admin-only check and a team rule (the verdict goes to the team's owner).
      { op: 'replace', path: `/rules/${choose}/steps/0/where`, value: rel('santa') },
      { op: 'replace', path: `/rules/${vets}/source/when`, value: rel('santa') },
    ]);
    expect(privacy(result.diagnostics)).toEqual([]);
    expect(result.ok).toBe(true);

    const team = compile(patched(wichtelcupDoc(), [{ op: 'replace', path: '/stages/0/constraints/5/when', value: rel('santa') }]));
    expect(privacy(team.diagnostics).map((d) => d.json_pointer)).toEqual(['/stages/0/pairing/allow']);
  });

  it('warns once per relation in an expression, however often it is read', () => {
    const twice = { k: 'and', args: [rel('santa'), { k: 'not', a: rel('santa', 'b', 'a') }] };
    const result = gift([{ op: 'replace', path: '/rules/1/when', value: twice }]);
    expect(privacy(result.diagnostics)).toHaveLength(1);
  });

  it('warns for each hidden relation an expression reads', () => {
    const result = compile(
      patched(giftExchangeDoc(), [
        { op: 'add', path: '/relations/-', value: { key: 'buddy', label: { base: 'en', en: { v: 'Buddy', s: 'human' } }, shape: 'pairs' } },
        { op: 'replace', path: '/rules/1/when', value: { k: 'or', args: [rel('santa'), rel('buddy')] } },
      ]),
    );
    expect(privacy(result.diagnostics).map((d) => d.params.relation)).toEqual(['santa', 'buddy']);
  });

  it('warns when only one side is hidden or own, and not when both sides are public', () => {
    const rule = { op: 'replace', path: '/rules/1/when', value: rel('santa') } as const;
    const visibility = (from: string, to: string): PatchOp => ({ op: 'add', path: '/relations/0/visibility', value: { from, to } });
    expect(privacy(gift([rule, visibility('all', 'hidden')]).diagnostics)).toHaveLength(1);
    expect(privacy(gift([rule, visibility('own', 'all')]).diagnostics)).toHaveLength(1);
    expect(privacy(gift([rule, visibility('hidden', 'own')]).diagnostics)).toHaveLength(1);
    expect(privacy(gift([rule, visibility('all', 'all')]).diagnostics)).toEqual([]);
  });

  it('says nothing about a relation that does not exist (that is its own error)', () => {
    const result = gift([{ op: 'replace', path: '/rules/1/when', value: rel('nowhere') }]);
    expect(privacy(result.diagnostics)).toEqual([]);
    expect(result.diagnostics.some((d) => d.code === 'expr_invalid')).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('flags the Wichtelcup fixture, whose pairing filter keeps givers away from their recipients', () => {
    const hits = privacy(compile(wichtelcupDoc()).diagnostics);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: 'warning', json_pointer: '/stages/0/pairing/allow', params: { relation: 'santa', owner: 'cup' } });
  });

  it('leaves every built-in preset without this warning', () => {
    for (const preset of [classicLeague, cup, swissTopCut, wichtelcup]) {
      expect(privacy(compile(preset).diagnostics), preset.identity.name.en?.v).toEqual([]);
    }
  });

  it('renders in English and German with the relation and the rule named', () => {
    const result = compile(wichtelcupDoc());
    const def = result.definition as FormatDefinition;
    const hit = privacy(result.diagnostics)[0];
    const en = renderDiagnostic(hit, 'en', def);
    const de = renderDiagnostic(hit, 'de', def);
    expect(en).toContain('santa');
    expect(en).toContain('Cup');
    expect(en).toContain('a pairing filter');
    expect(en).toContain('public');
    expect(de).toContain('santa');
    expect(de).toContain('bei einem Paarungsfilter');
    expect(de).toContain('öffentlich');
    for (const text of [en, de]) expect(text).not.toMatch(/\{[A-Za-z_]+\}|undefined/);

    const rule = privacy(gift([{ op: 'replace', path: '/rules/1/when', value: rel('santa') }]).diagnostics)[0];
    expect(renderDiagnostic(rule, 'en')).toContain('midway reads the relation santa in an event condition');
    expect(renderDiagnostic(rule, 'de')).toContain('midway liest die Beziehung santa bei einer Ereignisbedingung');
  });

  it('reads the definition only: calling the check twice gives the same answer', () => {
    const def = compile(wichtelcupDoc()).definition as FormatDefinition;
    expect(checkPublicRelationReads(def)).toEqual(checkPublicRelationReads(def));
  });
});

describe('relationsRead and hasHiddenSide', () => {
  it('lists the relations of rel() nodes anywhere in a tree, once each, in first-use order', () => {
    const tree = { k: 'if', cond: { k: 'and', args: [rel('b'), { k: 'not', a: rel('a') }] }, then: rel('b'), else: { k: 'num', v: 1 } };
    expect(relationsRead(tree)).toEqual(['b', 'a']);
    expect(relationsRead({ k: 'num', v: 1 })).toEqual([]);
    expect(relationsRead(null)).toEqual([]);
  });

  it('survives a very deep hand-built tree without recursing', () => {
    let node: unknown = rel('deep');
    for (let i = 0; i < 20_000; i += 1) node = { k: 'not', a: node };
    expect(relationsRead(node)).toEqual(['deep']);
  });

  it('calls a relation hidden unless both sides are public', () => {
    expect(hasHiddenSide({ visibility: { from: 'hidden', to: 'own' } })).toBe(true);
    expect(hasHiddenSide({ visibility: { from: 'all', to: 'own' } })).toBe(true);
    expect(hasHiddenSide({ visibility: { from: 'all', to: 'all' } })).toBe(false);
  });
});
