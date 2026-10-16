import type { PokemonSet, TeamImportSource, TeamMode, TeamValidationResult } from '@/types/team';
import type { CalcField } from '@/types/calc';
import type { DraftPoolEntry } from '@/types/draft-pool';

// ── Draft context loaded by useDraftContext ──────────────────────────
export interface DraftEditorContext {
  poolId: string;
  budget: number | null;
  /** Fallback cost applied to entries that lack an explicit point_cost */
  defaultPointCost: number | null;
  spent: number | null;
  roster: string[];
  entries: DraftPoolEntry[];
  takenPokemon: string[];
}

// ============================================================
// STATE SHAPE
// ============================================================

const EMPTY_SIX: (PokemonSet | null)[] = Array.from({ length: 6 }, () => null);

export interface EditorState {
  /** Which surface is rendering: teambuilder | plan | library */
  mode: TeamMode;

  // ── Format & scope ────────────────────────────────────────────────
  format: string;
  generation: number;
  seasonId: string | null;
  tournamentId: string | null;
  matchId: string | null;
  isDraftLeague: boolean;

  // ── Team data (always 6 slots, null = empty) ──────────────────────
  team: (PokemonSet | null)[];
  activeSlot: number | null;

  // ── Validation ────────────────────────────────────────────────────
  validation: TeamValidationResult | null;
  /** Set by SET_JUMP_TARGET when clicking an issue in ValidationPanel */
  jumpTarget: string | null; // issue_id

  // ── Panel state ───────────────────────────────────────────────────
  rightPanelTab: 'intel' | 'validation' | 'ai' | 'opponent';
  intelTab: 'overview' | 'sets' | 'calc' | 'speed';

  // ── Field conditions (calc/speed shared) ──────────────────────────
  fieldConditions: CalcField;
  /** Benchmark the Speed tab's outspeed solver is targeting */
  speedCalcTarget: { species: string; speed: number; label: string } | null;

  // ── Browser ───────────────────────────────────────────────────────
  browserHighlighted: string | null;
  typeFilters: string[];
  searchQuery: string;

  // ── Meta ──────────────────────────────────────────────────────────
  teamId: string | null;
  teamName: string;
  importSource: TeamImportSource;
  locked: boolean;
  rulesetId: string | null;
  dirty: boolean;

  // ── Workspace view ─────────────────────────────────────────────────
  /** 'grid' = 6-card overview; 'set' = inline set editor */
  workspaceView: 'grid' | 'set';

  // ── Validation status (separate from the validation result object) ──
  validationStatus: 'idle' | 'pending' | 'fresh' | 'stale';

  // ── Mobile pane ────────────────────────────────────────────────────
  mobilePane: 'team' | 'browser' | 'intel' | 'ai';

  // ── Draft context (populated by useDraftContext) ─────────────────
  draft: DraftEditorContext | null;

  // ── Save status ─────────────────────────────────────────────────────
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
}

// ============================================================
// ACTIONS (14 clean actions)
// ============================================================

export type EditorAction =
  // ── Format ─────────────────────────────────────────────────────
  | { type: 'SET_FORMAT'; format: string }

  // ── Team mutations ─────────────────────────────────────────────
  | { type: 'ADD_SLOT'; species: string }
  | { type: 'REMOVE_SLOT'; slot: number }
  | { type: 'SET_SLOT'; slot: number; set: PokemonSet }
  | { type: 'UPDATE_SLOT'; slot: number; patch: Partial<PokemonSet> }
  | { type: 'LOAD_TEAM'; pokemon: PokemonSet[]; teamId?: string }
  | { type: 'CLEAR_TEAM' }

  // ── Slot selection ─────────────────────────────────────────────
  | { type: 'SELECT_SLOT'; slot: number | null }
  | { type: 'JUMP_TO_ISSUE'; issueId: string }
  | { type: 'CLEAR_JUMP_TARGET' }

  // ── Team name ─────────────────────────────────────────────────
  | { type: 'SET_TEAM_NAME'; name: string }

  // ── Panels ─────────────────────────────────────────────────────
  | { type: 'SET_RIGHT_PANEL'; tab: EditorState['rightPanelTab'] }
  | { type: 'SET_INTEL_TAB'; tab: EditorState['intelTab'] }

  // ── Browser ────────────────────────────────────────────────────
  | { type: 'SET_BROWSER_HIGHLIGHT'; species: string | null }
  | { type: 'SET_SEARCH'; query: string; typeFilters?: string[] }

  // ── Validation ─────────────────────────────────────────────────
  | { type: 'SET_VALIDATION'; result: TeamValidationResult | null }

  // ── Workspace view ───────────────────────────────────────────────
  | { type: 'OPEN_SET_WORKSPACE' }
  | { type: 'CLOSE_SET_WORKSPACE' }

  // ── Slot operations ──────────────────────────────────────────────
  | { type: 'SWAP_SLOTS'; slotA: number; slotB: number }

  // ── Field / speed ─────────────────────────────────────────────────
  | { type: 'SET_FIELD_CONDITIONS'; conditions: CalcField }
  | { type: 'SET_SPEED_TARGET'; target: EditorState['speedCalcTarget'] }

  // ── Validation status ─────────────────────────────────────────────
  | { type: 'SET_VALIDATION_STATUS'; status: EditorState['validationStatus'] }

  // ── Mobile ────────────────────────────────────────────────────────
  | { type: 'SET_MOBILE_PANE'; pane: EditorState['mobilePane'] }

  // ── AI proposal ───────────────────────────────────────────────────
  | { type: 'APPLY_TEAM_PROPOSAL'; team: PokemonSet[]; mode: 'replace' | 'fill' }

  // ── Draft ─────────────────────────────────────────────────────────
  | { type: 'SET_DRAFT_CONTEXT'; draft: DraftEditorContext | null }

  // ── Save ─────────────────────────────────────────────────────────
  | { type: 'SET_SAVE_STATUS'; status: EditorState['saveStatus'] }
  | { type: 'MARK_SAVED' }

  // ── Meta ───────────────────────────────────────────────────────
  | { type: 'SET_META'; patch: Partial<Pick<EditorState, 'teamId' | 'locked' | 'rulesetId' | 'matchId' | 'importSource'>> };

