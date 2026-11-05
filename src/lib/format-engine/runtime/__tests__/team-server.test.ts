import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcupDoc } from '@/lib/format-kit/__tests__/fixtures/docs';
import type { FormatDefinition } from '@/lib/format-kit/types';
import type { PokemonSet, TeamValidationResult } from '@/types/team';
import { makeSet } from '@/test/team-fixtures';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { SEED, stateFor } from './helpers';

vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  loadFreshKitContext: vi.fn(),
}));
vi.mock('@/lib/team/check.server', () => ({ checkTeam: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));

import { loadFreshKitContext, type KitContext } from '../load';
import { checkTeam } from '@/lib/team/check.server';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { currentPhaseRound, evaluateTeam, resolveTeamMembers } from '../team-server';

function wichtelDef(): FormatDefinition {
  const result = compile(wichtelcupDoc());
  if (result.definition === null) throw new Error('the Wichtelcup fixture does not compile');
  return result.definition as FormatDefinition;
}

const DEF = wichtelDef();
const RULESET = makeRuleset({ id: 'rs-1' });
const CLEAN: TeamValidationResult = { valid: true, issues: [], team_issues: [], team_issue_details: [] };

function context(over: Partial<KitContext> = {}): KitContext {
  return {
    seasonId: 's-1',
    seed: SEED,
    def: DEF,
    state: stateFor(DEF),
    tunableIssues: [],
    phases: [{ id: 'cup-1', stage: DEF.stages[0], members: ['p1'] }],
    ...over,
  };
}

// One item per slot: the Wichtelcup allows each item once.
const team = (...species: string[]): PokemonSet[] => species.map((s, i) => makeSet(s, { moves: ['Tackle'], item: `Item ${i}` }));
const input = (pokemon: PokemonSet[], over: Partial<Parameters<typeof evaluateTeam>[0]> = {}) => ({
  seasonId: 's-1',
  phaseId: 'cup-1',
  playerId: 'p1',
  roundNumber: 1,
  pokemon,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadFreshKitContext).mockResolvedValue(context());
  vi.mocked(checkTeam).mockResolvedValue(CLEAN);
  vi.mocked(getRulesetById).mockResolvedValue(RULESET);
  vi.mocked(getSeasonById).mockResolvedValue(null);
  vi.mocked(getTournamentById).mockResolvedValue({ id: 'cup-1', ruleset_id: 'rs-1' } as never);
});

describe('resolveTeamMembers', () => {
  it('resolves ids, base species, types, item, Tera type and evolution class through the dex', () => {
    const sets: PokemonSet[] = [
      makeSet('Rotom-Wash', { item: 'Leftovers', moves: ['Tackle'], tera_type: 'Water' }),
      makeSet('Pichu', { moves: ['Tackle'] }),
      makeSet('Pikachu', { moves: ['Tackle'] }),
      makeSet('Garchomp', { moves: ['Tackle'] }),
    ];
    const members = resolveTeamMembers(sets, 9, false);
    expect(members[0]).toMatchObject({
      name: 'Rotom-Wash',
      species: 'rotomwash',
      baseSpecies: 'rotom',
      baseName: 'Rotom',
      types: ['Electric', 'Water'],
      item: 'leftovers',
      teraType: 'Water',
      evolution: 'fe',
    });
    expect(members.map((m) => m.evolution)).toEqual(['fe', 'lc', 'nfe', 'fe']);
  });

  it('keeps one member per slot, an unreadable set included', () => {
    const members = resolveTeamMembers([team('Garchomp')[0], { moves: [] } as unknown as PokemonSet, team('Missingno')[0]], 9, false);
    expect(members).toHaveLength(3);
    expect(members[1].species).toBe('');
    expect(members[2]).toMatchObject({ species: 'missingno', types: [] });
  });
});

