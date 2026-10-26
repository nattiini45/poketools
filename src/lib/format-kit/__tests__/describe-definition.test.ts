import { describe, expect, it } from 'vitest';
import { compile } from '../compile';
import { deepFreeze } from '../json';
import {
  computeCoverage,
  definitionToPlainText,
  describeDefinition,
  describeStage,
  type DefinitionDescription,
} from '../engine/describe-definition';
import type { StagePlan } from '../engine/plan';
import { ltext } from '../ltext';
import { classicLeague } from '../presets/classic-league';
import { cup } from '../presets/cup';
import { PRESETS } from '../presets';
import { swissTopCut } from '../presets/swiss-top-cut';
import type { FormatDefinition } from '../types';
import { describeLegacy } from '@/lib/format-studio/legacy/describe-legacy';
import { FIXTURE_LEAGUES } from '@/lib/format-studio/__tests__/fixtures/leagues';
import { legacyCompileEnv } from '@/lib/format-studio/view';

const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/;
// Double-encoding markers written as escapes so the repository's mojibake guard does not match this file.
const MOJIBAKE = /\u00c3|\u00c2|\u00e2\u20ac|\uFFFD/;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, out));
  else if (typeof value === 'object' && value !== null) Object.values(value).forEach((item) => strings(item, out));
  return out;
}

/** The description with every string replaced by a marker, so two languages can be compared by structure. */
function shape(value: unknown): unknown {
  if (typeof value === 'string') return 'S';
  if (Array.isArray(value)) return value.map(shape);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'locale').map(([key, item]) => [key, shape(item)]));
  }
  return value;
}

const SUBJECTS: [string, FormatDefinition, ReturnType<typeof compile> | null][] = [
  ...PRESETS.map(({ id, definition }): [string, FormatDefinition, null] => [`preset ${id}`, definition, null]),
  ...Object.entries(FIXTURE_LEAGUES).map(([name, input]): [string, FormatDefinition, ReturnType<typeof compile>] => {
    const definition = describeLegacy(input);
    return [`league ${name}`, definition, compile(definition, legacyCompileEnv(input.season.participantCount))];
  }),
];

describe.each(SUBJECTS)('%s', (_name, definition, result) => {
  const opts = result === null ? undefined : { plan: result.plan ?? undefined, order: result.graph?.order };
  const en = describeDefinition(definition, 'en', opts);
  const de = describeDefinition(definition, 'de', opts);

  it.each([
    ['en', en],
    ['de', de],
  ] as const)('renders cleanly in %s', (_locale, description) => {
    const all = strings(description);
    expect(all.length).toBeGreaterThan(10);
    for (const text of all) {
      expect(text, 'empty string').not.toBe('');
      expect(text).not.toMatch(PLACEHOLDER);
      expect(text).not.toMatch(MOJIBAKE);
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('null');
    }
    const plain = definitionToPlainText(description);
    expect(plain).not.toMatch(PLACEHOLDER);
    expect(plain).not.toContain('undefined');
  });

  it('has the same structure in both languages and different words', () => {
    expect(shape(de)).toEqual(shape(en));
    expect(de.overview).not.toBe(en.overview);
    expect(de.coverageLine).not.toBe(en.coverageLine);
    expect(de.coverage).toEqual(en.coverage);
  });

  it('has real umlauts in the German text where the words have them', () => {
    expect(definitionToPlainText(de)).toMatch(/[äöüß]/);
  });

  it('is deterministic', () => {
    expect(definitionToPlainText(describeDefinition(definition, 'en', opts))).toBe(definitionToPlainText(en));
  });
});