// ============================================================
// HELPERS
// ============================================================

const DEFAULT_EVS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const DEFAULT_IVS = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

function makeBlankSet(species: string): PokemonSet {
  return {
    name: '',
    species,
    gender: '',
    item: '',
    ability: '',
    evs: { ...DEFAULT_EVS },
    ivs: { ...DEFAULT_IVS },
    nature: '',
    level: 100,
    moves: [],
  };
}

function padTo6(pokemon: PokemonSet[]): (PokemonSet | null)[] {
  const padded: (PokemonSet | null)[] = [...pokemon];
  while (padded.length < 6) padded.push(null);
  return padded.slice(0, 6);
}

// ============================================================
// REDUCER
// ============================================================

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    // ── Format ─────────────────────────────────────────────────────
    case 'SET_FORMAT': {
      const gen = parseInt(action.format.match(/gen(\d)/)?.[1] || '9');
      // Legality differs per format — force revalidation
      return { ...state, format: action.format, generation: gen, validationStatus: 'stale' };
    }

    // ── Team mutations ─────────────────────────────────────────────
    case 'ADD_SLOT': {
      const emptyIndex = state.team.findIndex((s) => s === null);
      if (emptyIndex === -1) return state; // Team full
      const team = [...state.team];
      team[emptyIndex] = makeBlankSet(action.species);
      return { ...state, team, activeSlot: emptyIndex, dirty: true, validationStatus: 'stale' };
    }

    case 'REMOVE_SLOT': {
      const team = [...state.team];
      team[action.slot] = null;
      const activeSlot = state.activeSlot === action.slot ? null : state.activeSlot;
      return { ...state, team, activeSlot, dirty: true, validationStatus: 'stale' };
    }

    case 'SET_SLOT': {
      const team = [...state.team];
      team[action.slot] = action.set;
      return { ...state, team, dirty: true, validationStatus: 'stale' };
    }

    case 'UPDATE_SLOT': {
      const team = [...state.team];
      const existing = team[action.slot];
      if (!existing) return state;
      team[action.slot] = { ...existing, ...action.patch };
      return { ...state, team, dirty: true, validationStatus: 'stale' };
    }

    case 'LOAD_TEAM': {
      const team = padTo6(action.pokemon);
      return {
        ...state,
        team,
        activeSlot: null,
        teamId: action.teamId ?? state.teamId,
        dirty: false,
        validation: null,
        validationStatus: 'stale',
        workspaceView: 'grid',
      };
    }

    case 'CLEAR_TEAM': {
      return {
        ...state,
        team: [...EMPTY_SIX],
        activeSlot: null,
        teamName: '',
        dirty: true,
        validation: null,
        validationStatus: 'stale',
        workspaceView: 'grid',
      };
    }

    case 'SWAP_SLOTS': {
      const team = [...state.team];
      [team[action.slotA], team[action.slotB]] = [team[action.slotB], team[action.slotA]];
      return { ...state, team, dirty: true, validationStatus: 'stale' };
    }

    // ── Slot selection ─────────────────────────────────────────────
    case 'SELECT_SLOT': {
      return { ...state, activeSlot: action.slot };
    }

    case 'JUMP_TO_ISSUE': {
      // Find the issue to determine which slot it belongs to
      const issue = state.validation?.issues.find((i) => i.issue_id === action.issueId);
      const targetSlot = issue?.pokemon_index ?? state.activeSlot;
      return {
        ...state,
        activeSlot: targetSlot,
        jumpTarget: action.issueId,
        rightPanelTab: 'validation' as const,
        // Land the user on the offending set, not just the grid
        workspaceView: targetSlot !== null && state.team[targetSlot] ? 'set' : state.workspaceView,
      };
    }

    case 'CLEAR_JUMP_TARGET': {
      return { ...state, jumpTarget: null };
    }

    // ── Team name ──────────────────────────────────────────────────
    case 'SET_TEAM_NAME': {
      return { ...state, teamName: action.name, dirty: true };
    }

    // ── Panels ─────────────────────────────────────────────────────
    case 'SET_RIGHT_PANEL': {
      return { ...state, rightPanelTab: action.tab };
    }

    case 'SET_INTEL_TAB': {
      return { ...state, intelTab: action.tab };
    }

    // ── Browser ────────────────────────────────────────────────────
    case 'SET_BROWSER_HIGHLIGHT': {
      return { ...state, browserHighlighted: action.species };
    }

    case 'SET_SEARCH': {
      return {
        ...state,
        searchQuery: action.query,
        ...(action.typeFilters !== undefined ? { typeFilters: action.typeFilters } : {}),
      };
    }

    // ── Validation ─────────────────────────────────────────────────
    case 'SET_VALIDATION': {
      return { ...state, validation: action.result };
    }

    // ── Workspace view ────────────────────────────────────────────
    case 'OPEN_SET_WORKSPACE': {
      return { ...state, workspaceView: 'set' };
    }

    case 'CLOSE_SET_WORKSPACE': {
      return { ...state, workspaceView: 'grid' };
    }

    // ── Field / speed ─────────────────────────────────────────────
    case 'SET_FIELD_CONDITIONS': {
      return { ...state, fieldConditions: action.conditions };
    }

    case 'SET_SPEED_TARGET': {
      return { ...state, speedCalcTarget: action.target };
    }

    // ── Validation status ─────────────────────────────────────────
    case 'SET_VALIDATION_STATUS': {
      return { ...state, validationStatus: action.status };
    }

    // ── Mobile ────────────────────────────────────────────────────
    case 'SET_MOBILE_PANE': {
      return { ...state, mobilePane: action.pane };
    }

    // ── AI proposal ───────────────────────────────────────────────
    case 'APPLY_TEAM_PROPOSAL': {
      if (action.mode === 'replace') {
        return { ...state, team: padTo6(action.team), dirty: true, validationStatus: 'stale' };
      }
      // fill: only overwrite empty slots
      const team = [...state.team];
      let teamIdx = 0;
      for (let i = 0; i < team.length && teamIdx < action.team.length; i++) {
        if (team[i] === null) {
          team[i] = action.team[teamIdx++];
        }
      }
      return { ...state, team, dirty: true, validationStatus: 'stale' };
    }

    // ── Draft ─────────────────────────────────────────────────────
    case 'SET_DRAFT_CONTEXT': {
      return { ...state, draft: action.draft };
    }

    // ── Save ─────────────────────────────────────────────────────
    case 'SET_SAVE_STATUS': {
      return { ...state, saveStatus: action.status };
    }

    case 'MARK_SAVED': {
      return { ...state, saveStatus: 'saved', dirty: false };
    }

    // ── Meta ───────────────────────────────────────────────────────
    case 'SET_META': {
      return { ...state, ...action.patch };
    }

    default: {
      // Exhaustiveness check — should never reach here
      const _exhaustive: never = action;
      return state;
    }
  }
}

