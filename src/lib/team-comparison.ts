import { getGeneration, getSpeciesNatDex } from '@/lib/pkmn/dex';

export interface ComparisonLeague {
  id: string;
  name: string;
  format_type: string;
  start_date: string | null;
  created_at: string;
}

export interface ComparisonPokemon {
  species: string;
  types: string[];
}

export interface StabHit {
  attacker: string;
  defender: string;
  type: string;
  multiplier: number;
}

export interface ComparisonRoster {
  hidden: boolean;
  pokemon: ComparisonPokemon[];
}

export interface TeamComparisonData {
  leagues: ComparisonLeague[];
  leagueId: string | null;
  mine: ComparisonRoster;
  theirs: ComparisonRoster;
  myHits: StabHit[];
  theirHits: StabHit[];
}

export function currentRosterSpecies(trackers: readonly { current_form: string }[]): string[] {
  return trackers.map((tracker) => tracker.current_form);
}

export function comparisonPokemon(species: readonly string[]): ComparisonPokemon[] {
  return [...new Set(species)].map((name) => {
    const resolved = getSpeciesNatDex(name)?.entity;
    return { species: resolved?.name ?? name, types: resolved ? [...resolved.types] : [] };
  });
}

export function superEffectiveStabs(attackers: readonly ComparisonPokemon[], defenders: readonly ComparisonPokemon[]): StabHit[] {
  const chart = getGeneration(9).types;
  return attackers.flatMap((attacker) => defenders.flatMap((defender) => {
    if (defender.types.length === 0) return [];
    return attacker.types.flatMap((type) => {
      const attack = chart.get(type);
      if (!attack) return [];
      const multiplier = defender.types.reduce((value, defense) => {
        const target = chart.get(defense);
        return value * (target ? attack.effectiveness[target.name] : 1);
      }, 1);
      return multiplier > 1 ? [{ attacker: attacker.species, defender: defender.species, type, multiplier }] : [];
    });
  }));
}

export function mostRecentSharedLeague(leagues: readonly ComparisonLeague[]): ComparisonLeague | undefined {
  return [...leagues].sort((a, b) =>
    (b.start_date ?? b.created_at).localeCompare(a.start_date ?? a.created_at) ||
    b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
  )[0];
}