describe('evaluateTeam', () => {
  it('does not apply to a league without a kit format', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    const out = await evaluateTeam(input(team('Garchomp')));
    expect(out).toEqual({ applies: false, result: { valid: true, issues: [], team_issues: [] } });
    expect(checkTeam).not.toHaveBeenCalled();
  });

  it('does not apply to a tournament that is no phase of the format', async () => {
    expect((await evaluateTeam(input(team('Garchomp'), { phaseId: 'other' }))).applies).toBe(false);
  });

  it('does not apply to a phase with neither constraints nor domains or resources', async () => {
    const bare: FormatDefinition = { ...DEF, domains: [], resources: [] };
    vi.mocked(loadFreshKitContext).mockResolvedValue(
      context({ def: bare, phases: [{ id: 'cup-1', stage: { ...DEF.stages[0], constraints: [] }, members: ['p1'] }] }),
    );
    expect((await evaluateTeam(input(team('Garchomp')))).applies).toBe(false);
  });

  it('checks the phase ruleset and merges the stage constraints', async () => {
    vi.mocked(checkTeam).mockResolvedValue({
      valid: false,
      issues: [],
      team_issues: ['Species Clause'],
      team_issue_details: [{ issue: 'Species Clause', code: 'species_clause' }],
    });
    const out = await evaluateTeam(input(team('Garchomp', 'Blissey')));

    expect(out.applies).toBe(true);
    expect(checkTeam).toHaveBeenCalledWith(expect.objectContaining({ ruleset: RULESET, playerId: 'p1', seasonId: 's-1', season: null }));
    expect(getTournamentById).toHaveBeenCalledWith('cup-1');
    expect(getRulesetById).toHaveBeenCalledWith('rs-1');
    expect(out.result.valid).toBe(false);
    expect(out.result.team_issue_details?.map((d) => d.code)).toEqual(['species_clause', 'kit_roster_size', 'kit_count_min']);
    expect(out.result.team_issues).toHaveLength(3);
  });

  it('uses the ruleset the caller read and the round it names', async () => {
    const own = makeRuleset({ id: 'rs-2' });
    const out = await evaluateTeam(input(team('Garchomp'), { ruleset: own, roundNumber: 4 }));
    expect(getRulesetById).not.toHaveBeenCalled();
    expect(checkTeam).toHaveBeenCalledWith(expect.objectContaining({ ruleset: own }));
    // Round 4: the New Year cap applies and the junk-gift rule of round 1 does not.
    const min = out.result.team_issue_details?.filter((d) => d.code === 'kit_count_min').map((d) => d.params?.source);
    expect(min).toEqual(['resource gifts_premium']);
  });

  it('is invalid when a Tera type is chosen, and the issue sits on its set', async () => {
    const out = await evaluateTeam(input([makeSet('Garchomp', { moves: ['Tackle'], tera_type: 'Ground' })]));
    expect(out.result.issues).toMatchObject([{ pokemon_index: 0, code: 'kit_tera_banned', severity: 'error', species: 'Garchomp' }]);
  });

  it('reports a pinned ruleset that cannot be found as a failed check, never a silent downgrade', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(null);
    await evaluateTeam(input(team('Garchomp')));
    expect(checkTeam).toHaveBeenCalledWith(expect.objectContaining({ ruleset: null, rulesetFailure: 'ruleset_not_found', format: 'gen9' }));
  });

  it('reads a player resource from the runtime state', async () => {
    const state = stateFor(DEF, {
      items: [{ id: 'i1', resource: 'gifts_junk', player_id: 'p1', item_id: 'wobbuffet', amount: 1, exclusive: false, source: 'event', source_ref: null }],
    });
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ state }));
    const out = await evaluateTeam(input(team('Wobbuffet')));
    expect(out.result.team_issue_details?.some((d) => d.code === 'kit_count_min' && d.params?.source === 'resource gifts_junk')).toBe(false);
  });
});

describe('currentPhaseRound', () => {
  it('is the latest round of the phase, or 1 before it has one', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1 }, { round_number: 3 }, { round_number: 2 }] as never);
    expect(await currentPhaseRound('cup-1')).toBe(3);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    expect(await currentPhaseRound('cup-1')).toBe(1);
  });
});
