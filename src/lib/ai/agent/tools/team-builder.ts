/**
 * `buildTeam` meta-tool (PRD §5). A DETERMINISTIC assembler that chains the
 * other agent tools — it makes no LLM calls. The LLM describes intent (format,
 * cores, locked items/moves); `buildTeam` computes the specifics:
 *
 *   1. lookupPokemon  — confirm each requested core exists in the generation.
 *   2. getUsageStats  — candidate pool; fill open slots with high-usage mons
 *      that improve type coverage (scored via getTypeChart weaknesses).
 *   3. usage data     — pick each mon's item/ability/moves/spread, honouring
 *      requested_items / requested_moves overrides.
 *   4. validateTeam   — legality gate, with up to 3 repair iterations.
 *   5. export + createPokepaste — Showdown paste text and a shareable URL.
 *
 * This is an honest HEURISTIC assembler, not an optimiser: it favours clear,
 * legal, meta-representative sets over cleverness.
 */
import type { StatSpread, PokemonSet } from '@/types/team';
import type { Ruleset } from '@/types/ruleset';
import type { CoreTriple } from '@/types/season';
import { lookupPokemon, getTypeChart } from './pkmn';
import { getUsageStats, type UsageStatsPokemon } from './smogon';
import { validateTeam, type ValidateTeamIssue } from './validate';
import { createPokepaste } from './pokepaste';
import { parseGenFromFormat } from './format';
import { getSpecies, getLegalAbilities, listMovesForSpecies } from '@/lib/pkmn/dex';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { exportTeamText } from '@/lib/pkmn/teams';
import { parseSpread } from '@/lib/pkmn/spread-parser';
import type { GetTypeChartInput, BuildTeamInput, ValidateTeamInput } from './schemas';

// ─── Result shapes ───────────────────────────────────────────────────

export interface BuiltSet {
  species: string;
  item: string;
  ability: string;
  nature: string;
  evs: StatSpread;
  moves: string[];
  teraType?: string;
  level: number;
}

export interface CoverageEntry {
  type: string;
  count: number;
}

export interface BuildTeamResult {
  format: string;
  team: BuiltSet[];
  /** Showdown export text for the assembled team. */
  paste: string;
  /** pokepast.es URL, or null when publishing failed. */
  pasteUrl: string | null;
  coverage: {
    /** Types ≥2 team members are weak to (open holes). */
    weakTo: CoverageEntry[];
    /** Types ≥2 team members resist or are immune to. */
    resistedBy: CoverageEntry[];
  };
  valid: boolean;
  issues: ValidateTeamIssue[];
  team_issues: string[];
  notes: string[];
  /**
   * True when a `ruleset_id` was supplied but the league ruleset could not be
   * loaded, so the team was built WITHOUT league bans/constraints. The assistant
   * must disclose this rather than presenting the team as league-legal.
   */
  ruleset_load_failed?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────

const ZERO_EVS: StatSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const MAX_REPAIRS = 3;
/** Usage entries that mean "no item / no real choice". */
const EMPTY_VALUES = new Set(['', 'nothing', 'other']);

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isReal = (name: string) => !EMPTY_VALUES.has(name.trim().toLowerCase());

// ─── Type profiles (chains lookupPokemon → getTypeChart) ─────────────

interface TypeProfile {
  weak: Set<string>; // attacking types dealing ≥2× to this mon
  resist: Set<string>; // attacking types dealing ≤0.5× (incl. immunities)
}

function speciesTypes(species: string, gen: number): string[] {
  return getSpecies(species, gen)?.types.slice() ?? [];
}

/** Build a species' defensive type profile from `getTypeChart` effectiveness. */
function typeProfile(species: string, gen: number, cache: Map<string, TypeProfile>): TypeProfile {
  const key = species.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const types = speciesTypes(species, gen);
  const weak = new Set<string>();
  const resist = new Set<string>();
  if (types.length > 0) {
    const chart = getTypeChart({ types: types as GetTypeChartInput['types'], gen });
    for (const [attackType, mult] of Object.entries(chart.effectiveness)) {
      if (mult >= 2) weak.add(attackType);
      else if (mult <= 0.5) resist.add(attackType); // 0, 0.25, 0.5 all count as "handled"
    }
  }
  const profile = { weak, resist };
  cache.set(key, profile);
  return profile;
}

// ─── Candidate selection ─────────────────────────────────────────────

/** Species-clause key (base species, e.g. Rotom-Wash → Rotom). */
function baseKey(species: string, gen: number): string {
  const s = getSpecies(species, gen);
  return (s?.baseSpecies ?? s?.name ?? species).toLowerCase();
}

/**
 * Pick the next team member: the highest-usage candidate that best covers the
 * types the current team is most weak to (and doesn't pile on those weaknesses).
 */
function pickNextCandidate(
  chosen: string[],
  pool: UsageStatsPokemon[],
  usedBase: Set<string>,
  gen: number,
  profiles: Map<string, TypeProfile>,
): string | null {
  // Tally how many current members are weak to each attacking type.
  const weakCount = new Map<string, number>();
  for (const sp of chosen) {
    for (const t of typeProfile(sp, gen, profiles).weak) {
      weakCount.set(t, (weakCount.get(t) ?? 0) + 1);
    }
  }
  // Problem types: shared weaknesses (≥2 members), else the worst few.
  const shared = [...weakCount.entries()].filter(([, c]) => c >= 2).map(([t]) => t);
  const problem =
    shared.length > 0
      ? shared
      : [...weakCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);

  let best: string | null = null;
  let bestScore = -Infinity;
  for (const cand of pool) {
    if (usedBase.has(baseKey(cand.pokemon, gen))) continue;
    if (speciesTypes(cand.pokemon, gen).length === 0) continue;
    const prof = typeProfile(cand.pokemon, gen, profiles);
    let cover = 0;
    let adds = 0;
    for (const t of problem) {
      if (prof.resist.has(t)) cover++;
      else if (prof.weak.has(t)) adds++;
    }
    // Coverage dominates; usage (≈0–50) breaks ties.
    const score = cover * 10 - adds * 5 + cand.usage_pct * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = cand.pokemon;
    }
  }
  return best;
}

