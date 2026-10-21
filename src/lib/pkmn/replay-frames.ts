import { Generations } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import { Battle } from '@pkmn/client';
import { Protocol } from '@pkmn/protocol';
import type {
  BattleFrame,
  SideFrame,
  ActivePokemonFrame,
  TeamMemberFrame,
  SideConditionFrame,
  TurnEvent,
  ReplayMeta,
  ReplayFramesResponse,
} from '@/types/replay-viewer';
import { fetchReplay } from './replay';

const gens = new Generations(Dex);

// ─── Side Condition Display Names ────────────────────────────────────

const SIDE_CONDITION_NAMES: Record<string, string> = {
  stealthrock: 'Stealth Rock',
  spikes: 'Spikes',
  toxicspikes: 'Toxic Spikes',
  stickyweb: 'Sticky Web',
  reflect: 'Reflect',
  lightscreen: 'Light Screen',
  auroraveil: 'Aurora Veil',
  tailwind: 'Tailwind',
  safeguard: 'Safeguard',
  mist: 'Mist',
};

// ─── Snapshot Extraction ─────────────────────────────────────────────

function snapshotPokemon(pokemon: InstanceType<typeof Battle>['p1']['active'][0]): ActivePokemonFrame | null {
  if (!pokemon) return null;

  const hpPercent = pokemon.maxhp > 0
    ? Math.round((pokemon.hp / pokemon.maxhp) * 100)
    : 0;

  // Extract non-zero boosts
  const boosts: Partial<Record<string, number>> = {};
  if (pokemon.boosts) {
    for (const [stat, val] of Object.entries(pokemon.boosts)) {
      if (val !== 0) boosts[stat] = val;
    }
  }

  // Extract volatile status names
  const volatiles = Object.keys(pokemon.volatiles || {});

  return {
    species: ((pokemon as unknown as { speciesForme: string }).speciesForme) ?? pokemon.name,
    level: pokemon.level,
    gender: pokemon.gender as 'M' | 'F' | 'N',
    shiny: pokemon.shiny,
    hp: hpPercent,
    status: pokemon.status ?? null,
    fainted: pokemon.fainted,
    terastallized: (pokemon.terastallized as string) ?? null,
    boosts,
    volatiles,
  };
}

function snapshotTeamMember(pokemon: InstanceType<typeof Battle>['p1']['team'][0]): TeamMemberFrame {
  const hpPercent = pokemon.maxhp > 0
    ? Math.round((pokemon.hp / pokemon.maxhp) * 100)
    : 0;

  return {
    species: ((pokemon as unknown as { speciesForme: string }).speciesForme) ?? pokemon.name,
    fainted: pokemon.fainted,
    active: !pokemon.fainted && pokemon.hp > 0,
    hp: hpPercent,
  };
}

function snapshotSideConditions(
  conditions: Record<string, { name?: string; level?: number }>
): SideConditionFrame[] {
  const result: SideConditionFrame[] = [];
  for (const [id, state] of Object.entries(conditions)) {
    const displayName = SIDE_CONDITION_NAMES[id] ?? String(state.name ?? id);
    result.push({
      name: displayName,
      layers: state.level ?? 1,
    });
  }
  return result;
}

function snapshotSide(side: InstanceType<typeof Battle>['p1']): SideFrame {
  const activePokemon = side.active[0] ?? null;

  return {
    name: side.name as string || '',
    active: snapshotPokemon(activePokemon),
    team: side.team.map(snapshotTeamMember),
    sideConditions: snapshotSideConditions(
      side.sideConditions as Record<string, { name?: string; level?: number }>
    ),
  };
}

function snapshotFrame(
  battle: InstanceType<typeof Battle>,
  turn: number,
  events: TurnEvent[],
  winner?: string,
): BattleFrame {
  const field = battle.field;

  // Extract pseudo-weather names
  const pseudoWeather = Object.keys(field.pseudoWeather || {});

  return {
    turn,
    weather: (field.weather as string) ?? null,
    terrain: (field.terrain as string) ?? null,
    pseudoWeather,
    sides: [snapshotSide(battle.p1), snapshotSide(battle.p2)],
    events: [...events],
    ...(winner ? { winner } : {}),
  };
}

// ─── Protocol Line → Side Index Helper ───────────────────────────────

function sideIndex(ident: string): 0 | 1 {
  return ident.startsWith('p2') ? 1 : 0;
}

