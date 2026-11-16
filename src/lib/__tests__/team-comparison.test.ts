import { describe, expect, it } from 'vitest';
import { comparisonPokemon, currentRosterSpecies, mostRecentSharedLeague, superEffectiveStabs } from '../team-comparison';

describe('current league comparison', () => {
  it('uses current tracker forms, including branch choices, rather than base or final stages', () => {
    const species = currentRosterSpecies([
      { current_form: 'Charmeleon' }, { current_form: 'Vaporeon' }, { current_form: 'Cosmoem' },
    ]);
    expect(species).toEqual(['Charmeleon', 'Vaporeon', 'Cosmoem']);
    expect(comparisonPokemon(species).map((pokemon) => pokemon.types)).toEqual([['Fire'], ['Water'], ['Psychic']]);
    expect(superEffectiveStabs(comparisonPokemon(['Pikachu']), comparisonPokemon(['Charmeleon']))).toEqual([]);
    expect(superEffectiveStabs(comparisonPokemon(['Pikachu']), comparisonPokemon(['Charizard']))).toHaveLength(1);
  });

  it('uses the Gen 9 chart (Steel no longer resists Dark), combining both defensive types', () => {
    expect(superEffectiveStabs(comparisonPokemon(['Umbreon']), comparisonPokemon(['Metagross']))).toEqual([
      { attacker: 'Umbreon', defender: 'Metagross', type: 'Dark', multiplier: 2 },
    ]);
    expect(superEffectiveStabs(comparisonPokemon(['Swampert']), comparisonPokemon(['Heatran']))).toContainEqual(
      { attacker: 'Swampert', defender: 'Heatran', type: 'Ground', multiplier: 4 },
    );
    expect(superEffectiveStabs(comparisonPokemon(['Pikachu']), comparisonPokemon(['Swampert']))).toEqual([]);
    expect(superEffectiveStabs(comparisonPokemon(['Charizard']), comparisonPokemon(['Kingdra']))).toEqual([]);
  });

  it('shows the reverse independently and does not infer coverage for unresolved species', () => {
    const mine = comparisonPokemon(['Charmeleon', 'Unknown-species']);
    const theirs = comparisonPokemon(['Wartortle']);
    expect(superEffectiveStabs(mine, theirs)).toEqual([]);
    expect(superEffectiveStabs(theirs, mine)).toEqual([
      { attacker: 'Wartortle', defender: 'Charmeleon', type: 'Water', multiplier: 2 },
    ]);
    expect(mine[1].types).toEqual([]);
  });

  it('defaults to the most recent league, including completed leagues', () => {
    const older = { id: 'older', name: 'Earlier Cup', format_type: 'standard', start_date: '2025-01-01', created_at: '2025-01-01' };
    const newer = { ...older, id: 'newer', start_date: '2026-11-01' };
    const leagues = [older, newer];
    expect(mostRecentSharedLeague(leagues)?.id).toBe('newer');
    expect(leagues[0]).toBe(older);
  });

  it('breaks tied start dates by creation time before comparing ids', () => {
    const older = { id: 'zzz', name: 'Earlier Cup', format_type: 'standard', start_date: '2026-11-01', created_at: '2025-01-01' };
    const newer = { ...older, id: 'aaa', created_at: '2026-01-01' };
    expect(mostRecentSharedLeague([older, newer])?.id).toBe('aaa');
  });
});