/**
 * League type-quota state for slot filling. `required` are the types that need
 * coverage (the player's assigned core, or the ruleset's fixed types);
 * `minPerType` is how many of each are needed; `allowMulti` mirrors the
 * validator — when false only a mon's PRIMARY type counts toward a quota.
 */
interface QuotaSpec {
  required: string[];
  minPerType: number;
  allowMulti: boolean;
}

/** Count how many chosen mons satisfy each required type (validator semantics). */
function quotaCounts(chosen: string[], spec: QuotaSpec, gen: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of spec.required) counts.set(t, 0);
  for (const sp of chosen) {
    const types = speciesTypes(sp, gen);
    if (spec.allowMulti) {
      for (const t of types) if (counts.has(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
    } else {
      const primary = types[0];
      if (primary && counts.has(primary)) counts.set(primary, (counts.get(primary) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Pick the highest-usage candidate that helps an UNMET type quota. Returns null
 * when there is no quota, all quotas are already met, or no candidate of a
 * deficient type exists (caller then falls back to coverage-based picking).
 */
function pickForQuota(
  chosen: string[],
  pool: UsageStatsPokemon[],
  usedBase: Set<string>,
  gen: number,
  spec: QuotaSpec | null,
): string | null {
  if (!spec || spec.required.length === 0 || spec.minPerType <= 0) return null;
  const counts = quotaCounts(chosen, spec, gen);
  const deficit = spec.required.filter((t) => (counts.get(t) ?? 0) < spec.minPerType);
  if (deficit.length === 0) return null;

  let best: string | null = null;
  let bestUsage = -Infinity;
  for (const cand of pool) {
    if (usedBase.has(baseKey(cand.pokemon, gen))) continue;
    const types = speciesTypes(cand.pokemon, gen);
    if (types.length === 0) continue;
    const helps = spec.allowMulti
      ? deficit.some((t) => types.includes(t))
      : deficit.includes(types[0]);
    if (!helps) continue;
    if (cand.usage_pct > bestUsage) {
      bestUsage = cand.usage_pct;
      best = cand.pokemon;
    }
  }
  return best;
}

// ─── Set building ────────────────────────────────────────────────────

function lowerKeyMap<T>(src: Record<string, T> | undefined): Map<string, T> {
  const map = new Map<string, T>();
  if (src) for (const [k, v] of Object.entries(src)) map.set(k.toLowerCase(), v);
  return map;
}

/** A reasonable fallback spread when usage data has no spread for a mon. */
function defaultSpread(baseStats: { atk: number; spa: number }): { nature: string; evs: StatSpread } {
  const physical = baseStats.atk >= baseStats.spa;
  return {
    nature: physical ? 'Jolly' : 'Timid',
    evs: {
      hp: 4,
      atk: physical ? 252 : 0,
      def: 0,
      spa: physical ? 0 : 252,
      spd: 0,
      spe: 252,
    },
  };
}

/** Up to `n` legal damaging moves for a species, strongest first. */
async function topDamagingMoves(species: string, gen: number, n: number): Promise<string[]> {
  const moves = await listMovesForSpecies(species, gen);
  return moves
    .filter((m) => m.basePower > 0)
    .sort((a, b) => b.basePower - a.basePower)
    .slice(0, n)
    .map((m) => m.name);
}

/** Lowercased ban lists for moves/items/abilities, used to gate set building. */
interface BannedSets {
  moves: Set<string>;
  items: Set<string>;
  abilities: Set<string>;
}
const lowerSet = (arr: string[] | undefined): Set<string> =>
  new Set((arr ?? []).map((s) => s.toLowerCase()));

async function buildSet(
  species: string,
  usage: UsageStatsPokemon | undefined,
  gen: number,
  reqItems: Map<string, string>,
  reqMoves: Map<string, string[]>,
  banned: BannedSets,
  notes: string[],
): Promise<BuiltSet> {
  const look = await lookupPokemon({ species, gen });
  const notBannedMove = (m: string) => isReal(m) && !banned.moves.has(m.toLowerCase());
  const legalAbilities = getLegalAbilities(species, gen)
    .map((a) => a.name)
    .filter((a) => !banned.abilities.has(a.toLowerCase()));

  // Ability: most-used (if legal & unbanned) else the species' first legal ability.
  const topAbility = usage?.abilities
    .map((a) => a.name)
    .find((a) => isReal(a) && !banned.abilities.has(a.toLowerCase()));
  const ability =
    (topAbility && legalAbilities.find((n) => eq(n, topAbility))) || legalAbilities[0] || '';

  // Item: requested override (if unbanned) → most-used unbanned → none.
  const requestedItem = reqItems.get(species.toLowerCase());
  const item =
    (requestedItem && !banned.items.has(requestedItem.toLowerCase()) ? requestedItem : undefined) ??
    usage?.items.map((i) => i.name).find((i) => isReal(i) && !banned.items.has(i.toLowerCase())) ??
    '';

  // Moves: requested override → most-used → strongest legal damaging moves,
  // always excluding banned moves.
  const override = reqMoves.get(species.toLowerCase());
  let moves: string[] = [];
  if (override && override.length > 0) {
    moves = override.filter(notBannedMove).slice(0, 4);
  } else {
    for (const m of (usage?.moves ?? []).map((x) => x.name).filter(notBannedMove)) {
      if (moves.length >= 4) break;
      if (!moves.some((x) => eq(x, m))) moves.push(m);
    }
  }
  if (moves.length < 4) {
    for (const m of await topDamagingMoves(species, gen, 8)) {
      if (moves.length >= 4) break;
      if (!notBannedMove(m)) continue;
      if (!moves.some((x) => eq(x, m))) moves.push(m);
    }
  }
  if (moves.length === 0) {
    notes.push(`Could not resolve any legal moves for ${species}.`);
    moves = ['Tackle'];
  }

  // Spread: most-used → stat-based default.
  let nature = 'Hardy';
  let evs: StatSpread = { ...ZERO_EVS };
  const usageSpread = usage?.spreads[0]?.name ? parseSpread(usage.spreads[0].name) : null;
  if (usageSpread) {
    nature = usageSpread.nature;
    evs = usageSpread.evs;
  } else if (look) {
    const d = defaultSpread(look.baseStats);
    nature = d.nature;
    evs = d.evs;
  }

  // Tera (gen 9+): most-used tera type, else the mon's primary type.
  const teraType =
    gen >= 9 ? usage?.teraTypes.map((t) => t.name).find(isReal) ?? look?.types[0] : undefined;

  return { species: look?.species ?? species, item, ability, nature, evs, moves, teraType, level: 100 };
}

// ─── Repair (move-legality + ban fixes from validateTeam issues) ─────

async function repairTeam(
  sets: BuiltSet[],
  issues: ValidateTeamIssue[],
  gen: number,
  bannedMoves: Set<string>,
): Promise<BuiltSet[]> {
  const next = sets.map((s) => ({ ...s, moves: [...s.moves] }));
  const touched = new Set<number>();

  for (const issue of issues) {
    if (issue.severity !== 'error') continue;
    const set = next[issue.pokemon_index];
    if (!set) continue;

    // Illegal / unknown move → drop it and refill.
    const badMove =
      issue.issue.match(/cannot legally learn (.+)$/)?.[1] ??
      issue.issue.match(/Unknown move: (.+)$/)?.[1];
    if (badMove) {
      set.moves = set.moves.filter((m) => !eq(m, badMove));
      touched.add(issue.pokemon_index);
      continue;
    }

    // "X is banned" → strip X from whichever field carries it (move or item).
    const bannedName = issue.issue.match(/^(.+) is banned$/)?.[1];
    if (bannedName) {
      if (set.moves.some((m) => eq(m, bannedName))) {
        set.moves = set.moves.filter((m) => !eq(m, bannedName));
        touched.add(issue.pokemon_index);
      } else if (set.item && eq(set.item, bannedName)) {
        set.item = '';
      }
    }
  }

  // Refill any set we pruned with strong legal, non-banned moves.
  for (const idx of touched) {
    const set = next[idx];
    for (const m of await topDamagingMoves(set.species, gen, 12)) {
      if (set.moves.length >= 4) break;
      if (bannedMoves.has(m.toLowerCase())) continue;
      if (!set.moves.some((x) => eq(x, m))) set.moves.push(m);
    }
    if (set.moves.length === 0) set.moves = ['Tackle'];
  }

  return next;
}

// ─── Coverage report ─────────────────────────────────────────────────

function coverageReport(
  sets: BuiltSet[],
  gen: number,
  profiles: Map<string, TypeProfile>,
): BuildTeamResult['coverage'] {
  const weak = new Map<string, number>();
  const resist = new Map<string, number>();
  for (const s of sets) {
    const prof = typeProfile(s.species, gen, profiles);
    for (const t of prof.weak) weak.set(t, (weak.get(t) ?? 0) + 1);
    for (const t of prof.resist) resist.set(t, (resist.get(t) ?? 0) + 1);
  }
  const collect = (m: Map<string, number>): CoverageEntry[] =>
    [...m.entries()]
      .filter(([, c]) => c >= 2)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  return { weakTo: collect(weak), resistedBy: collect(resist) };
}

// ─── Conversions ─────────────────────────────────────────────────────

function toValidateInput(set: BuiltSet): ValidateTeamInput['team'][number] {
  return {
    species: set.species,
    item: set.item || undefined,
    ability: set.ability || undefined,
    nature: set.nature,
    evs: set.evs,
    level: set.level,
    moves: set.moves,
    teraType: set.teraType,
  };
}

function toPokemonSet(set: BuiltSet): PokemonSet {
  return {
    name: '',
    species: set.species,
    gender: '',
    item: set.item,
    ability: set.ability,
    evs: set.evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: set.nature,
    level: set.level,
    moves: set.moves,
    tera_type: set.teraType,
  };
}

// ─── buildTeam ───────────────────────────────────────────────────────

export async function buildTeam(input: BuildTeamInput): Promise<BuildTeamResult> {
  const { format } = input;
  const gen = parseGenFromFormat(format);
  const teamSize = input.team_size ?? 6;
  const notes: string[] = [];
  const profiles = new Map<string, TypeProfile>();
  const reqItems = lowerKeyMap(input.requested_items);
  const reqMoves = lowerKeyMap(input.requested_moves);

  // 0. League ruleset (real bans + team constraints) when supplied — gates the
  // candidate pool and slot-filling so we don't propose mons the validator will
  // reject. An unresolvable id soft-falls back to an unconstrained build.
  let ruleset: Ruleset | null = null;
  let rulesetLoadFailed = false;
  if (input.ruleset_id) {
    try {
      ruleset = await getRulesetById(input.ruleset_id);
      if (!ruleset) rulesetLoadFailed = true;
    } catch {
      rulesetLoadFailed = true;
    }
    if (rulesetLoadFailed) {
      notes.push(
        'LEAGUE RULESET COULD NOT BE LOADED — this team was built WITHOUT the league bans and constraints (type quota, NFE/evolution caps and custom bans were NOT enforced). Tell the player it is not validated against the league rules.',
      );
    }
  }
  const playerCore = (input.player_core as CoreTriple | undefined) ?? null;
  const bannedBase = new Set((ruleset?.bans.pokemon ?? []).map((n) => baseKey(n, gen)));
  const isBanned = (species: string) => bannedBase.has(baseKey(species, gen));
  const banned: BannedSets = {
    moves: lowerSet(ruleset?.bans.moves),
    items: lowerSet(ruleset?.bans.items),
    abilities: lowerSet(ruleset?.bans.abilities),
  };

  // Type-quota spec from the ruleset (assigned core or fixed types).
  const tq = ruleset?.team_constraints?.type_quotas ?? null;
  const quotaSpec: QuotaSpec | null = tq
    ? {
        required: tq.source === 'player_core' ? (playerCore ?? []) : (tq.fixed_types ?? []),
        minPerType: tq.min_per_type,
        allowMulti: tq.allow_multi_count,
      }
    : null;
  if (tq?.source === 'player_core' && (!playerCore || playerCore.length !== 3)) {
    notes.push('This ruleset requires an assigned core, but none was provided — the type quota cannot be satisfied deliberately.');
  }

  // 1. Validate requested cores exist in this generation (and aren't banned).
  const cores: string[] = [];
  for (const name of input.core_pokemon ?? []) {
    const look = await lookupPokemon({ species: name, gen });
    if (!look) {
      notes.push(`Requested core "${name}" was not found in gen ${gen}; skipping it.`);
      continue;
    }
    if (isBanned(look.species)) {
      notes.push(`Requested core "${look.species}" is banned in this league ruleset; skipping it.`);
      continue;
    }
    cores.push(look.species);
  }

  // 2. Candidate pool (ban-filtered) + slot filling.
  const usage = await getUsageStats({ format });
  const usageByName = new Map(usage.pokemon.map((p) => [p.pokemon.toLowerCase(), p]));
  const pool = usage.pokemon.filter((p) => !isBanned(p.pokemon));
  if (usage.pokemon.length === 0) {
    notes.push(`No usage stats available for ${format}; only requested cores were placed.`);
  }

  const chosen: string[] = [];
  const usedBase = new Set<string>();
  for (const c of cores) {
    const bk = baseKey(c, gen);
    if (usedBase.has(bk)) continue;
    chosen.push(c);
    usedBase.add(bk);
  }
  while (chosen.length < teamSize) {
    // Unmet type quotas come first (hard legality), then defensive coverage.
    const cand =
      pickForQuota(chosen, pool, usedBase, gen, quotaSpec) ??
      pickNextCandidate(chosen, pool, usedBase, gen, profiles);
    if (!cand) break;
    chosen.push(cand);
    usedBase.add(baseKey(cand, gen));
  }
  if (chosen.length < teamSize) {
    notes.push(`Assembled ${chosen.length}/${teamSize} Pokémon — the candidate pool was exhausted.`);
  }

  // 3. Build each mon's set from usage data (+ overrides), excluding banned
  // moves/items/abilities at selection time.
  let sets: BuiltSet[] = [];
  for (const species of chosen) {
    sets.push(await buildSet(species, usageByName.get(species.toLowerCase()), gen, reqItems, reqMoves, banned, notes));
  }

  // 4. Validate against the real ruleset + core, repairing move-legality and
  // ban issues up to MAX_REPAIRS times.
  const validateArgs = { format, ruleset_id: input.ruleset_id, player_core: input.player_core };
  let validation = await validateTeam({ ...validateArgs, team: sets.map(toValidateInput) });
  for (let i = 0; i < MAX_REPAIRS && !validation.valid; i++) {
    sets = await repairTeam(sets, validation.issues, gen, banned.moves);
    validation = await validateTeam({ ...validateArgs, team: sets.map(toValidateInput) });
  }
  if (!validation.valid) {
    notes.push('Team still has legality issues after repair attempts — see `issues`.');
  }

  // 5. Export + publish.
  const paste = exportTeamText(sets.map(toPokemonSet));
  let pasteUrl: string | null = null;
  try {
    const published = await createPokepaste({ paste, title: `${format} team (auto-built)` });
    pasteUrl = published.url;
  } catch {
    notes.push('Could not publish the team to pokepast.es.');
  }

  return {
    format,
    team: sets,
    paste,
    pasteUrl,
    coverage: coverageReport(sets, gen, profiles),
    valid: validation.valid,
    issues: validation.issues,
    team_issues: validation.team_issues,
    notes,
    ruleset_load_failed: rulesetLoadFailed,
  };
}
