/**
 * Saving and submitting a player action of a kit league. A draft is checked for access only (the action exists, its
 * window is open, the actor has a link); a submission passes the whole `validateActionSubmission`. Both end in one SQL
 * function (`format_action_save` / `format_action_submit`), which re-checks the lock and, for a submission, the
 * exclusive items under a row lock. A refusal of the database (`action_locked`, `resource_item_taken`) leaves as a
 * `FormatRuntimeError`. Server only.
 */
import 'server-only';

import { expireSeasonReads } from '@/lib/revalidation';
import {
  saveFormatAction,
  submitFormatAction,
  type FormatActionSubmissionRow,
} from '@/lib/supabase/queries/format-runtime';
import type { Json } from '@/types/database';
import {
  findAction,
  isActionWindowOpen,
  resolveActionTarget,
  validateActionSubmission,
  type ActionIssue,
} from './actions';
import { loadFreshKitContext, rosterOf } from './load';
import type { ActionPick } from './types';

export interface ActionRequest {
  seasonId: string;
  actionId: string;
  actorId: string;
  picks: readonly ActionPick[];
}

export type ActionWrite = { ok: true; submission: FormatActionSubmissionRow } | { ok: false; issues: ActionIssue[] };

const picksJson = (picks: readonly ActionPick[]): Json => picks.map((pick) => ({ step: pick.step, item_id: pick.item_id }));

export async function saveAction(request: ActionRequest): Promise<ActionWrite> {
  const ctx = await loadFreshKitContext(request.seasonId);
  if (ctx === null) return { ok: false, issues: [{ code: 'format_not_running' }] };
  const rule = findAction(ctx.def, request.actionId);
  if (rule === null) return { ok: false, issues: [{ code: 'action_unknown' }] };

  const issues: ActionIssue[] = [];
  if (!isActionWindowOpen(rule, ctx.state)) issues.push({ code: 'window_closed' });
  const access = resolveActionTarget(rule, request.actorId, ctx.state);
  const roster = rosterOf(ctx);
  if (!access.ok || (rule.via === undefined && roster.length > 0 && !roster.includes(request.actorId))) issues.push({ code: 'actor_without_link' });
  for (const pick of request.picks) {
    if (!Number.isInteger(pick.step) || pick.step < 0 || pick.step >= rule.steps.length) issues.push({ code: 'step_unknown', step: pick.step, item_id: pick.item_id });
  }
  if (issues.length > 0 || !access.ok) return { ok: false, issues };

  const submission = await saveFormatAction({
    seasonId: request.seasonId,
    actionKey: request.actionId,
    actorId: request.actorId,
    targetId: access.target,
    picks: picksJson(request.picks),
  });
  expireSeasonReads(request.seasonId, ctx.phases.map((phase) => phase.id));
  return { ok: true, submission };
}

export async function submitAction(request: ActionRequest): Promise<ActionWrite> {
  const ctx = await loadFreshKitContext(request.seasonId);
  if (ctx === null) return { ok: false, issues: [{ code: 'format_not_running' }] };
  const rule = findAction(ctx.def, request.actionId);
  const checked = validateActionSubmission(ctx.def, request.actionId, request.actorId, request.picks, ctx.state, rosterOf(ctx), ctx.seed);
  if (!checked.ok || rule === null) return { ok: false, issues: checked.ok ? [{ code: 'action_unknown' }] : checked.issues };

  const submission = await submitFormatAction({
    seasonId: request.seasonId,
    actionKey: request.actionId,
    actorId: request.actorId,
    targetId: checked.target,
    picks: picksJson(request.picks),
    items: checked.items.map((item) => ({ resource: item.resource, item_id: item.item_id, exclusive: item.exclusive })),
    lock: rule.lock === 'on_submit',
  });
  expireSeasonReads(request.seasonId, ctx.phases.map((phase) => phase.id));
  return { ok: true, submission };
}