describe('coverage', () => {
  it('pins the numbers of the three presets', () => {
    expect(computeCoverage(classicLeague)).toEqual({ auto: 11, checked: 1, honor: 1, legacy: 0, total: 13 });
    expect(computeCoverage(cup)).toEqual({ auto: 11, checked: 1, honor: 0, legacy: 0, total: 12 });
    expect(computeCoverage(swissTopCut)).toEqual({ auto: 10, checked: 1, honor: 0, legacy: 0, total: 11 });
  });

  it('writes the coverage line with plural forms, in both languages', () => {
    expect(describeDefinition(classicLeague, 'en').coverageLine).toBe('11 automated, 1 confirmed by an admin, 1 honor rule.');
    expect(describeDefinition(classicLeague, 'de').coverageLine).toBe('11 automatisch, 1 vom Admin bestätigt, 1 Vertrauensregel.');
    const two = clone(classicLeague);
    two.rules.push({ ...two.rules[0], id: 'second' });
    expect(describeDefinition(two, 'en').coverageLine).toContain('2 honor rules');
    expect(describeDefinition(two, 'de').coverageLine).toContain('2 Vertrauensregeln');
  });

  it('lists only the buckets that are not empty', () => {
    expect(describeDefinition(cup, 'en').coverageLine).toBe('11 automated, 1 confirmed by an admin.');
    const bare = clone(cup);
    bare.edges = [];
    expect(describeDefinition(bare, 'en').coverageLine).toBe('11 automated.');
  });

  it('counts a rule card as honor and a module as legacy', () => {
    const def = clone(cup);
    def.rules.push({ ...clone(classicLeague).rules[0], id: 'a' }, { ...clone(classicLeague).rules[0], id: 'b' });
    def.modules.push({ kind: 'module.legacy', adapter: 'epb', facts: [] }, { kind: 'module.legacy', adapter: 'core_liga', facts: [] });
    expect(computeCoverage(def)).toEqual({ auto: 11, checked: 1, honor: 2, legacy: 2, total: 16 });
    const line = describeDefinition(def, 'en').coverageLine;
    expect(line).toBe('11 automated, 1 confirmed by an admin, 2 honor rules, 2 legacy modules.');
  });

  it('counts a selection as checked only under the admin_confirm gate', () => {
    const auto = clone(classicLeague);
    auto.edges[0].gate = 'auto';
    expect(computeCoverage(auto)).toEqual({ auto: 12, checked: 0, honor: 1, legacy: 0, total: 13 });
    const two = clone(classicLeague);
    two.edges[0].select.push({ kind: 'wildcard', n: 1 });
    expect(computeCoverage(two).checked).toBe(2);
  });

  it('counts groups, a named ruleset and a combined view', () => {
    const def = clone(classicLeague);
    def.stages[0].groups = { count: 2, method: 'serpentine' };
    def.stages[1].ruleset = { kind: 'ruleset', id: '00000000-0000-4000-8000-000000000001' };
    def.views.push({ key: 'total', label: ltext('en', 'Total'), stages: ['league', 'playoffs'], metric: 'points', combine: 'sum' });
    expect(computeCoverage(def)).toEqual({ auto: 14, checked: 1, honor: 1, legacy: 0, total: 16 });
  });

  it('counts a Showdown format like a named ruleset', () => {
    const def = clone(classicLeague);
    def.stages[1].ruleset = { kind: 'showdown', format: 'gen9ou' };
    expect(computeCoverage(def)).toEqual({ auto: 12, checked: 1, honor: 1, legacy: 0, total: 14 });
  });

  it('gives the no-rules sentence for an empty definition', () => {
    const empty = { ...clone(classicLeague), stages: [], edges: [], rules: [], modules: [] } satisfies FormatDefinition;
    expect(computeCoverage(empty)).toEqual({ auto: 0, checked: 0, honor: 0, legacy: 0, total: 0 });
    expect(describeDefinition(empty, 'en').coverageLine).toBe('This format has no rules to cover yet.');
    expect(describeDefinition(empty, 'de').coverageLine).toBe('Dieses Format hat noch keine Regeln, die sich abdecken lassen.');
    expect(describeDefinition(empty, 'en').overview).toBe('This format has no stages yet.');
  });
});

