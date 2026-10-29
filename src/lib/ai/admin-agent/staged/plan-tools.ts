/**
 * The Plan tools (plan 3.6.4): `plan_create`, `plan_set`, `plan_patch` and `plan_revert`. They write the assistant's own
 * tables only (`admin_agent_plans` and its revision history); nothing here reaches a domain table or a route.
 *
 * Every edit is the pure code of `plans/` (`applyPlanSetJson`, `applyPlanPatch`, `applyPlanRevert`), applied to the
 * conversation's active Plan as stored, and written as the next revision with a compare-and-set on the revision it read
 * (a concurrent edit by the admin in the panel answers `plan_stale`). A refusal is a catalogued `validation_failed` whose
 * `issues` name kinds and paths, never a zod message. The result carries the blockers that need no live lookup; the full
 * readiness with live facts is `plan_validate` and `propose_build`.
 */
import {
  applyPlanPatch,
  applyPlanRevert,
  applyPlanSetJson,
  describePlanEditError,
  emptyPlan,
  jsonClone,
  parsePlanDocument,
  planDocHash,
  planReadiness,
  type PlanDocument,
  type PlanEditResult,
  type PlanSlotName,
} from '../plans';
import { toolError } from '../registry/errors';
import type { ToolCallContext, ToolRunResult } from '../loop/types';
import type { AdminId } from '../store/ids';
import type { Json, PlanRecord } from '../store/types';
import type { StagedRunnerDeps } from './types';

/** The blockers shown to the model after an edit. */
const BLOCKERS_SHOWN = 8;

type Loaded = { ok: true; record: PlanRecord; plan: PlanDocument } | { ok: false; result: ToolRunResult };

export const noPlan = (): ToolRunResult => toolError('validation_failed', { issues: 'no_plan: call plan_create first' });

async function loadActive(deps: StagedRunnerDeps, ctx: ToolCallContext): Promise<Loaded> {
  const record = await deps.store.plans.getActivePlan(ctx.adminId as AdminId, ctx.conversationId);
  if (record === null) return { ok: false, result: noPlan() };
  const parsed = parsePlanDocument(record.doc);
  if (!parsed.ok) {
    // A stored Plan that no longer parses is a server fault, not something the model can repair with an edit.
    console.error('[admin-agent] the stored Plan no longer parses', parsed.issues.slice(0, 5));
    return { ok: false, result: toolError('agent_harness_error') };
  }
  return { ok: true, record, plan: parsed.plan };
}

/** The blockers that need no live lookup (a `fact_unavailable` one means "checked when the Build is prepared"). */
function openBlockers(plan: PlanDocument): string[] {
  return planReadiness(plan)
    .blockers.filter((blocker) => blocker.kind !== 'fact')
    .slice(0, BLOCKERS_SHOWN)
    .map((blocker) => blocker.code);
}

function updated(revision: number, data: Record<string, Json>): ToolRunResult {
  return { ok: true, data: { plan_revision: revision, ...data }, events: [{ type: 'plan.updated', revision }], ui: { plan_revision: revision } };
}

/** Writes `plan` as the next revision of `record` and answers the model. */
async function commit(
  deps: StagedRunnerDeps,
  ctx: ToolCallContext,
  record: PlanRecord,
  result: Extract<PlanEditResult, { ok: true }>,
  patch: Json | null,
): Promise<ToolRunResult> {
  const doc = jsonClone(result.plan) as unknown as Json;
  const docHash = planDocHash(result.plan);
  const blockers = openBlockers(result.plan);
  if (docHash === record.doc_hash) {
    // Nothing changed: no new revision, so the history and the pending Build card stay as they are.
    return { ok: true, data: { plan_revision: record.revision, changed_slots: [], unchanged: true, blockers } };
  }
  const written = await deps.store.plans.writePlanRevision(ctx.adminId as AdminId, record.id, {
    expectedRevision: record.revision,
    doc,
    docHash,
    patch,
    author: 'agent',
  });
  return updated(written.plan.revision, {
    changed_slots: result.changedSlots,
    blockers,
    ...(written.supersededProposals > 0 ? { superseded_proposals: written.supersededProposals } : {}),
  });
}

