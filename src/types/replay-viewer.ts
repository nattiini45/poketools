// ─── Replay Viewer Types ─────────────────────────────────────────────
// Types for the pre-computed battle frame system.
// The server-side frame extractor produces BattleFrame[],
// the client-side viewer indexes into this array for O(1) scrubbing.

// ─── Turn Events (for sequential animation) ─────────────────────────

export type TurnEvent =
  | { type: 'move'; side: 0 | 1; pokemon: string; move: string; target?: string }
  | { type: 'damage'; side: 0 | 1; pokemon: string; hp: number; from?: string }
  | { type: 'heal'; side: 0 | 1; pokemon: string; hp: number; from?: string }
  | { type: 'faint'; side: 0 | 1; pokemon: string }
  | { type: 'switch'; side: 0 | 1; pokemonIn: string; pokemonOut?: string }
  | { type: 'status'; side: 0 | 1; pokemon: string; status: string }
  | { type: 'cure-status'; side: 0 | 1; pokemon: string }
  | { type: 'boost'; side: 0 | 1; pokemon: string; stat: string; amount: number }
  | { type: 'weather'; weather: string | null; from?: string; of?: string }
  | { type: 'terrain'; terrain: string | null; from?: string; of?: string }
  | { type: 'side-condition'; side: 0 | 1; condition: string; action: 'start' | 'end'; of?: string }
  | { type: 'mega'; side: 0 | 1; pokemon: string; species: string }
  | { type: 'terastallize'; side: 0 | 1; pokemon: string; teraType: string };

// ─── Frame Snapshot Types ────────────────────────────────────────────

export interface ActivePokemonFrame {
  /** speciesForme for sprite lookup (handles Mega, form changes) */
  species: string;
  level: number;
  gender: 'M' | 'F' | 'N';
  shiny: boolean;
  /** HP as 0–100 percentage */
  hp: number;
  /** Non-volatile status: brn, par, slp, frz, psn, tox */
  status: string | null;
  fainted: boolean;
  /** Tera type if active, null otherwise */
  terastallized: string | null;
  /** Stat boosts: { atk: 1, def: -1, ... } — only non-zero entries */
  boosts: Partial<Record<string, number>>;
  /** Active volatile statuses: confusion, leechseed, substitute, etc. */
  volatiles: string[];
}

export interface TeamMemberFrame {
  species: string;
  fainted: boolean;
  active: boolean;
  /** HP as 0–100 percentage */
  hp: number;
}

export interface SideConditionFrame {
  /** e.g. 'Stealth Rock', 'Spikes', 'Reflect', 'Light Screen', 'Tailwind' */
  name: string;
  /** Layer count for Spikes (1-3), Toxic Spikes (1-2); 1 for non-stacking */
  layers: number;
}

export interface SideFrame {
  name: string;
  active: ActivePokemonFrame | null;
  team: TeamMemberFrame[];
  sideConditions: SideConditionFrame[];
}

export interface BattleFrame {
  turn: number;
  weather: string | null;
  terrain: string | null;
  /** Pseudo-weathers: Trick Room, Magic Room, Wonder Room, Gravity */
  pseudoWeather: string[];
  sides: [SideFrame, SideFrame];
  /** Ordered events that occurred during this turn (for animation) */
  events: TurnEvent[];
  /** Winner username if battle ended this turn */
  winner?: string;
}

// ─── Replay Metadata ─────────────────────────────────────────────────

export interface ReplayMeta {
  id: string;
  format: string;
  players: [string, string];
  winner: string;
  rating?: number;
  uploadTime?: number;
}

// ─── API Response ────────────────────────────────────────────────────

export interface ReplayFramesResponse {
  frames: BattleFrame[];
  meta: ReplayMeta;
}

// ─── Playback State ──────────────────────────────────────────────────

export type PlaybackSpeed = 1 | 2 | 4;

export interface PlaybackState {
  frames: BattleFrame[];
  meta: ReplayMeta | null;
  currentIndex: number;
  playing: boolean;
  speed: PlaybackSpeed;
  /** Which event within the current turn is animating (-1 = showing settled state) */
  eventStep: number;
  /** True while mid-turn events are playing out */
  animating: boolean;
  /** Loading/error state */
  loading: boolean;
  error: string | null;
}

export type PlaybackAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; frames: BattleFrame[]; meta: ReplayMeta }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'NEXT_FRAME' }
  | { type: 'PREV_FRAME' }
  | { type: 'GO_TO_FRAME'; index: number }
  | { type: 'TOGGLE_PLAY' }
  | { type: 'SET_SPEED'; speed: PlaybackSpeed }
  | { type: 'FIRST_FRAME' }
  | { type: 'LAST_FRAME' }
  | { type: 'ADVANCE_EVENT' }
  | { type: 'SKIP_ANIMATION' }
  | { type: 'SET_ANIMATING'; animating: boolean };