describe('stage blocks', () => {
  it('describes a stage with its sentences', () => {
    const stage = describeStage(classicLeague, 'league', 'en');
    expect(stage).not.toBeNull();
    expect(stage?.name).toBe('League phase');
    expect(stage?.summary).toContain('Stage League phase.');
    expect(stage?.participants).toBe('Participants come from the roster, seeded in sign-up order.');
    expect(stage?.pairing).toBe('Everyone plays everyone 2 times.');
    expect(stage?.series).toBe('Matches are best of 1.');
    expect(stage?.scoring).toBe('Points: win 3, loss 0, bye 0.');
    expect(stage?.ruleset).toBe('Teams follow the ruleset of the season.');
    expect(stage?.groups).toBeNull();
    expect(stage?.doubles).toBeNull();
    expect(stage?.expected).toBeNull();
    expect(stage?.rankSteps).toHaveLength(5);
    expect(stage?.rankChain).toContain('points (highest first)');
    expect(stage?.rankChain).toContain('coin flip');
  });

  it('describes a stage in German', () => {
    const stage = describeStage(classicLeague, 'playoffs', 'de');
    expect(stage?.name).toBe('Playoffs');
    expect(stage?.pairing).toBe('K.-o.-System mit einfacher Ausscheidung.');
    expect(stage?.participants).toBe('Die Teilnehmer kommen aus den früheren Stages, in der Reihenfolge des Weiterkommens.');
    expect(stage?.rankChain).toBeNull();
  });

  it('names the stages around an advancement rule and adds the seeding and gate words', () => {
    const league = describeStage(classicLeague, 'league', 'en');
    const playoffs = describeStage(classicLeague, 'playoffs', 'en');
    const sentence =
      'Players advance from League phase to Playoffs. Selection: top 4. Seeded by final rank. An admin confirms the result before players move on.';
    expect(league?.outgoing).toEqual([sentence]);
    expect(league?.incoming).toEqual([]);
    expect(playoffs?.incoming).toEqual([sentence]);
    expect(describeDefinition(classicLeague, 'en').advancement).toEqual([sentence]);
    expect(describeDefinition(cup, 'en').advancement[0]).toContain('Seeded across the groups.');
    const auto = clone(classicLeague);
    auto.edges[0].gate = 'auto';
    expect(describeDefinition(auto, 'de').advancement[0]).toContain('Die Spieler kommen automatisch weiter.');
  });

  it('describes groups, doubles and expected counts of the roster', () => {
    const def = clone(cup);
    def.stages[0].doubles = true;
    def.stages[0].players_per_match = 4;
    if (def.stages[0].participants.from === 'roster') def.stages[0].participants.expected_count = 16;
    const stage = describeStage(def, 'groups', 'en');
    expect(stage?.groups).toBe('Players are split into 4 groups. Assignment: Serpentine.');
    expect(stage?.doubles).toBe('Played as doubles. 4 players take part in each match.');
    expect(stage?.participants).toContain('seeded by rating.');
    expect(stage?.participants).toContain('16 participants are expected.');
  });

  it('gives null for a stage that does not exist', () => {
    expect(describeStage(classicLeague, 'nope', 'en')).toBeNull();
    expect(describeStage(classicLeague, '', 'de')).toBeNull();
    expect(describeStage(classicLeague, 'constructor', 'de')).toBeNull();
  });

  it('names the Showdown format of a stage in both languages', () => {
    const def = clone(classicLeague);
    def.stages[1].ruleset = { kind: 'showdown', format: 'gen9vgc' };
    expect(describeStage(def, 'playoffs', 'en')?.ruleset).toBe('Teams follow the Showdown format Gen 9 VGC.');
    expect(describeStage(def, 'playoffs', 'de')?.ruleset).toBe('Die Teams folgen dem Showdown-Format Gen 9 VGC.');
  });

  it('names a stored ruleset and falls back to the generic sentence', () => {
    const def = clone(classicLeague);
    def.stages[1].ruleset = { kind: 'ruleset', id: '00000000-0000-4000-8000-000000000001' };
    const rulesets = [{ id: '00000000-0000-4000-8000-000000000001', name: 'Playoff rules' }];
    expect(describeStage(def, 'playoffs', 'en', { rulesets })?.ruleset).toBe('Teams follow the ruleset Playoff rules.');
    expect(describeStage(def, 'playoffs', 'de', { rulesets })?.ruleset).toBe('Die Teams folgen dem Regelwerk Playoff rules.');
    expect(describeStage(def, 'playoffs', 'en')?.ruleset).toBe('Teams follow a specific ruleset.');
    expect(describeStage(def, 'playoffs', 'en', { rulesets: [{ id: 'other', name: 'X' }] })?.ruleset).toBe('Teams follow a specific ruleset.');
  });
});