const refused = (error: Parameters<typeof describePlanEditError>[0]): ToolRunResult => toolError('validation_failed', { issues: describePlanEditError(error) });

export async function planCreate(
  deps: StagedRunnerDeps,
  args: { mode: 'create' | 'amend'; title: string; entity_kind?: string; entity_id?: string },
  ctx: ToolCallContext,
): Promise<ToolRunResult> {
  // Seeding a Plan from an existing league or tournament reads live rows into a Plan; that arrives with the change cards.
  if (args.mode === 'amend') return toolError('tool_not_available');
  const existing = await deps.store.plans.getActivePlan(ctx.adminId as AdminId, ctx.conversationId);
  if (existing !== null && existing.status !== 'abandoned' && existing.status !== 'built') {
    return toolError('validation_failed', { issues: 'plan_exists: edit it with plan_set or plan_patch, or restore an earlier revision with plan_revert' });
  }
  const plan = emptyPlan({ title: args.title, intent: 'mixed', contentLocale: ctx.locale });
  const record = await deps.store.plans.createPlan(ctx.adminId as AdminId, {
    conversationId: ctx.conversationId,
    mode: 'create',
    doc: jsonClone(plan) as unknown as Json,
    docHash: planDocHash(plan),
    author: 'agent',
  });
  return updated(record.revision, {});
}

export async function planSet(deps: StagedRunnerDeps, args: { slot: PlanSlotName; value_json: string }, ctx: ToolCallContext): Promise<ToolRunResult> {
  const loaded = await loadActive(deps, ctx);
  if (!loaded.ok) return loaded.result;
  const result = applyPlanSetJson(loaded.plan, { slot: args.slot, valueJson: args.value_json });
  if (!result.ok) return refused(result.error);
  return commit(deps, ctx, loaded.record, result, { set: args.slot });
}

export async function planPatch(deps: StagedRunnerDeps, args: { ops_json: string }, ctx: ToolCallContext): Promise<ToolRunResult> {
  const loaded = await loadActive(deps, ctx);
  if (!loaded.ok) return loaded.result;
  const result = applyPlanPatch(loaded.plan, args.ops_json);
  if (!result.ok) return refused(result.error);
  // `applyPlanPatch` parsed these ops already, so this parse cannot fail; the stored form is the parsed array.
  const ops = JSON.parse(args.ops_json) as Json;
  return commit(deps, ctx, loaded.record, result, { ops });
}

/** The stored marker of a revision written by a revert: the revision whose content it restored. */
function revertedTo(patch: Json | null): number | null {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return null;
  const value = (patch as Record<string, Json>).reverted_to;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * Restores the previous state of the Plan. A revert is itself a revision (the history is append-only), so repeated reverts
 * walk back: after reverting to revision `n` the next revert restores the state before `n`.
 */
export async function planRevert(deps: StagedRunnerDeps, ctx: ToolCallContext): Promise<ToolRunResult> {
  const loaded = await loadActive(deps, ctx);
  if (!loaded.ok) return loaded.result;
  const { record } = loaded;
  const adminId = ctx.adminId as AdminId;

  const latest = await deps.store.plans.getRevision(adminId, record.id, record.revision);
  const marker = latest === null ? null : revertedTo(latest.patch);
  const target = marker !== null ? marker - 1 : record.revision - 1;
  if (target < 1) return toolError('validation_failed', { issues: 'nothing_to_revert' });
  const previous = await deps.store.plans.getRevision(adminId, record.id, target);
  if (previous === null) return toolError('validation_failed', { issues: 'revision_missing' });
  const parsed = parsePlanDocument(previous.doc);
  if (!parsed.ok) return toolError('validation_failed', { issues: 'revision_unreadable' });

  const result = applyPlanRevert(loaded.plan, parsed.plan);
  if (!result.ok) return refused(result.error);
  return commit(deps, ctx, record, result, { reverted_to: target });
}
