/**
 * Evolution Point Buy draft line identity (draft-backend §2.1, critique S6).
 *
 * A line's stable id is `toID(base) + '--' + toID(final stage)`, e.g.
 * `teddiursa--ursalunabloodmoon`, `flabebe--florges`, `oshawott--samurotthisui`.
 * `foldId` IS the one Pokémon id fold of the app (`src/lib/pkmn/i18n/id.ts`, PK-1),
 * which has no imports, so this module stays client-safe and dictionary-free.
 * The SQL mirror `public.epb_fold_id` / `public.epb_line_id` (migration
 * `20261012024103_draft_line_ids.sql`) computes the same string; a trigger
 * refuses an imported `line_id` that differs from it.
 */

import { toID } from '@/lib/pkmn/i18n/id';

/** The single declaration of LineId; `src/types/draft-queue.ts` re-exports it (critique S8). */
export type LineId = string;

/** Shape of every line id: two folded ids joined by `--`. */
export const LINE_ID_PATTERN = /^[a-z0-9]+--[a-z0-9]+$/;

/** = toID: ♀→f, ♂→m, decompose, strip combining marks, lowercase, drop [^a-z0-9]. Equals the @pkmn species id for list names. */
export const foldId: (name: string) => string = toID;

/** `${foldId(base)}--${foldId(finalStage)}`; the final stage is stage 3, or stage 2 for a two-stage line. */
export function toLineId(base: string, finalStage: string): LineId {
  return `${foldId(base)}--${foldId(finalStage)}`;
}

/** A row carrying the stage names, with or without its stored `line_id` (any `PointBuyListEntry`). */
export interface StagedLineEntry {
  line_id?: LineId | null;
  base_pokemon: string;
  stage2_pokemon: string;
  stage3_pokemon: string | null;
}

/**
 * Anything a line id can be read from: an object that already carries its `line_id`,
 * or a row with the three stage names (the id is then computed). Lets the line-keyed
 * helpers (`applyLeagueOverrides`, `specialRulesTextFor`, ...) take a `PointBuyListEntry`
 * or an importer row built before its id is set.
 */
export type LineKeyedEntry = { line_id: LineId } | StagedLineEntry;

/**
 * The line id of a point-buy list entry (or any row carrying the three stage names):
 * the stored `line_id` when present (the M1 trigger guarantees it equals the computed
 * one), else computed from the stage names.
 */
export function lineIdOfEntry(e: LineKeyedEntry): LineId {
  if (e.line_id) return e.line_id;
  if ('base_pokemon' in e) return toLineId(e.base_pokemon, e.stage3_pokemon ?? e.stage2_pokemon);
  throw new Error('lineIdOfEntry: the entry has neither a line id nor stage names');
}

/** True when `value` has the line-id shape (route parameter validation). */
export function isLineId(value: string): boolean {
  return LINE_ID_PATTERN.test(value);
}

/**
 * Legacy-board key for a point-buy line: `base` or `base|stage3`.
 * @deprecated Use line ids (`lineIdOfEntry`, `toLineId`). Only the legacy 2D board keeps it
 * (`api/drafts/[id]/state` taken set + `PickSelector`): its pool rows (`draft_pool_entries`)
 * carry neither a line id nor stage names, so a line id cannot be computed there.
 */
export function getLineIdentity(basePokemon: string, stage3Pokemon: string | null): string {
  return stage3Pokemon ? `${basePokemon}|${stage3Pokemon}` : basePokemon;
}

/**
 * English "Base → Stage3" label for logs and audit text only. Every display
 * label goes through `localizeLineLabel` from `src/lib/pkmn/i18n` (critique S13).
 */
export function formatLineLabel(basePokemon: string, stage3Pokemon: string | null): string {
  return stage3Pokemon ? `${basePokemon} → ${stage3Pokemon}` : basePokemon;
}

/**
 * Taken legacy-board keys (`getLineIdentity`) from evolution trackers (server truth for the legacy EPB board).
 * @deprecated Use the trackers' `line_id`; kept only for the legacy board (see `getLineIdentity`).
 */
export function collectTakenLineIdentities(
  trackers: { base_pokemon: string; locked_stage3_pokemon: string | null }[],
): string[] {
  return [
    ...new Set(
      trackers.map((t) => getLineIdentity(t.base_pokemon, t.locked_stage3_pokemon)),
    ),
  ];
}
