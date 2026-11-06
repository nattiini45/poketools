/**
 * Saving and submitting a player action of a kit league. A draft is checked for access only (the action exists, its
 * window is open, the actor has a link); a submission passes the whole `validateActionSubmission`. Both end in one SQL
 * function (`format_action_save` / `format_action_submit`), which re-checks the lock and, for a submission, the
 * exclusive items under a row lock. Both hand the database the revision of the format the context was loaded from
 * (`KitContext.revision`): an admin change that landed after the validation (a format attached, replaced, detached,
 * switched, or a domain amended) makes it refuse the write as `format_context_stale` (409; the caller reloads and
 * validates again), so a pick is never stored against a format it was not validated for. The database also keeps the
 * capacity of a resource under a lock that every grant shares. A refusal of the database (`action_locked`,
 * `resource_item_taken`, `resource_capacity_reached`, `format_context_stale`) leaves as a `FormatRuntimeError`; a submit that asked to write only over a draft (`onlyIfUnsubmitted`) and met a submitted pick
 * leaves as a `FormatActionAlreadySubmittedError`. Server only.
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
  type ActionAudience,
  type ActionIssue,
} from './actions';
import { loadFreshKitContext, rosterOf } from './load';
import { refuse } from './refusal';
import type { ActionPick } from './types';

export interface ActionRequest {
  seasonId: string;
  actionId: string;
  actorId: string;
  picks: readonly ActionPick[];
  /** Default `player`; the cron's deadline pick passes `system` (see `validateActionSubmission`). */
  audience?: ActionAudience;
  /**
   * Submit only over a draft: a pick that is already submitted or locked when the database takes the action's lock is
   * left alone and the call raises `FormatActionAlreadySubmittedError`. The cron's deadline draw sets it (a player's
   * deliberate choice must never be replaced by a draw). Ignored by `saveAction`.
   */
  onlyIfUnsubmitted?: boolean;
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

  // A submitted pick is not demoted by a save: the database would turn it into a draft and drop the items it granted, and
  // a stale tab or a direct call must not be able to do that. The player submits again to change it. (A submit that lands
  // between this read and the call below can still be demoted; that needs two requests of one account in the same few
  // milliseconds and ends in a draft the player can submit again.)
  if (ctx.state.submissions.some((s) => s.action === request.actionId && s.actor === request.actorId && s.status === 'submitted')) {
    throw refuse('format_action_already_submitted');
  }
  const submission = await saveFormatAction({
    seasonId: request.seasonId,
    actionKey: request.actionId,
    actorId: request.actorId,
    targetId: access.target,
    picks: picksJson(request.picks),
    revision: ctx.revision,
  });
  expireSeasonReads(request.seasonId, ctx.phases.map((phase) => phase.id));
  return { ok: true, submission };
}

export async function submitAction(request: ActionRequest): Promise<ActionWrite> {
  const ctx = await loadFreshKitContext(request.seasonId);
  if (ctx === null) return { ok: false, issues: [{ code: 'format_not_running' }] };
  const rule = findAction(ctx.def, request.actionId);
  const checked = validateActionSubmission(ctx.def, request.actionId, request.actorId, request.picks, ctx.state, rosterOf(ctx), ctx.seed, { audience: request.audience });
  if (!checked.ok || rule === null) return { ok: false, issues: checked.ok ? [{ code: 'action_unknown' }] : checked.issues };

  const submission = await submitFormatAction({
    seasonId: request.seasonId,
    actionKey: request.actionId,
    actorId: request.actorId,
    targetId: checked.target,
    picks: picksJson(request.picks),
    items: checked.items.map((item) => ({ resource: item.resource, item_id: item.item_id, exclusive: item.exclusive })),
    lock: rule.lock === 'on_submit',
    onlyIfUnsubmitted: request.onlyIfUnsubmitted,
    revision: ctx.revision,
  });
  expireSeasonReads(request.seasonId, ctx.phases.map((phase) => phase.id));
  return { ok: true, submission };
}