describe('plan sentences', () => {
  const plan = (over: Partial<StagePlan> & { key: string }): StagePlan => ({
    participants: null,
    groupSize: null,
    rounds: null,
    bracketSize: null,
    byes: null,
    mappedBracketType: 'round_robin',
    ...over,
  });

  it('is null without a plan and with an entry that knows nothing', () => {
    expect(describeStage(classicLeague, 'league', 'en')?.expected).toBeNull();
    expect(describeStage(classicLeague, 'league', 'en', { plan: [plan({ key: 'league' })] })?.expected).toBeNull();
    expect(describeStage(classicLeague, 'league', 'en', { plan: [plan({ key: 'other', participants: { min: 4, max: 4 } })] })?.expected).toBeNull();
  });

  it('writes the participants, rounds, bracket and byes of the compiler plan', () => {
    const result = compile(classicLeague, { ...legacyCompileEnv(8) });
    const opts = { plan: result.plan ?? [] };
    expect(describeStage(classicLeague, 'league', 'en', opts)?.expected).toBe('Expected: 8 participants. Plays 14 rounds.');
    expect(describeStage(classicLeague, 'playoffs', 'en', opts)?.expected).toBe(
      'Expected: 4 participants. Plays 2 rounds. The bracket has 4 places.',
    );
    expect(describeStage(classicLeague, 'playoffs', 'de', opts)?.expected).toBe(
      'Erwartet: 4 Teilnehmer. Gespielt werden 2 Runden. Der Turnierbaum hat 4 Plätze.',
    );
  });

  it('uses the singular forms for one round, one participant and one bye', () => {
    const one = describeStage(classicLeague, 'playoffs', 'en', {
      plan: [plan({ key: 'playoffs', participants: { min: 1, max: 1 }, rounds: { min: 1, max: 1 }, bracketSize: 2, byes: 1 })],
    });
    expect(one?.expected).toBe('Expected: 1 participant. Plays 1 round. The bracket has 2 places. 1 player gets a bye.');
    const many = describeStage(classicLeague, 'playoffs', 'en', {
      plan: [plan({ key: 'playoffs', participants: { min: 3, max: 3 }, rounds: { min: 2, max: 2 }, bracketSize: 4, byes: 1 })],
    });
    expect(many?.expected).toBe('Expected: 3 participants. Plays 2 rounds. The bracket has 4 places. 1 player gets a bye.');
    const byes = describeStage(classicLeague, 'playoffs', 'de', { plan: [plan({ key: 'playoffs', byes: 2 })] });
    expect(byes?.expected).toBe('2 Spieler erhalten ein Freilos.');
  });

  it('writes a range when the count is not exact and leaves out zero byes', () => {
    const stage = describeStage(classicLeague, 'league', 'en', {
      plan: [plan({ key: 'league', participants: { min: 4, max: 8 }, rounds: { min: 3, max: 7 }, byes: 0 })],
    });
    expect(stage?.expected).toBe('Expected: 4 to 8 participants. Plays 3 to 7 rounds.');
  });
});

describe('order', () => {
  it('follows the declaration order without opts.order', () => {
    expect(describeDefinition(cup, 'en').stages.map((s) => s.key)).toEqual(['groups', 'knockout']);
  });

  it('follows opts.order and appends the stages it misses', () => {
    expect(describeDefinition(cup, 'en', { order: ['knockout', 'groups'] }).stages.map((s) => s.key)).toEqual(['knockout', 'groups']);
    expect(describeDefinition(cup, 'en', { order: ['knockout'] }).stages.map((s) => s.key)).toEqual(['knockout', 'groups']);
    expect(describeDefinition(cup, 'en', { order: [] }).stages.map((s) => s.key)).toEqual(['groups', 'knockout']);
  });

  it('ignores unknown and repeated keys in opts.order', () => {
    const order = ['ghost', 'knockout', 'knockout', 'groups', 'groups'];
    expect(describeDefinition(cup, 'en', { order }).stages.map((s) => s.key)).toEqual(['knockout', 'groups']);
  });

  it('lists each stage once even when a key is declared twice', () => {
    const def = clone(cup);
    def.stages.push({ ...clone(cup.stages[1]), name: ltext('en', 'Copy') });
    expect(describeDefinition(def, 'en', { order: ['knockout'] }).stages.map((s) => s.name)).toEqual(['Knockout', 'Group stage', 'Copy']);
  });
});

