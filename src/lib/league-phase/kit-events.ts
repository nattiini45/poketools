import 'server-only';

import { logger } from '@/lib/logger';
import type { FireFormatEventInput } from '@/lib/supabase/queries/format-runtime';
import { eventKey } from '@/lib/format-engine/runtime/events';
import { eventNeedsRows, planEffects } from '@/lib/format-engine/runtime/effects';
import { pendingLockEvents } from '@/lib/format-engine/runtime/fire';
import { loadFreshKitContext, rosterOf, phasesOfStageKey, type KitContext } from '@/lib/format-engine/runtime/load';
import { playerRowsOf } from '@/lib/format-engine/runtime/stage-table';
import type { KitStanding } from '@/lib/format-engine/standings';
import type { PlayerRow } from '@/lib/format-engine/runtime/types';
import type { KitStoragePort } from './kit-storage';

export interface NativeKitStatusPort {
  storage: KitStoragePort;
  table(ctx: KitContext, phaseId: string): Promise<KitStanding[] | null>;
  settled(ctx: KitContext, phaseId: string): Promise<boolean>;
  writeEvent(input: Omit<FireFormatEventInput, 'matchFence'>): Promise<boolean>;
  invalidate(seasonId: string, phaseIds: readonly string[]): void;
}

type NativeStatusEvent =
  | { event: 'stage_start' | 'stage_end'; stage: string; action?: never }
  | { event: 'action_locked'; action: string; stage?: never };

export async function fireNativeKitStatusEvent(
  ctx: KitContext,
  event: NativeStatusEvent,
  port: NativeKitStatusPort,
  depth = 0,
): Promise<void> {
  const key = eventKey(event);
  if (!ctx.state.firedEventKeys.includes(key)) {
    let rows: Record<string, PlayerRow> | undefined;
    if (eventNeedsRows(ctx.def, event)) {
      const phases = event.stage === undefined ? ctx.phases.slice(0, 1) : phasesOfStageKey(ctx, event.stage);
      for (const phase of phases) {
        const table = await port.table(ctx, phase.id);
        if (table !== null) rows = { ...rows, ...playerRowsOf(table) };
      }
    }
    const plan = planEffects(ctx.def, event, ctx.state, rosterOf(ctx, event.stage), ctx.seed, { rows });
    const fired = await port.writeEvent({
      seasonId: ctx.seasonId,
      eventKey: key,
      event: event.event,
      payload: { event: event.event, ...(event.stage !== undefined ? { stage: event.stage } : {}), ...(event.action !== undefined ? { action: event.action } : {}) },
      ops: plan.ops,
      firedBy: null,
      revision: ctx.revision,
      notifications: plan.notifications,
    });
    for (const issue of plan.issues) logger.warn('format-engine/native-status', 'event effect skipped', { phaseStage: event.stage, ...issue });
    if (fired) port.invalidate(ctx.seasonId, ctx.phases.map((phase) => phase.id));
  }
  if (depth >= 3) return;
  try {
    const fresh = await loadFreshKitContext(ctx.seasonId, port.storage);
    if (fresh === null) return;
    for (const action of pendingLockEvents(fresh)) {
      const current = await loadFreshKitContext(ctx.seasonId, port.storage);
      if (current === null) return;
      if (!pendingLockEvents(current).includes(action)) continue;
      await fireNativeKitStatusEvent(current, { event: 'action_locked', action }, port, depth + 1);
    }
  } catch (error) {
    logger.error('format-engine/native-status', 'native lock cascade failed; retry the status reaction to repair it', { seasonId: ctx.seasonId, eventKey: key, error });
  }
}