// ============================================================
// INITIAL STATE FACTORY
// ============================================================

export function createInitialState(params?: {
  mode?: TeamMode;
  format?: string;
  generation?: number;
  tournamentId?: string | null;
  seasonId?: string | null;
  matchId?: string | null;
  teamId?: string | null;
  locked?: boolean;
  isDraftLeague?: boolean;
  rulesetId?: string | null;
  importSource?: TeamImportSource;
  teamName?: string;
}): EditorState {
  const format = params?.format ?? 'gen9ou';
  const gen = params?.generation ?? parseInt(format.match(/gen(\d)/)?.[1] || '9');
  return {
    mode: params?.mode ?? 'teambuilder',
    format,
    generation: gen,
    seasonId: params?.seasonId ?? null,
    tournamentId: params?.tournamentId ?? null,
    matchId: params?.matchId ?? null,
    isDraftLeague: params?.isDraftLeague ?? false,
    team: [...EMPTY_SIX],
    activeSlot: null,
    validation: null,
    jumpTarget: null,
    rightPanelTab: 'intel',
    intelTab: 'overview',
    fieldConditions: {},
    speedCalcTarget: null,
    browserHighlighted: null,
    typeFilters: [],
    searchQuery: '',
    teamId: params?.teamId ?? null,
    teamName: params?.teamName ?? '',
    importSource: params?.importSource ?? 'manual',
    locked: params?.locked ?? false,
    rulesetId: params?.rulesetId ?? null,
    dirty: false,
    workspaceView: 'grid',
    validationStatus: 'idle',
    mobilePane: 'team',
    draft: null,
    saveStatus: 'idle',
  };
}
