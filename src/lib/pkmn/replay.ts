import { Generations } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import { Battle } from '@pkmn/client';
import { Protocol } from '@pkmn/protocol';
import type { ParsedBattleStats, ParsedPokemonStat, ReplayData } from '@/types/game';
import {
  isSameReplayPokemonEntity,
  stripHiddenPreviewSuffix,
} from '@/lib/pkmn/replay-species';

const gens = new Generations(Dex);

/**
 * Normalizes a Showdown replay URL or bare ID for fetching.
 * Strips fragments, query strings, host prefix, trailing slashes, and `.json`.
 */
export function normalizeReplayUrlOrId(urlOrId: string): string {
  const withoutFragmentOrQuery = urlOrId.split('#')[0].split('?')[0];
  return withoutFragmentOrQuery
    .replace(/^https?:\/\/replay\.pokemonshowdown\.com\//, '')
    .replace(/\.json$/, '')
    .replace(/\/$/, '');
}

/**
 * Fetches a replay from Pokémon Showdown.
 * Accepts full URLs or bare replay IDs.
 */
export async function fetchReplay(urlOrId: string): Promise<ReplayData> {
  const id = normalizeReplayUrlOrId(urlOrId);

  const res = await fetch(`https://replay.pokemonshowdown.com/${id}.json`, {
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch replay: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (!json.log || !json.players) {
    throw new Error('Invalid replay format: missing log or players');
  }

  return {
    id: json.id ?? id,
    format: json.format ?? '',
    players: [json.players[0] ?? json.p1, json.players[1] ?? json.p2],
    winner: json.winner ?? '',
    log: json.log,
  };
}

// ─── Kill Attribution Types ──────────────────────────────────────────

/** Identifies a Pokémon by side + species name (matches PokemonTracker keys) */
interface PokemonRef {
  side: string;   // "p1" or "p2"
  pokemon: string; // species name (PokemonTracker map key)
}

type DamageKind =
  | 'move'        // Direct move damage
  | 'hazard'      // Stealth Rock, Spikes
  | 'weather'     // Sandstorm, Hail
  | 'status'      // brn, psn, tox
  | 'leech_seed'
  | 'trap'        // Wrap, Bind, Fire Spin, etc.
  | 'item'        // Life Orb, Rocky Helmet, Black Sludge
  | 'ability'     // Iron Barbs, Rough Skin, Aftermath, Bad Dreams
  | 'recoil'      // Recoil, Struggle
  | 'curse'       // Ghost Curse
  | 'unknown';

/** Describes the source of damage a Pokémon last received */
interface DamageSource {
  kind: DamageKind;
  /** The Pokémon responsible (null = self-inflicted or unknown) */
  attacker: PokemonRef | null;
}

/** Central state for kill attribution tracking */
interface AttributionState {
  /** Who set each hazard on each side: side → hazardName → setter */
  hazards: Record<string, Map<string, PokemonRef>>;
  /** Who set the current weather */
  weatherSetter: PokemonRef | null;
  /** Current weather name */
  currentWeather: string | null;
  /** Who inflicted each Pokémon's status: pokemonKey → inflicter */
  statusInflicter: Map<string, PokemonRef>;
  /** Who Leech Seeded each Pokémon */
  leechSeedSource: Map<string, PokemonRef>;
  /** Who is trapping each Pokémon (partial trap moves) */
  trapSource: Map<string, PokemonRef>;
  /** Who cursed each Pokémon (Ghost Curse) */
  curseSource: Map<string, PokemonRef>;
  /** Who used Perish Song affecting each Pokémon */
  perishSongUser: Map<string, PokemonRef>;
  /** Last damage event per Pokémon (used on faint to determine cause) */
  lastDamageSource: Map<string, DamageSource>;
  /** Last opposing Pokémon that dealt damage to each Pokémon (persists across turns) */
  lastOpposingDamager: Map<string, PokemonRef>;
  /** Most recent move user */
  lastMoveUser: PokemonRef | null;
  /** Currently active Pokémon per side */
  activePokemon: Record<string, PokemonRef | null>;
}

const PARTIAL_TRAP_MOVES = new Set([
  'Wrap', 'Bind', 'Fire Spin', 'Whirlpool', 'Sand Tomb',
  'Magma Storm', 'Infestation', 'Thunder Cage', 'Clamp', 'Snap Trap',
  'G-Max Centiferno', 'G-Max Sandblast',
]);

const SELF_INFLICTED_KINDS = new Set<DamageKind>(['recoil']);

// ─── Per-Pokémon Stats Tracker ───────────────────────────────────────

/** Tracker counters captured at switch-in; an Illusion reveal rolls the disguise window back. */
interface ActivationBaseline {
  kos_dealt: number;
  turns_active: number;
  moves_used: Set<string>;
  was_brought: boolean;
  was_lead: boolean;
}

interface PokemonTracker {
  pokemon_name: string;
  was_brought: boolean;
  was_lead: boolean;
  kos_dealt: number;
  was_koed: boolean;
  moves_used: Set<string>;
  turns_active: number;
  is_active: boolean;
  first_seen_turn: number;
  activationBaseline: ActivationBaseline | null;
}

/**
 * Parses a PS replay log into structured battle stats.
 *
 * Uses @pkmn/client Battle to maintain state and @pkmn/protocol
 * parseBattleLine for kwArgs access (damage sources, hazard setters, etc.).
 * Tracks passive damage sources (hazards, weather, status, traps, etc.)
 * and attributes kills to the correct Pokémon.
 */
export function parseReplayLog(log: string): ParsedBattleStats {
  const battle = new Battle(gens);
  const lines = log.split('\n');

  // Per-player tracking: p1 and p2
  const trackers: Record<string, Map<string, PokemonTracker>> = {
    p1: new Map(),
    p2: new Map(),
  };

  let winner_ps_username = '';
  let currentTurn = 0;

  // Attribution state
  const attr: AttributionState = {
    hazards: { p1: new Map(), p2: new Map() },
    weatherSetter: null,
    currentWeather: null,
    statusInflicter: new Map(),
    leechSeedSource: new Map(),
    trapSource: new Map(),
    curseSource: new Map(),
    perishSongUser: new Map(),
    lastDamageSource: new Map(),
    lastOpposingDamager: new Map(),
    lastMoveUser: null,
    activePokemon: { p1: null, p2: null },
  };

  // Maps ident slot (e.g. "p1a") to tracker key for attribution (first-seen species name)
  const slotToSpecies = new Map<string, string>();
  // Maps slot to tracker map key — enables same-slot forme continuity (Mimikyu / Mimikyu-Busted)
  const slotToTrackerKey = new Map<string, string>();

  // ─── Helpers ─────────────────────────────────────────────────────

  function extractSide(ident: string): string {
    const match = ident.match(/^(p[1-4])/);
    return match ? match[1] : 'p1';
  }

  function extractSlot(ident: string): string {
    // "p1a: Pikachu" → "p1a"
    const colonIdx = ident.indexOf(':');
    return colonIdx >= 0 ? ident.slice(0, colonIdx).trim() : ident.slice(0, 3);
  }

  function extractName(ident: string): string {
    const colonIdx = ident.indexOf(': ');
    return colonIdx >= 0 ? ident.slice(colonIdx + 2) : ident;
  }

  function extractSpeciesFromDetails(details: string): string {
    return stripHiddenPreviewSuffix(details.split(',')[0].trim());
  }

  function opposingSide(side: string): string {
    return side === 'p1' ? 'p2' : 'p1';
  }

  /** Resolve a Pokémon ident to a species-based key for attribution maps */
  function pokemonKey(ident: string): string {
    const side = extractSide(ident);
    const slot = extractSlot(ident);
    const species = slotToSpecies.get(slot) ?? extractName(ident);
    return species + '|' + side;
  }

  /** Resolve a Pokémon ident to a PokemonRef using species from slot map */
  function identToRef(ident: string): PokemonRef {
    const side = extractSide(ident);
    const slot = extractSlot(ident);
    const species = slotToSpecies.get(slot);
    if (species) return { side, pokemon: species };
    // Fallback: check if active Pokémon on that side matches
    const active = attr.activePokemon[side];
    if (active) return active;
    return { side, pokemon: extractName(ident) };
  }

  function getOrCreateTracker(side: string, pokemonName: string, brought = false): PokemonTracker {
    const name = stripHiddenPreviewSuffix(pokemonName);
    const sideTrackers = trackers[side];
    if (!sideTrackers) return createTracker(name, brought);

    const existing = sideTrackers.get(name);
    if (existing) {
      if (brought) existing.was_brought = true;
      return existing;
    }

    const tracker = createTracker(name, brought);
    tracker.first_seen_turn = currentTurn;
    sideTrackers.set(name, tracker);
    return tracker;
  }

  /** Find an existing tracker for the same dex entity (e.g. Mimikyu returning after Volt Switch). */
  function findTrackerByEntity(side: string, name: string): PokemonTracker | undefined {
    for (const tracker of Array.from(trackers[side].values())) {
      if (isSameReplayPokemonEntity(tracker.pokemon_name, name)) {
        return tracker;
      }
    }
    return undefined;
  }

  /** Switch/drag: reuse tracker for same-slot forme aliases or same entity re-entering the field. */
  function getOrCreateTrackerForSwitch(
    side: string,
    slot: string,
    pokemonName: string,
  ): PokemonTracker {
    const name = stripHiddenPreviewSuffix(pokemonName);
    const sideTrackers = trackers[side];
    const prevKey = slotToTrackerKey.get(slot);

    let tracker: PokemonTracker;
    if (prevKey && sideTrackers?.has(prevKey) && isSameReplayPokemonEntity(prevKey, name)) {
      tracker = sideTrackers.get(prevKey)!;
    } else {
      tracker = findTrackerByEntity(side, name) ?? getOrCreateTracker(side, name, false);
    }

    captureActivationBaseline(tracker);
    tracker.was_brought = true;
    slotToTrackerKey.set(slot, tracker.pokemon_name);
    slotToSpecies.set(slot, tracker.pokemon_name);
    return tracker;
  }

  function captureActivationBaseline(tracker: PokemonTracker): void {
    tracker.activationBaseline = {
      kos_dealt: tracker.kos_dealt,
      turns_active: tracker.turns_active,
      moves_used: new Set(tracker.moves_used),
      was_brought: tracker.was_brought,
      was_lead: tracker.was_lead,
    };
  }

  function syncSlotAfterFormeChange(ident: string, rawSpecies: string): void {
    const side = extractSide(ident);
    const slot = extractSlot(ident);
    const prevKey = slotToTrackerKey.get(slot);
    const trackerKey = prevKey ?? stripHiddenPreviewSuffix(rawSpecies);
    slotToSpecies.set(slot, trackerKey);
    if (prevKey) {
      attr.activePokemon[side] = { side, pokemon: prevKey };
    }
  }

  function createTracker(pokemonName: string, brought = false): PokemonTracker {
    return {
      pokemon_name: pokemonName,
      was_brought: brought,
      was_lead: false,
      kos_dealt: 0,
      was_koed: false,
      moves_used: new Set(),
      turns_active: 0,
      is_active: false,
      first_seen_turn: currentTurn,
      activationBaseline: null,
    };
  }

  function findActiveTracker(side: string): PokemonTracker | undefined {
    for (const t of Array.from(trackers[side].values())) {
      if (t.is_active) return t;
    }
    return undefined;
  }

  /**
   * Rewrite stored PokemonRefs that point at one tracker key (species) so they point at
   * another — used when an Illusion reveal shows that refs recorded during the disguise
   * window (hazard setters, damage attackers, status inflicters) name the revealed mon.
   */
  function rewriteAttributionRefs(side: string, fromKey: string, toKey: string): void {
    const fix = (ref: PokemonRef | null): PokemonRef | null =>
      ref && ref.side === side && ref.pokemon === fromKey ? { side, pokemon: toKey } : ref;

    for (const hazardMap of Object.values(attr.hazards)) {
      for (const [hazard, ref] of Array.from(hazardMap.entries())) {
        const fixed = fix(ref);
        if (fixed) hazardMap.set(hazard, fixed);
      }
    }
    attr.weatherSetter = fix(attr.weatherSetter);
    for (const map of [
      attr.statusInflicter,
      attr.leechSeedSource,
      attr.trapSource,
      attr.curseSource,
      attr.perishSongUser,
      attr.lastOpposingDamager,
    ]) {
      for (const [key, ref] of Array.from(map.entries())) {
        const fixed = fix(ref);
        if (fixed) map.set(key, fixed);
      }
    }
    for (const [key, source] of Array.from(attr.lastDamageSource.entries())) {
      const attacker = fix(source.attacker);
      if (attacker !== source.attacker) {
        attr.lastDamageSource.set(key, { ...source, attacker });
      }
    }
  }

  /**
   * An Illusion broke: the log revealed that a slot's "species" (nickname and details it
   * copied from a teammate) is actually a different Pokémon. The stats accumulated on the
   * copied species' tracker since the slot switched in belong to the revealed Pokémon, so
   * the disguise window's delta migrates to the revealed species' tracker and the copied
   * tracker rolls back to its pre-window baseline.
   */
  function applyIllusionBreak(ident: string, details: string): void {
    const side = extractSide(ident);
    const slot = extractSlot(ident);
    const revealedSpecies = extractSpeciesFromDetails(details);
    const sideTrackers = trackers[side];
    const illusionKey = slotToTrackerKey.get(slot);
    if (!sideTrackers || !illusionKey) return;

    const illusionTracker = sideTrackers.get(illusionKey);
    if (!illusionTracker) return;

    const revealed =
      sideTrackers.get(revealedSpecies) ??
      findTrackerByEntity(side, revealedSpecies) ??
      getOrCreateTracker(side, revealedSpecies, false);

    // A disguise as the same species needs no split — one tracker row serves both.
    if (revealed.pokemon_name === illusionKey) return;

    const base = illusionTracker.activationBaseline;
    if (base) {
      revealed.kos_dealt += illusionTracker.kos_dealt - base.kos_dealt;
      revealed.turns_active += illusionTracker.turns_active - base.turns_active;
      for (const move of Array.from(illusionTracker.moves_used)) {
        if (!base.moves_used.has(move)) revealed.moves_used.add(move);
      }
      if (illusionTracker.was_lead && !base.was_lead) revealed.was_lead = true;

      illusionTracker.kos_dealt = base.kos_dealt;
      illusionTracker.turns_active = base.turns_active;
      illusionTracker.moves_used = base.moves_used;
      illusionTracker.was_brought = base.was_brought;
      illusionTracker.was_lead = base.was_lead;
      illusionTracker.activationBaseline = null;

      // When the copied tracker had no activity before the disguise window, every stored
      // ref to its species must have been recorded during the window — those are the
      // revealed mon's actions, so rewrite them (a tracker with pre-window activity keeps
      // its refs: they cannot be told apart from window refs).
      if (
        !base.was_brought &&
        base.kos_dealt === 0 &&
        base.turns_active === 0 &&
        base.moves_used.size === 0
      ) {
        rewriteAttributionRefs(side, illusionKey, revealed.pokemon_name);
      }
    }

    revealed.was_brought = true;
    revealed.is_active = illusionTracker.is_active;
    illusionTracker.is_active = false;

    if (attr.activePokemon[side]?.pokemon === illusionKey) {
      attr.activePokemon[side] = { side, pokemon: revealed.pokemon_name };
    }
    if (attr.lastMoveUser?.side === side && attr.lastMoveUser.pokemon === illusionKey) {
      attr.lastMoveUser = { side, pokemon: revealed.pokemon_name };
    }

    slotToTrackerKey.set(slot, revealed.pokemon_name);
    slotToSpecies.set(slot, revealed.pokemon_name);

    // Damage/secondary tracking pending under the copied species' target key follows the
    // reveal (e.g. the hit that broke the Illusion is resolved at the upcoming |faint|).
    const oldKey = `${illusionKey}|${side}`;
    const newKey = `${revealed.pokemon_name}|${side}`;
    const dmgSource = attr.lastDamageSource.get(oldKey);
    if (dmgSource !== undefined) {
      attr.lastDamageSource.delete(oldKey);
      attr.lastDamageSource.set(newKey, dmgSource);
    }
    for (const map of [
      attr.lastOpposingDamager,
      attr.statusInflicter,
      attr.leechSeedSource,
      attr.trapSource,
      attr.curseSource,
      attr.perishSongUser,
    ]) {
      const entry = map.get(oldKey);
      if (entry !== undefined) {
        map.delete(oldKey);
        map.set(newKey, entry);
      }
    }
  }

  // ─── Damage Classification ──────────────────────────────────────

  function classifyDamageSource(
    from: string,
    ofIdent: string | null,
    targetKey: string,
    targetSide: string,
  ): DamageSource {
    // Hazards
    if (from === 'Stealth Rock' || from === 'Spikes') {
      const setter = attr.hazards[targetSide]?.get(from) ?? null;
      return { kind: 'hazard', attacker: setter };
    }

    // Weather
    if (from === 'Sandstorm' || from === 'Hail' || from === 'hail') {
      return { kind: 'weather', attacker: attr.weatherSetter };
    }

    // Status conditions
    if (from === 'brn' || from === 'psn' || from === 'tox') {
      const inflicter = attr.statusInflicter.get(targetKey) ?? null;
      return { kind: 'status', attacker: inflicter };
    }

    // Leech Seed
    if (from === 'Leech Seed') {
      const seeder = ofIdent
        ? identToRef(ofIdent)
        : (attr.leechSeedSource.get(targetKey) ?? null);
      return { kind: 'leech_seed', attacker: seeder };
    }

    // Curse (Ghost)
    if (from === 'Curse') {
      return { kind: 'curse', attacker: attr.curseSource.get(targetKey) ?? null };
    }

    // Nightmare
    if (from === 'Nightmare') {
      return { kind: 'curse', attacker: null };
    }

    // Recoil / Struggle
    if (from === 'recoil' || from === 'Recoil' || from === 'Struggle' || from === 'struggle') {
      return { kind: 'recoil', attacker: null };
    }

    // Items
    if (from.startsWith('item:')) {
      const itemName = from.slice(5).trim();
      if (itemName === 'Life Orb') {
        // Self-inflicted
        return { kind: 'item', attacker: null };
      }
      // Rocky Helmet, Black Sludge, Sticky Barb, etc. — [of] is the holder
      const source = ofIdent ? identToRef(ofIdent) : null;
      return { kind: 'item', attacker: source };
    }

    // Abilities (Iron Barbs, Rough Skin, Aftermath, Bad Dreams, etc.)
    if (from.startsWith('ability:')) {
      const source = ofIdent ? identToRef(ofIdent) : null;
      return { kind: 'ability', attacker: source };
    }

    // Partial trap moves
    if (from.startsWith('move:')) {
      const moveName = from.slice(5).trim();
      if (PARTIAL_TRAP_MOVES.has(moveName)) {
        const trapper = ofIdent
          ? identToRef(ofIdent)
          : (attr.trapSource.get(targetKey) ?? null);
        return { kind: 'trap', attacker: trapper };
      }
    }

    return { kind: 'unknown', attacker: null };
  }

  /**
   * Resolve the Pokémon to credit for a kill.
   * For self-inflicted damage: use lastOpposingDamager, then fallback to opposing active.
   */
  function resolveKillCredit(
    dmgSource: DamageSource | undefined,
    targetKey: string,
    targetSide: string,
  ): PokemonRef | null {
    if (dmgSource) {
      const isSelfInflicted =
        SELF_INFLICTED_KINDS.has(dmgSource.kind) ||
        (dmgSource.kind === 'item' && dmgSource.attacker === null);

      if (isSelfInflicted) {
        // Self-inflicted: credit last opposing Pokémon that damaged this one
        return attr.lastOpposingDamager.get(targetKey)
          ?? attr.activePokemon[opposingSide(targetSide)]
          ?? null;
      }

      // Non-self-inflicted: credit the tracked attacker
      if (dmgSource.attacker) return dmgSource.attacker;

      // Attacker unknown but damage was from an external source — fallback
      return attr.lastOpposingDamager.get(targetKey)
        ?? attr.activePokemon[opposingSide(targetSide)]
        ?? null;
    }

    // No damage source recorded (Perish Song, Destiny Bond, or edge case)
    const perishUser = attr.perishSongUser.get(targetKey);
    if (perishUser) return perishUser;

    // Final fallback: opposing active Pokémon
    return attr.activePokemon[opposingSide(targetSide)] ?? null;
  }

  // ─── Main Parse Loop ────────────────────────────────────────────

  for (const line of lines) {
    if (!line.startsWith('|')) continue;

    // Feed every line to the Battle state machine
    try {
      battle.add(line);
    } catch {
      // Some lines may not be parseable; that's fine
    }

    const { args, kwArgs } = Protocol.parseBattleLine(line);
    if (!args) continue;

    const cmd = args[0];
    // Cast kwArgs for typed access — fields are optional
    const kw = kwArgs as { from?: string; of?: string; upkeep?: true };

    switch (cmd) {
      // ── Turn ──────────────────────────────────────────────────
      case 'turn': {
        currentTurn = parseInt(args[1] as string, 10);
        for (const side of ['p1', 'p2']) {
          for (const tracker of Array.from(trackers[side].values())) {
            if (tracker.is_active) {
              tracker.turns_active++;
            }
          }
        }
        break;
      }

      // ── Team Preview (poke) ─────────────────────────────────────
      case 'poke': {
        // |poke|p1|Species, L50, F|item — registers team members before battle
        const side = args[1] as string;
        const details = args[2] as string;
        const species = extractSpeciesFromDetails(details);
        // Create tracker with was_brought=false; will be set to true on switch-in
        getOrCreateTracker(side, species, false);
        break;
      }

      // ── Switch / Drag ─────────────────────────────────────────
      case 'switch':
      case 'drag': {
        const ident = args[1] as string;
        const details = args[2] as string;
        const side = extractSide(ident);
        const slot = extractSlot(ident);
        const species = extractSpeciesFromDetails(details);

        // Mark previous active Pokémon on this side as inactive
        for (const tracker of Array.from(trackers[side].values())) {
          if (tracker.is_active) {
            tracker.is_active = false;
          }
        }

        const tracker = getOrCreateTrackerForSwitch(side, slot, species);
        tracker.is_active = true;

        if (currentTurn === 0) {
          tracker.was_lead = true;
        }

        attr.activePokemon[side] = { side, pokemon: tracker.pokemon_name };
        break;
      }

      // ── Forme / details change (same slot, same tracker) ───────
      case 'detailschange': {
        const ident = args[1] as string;
        const details = args[2] as string;
        const species = extractSpeciesFromDetails(details);
        const prevKey = slotToTrackerKey.get(extractSlot(ident));
        // A detailschange to a different dex entity is a legacy Illusion reveal
        // (newer logs announce it via |replace|); same-entity changes stay one tracker.
        if (prevKey && !isSameReplayPokemonEntity(prevKey, species)) {
          applyIllusionBreak(ident, details);
        } else {
          syncSlotAfterFormeChange(ident, species);
        }
        break;
      }

      case '-formechange': {
        const ident = args[1] as string;
        const species = args[2] as string;
        syncSlotAfterFormeChange(ident, species);
        break;
      }

      // ── Illusion break (Zoroark/Zorua revealed) ────────────────
      case 'replace': {
        const ident = args[1] as string;
        const details = args[2] as string;
        applyIllusionBreak(ident, details);
        break;
      }

      // ── Move ──────────────────────────────────────────────────
      case 'move': {
        const ident = args[1] as string;
        const moveName = args[2] as string;
        const side = extractSide(ident);

        const tracker = findActiveTracker(side) ?? trackers[side].get(extractName(ident));
        if (tracker) {
          tracker.moves_used.add(moveName);
          attr.lastMoveUser = { side, pokemon: tracker.pokemon_name };
        }
        break;
      }

      // ── Damage ────────────────────────────────────────────────
      case '-damage': {
        const targetIdent = args[1] as string;
        const targetSide = extractSide(targetIdent);
        const targetKey = pokemonKey(targetIdent);

        let source: DamageSource;
        if (kw.from) {
          source = classifyDamageSource(kw.from, kw.of ?? null, targetKey, targetSide);
        } else {
          // No [from] → direct move damage
          source = {
            kind: 'move',
            attacker: attr.lastMoveUser ? { ...attr.lastMoveUser } : null,
          };
        }

        attr.lastDamageSource.set(targetKey, source);

        // Track last opposing damager for self-inflicted kill attribution
        const attacker = source.attacker;
        if (attacker && attacker.side !== targetSide) {
          attr.lastOpposingDamager.set(targetKey, attacker);
        }
        break;
      }

      // ── Side Conditions (hazard setup) ────────────────────────
      case '-sidestart': {
        const sideArg = args[1] as string;
        const sideStr = extractSide(sideArg);
        const condition = (args[2] as string).replace('move: ', '');

        // The Pokémon that set this hazard is the one that just used a move
        if (attr.lastMoveUser) {
          attr.hazards[sideStr].set(condition, { ...attr.lastMoveUser });
        }
        break;
      }

      case '-sideend': {
        const sideArg = args[1] as string;
        const sideStr = extractSide(sideArg);
        const condition = (args[2] as string).replace('move: ', '');
        attr.hazards[sideStr].delete(condition);
        break;
      }

      // ── Weather ───────────────────────────────────────────────
      case '-weather': {
        const weather = args[1] as string;

        if (weather === 'none') {
          attr.currentWeather = null;
          attr.weatherSetter = null;
        } else if (!kw.upkeep) {
          // New weather being set (not an upkeep tick)
          attr.currentWeather = weather;
          if (kw.of) {
            attr.weatherSetter = identToRef(kw.of);
          } else if (attr.lastMoveUser) {
            attr.weatherSetter = { ...attr.lastMoveUser };
          }
        }
        break;
      }

      // ── Status Infliction ─────────────────────────────────────
      case '-status': {
        const targetIdent = args[1] as string;
        const targetKey = pokemonKey(targetIdent);
        const targetSide = extractSide(targetIdent);

        if (kw.of) {
          // Explicit source (e.g., [from] move: Will-O-Wisp [of] p1a: Charizard)
          attr.statusInflicter.set(targetKey, identToRef(kw.of));
        } else if (kw.from) {
          if (kw.from === 'Toxic Spikes') {
            const setter = attr.hazards[targetSide]?.get('Toxic Spikes');
            if (setter) attr.statusInflicter.set(targetKey, setter);
          } else if (kw.from.startsWith('ability:') || kw.from.startsWith('item:')) {
            // Contact abilities (Flame Body, Static, etc.) — source is opposing active
            const opp = attr.activePokemon[opposingSide(targetSide)];
            if (opp) attr.statusInflicter.set(targetKey, opp);
          } else if (attr.lastMoveUser) {
            attr.statusInflicter.set(targetKey, { ...attr.lastMoveUser });
          }
        } else if (attr.lastMoveUser) {
          // No kwargs — status from a move
          attr.statusInflicter.set(targetKey, { ...attr.lastMoveUser });
        }
        break;
      }

      case '-curestatus': {
        const targetIdent = args[1] as string;
        attr.statusInflicter.delete(pokemonKey(targetIdent));
        break;
      }

      // ── Volatile Conditions (Leech Seed, Curse, traps, Perish Song) ──
      case '-start': {
        const targetIdent = args[1] as string;
        const effect = args[2] as string;
        const targetKey = pokemonKey(targetIdent);

        if (effect === 'move: Leech Seed' || effect === 'Leech Seed') {
          if (kw.of) {
            attr.leechSeedSource.set(targetKey, identToRef(kw.of));
          } else if (attr.lastMoveUser) {
            attr.leechSeedSource.set(targetKey, { ...attr.lastMoveUser });
          }
        } else if (effect === 'Curse') {
          if (attr.lastMoveUser) {
            attr.curseSource.set(targetKey, { ...attr.lastMoveUser });
          }
        } else if (effect === 'perish3' || effect === 'move: Perish Song') {
          // Perish Song count starts at 3 — record who used it
          if (attr.lastMoveUser) {
            attr.perishSongUser.set(targetKey, { ...attr.lastMoveUser });
          }
        } else if (effect.startsWith('move:')) {
          const moveName = effect.slice(5).trim();
          if (PARTIAL_TRAP_MOVES.has(moveName)) {
            if (kw.of) {
              attr.trapSource.set(targetKey, identToRef(kw.of));
            } else if (attr.lastMoveUser) {
              attr.trapSource.set(targetKey, { ...attr.lastMoveUser });
            }
          }
        }
        break;
      }

      case '-end': {
        const targetIdent = args[1] as string;
        const effect = args[2] as string;
        const targetKey = pokemonKey(targetIdent);

        if (effect === 'move: Leech Seed' || effect === 'Leech Seed') {
          attr.leechSeedSource.delete(targetKey);
        } else if (effect === 'Curse') {
          attr.curseSource.delete(targetKey);
        } else if (effect.startsWith('move:')) {
          const moveName = effect.slice(5).trim();
          if (PARTIAL_TRAP_MOVES.has(moveName)) {
            attr.trapSource.delete(targetKey);
          }
        }
        break;
      }

      // ── Destiny Bond activation ───────────────────────────────
      case '-activate': {
        const ident = args[1] as string;
        const effect = args[2] as string;

        if (effect === 'move: Destiny Bond' || effect === 'Destiny Bond') {
          // The next faint of the opponent should be credited to this Pokémon
          const ref = identToRef(ident);
          const oppSide = opposingSide(ref.side);
          const oppActive = attr.activePokemon[oppSide];
          if (oppActive) {
            const oppKey = oppActive.pokemon + '|' + oppSide;
            attr.lastDamageSource.set(oppKey, { kind: 'move', attacker: ref });
            attr.lastOpposingDamager.set(oppKey, ref);
          }
        }
        break;
      }

      // ── Faint ─────────────────────────────────────────────────
      case 'faint': {
        const ident = args[1] as string;
        const side = extractSide(ident);
        const targetKey = pokemonKey(ident);

        // Mark the fainted Pokémon
        const faintedTracker = findActiveTracker(side);
        if (faintedTracker) {
          faintedTracker.was_koed = true;
          faintedTracker.is_active = false;
        }

        // Determine kill attribution
        const dmgSource = attr.lastDamageSource.get(targetKey);
        const attacker = resolveKillCredit(dmgSource, targetKey, side);

        if (attacker && attacker.side !== side) {
          const attackerTracker = trackers[attacker.side].get(attacker.pokemon);
          if (attackerTracker) {
            attackerTracker.kos_dealt++;
          }
        }

        // Clean up tracking for the fainted Pokémon
        attr.lastDamageSource.delete(targetKey);
        attr.lastOpposingDamager.delete(targetKey);
        attr.statusInflicter.delete(targetKey);
        attr.leechSeedSource.delete(targetKey);
        attr.trapSource.delete(targetKey);
        attr.curseSource.delete(targetKey);
        attr.perishSongUser.delete(targetKey);
        break;
      }

      // ── Win ───────────────────────────────────────────────────
      case 'win': {
        winner_ps_username = args[1] as string;
        break;
      }

      // ── Player ────────────────────────────────────────────────
      case 'player': {
        // Player names are captured from the replay data, not here
        break;
      }
    }
  }

  // ─── Build Results ──────────────────────────────────────────────

  const players: ParsedBattleStats['players'] = [];

  for (const [sideId, sideIndex] of [['p1', 0], ['p2', 1]] as const) {
    const sideTrackers = trackers[sideId];
    const pokemon: ParsedPokemonStat[] = [];

    for (const tracker of Array.from(sideTrackers.values())) {
      pokemon.push({
        pokemon_name: tracker.pokemon_name,
        was_brought: tracker.was_brought,
        was_lead: tracker.was_lead,
        kos_dealt: tracker.kos_dealt,
        was_koed: tracker.was_koed,
        moves_used: Array.from(tracker.moves_used),
        turns_active: tracker.turns_active,
      });
    }

    const side = sideIndex === 0 ? battle.p1 : battle.p2;
    players.push({
      ps_username: (side.name as string) || `Player ${sideIndex + 1}`,
      pokemon,
    });
  }

  return {
    winner_ps_username,
    players,
  };
}
