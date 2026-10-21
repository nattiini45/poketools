import type { PokemonSet } from '@/types/team';
import { getBaseStats } from './dex';

export type TeamArchetype =
  | 'Hyper Offense'
  | 'Bulky Offense'
  | 'Balance'
  | 'Stall'
  | 'Rain'
  | 'Sun'
  | 'Sand'
  | 'Snow'
  | 'Trick Room'
  | 'Volt-Turn'
  | 'Hazard Stack'
  | 'Weather';

interface ArchetypeResult {
  primary: TeamArchetype;
  secondary: TeamArchetype | null;
  reasoning: string;
}

// ─── Weather detection ──────────────────────────────────────────────
const WEATHER_SETTERS: Record<string, TeamArchetype> = {
  'Drizzle': 'Rain',
  'Primordial Sea': 'Rain',
  'Drought': 'Sun',
  'Desolate Land': 'Sun',
  'Sand Stream': 'Sand',
  'Sand Spit': 'Sand',
  'Snow Warning': 'Snow',
};

const WEATHER_ABUSERS: Record<string, TeamArchetype> = {
  'Swift Swim': 'Rain',
  'Rain Dish': 'Rain',
  'Chlorophyll': 'Sun',
  'Solar Power': 'Sun',
  'Harvest': 'Sun',
  'Sand Rush': 'Sand',
  'Sand Force': 'Sand',
  'Slush Rush': 'Snow',
  'Ice Body': 'Snow',
};

const WEATHER_MOVES: Record<string, TeamArchetype> = {
  'Rain Dance': 'Rain',
  'Sunny Day': 'Sun',
  'Sandstorm': 'Sand',
  'Snowscape': 'Snow',
  'Chilly Reception': 'Snow',
};

// ─── Move categories ────────────────────────────────────────────────
const SETUP_MOVES = new Set([
  'Swords Dance', 'Nasty Plot', 'Dragon Dance', 'Calm Mind', 'Bulk Up',
  'Quiver Dance', 'Shell Smash', 'Shift Gear', 'Coil', 'Agility',
  'Rock Polish', 'Autotomize', 'Growth', 'Belly Drum', 'Curse',
  'Iron Defense', 'Cosmic Power', 'Cotton Guard',
]);

const PIVOT_MOVES = new Set([
  'U-turn', 'Volt Switch', 'Flip Turn', 'Parting Shot', 'Teleport',
  'Baton Pass', 'Chilly Reception',
]);

const HAZARD_MOVES = new Set([
  'Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web', 'Ceaseless Edge',
  'Stone Axe',
]);

const TRICK_ROOM_MOVES = new Set(['Trick Room']);

const RECOVERY_MOVES = new Set([
  'Recover', 'Slack Off', 'Soft-Boiled', 'Roost', 'Wish', 'Synthesis',
  'Moonlight', 'Morning Sun', 'Shore Up', 'Strength Sap',
]);

const STALL_MOVES = new Set([
  'Toxic', 'Will-O-Wisp', 'Thunder Wave', 'Haze', 'Whirlwind', 'Roar',
  'Dragon Tail', 'Circle Throw', 'Protect', 'Detect', 'Encore', 'Disable',
]);

const DEFENSIVE_ITEMS = new Set([
  'Leftovers', 'Heavy-Duty Boots', 'Rocky Helmet', 'Eviolite',
  'Black Sludge', 'Assault Vest', 'Shed Shell',
]);

const OFFENSIVE_ITEMS = new Set([
  'Choice Band', 'Choice Specs', 'Choice Scarf', 'Life Orb',
  'Focus Sash', 'Expert Belt', 'Weakness Policy',
]);

// ─── Classification ─────────────────────────────────────────────────