function extractName(ident: string): string {
  const colonIdx = ident.indexOf(': ');
  return colonIdx >= 0 ? ident.slice(colonIdx + 2) : ident;
}

function extractSpecies(details: string): string {
  return details.split(',')[0].trim();
}

// ─── Main Frame Extraction ───────────────────────────────────────────

/**
 * Extracts an array of BattleFrame snapshots from a PS replay log.
 *
 * Each frame captures the battle state at a turn boundary plus the
 * events that occurred during that turn (for sequential animation).
 *
 * Frame 0 = initial state after switches, before any moves.
 * Frame N = state after turn N resolves.
 * Final frame has `winner` set if the battle ended.
 */
export function extractBattleFrames(log: string): BattleFrame[] {
  const battle = new Battle(gens);
  const lines = log.split('\n');
  const frames: BattleFrame[] = [];

  let currentTurn = 0;
  let currentEvents: TurnEvent[] = [];
  let hasSnapshotedTurn0 = false;

  for (const line of lines) {
    if (!line.startsWith('|')) continue;

    // Parse for event capture before feeding to battle
    const { args, kwArgs } = Protocol.parseBattleLine(line);
    const kw = kwArgs as { from?: string; of?: string };

    // Feed line to battle state machine
    try {
      battle.add(line);
    } catch {
      // Some protocol lines may not be parseable — skip
    }

    if (!args) continue;
    const cmd = args[0];

    switch (cmd) {
      case 'turn': {
        const newTurn = parseInt(args[1] as string, 10);

        if (!hasSnapshotedTurn0) {
          // Snapshot initial state (turn 0) before turn 1 begins
          frames.push(snapshotFrame(battle, 0, currentEvents));
          hasSnapshotedTurn0 = true;
          currentEvents = [];
        } else {
          // Snapshot the state after the previous turn's events
          frames.push(snapshotFrame(battle, currentTurn, currentEvents));
          currentEvents = [];
        }

        currentTurn = newTurn;
        break;
      }

      case 'win': {
        const winner = args[1] as string;
        // Final snapshot with winner
        frames.push(snapshotFrame(battle, currentTurn, currentEvents, winner));
        currentEvents = [];
        break;
      }

      // ── Capture events for animation ────────────────────────────

      case 'switch':
      case 'drag': {
        const ident = args[1] as string;
        const details = args[2] as string;
        const side = sideIndex(ident);
        const species = extractSpecies(details);

        currentEvents.push({
          type: 'switch',
          side,
          pokemonIn: species,
        });
        break;
      }

      case 'move': {
        const ident = args[1] as string;
        const moveName = args[2] as string;
        const targetIdent = args[3] as string | undefined;
        const side = sideIndex(ident);

        currentEvents.push({
          type: 'move',
          side,
          pokemon: extractName(ident),
          move: moveName,
          ...(targetIdent ? { target: extractName(targetIdent) } : {}),
        });
        break;
      }

      case '-damage': {
        const ident = args[1] as string;
        const hpStr = args[2] as string;
        const side = sideIndex(ident);

        // Parse HP: "90/100" or "0 fnt"
        let hp = 0;
        if (hpStr && !hpStr.includes('fnt')) {
          const parts = hpStr.split('/');
          if (parts.length === 2) {
            const current = parseInt(parts[0], 10);
            const max = parseInt(parts[1], 10);
            hp = max > 0 ? Math.round((current / max) * 100) : 0;
          }
        }

        currentEvents.push({
          type: 'damage',
          side,
          pokemon: extractName(ident),
          hp,
          ...(kw.from ? { from: kw.from } : {}),
        });
        break;
      }

      case '-heal': {
        const ident = args[1] as string;
        const hpStr = args[2] as string;
        const side = sideIndex(ident);

        let hp = 100;
        if (hpStr) {
          const parts = hpStr.split('/');
          if (parts.length === 2) {
            const current = parseInt(parts[0], 10);
            const max = parseInt(parts[1], 10);
            hp = max > 0 ? Math.round((current / max) * 100) : 100;
          }
        }

        currentEvents.push({
          type: 'heal',
          side,
          pokemon: extractName(ident),
          hp,
          ...(kw.from ? { from: kw.from } : {}),
        });
        break;
      }

      case 'faint': {
        const ident = args[1] as string;
        currentEvents.push({
          type: 'faint',
          side: sideIndex(ident),
          pokemon: extractName(ident),
        });
        break;
      }

      case '-status': {
        const ident = args[1] as string;
        const status = args[2] as string;
        currentEvents.push({
          type: 'status',
          side: sideIndex(ident),
          pokemon: extractName(ident),
          status,
        });
        break;
      }

      case '-curestatus': {
        const ident = args[1] as string;
        currentEvents.push({
          type: 'cure-status',
          side: sideIndex(ident),
          pokemon: extractName(ident),
        });
        break;
      }

      case '-boost':
      case '-unboost': {
        const ident = args[1] as string;
        const stat = args[2] as string;
        const amount = parseInt(args[3] as string, 10) || 1;
        currentEvents.push({
          type: 'boost',
          side: sideIndex(ident),
          pokemon: extractName(ident),
          stat,
          amount: cmd === '-unboost' ? -amount : amount,
        });
        break;
      }

      case '-weather': {
        const weather = args[1] as string;
        const kw2 = kwArgs as { upkeep?: true };
        if (!kw2.upkeep) {
          currentEvents.push({
            type: 'weather',
            weather: weather === 'none' ? null : weather,
            // Ability-set weather (Drought, Drizzle, …) carries its source:
            // `[from] ability: Drought [of] p1a: Vulpix`. Capture it so the
            // analysis knows WHO set the weather, not just that it exists.
            ...(kw.from ? { from: kw.from } : {}),
            ...(kw.of ? { of: extractName(kw.of) } : {}),
          });
        }
        break;
      }

      case '-fieldstart': {
        const field = args[1] as string;
        // Terrain changes: "move: Electric Terrain" → "Electric"
        if (field.includes('Terrain')) {
          const terrain = field.replace('move: ', '').replace(' Terrain', '');
          currentEvents.push({
            type: 'terrain',
            terrain,
            // Surge abilities set terrain on switch-in with the same attribution.
            ...(kw.from ? { from: kw.from } : {}),
            ...(kw.of ? { of: extractName(kw.of) } : {}),
          });
        }
        break;
      }

      case '-fieldend': {
        const field = args[1] as string;
        if (field.includes('Terrain')) {
          currentEvents.push({ type: 'terrain', terrain: null });
        }
        break;
      }

      case '-sidestart': {
        const sideArg = args[1] as string;
        const condition = (args[2] as string).replace('move: ', '');
        currentEvents.push({
          type: 'side-condition',
          side: sideIndex(sideArg),
          condition,
          action: 'start',
          // Hazard/screen setters are usually attributed by the preceding move
          // event, but capture `[of]` opportunistically when present.
          ...(kw.of ? { of: extractName(kw.of) } : {}),
        });
        break;
      }

      case '-sideend': {
        const sideArg = args[1] as string;
        const condition = (args[2] as string).replace('move: ', '');
        currentEvents.push({
          type: 'side-condition',
          side: sideIndex(sideArg),
          condition,
          action: 'end',
        });
        break;
      }

      case '-mega': {
        const ident = args[1] as string;
        const species = args[2] as string;
        currentEvents.push({
          type: 'mega',
          side: sideIndex(ident),
          pokemon: extractName(ident),
          species,
        });
        break;
      }

      case '-terastallize': {
        const ident = args[1] as string;
        const teraType = args[2] as string;
        currentEvents.push({
          type: 'terastallize',
          side: sideIndex(ident),
          pokemon: extractName(ident),
          teraType,
        });
        break;
      }
    }
  }

  // Edge case: battle ended without |win| (forfeit, tie, etc.)
  // or no turns occurred — ensure we have at least one frame
  if (frames.length === 0 && hasSnapshotedTurn0) {
    frames.push(snapshotFrame(battle, currentTurn, currentEvents));
  } else if (frames.length === 0) {
    frames.push(snapshotFrame(battle, 0, currentEvents));
  }

  return frames;
}

// ─── Full Pipeline: URL → Frames + Metadata ─────────────────────────

/**
 * Fetches a Pokémon Showdown replay and extracts battle frames.
 * Returns frames for turn-by-turn playback plus replay metadata.
 */
export async function getReplayFrames(replayUrl: string): Promise<ReplayFramesResponse> {
  const replay = await fetchReplay(replayUrl);
  const frames = extractBattleFrames(replay.log);

  const meta: ReplayMeta = {
    id: replay.id,
    format: replay.format,
    players: [replay.players[0], replay.players[1]],
    winner: replay.winner,
  };

  return { frames, meta };
}
