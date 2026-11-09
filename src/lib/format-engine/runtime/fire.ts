/**
 * Fires an event of a kit league: plan the ops from the format's rules, hand them to `format_fire_event` (one
 * transaction; the event key makes a second call a no-op), then expire the public reads. Server only.
 *
 * A `lock_action` op locks the action, which is itself an event (`action_locked`, for a relation's `reveal_on` and any
 * rule on it): it is fired right after, up to `MAX_CASCADE` levels deep. The cascade is a second transaction, so it can be
 * lost (a crash between the two, a manual lock by an adjustment). The flag is the truth: `fireLockedActionEvents` fires
 * `action_locked` for every action whose flag is `"locked"` and whose event has not fired, and runs when an event that
 * had fired before is fired again (a retry) and in every cron pass; a cascade that fails right after its event committed is
 * logged and left to that pass, it never fails the event. Callers that add their own ops to the same
 * transaction (track progress of a completed match) pass them in `options.ops`.
 *
 * The ops are planned from the context's format, and the database applies them only to that version of it: the call carries
 * `KitContext.revision`, and an attach, a re-attach, a detach, an engine switch or an amendment that landed after the context
 * was loaded makes it raise `format_context_stale` before the key is logged (nothing applied, the key stays free for the
 * event of the new format). The error leaves `fireEvent` as it is: it means "retry later", and the callers do (a hook
 * reports a failed step and the heal repeats it, the cron pass starts over on its next run, an admin's manual lock is picked
 * up by the cron).
 */
import 'server-only';

import { logger } from '@/lib/logger';
import { expireSeasonReads } from '@/lib/revalidation';
import { fireFormatEvent } from '@/lib/supabase/queries/format-runtime';
import type { Json } from '@/types/database';
import { eventKey, type KitEvent } from './events';
import { eventNeedsRows, planEffects, type PlannedNotification } from './effects';
import { actionFlagKey } from './actions';
import { loadFreshKitContext, rosterOf, type KitContext } from './load';
import { loadStageRows } from './stage-table';
import { own, type FormatOp, type PlayerRow, type RuntimeIssue } from './types';

const TAG = 'format-engine/fire';

const MAX_CASCADE = 3;

export interface FireOptions {
  /** Ops that belong to this event's transaction besides the planned effects. */
  ops?: readonly FormatOp[];
  /** The context the caller already loaded (it must be fresh). */
  context?: KitContext;
  /** Cascade depth, set by the call itself. */
  depth?: number;
  /** The completion this event belongs to (`FireFormatEventInput.matchFence`). */
  matchFence?: { matchId: string; confirmedAt: string };
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

/** The actions whose flag says locked but whose `action_locked` event has not fired. */
export function pendingLockEvents(ctx: Pick<KitContext, 'def' | 'state'>): string[] {
  const out: string[] = [];
  for (const rule of ctx.def.rules) {
    if (rule.kind !== 'player.action' || out.includes(rule.id)) continue;
    if (own(ctx.state.flags, actionFlagKey(rule.id)) !== 'locked') continue;
    if (!ctx.state.firedEventKeys.includes(eventKey({ event: 'action_locked', action: rule.id }))) out.push(rule.id);
  }
  return out;
}

/**
 * Fires the `action_locked` event of every locked action that has none yet (see the header). Returns the event keys that
 * fired now, including the ones they cascaded to. `context` must be fresh.
 */
export async function fireLockedActionEvents(
  seasonId: string,
  firedBy: string | null,
  options: { context?: KitContext; depth?: number } = {},
): Promise<string[]> {
  const ctx = options.context ?? (await loadFreshKitContext(seasonId));
  if (ctx === null) return [];
  const fired: string[] = [];
  // The decision (this action is locked and its event has not fired) and the write go through ONE context: the first fire
  // carries the revision of `ctx` (a format replaced since raises format_context_stale, nothing is logged), and every later
  // one re-reads the league, re-checks the decision against that fresh context and fires through it, so a lock the new
  // format does not have never burns an `action_locked:<id>` key there.
  let current = ctx;
  let first = true;
  for (const action of pendingLockEvents(ctx)) {
    if (!first) {
      const fresh = await loadFreshKitContext(seasonId);
      if (fresh === null) return fired;
      current = fresh;
      if (!pendingLockEvents(current).includes(action)) continue;
    }
    first = false;
    const result = await fireEvent(seasonId, { event: 'action_locked', action }, firedBy, { context: current, depth: (options.depth ?? 0) + 1 });
    if (result?.fired) fired.push(result.eventKey, ...result.cascaded);
  }
  return fired;
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
  const depth = options.depth ?? 0;
  if (ctx.state.firedEventKeys.includes(key)) {
    // A retry of an event whose own transaction committed: its lock cascade may be what was lost.
    if (depth < MAX_CASCADE) return { ...empty, cascaded: await fireLockedActionEvents(seasonId, firedBy, { context: ctx, depth }) };
    return empty;
  }

  // A `foreach_group` stage is several phases under one key: every group's table feeds the rows.
  const rows: Record<string, PlayerRow> | undefined = eventNeedsRows(ctx.def, event) ? await loadStageRows(ctx, event.stage) : undefined;
  const plan = planEffects(ctx.def, event, ctx.state, rosterOf(ctx, event.stage), ctx.seed, { rows });
  const ops = [...plan.ops, ...(options.ops ?? [])];
  const fired = await fireFormatEvent({
    seasonId,
    eventKey: key,
    event: event.event,
    payload: payloadOf(event),
    ops,
    firedBy,
    revision: ctx.revision,
    ...(options.matchFence ? { matchFence: options.matchFence } : {}),
  });
  if (!fired) return { ...empty, ops, notifications: plan.notifications, issues: plan.issues };

  expireSeasonReads(seasonId, ctx.phases.map((phase) => phase.id));

  const cascaded: string[] = [];
  if (depth < MAX_CASCADE && ops.some((op) => op.op === 'lock_action')) {
    // The event is committed: a cascade that cannot run now must not fail it (a caller would report a failed step for an
    // event that applied, and skip what follows it). The flag is the truth, and the cron pass fires every pending
    // `action_locked` (`fireLockedActionEvents`). The cascade re-reads the league and fires only the locks the CURRENT format
    // has, so a format replaced since never gets an `action_locked` key burnt for a lock it does not have.
    try {
      cascaded.push(...(await fireLockedActionEvents(seasonId, firedBy, { depth })));
    } catch (error) {
      logger.error(TAG, 'the lock cascade of a fired event failed; the next cron pass fires the pending action_locked events', {
        seasonId,
        eventKey: key,
        error,
      });
    }
  }
  return { eventKey: key, fired: true, ops, notifications: plan.notifications, issues: plan.issues, cascaded };
}
