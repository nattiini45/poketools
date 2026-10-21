import type { PokemonSet } from '@/types/team';
import type { CalcField } from '@/types/calc';
import type { EditorState } from '../editor/state';

// ── Command union ────────────────────────────────────────────────────

export type EditorCommand =
  // Set-level mutations
  | { kind: 'apply_set'; slot: number; set: Partial<PokemonSet> }
  | { kind: 'set_species'; slot: number; species: string }
  | { kind: 'set_move'; slot: number; moveIndex: 0 | 1 | 2 | 3; move: string }
  | { kind: 'set_item'; slot: number; item: string }
  | { kind: 'set_ability'; slot: number; ability: string }
  | { kind: 'set_nature'; slot: number; nature: string }
  | { kind: 'set_tera'; slot: number; tera: string }
  | { kind: 'set_evs'; slot: number; spread: Partial<PokemonSet['evs']> }
  | { kind: 'set_ivs'; slot: number; spread: Partial<PokemonSet['ivs']> }
  // Team-level mutations
  | { kind: 'remove_slot'; slot: number }
  | { kind: 'propose_team'; team: PokemonSet[]; mode: 'replace' | 'fill' }
  // Navigation
  | { kind: 'select_slot'; slot: number }
  | { kind: 'open_intel'; tab: EditorState['intelTab'] }
  // Field
  | { kind: 'set_field'; field: CalcField }
  // Highlighting
  | { kind: 'highlight_issue'; issueId: string };

// ── Result ───────────────────────────────────────────────────────────

/** Why a command was refused; a key of `teambuilder.commandErrors`. */
export type EditorCommandErrorCode =
  | 'locked'
  | 'invalid_slot'
  | 'slot_empty'
  | 'invalid_move_index'
  | 'empty_proposal'
  | 'unknown_command';

export interface CommandResult {
  ok: boolean;
  /** English reason (for agents and logs); the UI renders `code` instead. */
  error?: string;
  /** Set whenever `ok` is false. */
  code?: EditorCommandErrorCode;
}

// ── Snapshot (read access for agents) ────────────────────────────────

export interface EditorSnapshot {
  team: (PokemonSet | null)[];
  format: string;
  generation: number;
  rulesetId: string | null;
  activeSlot: number | null;
  validation: EditorState['validation'];
  draft: EditorState['draft'];
}

// ── API contract ─────────────────────────────────────────────────────

export interface EditorCommandApi {
  execute(cmd: EditorCommand): CommandResult;
  executeBatch(cmds: EditorCommand[]): CommandResult[];
  snapshot(): EditorSnapshot;
}