export function classifyTeam(team: PokemonSet[], gen: number = 9): ArchetypeResult {
  const reasons: string[] = [];
  const scores = new Map<TeamArchetype, number>();

  function add(arch: TeamArchetype, weight: number, reason: string) {
    scores.set(arch, (scores.get(arch) ?? 0) + weight);
    reasons.push(reason);
  }

  // Analyze each mon
  let totalBaseSpe = 0;
  let totalBulk = 0;
  let setupCount = 0;
  let pivotCount = 0;
  let hazardCount = 0;
  let trickRoomCount = 0;
  let recoveryCount = 0;
  let stallMoveCount = 0;
  let defensiveItemCount = 0;
  let offensiveItemCount = 0;
  let slowMonCount = 0;

  for (const set of team) {
    const stats = getBaseStats(set.species, gen);
    if (!stats) continue;

    totalBaseSpe += stats.baseStats.spe;
    totalBulk += stats.baseStats.hp + stats.baseStats.def + stats.baseStats.spd;

    if (stats.baseStats.spe <= 50) slowMonCount++;

    // Weather
    const weatherSetter = WEATHER_SETTERS[set.ability];
    if (weatherSetter) add(weatherSetter, 3, `${set.species} sets weather (${set.ability})`);
    const weatherAbuser = WEATHER_ABUSERS[set.ability];
    if (weatherAbuser) add(weatherAbuser, 2, `${set.species} abuses weather (${set.ability})`);

    for (const move of set.moves) {
      const wm = WEATHER_MOVES[move];
      if (wm) add(wm, 1.5, `${set.species} has ${move}`);
      if (SETUP_MOVES.has(move)) setupCount++;
      if (PIVOT_MOVES.has(move)) pivotCount++;
      if (HAZARD_MOVES.has(move)) hazardCount++;
      if (TRICK_ROOM_MOVES.has(move)) trickRoomCount++;
      if (RECOVERY_MOVES.has(move)) recoveryCount++;
      if (STALL_MOVES.has(move)) stallMoveCount++;
    }

    if (DEFENSIVE_ITEMS.has(set.item)) defensiveItemCount++;
    if (OFFENSIVE_ITEMS.has(set.item)) offensiveItemCount++;
  }

  const avgSpeed = totalBaseSpe / (team.length || 1);
  const _avgBulk = totalBulk / (team.length || 1);

  // Trick Room
  if (trickRoomCount >= 1 && slowMonCount >= 3) {
    add('Trick Room', 5, `${trickRoomCount} TR setter(s), ${slowMonCount} slow mons`);
  }

  // Volt-Turn
  if (pivotCount >= 3) {
    add('Volt-Turn', 3, `${pivotCount} pivot moves`);
  }

  // Hazard Stack
  if (hazardCount >= 3) {
    add('Hazard Stack', 3, `${hazardCount} hazard-setting moves`);
  }

  // Speed-based archetypes
  if (avgSpeed > 95 && setupCount >= 2 && offensiveItemCount >= 3) {
    add('Hyper Offense', 4, `High avg speed (${Math.round(avgSpeed)}), ${setupCount} setup, ${offensiveItemCount} offensive items`);
  } else if (avgSpeed > 80 && offensiveItemCount >= 2) {
    add('Bulky Offense', 2, `Moderate speed (${Math.round(avgSpeed)}), mix of offense/defense`);
  }

  // Stall
  if (recoveryCount >= 4 && stallMoveCount >= 3 && defensiveItemCount >= 4) {
    add('Stall', 5, `${recoveryCount} recovery, ${stallMoveCount} status, ${defensiveItemCount} defensive items`);
  }

  // Balance (default)
  if (defensiveItemCount >= 2 && offensiveItemCount >= 2) {
    add('Balance', 1, `Mix of defensive and offensive items`);
  }

  // Sort by score
  const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    return { primary: 'Balance', secondary: null, reasoning: 'No strong archetype signals detected' };
  }

  const primary = sorted[0][0];
  const secondary = sorted.length > 1 && sorted[1][1] >= 2 ? sorted[1][0] : null;

  return {
    primary,
    secondary,
    reasoning: reasons.slice(0, 4).join('. '),
  };
}
