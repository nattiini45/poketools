import { Dex } from '@pkmn/dex';
import { describe, expect, it, vi } from 'vitest';
import { resolveTeamMembers } from '@/lib/format-engine/runtime/team-server';
import { toID } from '@/lib/pkmn/i18n/id';
import {
  WICHTELCUP_JUNK,
  WICHTELCUP_JUNK_ROLES,
  WICHTELCUP_NEW_YEAR,
  WICHTELCUP_NORMAL,
  WICHTELCUP_PREMIUM,
  WICHTELCUP_SPECIES,
} from '@/lib/pkmn/preset-data/wichtelcup';
import { resolvePresetRules } from '@/lib/pkmn/preset-rules.server';
import { makeSet } from '@/test/team-fixtures';
import { emptyRuntimeState, type RuntimeItem } from '@/lib/format-engine/runtime/types';
import { evaluateConstraints } from '@/lib/format-engine/runtime/team';
import { compile } from '../compile';
import { CURRENT_ENV } from '../engine/env';
import { PRESETS, wichtelcup } from '../presets';
import type { FormatDefinition } from '../types';

// team-server reads the season from the database; only its dex-based member resolution is used here.
vi.mock('@/lib/team/check.server', () => ({ checkTeam: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));

// The neutral Wichtelcup EXAMPLE against the real dex: made-up pools, the gift-order mechanic (ordinal), the hidden
// surprise pool and the per-recipient reveal. The real tournament's data lives in the private pack, not here.

const dex = Dex.forGen(9);
const POOLS = ['normal', 'junk', 'premium', 'new_year'] as const;
const domain = (key: string) => wichtelcup.domains?.find((d) => d.key === key);
const idsOf = (key: string): string[] => (domain(key)?.entries ?? []).map((e) => e.id);

describe('the Wichtelcup example is registered', () => {
  it('is a shipped example', () => {
    expect(PRESETS.map((p) => p.id)).toContain('wichtelcup');
    expect(PRESETS.find((p) => p.id === 'wichtelcup')?.definition).toBe(wichtelcup);
  });
});

describe('the Wichtelcup example compiles against the real dex', () => {
  const known = new Set(
    [...POOLS.flatMap(idsOf)].filter((id) => {
      const species = dex.species.get(id);
      return species.exists && toID(species.name) === id;
    }),
  );
  const result = compile(wichtelcup, { ...CURRENT_ENV, speciesIds: known });

  it('has no error and no warning (the participant count is only an info)', () => {
    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('knows every entry id as a species', () => {
    expect(result.diagnostics.filter((d) => d.code === 'domain_entry_unknown_species')).toEqual([]);
    expect(known.size).toBe(23);
  });

  it('catches a typo in an entry id', () => {
    const typo = structuredClone(wichtelcup);
    typo.domains = typo.domains?.map((d) => (d.key === 'normal' ? { ...d, entries: [...d.entries, { id: 'pikachux', attrs: [] }] } : d));
    expect(compile(typo, { ...CURRENT_ENV, speciesIds: known }).diagnostics.map((d) => d.code)).toContain('domain_entry_unknown_species');
  });

  it('checks alias species and emits their own diagnostic pointers', () => {
    const definition = structuredClone(wichtelcup);
    const entry = definition.domains?.[0]?.entries[0];
    if (!entry) throw new Error('Expected an example domain entry');
    entry.aliases = ['rotomwash', 'rotomwah', entry.id];
    const result = compile(definition, { ...CURRENT_ENV, speciesIds: new Set([...known, 'rotomwash']) });
    expect(result.diagnostics.filter(({ code }) => code === 'domain_entry_unknown_species' || code === 'domain_entry_duplicate'))
      .toMatchObject([
        { code: 'domain_entry_unknown_species', json_pointer: '/domains/0/entries/0/aliases/1' },
        { code: 'domain_entry_duplicate', json_pointer: '/domains/0/entries/0/aliases/2' },
      ]);
  });
});

describe('the four made-up pools', () => {
  it('have the example sizes', () => {
    expect(POOLS.map((key) => idsOf(key).length)).toEqual([8, 6, 6, 3]);
    expect(WICHTELCUP_NORMAL).toHaveLength(8);
    expect(WICHTELCUP_JUNK).toHaveLength(6);
    expect(WICHTELCUP_PREMIUM).toHaveLength(6);
    expect(WICHTELCUP_NEW_YEAR).toHaveLength(3);
  });

  it('are the transcribed tables mapped to dex ids', () => {
    expect(idsOf('normal')).toEqual(WICHTELCUP_NORMAL.map(toID));
    expect(idsOf('junk')).toEqual(WICHTELCUP_JUNK.map(toID));
    expect(idsOf('premium')).toEqual(WICHTELCUP_PREMIUM.map(toID));
    expect(idsOf('new_year')).toEqual(WICHTELCUP_NEW_YEAR.map(toID));
  });

  it('together are exactly the species list of the pinned rule preset', () => {
    const preset = resolvePresetRules('gen9natdexwichtelcup');
    if (preset === null) throw new Error('the Wichtelcup rule preset is missing');
    expect(preset.pokemon.mode).toBe('allow');
    const union = [...new Set(POOLS.flatMap(idsOf))].sort();
    expect(union).toHaveLength(23);
    expect(union).toEqual(WICHTELCUP_SPECIES.map(toID).sort());
    expect(preset.pokemon.ids).toEqual(union);
  });

  it('are pairwise disjoint', () => {
    const all = POOLS.flatMap(idsOf);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keep the surprise pool locked and hidden at the start, the others open and public', () => {
    expect(POOLS.map((key) => domain(key)?.initially)).toEqual(['unlocked', 'unlocked', 'unlocked', 'locked']);
    expect(POOLS.map((key) => domain(key)?.visibility)).toEqual(['public', 'public', 'public', 'when_unlocked']);
  });

  it('match every species of the list in exactly one pool, by species or base species', () => {
    const pools = POOLS.map((key) => ({ key, ids: new Set(idsOf(key)) }));
    const members = resolveTeamMembers(
      WICHTELCUP_SPECIES.map((name) => makeSet(name, { moves: ['Protect'] })),
      9,
      true,
    );
    expect(members).toHaveLength(23);
    members.forEach((member, i) => {
      const hits = pools.filter((pool) => pool.ids.has(member.species) || pool.ids.has(member.baseSpecies)).map((pool) => pool.key);
      expect(hits, `${WICHTELCUP_SPECIES[i]} (${member.species} / ${member.baseSpecies})`).toHaveLength(1);
    });
  });
});

describe('the gift-order team check', () => {
  const compiled = compile(wichtelcup);
  if (compiled.definition === null) throw new Error('the Wichtelcup example does not compile');
  const def = compiled.definition as FormatDefinition;
  const cup = def.stages.find((stage) => stage.key === 'cup')?.constraints ?? [];
  const normal = idsOf('normal');
  const gift = (resource: 'junk_gifts' | 'premium_gift', itemId: string, ordinal: number): RuntimeItem => ({
    id: `i-${itemId}`,
    resource,
    player_id: 'p1',
    item_id: itemId,
    amount: 1,
    exclusive: false,
    source: 'event',
    source_ref: null,
    ordinal,
  });
  // junk gift #1 = Starmie, junk gift #2 = Golem, premium = Dragonite.
  const own = [gift('junk_gifts', 'starmie', 1), gift('junk_gifts', 'golem', 2), gift('premium_gift', 'dragonite', 1)];

  const issues = (round: number, species: string[], items: readonly RuntimeItem[] = own) =>
    evaluateConstraints({
      constraints: cup,
      def,
      state: { ...emptyRuntimeState(), items: [...items] },
      seed: 'seed-0123456789',
      playerId: 'p1',
      round,
      members: resolveTeamMembers(species.map((name) => makeSet(name, { moves: ['Protect'] })), 9, true),
    });
  const codes = (list: ReturnType<typeof issues>) => list.map((i) => i.code);

  it('week 1 accepts junk gift #1 + five normal and rejects junk gift #2', () => {
    expect(issues(1, ['Starmie', ...normal.slice(0, 5)])).toEqual([]);
    expect(codes(issues(1, ['Golem', ...normal.slice(0, 5)]))).toContain('kit_count_min');
  });

  it('week 2 accepts junk gift #2 + five normal and rejects junk gift #1', () => {
    expect(issues(2, ['Golem', ...normal.slice(0, 5)])).toEqual([]);
    expect(codes(issues(2, ['Starmie', ...normal.slice(0, 5)]))).toContain('kit_count_min');
  });

  it('week 3 accepts both junk gifts + four normal and rejects the premium', () => {
    expect(issues(3, ['Starmie', 'Golem', ...normal.slice(0, 4)])).toEqual([]);
    expect(codes(issues(3, ['Starmie', 'Golem', 'Dragonite', ...normal.slice(0, 3)]))).toContain('kit_count_max');
  });

  it('week 4 accepts both junk gifts + the premium + three normal', () => {
    expect(issues(4, ['Starmie', 'Golem', 'Dragonite', ...normal.slice(0, 3)])).toEqual([]);
  });

  it('every December week rejects the surprise pool', () => {
    for (const round of [1, 2, 3, 4]) {
      const team = round === 1
        ? ['Starmie', 'Mewtwo', ...normal.slice(0, 4)]
        : round === 2
          ? ['Golem', 'Mewtwo', ...normal.slice(0, 4)]
          : round === 3
            ? ['Starmie', 'Golem', 'Mewtwo', ...normal.slice(0, 3)]
            : ['Starmie', 'Golem', 'Dragonite', 'Mewtwo', ...normal.slice(0, 2)];
      expect(codes(issues(round, team)), `round ${round}`).toContain('kit_not_allowed');
    }
  });

  it('rejects a gift species the player does not hold (another recipient’s gift)', () => {
    // Clefable is a junk species, but this player holds Starmie and Golem, not Clefable.
    expect(codes(issues(3, ['Starmie', 'Golem', 'Clefable', ...normal.slice(0, 3)]))).toContain('kit_not_allowed');
  });

  it('an unmapped legacy holding (null ordinal) satisfies no ordinal slot', () => {
    const unmapped = [gift('junk_gifts', 'starmie', 1), { ...gift('junk_gifts', 'golem', 2), ordinal: null }, gift('premium_gift', 'dragonite', 1)];
    // Week 2 demands junk gift #2; the null-ordinal Golem does not match it.
    expect(codes(issues(2, ['Golem', ...normal.slice(0, 5)], unmapped))).toContain('kit_count_min');
  });
});

describe('the junk gift roles', () => {
  it('cover exactly the junk species, one role each', () => {
    expect(Object.keys(WICHTELCUP_JUNK_ROLES).sort()).toEqual([...WICHTELCUP_JUNK].sort());
    const counts = new Map<string, number>();
    for (const role of Object.values(WICHTELCUP_JUNK_ROLES)) counts.set(role, (counts.get(role) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
  });

  it('are tagged on every junk entry with a value of the primary_role attribute', () => {
    const attribute = wichtelcup.attributes?.find((a) => a.key === 'primary_role');
    expect(attribute?.on).toBe('entry');
    for (const entry of domain('junk')?.entries ?? []) {
      expect(entry.attrs, entry.id).toHaveLength(1);
      expect(attribute?.values, entry.id).toContain(entry.attrs[0].value);
    }
    for (const entry of [...(domain('normal')?.entries ?? []), ...(domain('premium')?.entries ?? []), ...(domain('new_year')?.entries ?? [])]) {
      expect(entry.attrs, entry.id).toEqual([]);
    }
  });
});

describe('the document as a whole', () => {
  it('stays small enough to store', () => {
    expect(JSON.stringify(wichtelcup).length).toBeLessThan(40_000);
  });

  it('relies on the pinned rule preset for the exact forme list, the bans and the clauses', () => {
    expect(wichtelcup.stages[0].ruleset).toEqual({ kind: 'preset', preset: 'gen9natdexwichtelcup' });
  });

  it('asks for exactly six Pokémon and bans Terastallization in the stage constraints', () => {
    const constraints = wichtelcup.stages[0].constraints ?? [];
    expect(constraints).toContainEqual({ kind: 'roster_size', min: 6, max: 6 });
    expect(constraints).toContainEqual({ kind: 'tera', mode: 'banned' });
  });

  it('scores 30 / 10 plus one point per faint, and 30 / 0 for a forfeit', () => {
    expect(wichtelcup.stages[0].scoring).toEqual({
      win: 30,
      loss: 10,
      bye: 0,
      per_opponent_faint: 1,
      forfeit: { win: 30, loss: 0, faint_bonus: false },
    });
  });

  it('reveals each recipient’s giver after their own week-4 match, not on a calendar mark', () => {
    expect(wichtelcup.relations?.[0].reveal_on).toBeUndefined();
    const reveal = wichtelcup.rules.find((r) => r.kind === 'rule.on_event' && r.id === 'christmas_reveal');
    expect(reveal?.kind === 'rule.on_event' && reveal.on).toEqual({ event: 'match_completed', stage: 'cup' });
    expect(reveal?.kind === 'rule.on_event' && reveal.effects).toEqual([
      { effect: 'reveal_relation', relation: 'santa', to: { who: 'event_players' } },
    ]);
  });

  it('has the premium pool globally exclusive and the junk pool not', () => {
    expect(wichtelcup.resources?.map((r) => [r.key, r.capacity, r.exclusive])).toEqual([
      ['junk_gifts', 2, 'none'],
      ['premium_gift', 1, 'global'],
    ]);
  });
});