describe('rule cards, views, modules and sections', () => {
  it('describes a rule card with its verification, timing and visibility', () => {
    const rule = describeDefinition(classicLeague, 'en').rules[0];
    expect(rule).toEqual({
      id: 'fair_play',
      text: 'Manual rule: Players agree on a match date within the week of the round.',
      verify: 'An admin checks it.',
      when: 'Applies once per season.',
      visibleToPlayers: true,
    });
    const def = clone(classicLeague);
    Object.assign(def.rules[0], { verify: 'player_attest', when: 'per_matchday', visible_to_players: false, scope: { kind: 'stage', stage: 'playoffs' } });
    const changed = describeDefinition(def, 'de').rules[0];
    expect(changed.verify).toBe('Die Spieler bestätigen sie selbst.');
    expect(changed.when).toBe('Gilt an jedem Spieltag. Nur in Playoffs.');
    expect(changed.visibleToPlayers).toBe(false);
    expect(definitionToPlainText(describeDefinition(def, 'en'))).toContain('Hidden from players.');
  });

  it('describes a combined view', () => {
    const def = clone(classicLeague);
    def.views.push({ key: 'total', label: ltext('en', 'Total', 'Gesamt'), stages: ['league', 'playoffs'], metric: 'points', combine: 'sum' });
    expect(describeDefinition(def, 'en').views).toEqual(['Combined table Total: points added up over 2 stages.']);
    expect(describeDefinition(def, 'de').views).toEqual(['Gesamttabelle Gesamt: Punkte aufsummiert über 2 Stages.']);
  });

  it('describes a module with readable fact values', () => {
    const input = FIXTURE_LEAGUES.epb_two_stage;
    const def = describeLegacy(input);
    const en = describeDefinition(def, 'en').modules[0];
    expect(en.adapter).toBe('epb');
    expect(en.label).toBe('Evolution Point Buy');
    expect(en.summary).toBe('Legacy module Evolution Point Buy with 22 facts.');
    const facts = new Map(en.facts.map((f) => [f.key, f]));
    expect(facts.get('redraft_open')).toEqual({ key: 'redraft_open', label: 'Redraft phase open', value: 'yes' });
    expect(facts.get('tera_stage2')?.value).toBe('only Tera types the Pokémon already has');
    expect(facts.get('tera_stage1')?.value).toBe('any');
    expect(facts.get('draft_budget')?.value).toBe('120');
    expect(facts.get('comeback_earn_window')?.value).toBe('whole season');
    const de = new Map(describeDefinition(def, 'de').modules[0].facts.map((f) => [f.key, f]));
    expect(de.get('redraft_open')?.value).toBe('ja');
    expect(de.get('tera_stage3')?.value).toBe('nicht erlaubt');
    expect(de.get('tera_stage2')?.value).toBe('nur Tera-Typen, die das Pokémon bereits hat');
    expect(de.get('tera_stage1')?.label).toBe('Terakristallisieren für Pokémon der Stufe 1');
    for (const stage of ['tera_stage1', 'tera_stage2', 'tera_stage3']) expect(de.get(stage)?.label).not.toMatch(/Wesen/);
    expect(computeCoverage(def).legacy).toBe(1);
  });

  it('keeps sections with the name of their stage', () => {
    const description = describeDefinition(describeLegacy(FIXTURE_LEAGUES.singles_groups_playoffs), 'de');
    expect(description.sections).toEqual([
      {
        id: 'bo_stage_2',
        title: 'Spiellängen in Playoffs',
        body: 'Third Place wird im Best-of-3-Modus gespielt.',
        stage: 'Playoffs',
      },
    ]);
    expect(describeDefinition(classicLeague, 'en').sections[0]).toEqual({
      id: 'overview',
      title: 'How this league works',
      body: 'Everyone plays everyone twice. The top four of the table continue in the playoffs.',
      stage: null,
    });
  });
});

describe('language fallback', () => {
  it('shows a name in the language that has it', () => {
    const def = clone(classicLeague);
    def.stages[0].name = { base: 'en', en: { v: 'League only', s: 'human' } };
    expect(describeDefinition(def, 'de').stages[0].name).toBe('League only');
    expect(describeDefinition(def, 'de').title).toBe('Klassische Liga');
  });
});

