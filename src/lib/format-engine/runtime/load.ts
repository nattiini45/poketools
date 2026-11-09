/**
 * The runtime context of a kit league: the attached format (spec, seed, tunables, amendments), the phases it generated
 * with their players, and the league's `format_*` rows as `KitRuntimeState`. Server only: it holds the season seed.
 *
 * `loadKitContext` is memoised per request (React `cache()`), for pages that only read. A writer needs the state as it
 * is now, after its own earlier writes: `loadFreshKitContext` skips the memo.
 */
import 'server-only';

import { cache } from 'react';
import type { FormatDefinition, Stage } from '@/lib/format-kit/types';
import { getKitPhases, getPhaseMembers } from '@/lib/supabase/queries/format-engine';
import { getFormatRuntime } from '@/lib/supabase/queries/format-runtime';
import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import type { Json } from '@/types/database';
import { stageOf } from '../load';
import type { EnvBase } from './expr-env';
import { buildRuntimeState } from './state';
import type { TunableIssue } from './tunables';
import type { KitRuntimeState } from './types';
import type { MaskContext } from './views';

export interface KitPhaseInfo {
  id: string;
  stage: Stage;
  /** The phase's enrolled players, sorted by id. */
  members: string[];
}

export interface KitContext {
  seasonId: string;
  /** Server side only. */
  seed: string;
  /**
   * `season_formats.revision` of the row `def` was read from. A writer of a player action hands it to the database, which
   * refuses the write (`format_context_stale`) when the format changed after this context was loaded.
   */
  revision: number;
  def: FormatDefinition;
  state: KitRuntimeState;
  tunableIssues: TunableIssue[];
  phases: KitPhaseInfo[];
}

/** The players of a stage's phase, or of every phase (sorted, no repeats) when no stage is named. */
export function rosterOf(ctx: Pick<KitContext, 'phases'>, stageKey?: string): string[] {
  const phases = stageKey === undefined ? ctx.phases : ctx.phases.filter((phase) => phase.stage.key === stageKey);
  return [...new Set(phases.flatMap((phase) => phase.members))].sort();
}

/** Every phase of a stage key: one, or one per group for a `foreach_group` stage. */
export function phasesOfStageKey(ctx: Pick<KitContext, 'phases'>, stageKey: string): KitPhaseInfo[] {
  return ctx.phases.filter((phase) => phase.stage.key === stageKey);
}

export function phaseById(ctx: Pick<KitContext, 'phases'>, phaseId: string): KitPhaseInfo | undefined {
  return ctx.phases.find((phase) => phase.id === phaseId);
}

export function envBaseOf(ctx: Pick<KitContext, 'def' | 'state' | 'seed'>, scope: string): EnvBase {
  return { def: ctx.def, state: ctx.state, seed: ctx.seed, scope };
}

/** The context of a league whose attached format runs on the `kit` engine, or null (no format, or another engine). */
export async function loadFreshKitContext(seasonId: string): Promise<KitContext | null> {
  const format = await getSeasonFormat(seasonId);
  if (format === null || format.engine !== 'kit') return null;
  const [phaseRows, runtime] = await Promise.all([getKitPhases(seasonId), getFormatRuntime(seasonId)]);
  const [stages, members] = await Promise.all([
    Promise.all(phaseRows.map((row) => stageOf(row))),
    getPhaseMembers(phaseRows.map((row) => row.id)),
  ]);
  const { state, tunableIssues } = buildRuntimeState(format.spec, runtime, {
    tunables: format.tunables as Json,
    amendments: format.amendments as Json,
  });
  const phases = phaseRows.map((row, i) => ({
    id: row.id,
    stage: stages[i],
    members: members.filter((m) => m.tournament_id === row.id).map((m) => m.player_id).sort(),
  }));
  return { seasonId, seed: format.seed, revision: format.revision, def: format.spec, state, tunableIssues, phases };
}

export const loadKitContext = cache(loadFreshKitContext);

/**
 * What the masks of the admin reads need (`MaskContext`) for a league with an attached format on ANY engine, or null (no
 * format). `loadFreshKitContext` is null for `legacy` and `shadow`, but the checks and adjustments a kit run wrote survive
 * an engine switch, so a read of them must still know who plays and which relations are hidden: otherwise switching the
 * engine would lift the masks without the audited unmask.
 */
export async function loadMaskContext(seasonId: string): Promise<MaskContext | null> {
  const format = await getSeasonFormat(seasonId);
  if (format === null) return null;
  const [phaseRows, runtime] = await Promise.all([getKitPhases(seasonId), getFormatRuntime(seasonId)]);
  const members = await getPhaseMembers(phaseRows.map((row) => row.id));
  const { state } = buildRuntimeState(format.spec, runtime, { tunables: format.tunables as Json, amendments: format.amendments as Json });
  return { def: format.spec, state, phases: phaseRows.map((row) => ({ members: members.filter((m) => m.tournament_id === row.id).map((m) => m.player_id) })) };
}
