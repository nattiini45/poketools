import { Dex } from '@pkmn/dex';
import { describe, expect, it, vi } from 'vitest';
import { resolveTeamMembers } from '@/lib/format-engine/runtime/team-server';
import { toID } from '@/lib/pkmn/i18n/id';
import {
  WICHTELCUP_ENTRY_FORMES,
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

// The Wichtelcup example against the real dex: the species ids are real, the four pools are exactly the species list of
// the pinned rule preset and are disjoint, and every role tag is complete.

const dex = Dex.forGen(9);
const POOLS = ['normal', 'junk', 'premium', 'new_year'] as const;
const domain = (key: string) => wichtelcup.domains?.find((d) => d.key === key);
const idsOf = (key: string): string[] => (domain(key)?.entries ?? []).map((e) => e.id);

describe('the Wichtelcup example is registered', () => {
  it('is the fourth shipped example', () => {
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
    expect(known.size).toBe(141);
  });

  it('catches a typo in an entry id', () => {
    const typo = structuredClone(wichtelcup);
    typo.domains = typo.domains?.map((d) => (d.key === 'normal' ? { ...d, entries: [...d.entries, { id: 'abomasnowx', attrs: [] }] } : d));
    expect(compile(typo, { ...CURRENT_ENV, speciesIds: known }).diagnostics.map((d) => d.code)).toContain('domain_entry_unknown_species');
  });
});

describe('the four pools', () => {
  it('have the sizes of the rules text', () => {
    expect(POOLS.map((key) => idsOf(key).length)).toEqual([64, 30, 23, 24]);
    expect(WICHTELCUP_NORMAL).toHaveLength(64);
    expect(WICHTELCUP_JUNK).toHaveLength(30);
    expect(WICHTELCUP_PREMIUM).toHaveLength(23);
    expect(WICHTELCUP_NEW_YEAR).toHaveLength(24);
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
    expect(union).toHaveLength(141);
    expect(union).toEqual(WICHTELCUP_SPECIES.map(toID).sort());
    // The preset's exact-id allowlist is the pools plus the formes an unpinned entry admits (Toxtricity-Low-Key).
    expect(preset.pokemon.ids).toEqual([...union, ...WICHTELCUP_ENTRY_FORMES.map(toID)].sort());
  });

  it('are pairwise disjoint', () => {
    const all = POOLS.flatMap(idsOf);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keep the New Year pool locked at the start and the others open', () => {
    expect(POOLS.map((key) => domain(key)?.initially)).toEqual(['unlocked', 'unlocked', 'unlocked', 'locked']);
    expect(POOLS.map((key) => domain(key)?.visibility)).toEqual(['public', 'public', 'public', 'public']);
  });

  it('match every species of the list in exactly one pool, by species or base species', () => {
    const pools = POOLS.map((key) => ({ key, ids: new Set(idsOf(key)) }));
    const members = resolveTeamMembers(
      WICHTELCUP_SPECIES.map((name) => makeSet(name, { moves: ['Protect'] })),
      9,
      true,
    );
    expect(members).toHaveLength(141);
    members.forEach((member, i) => {
      const hits = pools.filter((pool) => pool.ids.has(member.species) || pool.ids.has(member.baseSpecies)).map((pool) => pool.key);
      expect(hits, `${WICHTELCUP_SPECIES[i]} (${member.species} / ${member.baseSpecies})`).toHaveLength(1);
    });
  });
});

describe('Toxtricity-Low-Key in the team check', () => {
  // The pool check compares a member by its species id OR its base species id, so the Low-Key forme of the pool entry
  // `toxtricity` is in the New Year pool, and a gift of `toxtricity` covers both formes.
  const compiled = compile(wichtelcup);
  if (compiled.definition === null) throw new Error('the Wichtelcup example does not compile');
  const def = compiled.definition as FormatDefinition;
  const cup = def.stages.find((stage) => stage.key === 'cup')?.constraints ?? [];
  // Indexes into the stage's constraint list (document order): the closed New Year pool before week 4, its cap of two from week 4.
  const NEW_YEAR_CLOSED = 7;
  const NEW_YEAR_CAP = 8;
  const normal = idsOf('normal');
  const gift = (resource: 'junk_gifts' | 'premium_gift', itemId: string): RuntimeItem => ({
    id: `i-${itemId}`,
    resource,
    player_id: 'p1',
    item_id: itemId,
    amount: 1,
    exclusive: false,
    source: 'event',
    source_ref: null,
  });
  const own = [gift('junk_gifts', 'bergmite'), gift('junk_gifts', 'delibird'), gift('premium_gift', 'glastrier')];

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

  it('reads the constraints at the indexes used here', () => {
    expect(cup.map((c) => c.kind)).toHaveLength(9);
    expect(cup[NEW_YEAR_CLOSED]).toMatchObject({ kind: 'count', max: 0, source: { kind: 'domain', domain: 'new_year' } });
    expect(cup[NEW_YEAR_CAP]).toMatchObject({ kind: 'count', max: 2, source: { kind: 'domain', domain: 'new_year' } });
  });

  it('resolves the forme to species toxtricitylowkey with base species toxtricity', () => {
    const [member] = resolveTeamMembers([makeSet('Toxtricity-Low-Key', { moves: ['Protect'] })], 9, true);
    expect([member.species, member.baseSpecies]).toEqual(['toxtricitylowkey', 'toxtricity']);
  });

  it('is accepted in week 4 like the standard forme, and counts toward the cap of two New Year Pokémon', () => {
    const team = ['Bergmite', 'Delibird', 'Glastrier', 'Toxtricity-Low-Key', normal[0], normal[1]];
    expect(issues(4, team)).toEqual([]);
    const withTwo = issues(4, ['Bergmite', 'Glastrier', 'Toxtricity-Low-Key', 'Jirachi', normal[0], normal[1]]);
    expect(withTwo).toEqual([]);
    const withThree = issues(4, ['Glastrier', 'Toxtricity-Low-Key', 'Jirachi', 'Victini', normal[0], normal[1]]);
    expect(withThree.map((i) => `${i.code}#${i.constraint_index}`)).toEqual([`kit_count_max#${NEW_YEAR_CAP}`]);
  });

  it('counts as the held gift when the player holds the Toxtricity entry as the premium gift', () => {
    // A hypothetical gift `toxtricity`: the Low-Key forme satisfies the mandatory premium gift of week 4 through its base species.
    const gifted = [own[0], own[1], gift('premium_gift', 'toxtricity')];
    expect(issues(4, ['Bergmite', 'Delibird', 'Toxtricity-Low-Key', normal[0], normal[1], normal[2]], gifted)).toEqual([]);
    expect(issues(4, ['Bergmite', 'Delibird', 'Toxtricity', normal[0], normal[1], normal[2]], gifted)).toEqual([]);
  });

  it('is closed with the rest of the New Year pool before week 4', () => {
    const early = issues(3, ['Bergmite', 'Delibird', 'Glastrier', 'Toxtricity-Low-Key', normal[0], normal[1]]);
    expect(early.map((i) => `${i.code}#${i.constraint_index}`)).toEqual([`kit_count_max#${NEW_YEAR_CLOSED}`]);
  });
});

describe('the junk gift roles', () => {
  it('cover exactly the 30 junk species, split 4/6/6/5/3/6', () => {
    expect(Object.keys(WICHTELCUP_JUNK_ROLES).sort()).toEqual([...WICHTELCUP_JUNK].sort());
    const counts = new Map<string, number>();
    for (const role of Object.values(WICHTELCUP_JUNK_ROLES)) counts.set(role, (counts.get(role) ?? 0) + 1);
    expect([...counts.entries()]).toEqual([
      ['hazard_removal', 4],
      ['hazard_setter', 6],
      ['wall_stall', 6],
      ['support', 5],
      ['weather_setter', 3],
      ['attacker', 6],
    ]);
  });

  it('are tagged on every junk entry with a value of the primary_role attribute', () => {
    const attribute = wichtelcup.attributes?.find((a) => a.key === 'primary_role');
    expect(attribute?.on).toBe('entry');
    expect(attribute?.values).toEqual(['hazard_removal', 'hazard_setter', 'wall_stall', 'support', 'weather_setter', 'attacker']);
    for (const entry of domain('junk')?.entries ?? []) {
      expect(entry.attrs, entry.id).toHaveLength(1);
      expect(attribute?.values, entry.id).toContain(entry.attrs[0].value);
    }
    for (const entry of [...(domain('normal')?.entries ?? []), ...(domain('premium')?.entries ?? []), ...(domain('new_year')?.entries ?? [])]) {
      expect(entry.attrs, entry.id).toEqual([]);
    }
  });

  it('give the entries the role of their species', () => {
    const role = (id: string) => domain('junk')?.entries.find((e) => e.id === id)?.attrs[0]?.value;
    expect(role('staryu')).toBe('hazard_removal');
    expect(role('delibird')).toBe('hazard_setter');
    expect(role('spheal')).toBe('wall_stall');
    expect(role('impidimp')).toBe('support');
    expect(role('castform')).toBe('weather_setter');
    expect(role('stantler')).toBe('attacker');
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

  it('opens the gift window before round 1 and unlocks the New Year pool and the reveal on the same calendar mark', () => {
    const calendar = wichtelcup.stages[0].calendar;
    expect(calendar?.start).toEqual({ kind: 'season_start' });
    expect(calendar?.marks).toEqual([
      { key: 'gifts_open', round: 1, offset_hours: -336 },
      { key: 'gifts_close', round: 1, offset_hours: -12 },
      { key: 'week4', round: 4, offset_hours: 0 },
    ]);
    expect(wichtelcup.relations?.[0].reveal_on).toEqual({ event: 'time', mark: 'week4' });
    const unlock = wichtelcup.rules.find((r) => r.kind === 'rule.on_event' && r.on.event === 'time' && r.on.mark === 'week4');
    expect(unlock?.kind === 'rule.on_event' && unlock.effects.map((e) => e.effect)).toContain('unlock_domain');
  });

  it('has the premium pool globally exclusive and the junk pool not', () => {
    expect(wichtelcup.resources?.map((r) => [r.key, r.capacity, r.exclusive])).toEqual([
      ['junk_gifts', 2, 'none'],
      ['premium_gift', 1, 'global'],
    ]);
  });
});