describe('never throws', () => {
  const GARBAGE: unknown[] = [
    undefined,
    null,
    0,
    'text',
    [],
    {},
    { stages: 'x', edges: 5, rules: {}, modules: null, views: 'v', text: 3 },
    { stages: [null, 5, 'a', [], {}], edges: [null, { from: 1, to: {} }, { select: 'x' }], rules: [null, {}], modules: [{ facts: 'x' }, {}], views: [{}] },
    { identity: { name: 1 }, stages: [{ key: 'a', name: 5, participants: 3, pairing: 'x', series: [], scoring: null, rank: [1, {}, { kind: 5 }], groups: [] }] },
    { stages: [{ key: 'a' }], edges: [{ from: 'a', to: 'b', select: [null, {}], seeding: 7, gate: [] }], text: { sections: [1, { id: 5, stage: 'zz' }] } },
  ];

  it.each(GARBAGE.map((value, index) => [index, value] as const))('survives garbage input %i', (_index, value) => {
    const def = value as FormatDefinition;
    expect(() => computeCoverage(def)).not.toThrow();
    for (const locale of ['en', 'de'] as const) {
      const description = describeDefinition(def, locale, { plan: [null, {}, { key: 'a', participants: 'x' }] as never, order: [5, 'a'] as never, rulesets: [null, { id: 1 }] as never });
      expect(typeof definitionToPlainText(description)).toBe('string');
      expect(typeof description.title).toBe('string');
      expect(Array.isArray(description.stages)).toBe(true);
      expect(() => describeStage(def, 'a', locale)).not.toThrow();
    }
  });

  it('gives the untitled and no-stage sentences for a value that is not a definition', () => {
    const description = describeDefinition(null as never, 'en');
    expect(description.title).toBe('Untitled format');
    expect(description.overview).toBe('This format has no stages yet.');
    expect(description.coverage.total).toBe(0);
    expect(description.stages).toEqual([]);
  });
});

describe('purity', () => {
  it('does not mutate a frozen definition or a frozen plan', () => {
    const result = compile(classicLeague, legacyCompileEnv(8));
    expect(Object.isFrozen(result.definition)).toBe(true);
    const frozenDefinition = result.definition as FormatDefinition;
    const description = describeDefinition(frozenDefinition, 'en', { plan: result.plan ?? [], order: result.graph?.order });
    expect(description.stages).toHaveLength(2);
    expect(() => describeStage(deepFreeze(clone(cup)), 'groups', 'de')).not.toThrow();
    expect(() => describeDefinition(deepFreeze(describeLegacy(FIXTURE_LEAGUES.epb_two_stage)), 'de')).not.toThrow();
  });

  it('returns plain data', () => {
    const description: DefinitionDescription = describeDefinition(cup, 'en');
    expect(description).toStrictEqual(JSON.parse(JSON.stringify(description)));
  });
});

describe('definitionToPlainText', () => {
  it('joins title, overview, stages, advancement, rules, sections and the coverage line under catalog headings', () => {
    const text = definitionToPlainText(describeDefinition(classicLeague, 'en'));
    const lines = text.split('\n');
    expect(lines[0]).toBe('Classic league');
    expect(lines[1]).toBe('A double round robin, then a knockout for the top four.');
    expect(lines).toContain('Stages');
    expect(lines).toContain('Advancement');
    expect(lines).toContain('Rules');
    expect(lines).toContain('Notes');
    expect(lines).toContain('Coverage');
    expect(lines[lines.length - 1]).toBe('11 automated, 1 confirmed by an admin, 1 honor rule.');
    expect(lines).not.toContain('Legacy modules');
  });

  it('writes the module facts as label and value under the module heading', () => {
    const text = definitionToPlainText(describeDefinition(describeLegacy(FIXTURE_LEAGUES.draft_double_elim), 'en'));
    expect(text).toContain('Legacy modules\n- Legacy draft\n  Legacy module Legacy draft with 4 facts.\n  Pick limit for tier S: 1');
  });

  it('uses the German headings', () => {
    const lines = definitionToPlainText(describeDefinition(classicLeague, 'de')).split('\n');
    expect(lines).toEqual(expect.arrayContaining(['Stages', 'Weiterkommen', 'Regeln', 'Hinweise', 'Abdeckung']));
  });
});
