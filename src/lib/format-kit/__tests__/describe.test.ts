import { describe, expect, it } from 'vitest';
import type { Locale } from '@/i18n/config';
import { describePrimitive } from '../registry/describe';
import { AVAILABLE_KINDS, RESERVED_KINDS, type PrimitiveKind } from '../registry/kinds';
import { lt, sampleNodes } from './fixtures/docs';

const LOCALES: Locale[] = ['en', 'de'];
// Double-encoding markers, written as escapes so this file is not itself a hit for the mojibake scan.
const MOJIBAKE = /\u00c3|\u00e2\u20ac|\u00c2|\ufffd/;

function expectClean(text: string, label: string): void {
  expect(text.trim().length, label).toBeGreaterThan(0);
  expect(text, label).not.toMatch(/[{}]/);
  expect(text, label).not.toContain('undefined');
  expect(text, label).not.toContain('NaN');
  expect(text, label).not.toContain('[object');
  expect(text, label).not.toMatch(MOJIBAKE);
}

describe('describePrimitive: a representative node of every available kind', () => {
  const samples = sampleNodes();

  for (const kind of AVAILABLE_KINDS) {
    it(`${kind}: a clean sentence in both languages, and German differs`, () => {
      const en = describePrimitive(kind, samples[kind], 'en');
      const de = describePrimitive(kind, samples[kind], 'de');
      expectClean(en, `${kind} en`);
      expectClean(de, `${kind} de`);
      expect(de, kind).not.toBe(en);
      // A real description, not the bare label of the kind.
      expect(en, kind).not.toBe(describePrimitive(kind, undefined, 'en'));
    });
  }

  it('shows the node values', () => {
    expect(describePrimitive('advance.top_n', { kind: 'top_n', n: 4 }, 'en')).toBe('The top 4 advance.');
    expect(describePrimitive('advance.top_n', { kind: 'top_n', n: 4 }, 'de')).toBe('Die besten 4 kommen weiter.');
    expect(describePrimitive('advance.per_group', { kind: 'per_group', n: 2 }, 'en')).toBe('The top 2 of each group advance.');
    expect(describePrimitive('series.rule', { best_of: 3, allow_draw: false, overrides: [] }, 'en')).toBe('Matches are best of 3.');
    expect(describePrimitive('score.match', { win: 3, loss: 0, bye: 1 }, 'en')).toBe('Points: win 3, loss 0, bye 1.');
    expect(describePrimitive('score.match', { win: 3, loss: 0, bye: 1 }, 'de')).toBe('Punkte: Sieg 3, Niederlage 0, Freilos 1.');
    expect(describePrimitive('rank.coin_flip', { kind: 'coin_flip' }, 'en')).toBe('A seeded coin flip settles remaining ties.');
  });

  it('chooses the singular form for one stage in a combined table', () => {
    const view = (stages: string[]) => ({ key: 'total', label: lt('Total', 'Gesamt'), metric: 'points', stages, combine: 'sum' });
    expect(describePrimitive('standings.view', view(['a']), 'en')).toBe('Combined table Total: points added up over 1 stage.');
    expect(describePrimitive('standings.view', view(['a', 'b']), 'en')).toBe('Combined table Total: points added up over 2 stages.');
    expect(describePrimitive('standings.view', view(['a']), 'de')).toBe('Gesamttabelle Gesamt: Punkte aufsummiert über 1 Stage.');
    expect(describePrimitive('standings.view', view(['a', 'b']), 'de')).toBe('Gesamttabelle Gesamt: Punkte aufsummiert über 2 Stages.');
  });

  it('chooses the plural form by count: legs 1, 2 and 4', () => {
    const legs = (n: number, locale: Locale) => describePrimitive('pairing.round_robin', { kind: 'round_robin', legs: n, mirror_legs: true }, locale);
    expect(legs(1, 'en')).toBe('Everyone plays everyone once.');
    expect(legs(2, 'en')).toBe('Everyone plays everyone 2 times.');
    expect(legs(4, 'en')).toBe('Everyone plays everyone 4 times.');
    expect(legs(1, 'de')).toBe('Jeder spielt einmal gegen jeden.');
    expect(legs(2, 'de')).toBe('Jeder spielt 2-mal gegen jeden.');
    expect(legs(4, 'de')).toBe('Jeder spielt 4-mal gegen jeden.');
  });

  it('picks the variant sentence', () => {
    const d = (kind: PrimitiveKind, node: unknown) => describePrimitive(kind, node, 'en');
    expect(d('pairing.swiss', { kind: 'swiss', rounds: 'auto', avoid_repeats: true })).toContain('number of rounds follows');
    expect(d('pairing.swiss', { kind: 'swiss', rounds: 1, avoid_repeats: true })).toBe('Swiss system over 1 round.');
    expect(d('pairing.swiss', { kind: 'swiss', rounds: 5, avoid_repeats: true })).toBe('Swiss system over 5 rounds.');
    expect(d('pairing.single_elim', { kind: 'single_elim', third_place: true })).toContain('third-place');
    expect(d('pairing.single_elim', { kind: 'single_elim', third_place: false })).not.toContain('third-place');
    expect(d('pairing.double_elim', { kind: 'double_elim', bracket_reset: true })).toContain('reset');
    expect(d('team.ruleset', { kind: 'ruleset', id: '123e4567-e89b-42d3-a456-426614174000' })).toBe('Teams follow a specific ruleset.');
    expect(d('team.ruleset', { kind: 'preset', preset: 'gen9ou' })).toBe('Teams follow the rule preset Gen 9 OU.');
    expect(d('team.ruleset', { kind: 'preset', preset: 'gen9natdexdraft' })).toBe('Teams follow the rule preset Gen 9 NatDex Draft.');
    expect(d('team.ruleset', { kind: 'preset', preset: 'gen99xx' })).toBe('Teams follow the rule preset gen99xx.');
    expect(describePrimitive('team.ruleset', { kind: 'preset', preset: 'gen9doublesou' }, 'de')).toBe('Die Teams folgen dem Regel-Preset Gen 9 Doubles OU.');
    expect(d('advance.manual_list', { kind: 'manual_list' })).toBe('An admin picks the players by hand.');
    expect(d('advance.manual_list', { kind: 'manual_list', count: 1 })).toBe('An admin picks 1 player by hand.');
    expect(d('advance.top_n', { kind: 'top_n', n: 1 })).toBe('The first-placed player advances.');
    expect(d('theme.hint', { world: 'auto' })).toContain('automatically');
    expect(d('theme.hint', { world: 'forest' })).toBe('The world theme is forest.');
    expect(d('series.rule', { best_of: 3, overrides: [{}, {}] })).toBe('Matches are best of 3; 2 rounds use a different length.');
    expect(d('module.legacy', { kind: 'module.legacy', adapter: 'epb', facts: [] })).toContain('0 facts');
  });

  it('describes lists with the list formatter', () => {
    const edge = describePrimitive('advance.rule', sampleNodes()['advance.rule'], 'en');
    expect(edge).toBe('Players advance from groups to swiss. Selection: top 4 and best 2 of the rest.');
    expect(describePrimitive('advance.rule', sampleNodes()['advance.rule'], 'de')).toBe(
      'Spieler kommen von groups nach swiss weiter. Auswahl: die besten 4 und die besten 2 der übrigen.',
    );
    const stage = describePrimitive('stage.define', sampleNodes()['stage.define'], 'en');
    expect(stage).toContain('Stage League.');
    expect(stage).toContain('Everyone plays everyone 2 times.');
    expect(stage).toContain('Matches are best of 1.');
    expect(stage).toContain('Standings are ranked by: points (highest first), head-to-head (mini table), kill differential (highest first) and coin flip.');
  });

  it('prints a threshold condition', () => {
    const text = describePrimitive('advance.threshold', sampleNodes()['advance.threshold'], 'en');
    expect(text).toContain('Everyone who meets the condition');
    expect(text).toContain('points >= 6');
  });

  it('resolves LText in the viewer language and falls back per the order', () => {
    const rule = (text: unknown) => ({ kind: 'rule.custom', id: 'r', text });
    expect(describePrimitive('rule.custom', rule(lt('Be kind', 'Seid nett')), 'de')).toBe('Manuelle Regel: Seid nett');
    expect(describePrimitive('rule.custom', rule(lt('Be kind', 'Seid nett')), 'en')).toBe('Manual rule: Be kind');
    expect(describePrimitive('rule.custom', rule(lt('Only English')), 'de')).toBe('Manuelle Regel: Only English');
  });

  it('shows unknown metric keys as written and known ones translated', () => {
    expect(describePrimitive('rank.metric', { kind: 'metric', metric: 'charisma', direction: 'asc' }, 'en')).toBe('Ranked by charisma, lowest first.');
    expect(describePrimitive('rank.metric', { kind: 'metric', metric: 'wins', direction: 'desc' }, 'de')).toBe('Gereiht wird nach der Kennzahl Siege (höchster Wert zuerst).');
    expect(describePrimitive('rank.metric', { kind: 'metric', metric: 'constructor', direction: 'asc' }, 'en')).toContain('constructor');
  });
});

