/**
 * Fires an event of a kit league: plan the ops from the format's rules, hand them to `format_fire_event` (one
 * transaction; the event key makes a second call a no-op), then expire the public reads. Server only.
 *
 * A `lock_action` op locks the action, which is itself an event (`action_locked`, for a relation's `reveal_on` and any
 * rule on it): it is fired right after, up to `MAX_CASCADE` levels deep. Callers that add their own ops to the same
 * transaction (track progress of a completed match) pass them in `options.ops`.
 */
import 'server-only';

import { expireSeasonReads } from '@/lib/revalidation';
import { fireFormatEvent } from '@/lib/supabase/queries/format-runtime';
import type { Json } from '@/types/database';
import { eventKey, type KitEvent } from './events';
import { eventNeedsRows, planEffects, type PlannedNotification } from './effects';
import { loadFreshKitContext, phaseOfStageKey, rosterOf, type KitContext } from './load';
import { loadStageTable, playerRowsOf } from './stage-table';
import type { FormatOp, PlayerRow, RuntimeIssue } from './types';

const MAX_CASCADE = 3;

export interface FireOptions {
  /** Ops that belong to this event's transaction besides the planned effects. */
  ops?: readonly FormatOp[];
  /** The context the caller already loaded (it must be fresh). */
  context?: KitContext;
  /** Cascade depth, set by the call itself. */
  depth?: number;
}

export interface FireResult {
  eventKey: string;
  /** False when the event had fired before (nothing was applied). */
  fired: boolean;
  ops: FormatOp[];
  notifications: PlannedNotification[];
  issues: RuntimeIssue[];
  /** The `action_locked` events fired because this event locked an action. */
  cascaded: string[];
}

function payloadOf(event: KitEvent): Json {
  return {
    event: event.event,
    ...(event.stage !== undefined ? { stage: event.stage } : {}),
    ...(event.round !== undefined ? { round: event.round } : {}),
    ...(event.action !== undefined ? { action: event.action } : {}),
    ...(event.mark !== undefined ? { mark: event.mark } : {}),
    ...(event.match_id !== undefined ? { match_id: event.match_id } : {}),
    ...(event.players !== undefined ? { players: [...event.players] } : {}),
  };
}

/** Null when the league does not run a kit format. */
export async function fireEvent(
  seasonId: string,
  event: KitEvent,
  firedBy: string | null,
  options: FireOptions = {},
): Promise<FireResult | null> {
  const ctx = options.context ?? (await loadFreshKitContext(seasonId));
  if (ctx === null) return null;
  const key = eventKey(event);
  const empty: FireResult = { eventKey: key, fired: false, ops: [], notifications: [], issues: [], cascaded: [] };
  if (ctx.state.firedEventKeys.includes(key)) return empty;

  let rows: Record<string, PlayerRow> | undefined;
  if (eventNeedsRows(ctx.def, event)) {
    const phase = event.stage === undefined ? ctx.phases[0] : phaseOfStageKey(ctx, event.stage);
    const table = phase === undefined ? null : await loadStageTable(ctx, phase.id);
    rows = table === null ? undefined : playerRowsOf(table);
  }
  const plan = planEffects(ctx.def, event, ctx.state, rosterOf(ctx, event.stage), ctx.seed, { rows });
  const ops = [...plan.ops, ...(options.ops ?? [])];
  const fired = await fireFormatEvent({ seasonId, eventKey: key, event: event.event, payload: payloadOf(event), ops, firedBy });
  if (!fired) return { ...empty, ops, notifications: plan.notifications, issues: plan.issues };

  expireSeasonReads(seasonId, ctx.phases.map((phase) => phase.id));

  const cascaded: string[] = [];
  const depth = options.depth ?? 0;
  if (depth < MAX_CASCADE) {
    for (const op of ops) {
      if (op.op !== 'lock_action') continue;
      const result = await fireEvent(seasonId, { event: 'action_locked', action: op.action }, firedBy, { depth: depth + 1 });
      if (result?.fired) cascaded.push(result.eventKey, ...result.cascaded);
    }
  }
  return { eventKey: key, fired: true, ops, notifications: plan.notifications, issues: plan.issues, cascaded };
}