describe('describePrimitive: labels and robustness', () => {
  it('an unknown kind returns its own text', () => {
    expect(describePrimitive('nope.nothing' as PrimitiveKind, {}, 'en')).toBe('nope.nothing');
    expect(describePrimitive('constructor' as PrimitiveKind, {}, 'de')).toBe('constructor');
    expect(describePrimitive('__proto__' as PrimitiveKind, {}, 'de')).toBe('__proto__');
  });

  it('a reserved kind returns its label and the availability text', () => {
    for (const kind of RESERVED_KINDS) {
      const en = describePrimitive(kind, { anything: true }, 'en');
      const de = describePrimitive(kind, undefined, 'de');
      expectClean(en, kind);
      expectClean(de, kind);
      expect(en).toContain('(Not available yet)');
      expect(de).toContain('(Noch nicht verfügbar)');
    }
    expect(describePrimitive('acquire.draft', null, 'en')).toBe('Draft (Not available yet)');
  });

  it('describes the Phase 4 kinds with their values, in both languages', () => {
    const s = sampleNodes();
    const text = (kind: PrimitiveKind, locale: Locale) => describePrimitive(kind, s[kind], locale);
    expect(text('pairing.bipartite', 'en')).toBe(
      'Bipartite pairing by house over 3 rounds: ember play tide and grove. Opponents never repeat.',
    );
    expect(text('pairing.bipartite', 'de')).toBe(
      'Zweiseitige Paarung nach house über 3 Runden: ember spielen gegen tide und grove. Gegner wiederholen sich nie.',
    );
    expect(text('pairing.filter', 'en')).toBe(
      'Swiss system over 4 rounds. A pair is allowed only when not rel(santa, a, b).',
    );
    expect(text('pairing.challenge', 'en')).toContain('Challenge pairing over 6 rounds. A player may challenge up to 3 places above them.');
    expect(text('constraint.roster_size', 'en')).toBe('Team size: exactly 6 Pokémon.');
    expect(text('constraint.roster_size', 'de')).toBe('Teamgröße: genau 6 Pokémon.');
    expect(text('constraint.count', 'en')).toBe(
      'A team may have at most 1 Pokémon from the combination of the list normal and the resource picks. This applies when round >= 2.',
    );
    expect(text('constraint.distinct', 'en')).toBe('A team may have at most 1 Pokémon with the same base species.');
    expect(text('constraint.type_quota', 'en')).toBe('A team needs at least 1 Pokémon of each of the types fire and water.');
    expect(text('constraint.tera', 'en')).toBe('Terastallization: not allowed.');
    expect(text('constraint.tera', 'de')).toBe('Terakristallisierung: nicht erlaubt.');
    expect(text('constraint.evolution_stage', 'en')).toBe(
      'A team may have at most 4 fully evolved Pokémon and at most 2 Pokémon that can still evolve.',
    );
    expect(text('time.schedule', 'en')).toBe(
      'Rounds start from 2026-12-01 at 18:00, every week, and each round lasts 168 hours. Named point in time: gift_deadline (round 1, -12 hours).',
    );
    expect(text('time.deadline_policy', 'en')).toBe(
      'Deadline for matches: 0 hours relative to the round deadline. If it is missed: the match is forfeited.',
    );
    expect(text('stage.end_when', 'en')).toBe('The stage ends after 4 rounds.');
    expect(text('stage.foreach_group', 'de')).toBe('Die Stage wird einmal für jede Gruppe der Stage groups gespielt.');
  });

  it('describes the Phase 3 kinds with their values, in both languages', () => {
    const s = sampleNodes();
    const text = (kind: PrimitiveKind, locale: Locale) => describePrimitive(kind, s[kind], locale);
    expect(text('attr.define', 'en')).toBe('Attribute House (choice) for players, assigned with a seeded random draw.');
    expect(text('attr.define', 'de')).toBe('Attribut Haus (Auswahl) für Spieler, vergeben per Zufall mit festem Startwert.');
    expect(text('attr.assign', 'en')).toBe('Values are calculated by the formula tunable.base_level.');
    expect(text('domain.define', 'en')).toBe('List Gift pool with 2 entries. It starts locked and is visible to everyone once it is unlocked.');
    expect(text('relation.define', 'en')).toContain('Everything is revealed when round 2 of stage main ends.');
    expect(text('resource.define', 'en')).toBe('Resource Picks: holds entries of the list pool; up to 2 per player and each item can be held by one player only.');
    expect(text('metric.define', 'en')).toBe('Custom metric Gift score, calculated per player as wins * 2.');
    expect(text('rule.on_event', 'en')).toBe('When stage main starts and round >= 0: unlock the list pool and grant 3 of coins to all players.');
    expect(text('effect.apply', 'en')).toBe('Effect: grant 2 of coins to the players of the event.');
    expect(text('player.action', 'en')).toBe('Action Choose a gift, through the relation santa: take 2 from pool into picks.');
    expect(text('track.progression', 'en')).toBe('Progression track Milestones with 1 step, counted in stage main.');
    expect(text('score.placement', 'en')).toBe('Placement scoring Placement for stage main: 5, 3 and 1 points by final place.');
    expect(text('check.assisted', 'en')).toBe('Assisted check Ties: flags ties in the standings for an admin to review.');
    expect(text('adjust.manual', 'en')).toBe('Admins may adjust by hand, with a recorded reason: points and resources.');
    expect(text('adjust.manual', 'de')).toBe('Admins dürfen von Hand anpassen, mit festgehaltener Begründung: Punkte und Ressourcen.');
  });

  it('picks the variant sentence of the Phase 3 kinds', () => {
    const d = (kind: PrimitiveKind, node: unknown) => describePrimitive(kind, node, 'en');
    expect(d('attr.assign', { kind: 'manual' })).toBe('Values are entered by hand.');
    expect(d('domain.define', { label: lt('Pool'), entries: [{ id: 'mew', attrs: [] }], initially: 'unlocked', visibility: 'admins' })).toBe(
      'List Pool with 1 entry. It starts unlocked and is visible to admins only.',
    );
    expect(d('resource.define', { label: lt('Coins'), holds: { kind: 'counter' }, visibility: 'own', exclusive: 'none' })).toBe('Resource Coins: a counter.');
    expect(d('track.progression', { kind: 'track.progression', key: 't', label: lt('T'), steps: [{}, {}] })).toBe('Progression track T with 2 steps.');
    expect(d('check.assisted', { kind: 'check.assisted', id: 'vets', source: { kind: 'expr', of: 'match', when: { k: 'ref', name: 'forfeit', t: 'boolean' } } })).toBe(
      'Assisted check vets: flags every match where forfeit for an admin to review.',
    );
  });

  it('never throws on a node of the wrong shape and returns the label', () => {
    const hostile: unknown[] = [undefined, null, 5, 'text', true, [], [1, 2], {}, { kind: 5 }, { n: 'x' }, { stages: 'x' }, { select: [null, 5] }, Object.create(null), JSON.parse('{"__proto__":{"n":3}}')];
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    cyclic.when = cyclic;
    cyclic.rank = [cyclic];
    hostile.push(cyclic);
    for (const kind of AVAILABLE_KINDS) {
      const label = describePrimitive(kind, undefined, 'en');
      expectClean(label, kind);
      for (const node of hostile) {
        for (const locale of LOCALES) {
          expect(() => describePrimitive(kind, node, locale), `${kind} ${JSON.stringify(Object.keys(Object(node) as object))}`).not.toThrow();
          expect(typeof describePrimitive(kind, node, locale)).toBe('string');
        }
      }
    }
  });

  it('a wrong-shaped node gives the label of the kind', () => {
    expect(describePrimitive('advance.top_n', { kind: 'top_n', n: 'many' }, 'en')).toBe('Top players advance');
    expect(describePrimitive('series.rule', { best_of: '3' }, 'de')).toBe('Spiellänge');
    expect(describePrimitive('stage.define', { name: lt('X'), pairing: 'swiss' }, 'en')).toBe('Stage');
  });
});
