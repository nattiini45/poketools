/**
 * The private draft tools (plan 3.6.5, spec §18.4): `ruleset_create_draft` and `ruleset_patch_draft`. They write the admin's
 * OWN private ruleset drafts through the real Ruleset Studio routes, from inside the chat loop, as the verified session of
 * the chat request. A draft changes no league (leagues pin published versions) and is not approved, so these are class D:
 * they run at once, are audited `agent.draft.write`, and a patch keeps the previous document so it can be undone.
 *
 * One pipeline for both tools, in this order (nothing is dispatched before the ledger row and the snapshot exist):
 *
 *   phase cap, session present (else nothing is written)
 *   -> [patch: read the current draft through the viewer guard and the route's edit rule, refuse a stale revision,
 *       apply the operations, measure the previous document]
 *   -> ledger row (`insertAction`, at most once per tool_use_id)
 *   -> [patch: snapshot of the previous document]
 *   -> `checkCall` (the binding's strict schemas, fail closed)
 *   -> `invokeRoute` (the route's own guard, limiter and validation run for real)
 *   -> the ledger row completed with the outcome (also after a failure, so a snapshot is never orphaned)
 *   -> the audit event, and the answer: ids and revisions only, never the document.
 *
 * A masked 500, a 504 or a timeout may have committed: the answer says the outcome is unknown and the model must read the
 * draft again before it retries. Nothing here retries.
 *
 * Imports no route and no privileged code: the bindings arrive through `deps.drafts`.
 */
import { runWithAgentAuditContext } from '@/lib/audit/agent-context';
import { assertCanEditDraft } from '@/lib/ruleset-studio/library';
import { getRulesetDefinitionDraft } from '@/lib/supabase/queries/ruleset-definitions';
import type { JsonValue } from '@/lib/studio-core/json';
import { bindingInput, checkCall, invokeRoute, isUnknownOutcome, outcomeCode, type DispatchContext, type Outcome, type RouteBinding } from '../dispatch';
import { hashJson } from '../plans/hash';
import { toolError, toolErrorFromThrown, isCataloguedCode } from '../registry/errors';
import { guardFor } from '../registry/guard';
import type { StagedTool } from '../registry';
import type { StagedToolContext } from '../loop/tool-runtime';
import type { ToolRunResult } from '../loop/types';
import type { AdminId } from '../store/ids';
import type { Json } from '../store/types';
import { draftDocState, draftLifeState, stateHash } from '../proposals/after-state';
import { jsonbTextBytes, parsePatchOps, patchDocument, SNAPSHOT_MAX_BYTES } from './draft-patch';
import type { DraftToolDeps, StagedRunnerDeps } from './types';

const RE_READ = { re_read: 'ruleset_get' } as const;

export interface CreateDraftArgs {
  mode: 'new' | 'fork_preset' | 'fork_ruleset';
  name?: string;
  base_locale?: 'en' | 'de';
  base_preset?: string;
  preset_id?: string;
  source_id?: string;
  tour_overlay?: boolean;
  slug?: string;
}

export interface PatchDraftArgs {
  ruleset_id: string;
  draft_rev: number;
  ops_json: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isRevision = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** The pieces every draft write needs besides its arguments, or the answer that nothing was written. */
type Prelude = { ok: true; drafts: DraftToolDeps; dispatch: NonNullable<StagedToolContext['dispatch']> } | { ok: false; result: ToolRunResult };

function prelude(deps: StagedRunnerDeps, tool: StagedTool, ctx: StagedToolContext): Prelude {
  const drafts = deps.drafts;
  if (drafts === undefined) return { ok: false, result: toolError('tool_not_available') };
  // The registry offers a tool only up to the cap; this is the second line of defence.
  if (drafts.maxPhase() < tool.phase) return { ok: false, result: toolError('phase_disabled') };
  if (ctx.dispatch === undefined) {
    // No recorded session on this request: no route can run as the admin. Nothing is written, no ledger row is made.
    console.error(`[admin-agent] ${tool.name}: the turn carries no verified session; nothing was written`);
    return { ok: false, result: toolError('agent_harness_error') };
  }
  return { ok: true, drafts, dispatch: ctx.dispatch };
}

// ─── The shared pipeline ─────────────────────────────────────────────────────

interface Created {
  ruleset_id: string;
  draft_rev: number;
  slug?: string;
}

interface WriteSpec {
  tool: StagedTool;
  binding: RouteBinding;
  /** The tool's arguments as the binding's builders read them. */
  args: unknown;
  /** What the ledger stores as the call's arguments (small, never a document). */
  ledgerArgs: Json;
  /** The definition this call writes, when it is known before the call (a patch). */
  knownRulesetId: string | null;
  /** The revision and document hash before the call (a patch). */
  before: { draft_rev: number; doc_hash: string } | null;
  /** The previous document, kept for the undo (a patch). */
  snapshot: { document: Json; docHash: string } | null;
  /** The hash of the document the call sends (a patch); `null` when it cannot be hashed (the route will refuse it). */
  docHashAfter: string | null;
  /** Reads the ids out of what the route answered; `null` when it answered nothing usable. */
  read(data: unknown): Created | null;
  /** The compensating recipe stored with the ledger row. */
  undo(rulesetId: string | null, draftRevAfter: number | null): { recipe: Json; reversibility: string };
  /**
   * The state the write left the draft in, hashed (`after_fingerprint`): what an undo compares the live draft with to tell
   * whether anybody else saved since. `null` when it cannot be told (the document could not be hashed).
   */
  afterFingerprint(draftRevAfter: number | null): string | null;
}

/** The model's answer for an outcome that did not succeed: the route's own catalogued code, never its message. */
function failureResult(outcome: Exclude<Outcome, { kind: 'ok' }>): ToolRunResult {
  if (isUnknownOutcome(outcome)) return toolError('unknown_outcome', RE_READ);
  switch (outcome.kind) {
    case 'unauthenticated':
      return toolError('unauthenticated');
    case 'rate_limited':
      return toolError(outcome.code, { seconds: outcome.retryAfterSeconds });
    case 'validation': {
      const code = isCataloguedCode(outcome.code) ? outcome.code : 'validation_failed';
      return toolError(code, { ...(outcome.params ?? {}), ...(code === 'validation_failed' && outcome.issues !== '' ? { issues: outcome.issues } : {}) });
    }
    case 'forbidden':
    case 'not_found':
    case 'conflict':
    case 'locked': {
      const code = isCataloguedCode(outcome.code) ? outcome.code : 'agent_harness_error';
      return toolError(code, outcome.params);
    }
    default: {
      // upstream_timeout, masked_server_error and harness_error of a call that surely wrote nothing.
      const code = outcomeCode(outcome);
      return toolError(code !== null && isCataloguedCode(code) ? code : 'agent_harness_error');
    }
  }
}

async function writeDraft(drafts: DraftToolDeps, dispatch: NonNullable<StagedToolContext['dispatch']>, ctx: StagedToolContext, spec: WriteSpec): Promise<ToolRunResult> {
  const adminId = ctx.adminId as AdminId;
  const { tool, binding } = spec;
  const input = bindingInput(binding, spec.args);
  const argsHash = hashJson({ tool: tool.name, operation: binding.operation, args: spec.ledgerArgs });

  // 1. The ledger row, before anything else. A key that is taken means this call was dispatched before: do not dispatch again.
  let actionId: string;
  try {
    const inserted = await drafts.store.actions.insertAction(adminId, {
      conversationId: ctx.conversationId,
      toolUseId: ctx.toolUseId,
      toolName: tool.name,
      class: 'D',
      method: binding.method === 'GET' ? null : binding.method,
      path: binding.path,
      args: spec.ledgerArgs,
      argsHash,
    });
    if (!inserted.inserted) return toolError('unknown_outcome', RE_READ);
    actionId = inserted.action.id;
  } catch (error) {
    console.error(`[admin-agent] ${tool.name}: the ledger row could not be written; nothing was dispatched`, error);
    return toolError('ledger_unavailable');
  }

  const complete = async (outcome: Parameters<DraftToolDeps['store']['actions']['completeAction']>[2]): Promise<void> => {
    try {
      await drafts.store.actions.completeAction(adminId, actionId, outcome);
    } catch (error) {
      // The write (if any) is done; a ledger row left `executing` is closed by the reaper. The model still gets the truth.
      console.error(`[admin-agent] ${tool.name}: the ledger row could not be completed`, error);
    }
  };
  const before: Json | null = spec.before === null ? null : { ruleset_id: spec.knownRulesetId, draft_rev: spec.before.draft_rev, doc_hash: spec.before.doc_hash };

  // 2. The snapshot of the previous document, so a patch can be undone. No snapshot, no write.
  let snapshotId: string | null = null;
  if (spec.snapshot !== null) {
    try {
      snapshotId = (await drafts.store.snapshots.insertSnapshot(adminId, { actionId, document: spec.snapshot.document, docHash: spec.snapshot.docHash })).id;
    } catch (error) {
      console.error(`[admin-agent] ${tool.name}: the snapshot could not be stored; nothing was dispatched`, error);
      await complete({ status: 'failed', outcomeKind: 'not_dispatched', errorCode: 'ledger_unavailable', before, entityType: 'ruleset', entityId: spec.knownRulesetId });
      return toolError('ledger_unavailable');
    }
  }

  // 3. The second lock: the resolved request must still fit the binding's strict schemas.
  const checked = checkCall(binding, { params: input.params ?? {}, body: input.body });
  if (!checked.ok) {
    console.error(`[admin-agent] ${tool.name}: the resolved call does not fit its binding (${checked.reason})`, checked.issues);
    await complete({ status: 'skipped', outcomeKind: 'not_dispatched', errorCode: 'validation_failed', before, entityType: 'ruleset', entityId: spec.knownRulesetId });
    return toolError('validation_failed', { issues: checked.issues.slice(0, 6).join('; ') });
  }

  // 4. The route, as the verified session of this request. D is not approved: the audit context has no proposal and no approver.
  const context: DispatchContext = {
    session: dispatch.session,
    inbound: dispatch.inbound,
    audit: {
      agent_conversation_id: ctx.conversationId,
      agent_tool: tool.name,
      args_hash: argsHash,
      model: ctx.model,
      effort: ctx.effort,
      system_prompt_version: ctx.systemPromptVersion,
      tool_registry_version: ctx.toolRegistryVersion,
      ...(ctx.userTextHash === null ? {} : { user_text_hash: ctx.userTextHash }),
    },
  };
  const outcome = await invokeRoute(binding, input, context);

  // 5. The answer, and the ledger row completed with it.
  const created = outcome.kind === 'ok' ? spec.read(outcome.data) : null;
  const unknown = outcome.kind === 'ok' ? created === null : isUnknownOutcome(outcome);
  const rulesetId = created?.ruleset_id ?? spec.knownRulesetId;
  const revAfter = created?.draft_rev ?? null;
  const { recipe, reversibility } = spec.undo(rulesetId, revAfter);
  await complete({
    status: created !== null ? 'ok' : unknown ? 'unknown' : 'failed',
    httpStatus: outcome.kind === 'ok' ? outcome.httpStatus : 'httpStatus' in outcome ? outcome.httpStatus : null,
    outcomeKind: outcome.kind,
    errorCode: created !== null ? null : outcomeCode(outcome) ?? 'unknown_outcome',
    result: created === null ? null : ({ ruleset_id: created.ruleset_id, draft_rev: created.draft_rev, ...(created.slug === undefined ? {} : { slug: created.slug }) } as Json),
    before,
    after: created === null ? null : { ruleset_id: created.ruleset_id, draft_rev: created.draft_rev, doc_hash: spec.docHashAfter },
    undo: recipe,
    reversibility,
    ...(created !== null ? { afterFingerprint: spec.afterFingerprint(revAfter) } : {}),
    entityType: 'ruleset',
    entityId: rulesetId,
  });

  if (created !== null || unknown) {
    // A draft write is audited whether or not the answer arrived: an unknown outcome may have committed.
    writeAudit(drafts, ctx, context, spec, { actionId, snapshotId, rulesetId, revAfter, outcome: created !== null ? 'ok' : 'unknown' });
  }

  if (created !== null) {
    return {
      ok: true,
      data: { ruleset_id: created.ruleset_id, draft_rev: created.draft_rev, ...(created.slug === undefined ? {} : { slug: created.slug }) },
      // The conversation has now seen this definition: a later `propose_publish_ruleset` passes provenance (plan 6.3).
      refs: [{ kind: 'ruleset', id: created.ruleset_id, label: created.slug ?? null, source: 'tool_result' }],
    };
  }
  if (outcome.kind === 'ok') return toolError('unknown_outcome', RE_READ);
  return failureResult(outcome);
}

/** `agent.draft.write` (fire-and-forget): ids, the tool, the revisions and the document hashes, never a document. */
function writeAudit(
  drafts: DraftToolDeps,
  ctx: StagedToolContext,
  context: DispatchContext,
  spec: WriteSpec,
  facts: { actionId: string; snapshotId: string | null; rulesetId: string | null; revAfter: number | null; outcome: 'ok' | 'unknown' },
): void {
  try {
    runWithAgentAuditContext(context.audit, () =>
      drafts.audit({
        actor_id: ctx.adminId,
        actor_name: ctx.adminName,
        action: 'agent.draft.write',
        resource_type: 'ruleset',
        resource_id: facts.rulesetId,
        metadata: {
          tool: spec.tool.name,
          operation: spec.binding.operation,
          outcome: facts.outcome,
          agent_action_id: facts.actionId,
          draft_rev_before: spec.before?.draft_rev ?? null,
          draft_rev_after: facts.revAfter,
          doc_hash_before: spec.before?.doc_hash ?? null,
          doc_hash_after: spec.docHashAfter,
          snapshot_id: facts.snapshotId,
        },
      }),
    );
  } catch (error) {
    console.error(`[admin-agent] ${spec.tool.name}: the audit event could not be written`, error);
  }
}

// ─── ruleset_create_draft ────────────────────────────────────────────────────

/** `{ definition: { id, slug, draft_rev, ... }, check }` of the create and fork routes. */
function readCreated(data: unknown): Created | null {
  if (!isRecord(data) || !isRecord(data.definition)) return null;
  const { id, slug, draft_rev: rev } = data.definition;
  if (!isUuid(id) || !isRevision(rev)) return null;
  return { ruleset_id: id.toLowerCase(), draft_rev: rev, ...(typeof slug === 'string' && slug !== '' ? { slug } : {}) };
}

const compact = <T extends Record<string, unknown>>(value: T): Json => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Json;

export async function rulesetCreateDraft(deps: StagedRunnerDeps, tool: StagedTool, args: CreateDraftArgs, ctx: StagedToolContext): Promise<ToolRunResult> {
  const ready = prelude(deps, tool, ctx);
  if (!ready.ok) return ready.result;
  const { drafts, dispatch } = ready;

  const operation = args.mode === 'new' ? 'ruleset_create_new' : args.mode === 'fork_preset' ? 'ruleset_create_fork_preset' : 'ruleset_create_fork_ruleset';
  const binding = drafts.bindings.get(operation);
  if (binding === undefined) {
    console.error(`[admin-agent] ${tool.name}: no binding for ${operation}`);
    return toolError('tool_not_available');
  }
  // The arguments each mode's binding reads. Fields of another mode are left out, as the route would ignore them.
  const bound =
    args.mode === 'new'
      ? { name: args.name, base_locale: args.base_locale, base_preset: args.base_preset, tour_overlay: args.tour_overlay, slug: args.slug }
      : args.mode === 'fork_preset'
        ? { preset_id: args.preset_id, tour_overlay: args.tour_overlay, slug: args.slug }
        : { source_id: args.source_id, slug: args.slug };

  return writeDraft(drafts, dispatch, ctx, {
    tool,
    binding,
    args: bound,
    ledgerArgs: compact({ mode: args.mode, ...bound }),
    knownRulesetId: null,
    before: null,
    snapshot: null,
    docHashAfter: null,
    read: readCreated,
    undo: (rulesetId) => ({
      // Owner decision 2026-10-28: deleted by an undo only while it has never been published (read live when the undo is staged).
      recipe: { kind: 'delete_draft', ruleset_id: rulesetId },
      reversibility: 'delete_while_unpublished',
    }),
    // A fresh draft has no version: revision and "unpublished".
    afterFingerprint: (rev) => (rev === null ? null : stateHash(draftLifeState(rev, false))),
  });
}

// ─── ruleset_patch_draft ─────────────────────────────────────────────────────

/** `{ draft_rev, updated_at, name, check }` of the draft save. */
function readSaved(rulesetId: string) {
  return (data: unknown): Created | null => {
    if (!isRecord(data) || !isRevision(data.draft_rev)) return null;
    return { ruleset_id: rulesetId, draft_rev: data.draft_rev };
  };
}

export async function rulesetPatchDraft(deps: StagedRunnerDeps, tool: StagedTool, args: PatchDraftArgs, ctx: StagedToolContext): Promise<ToolRunResult> {
  const ready = prelude(deps, tool, ctx);
  if (!ready.ok) return ready.result;
  const { drafts, dispatch } = ready;

  const binding = drafts.bindings.get('ruleset_patch_draft');
  if (binding === undefined) {
    console.error(`[admin-agent] ${tool.name}: no binding for ruleset_patch_draft`);
    return toolError('tool_not_available');
  }

  const ops = parsePatchOps(args.ops_json);
  if (!ops.ok) return toolError('validation_failed', { issues: ops.issues });

  // The CURRENT draft, through the same live guard an R tool uses (a viewer) and the edit rule of the route. Nothing is
  // written yet: a refusal here costs no ledger row.
  let current: { document: unknown; draft_rev: number };
  try {
    const guarded = await guardFor({ kind: 'rulesetViewer', id: args.ruleset_id });
    const { definition, actor } = guarded.ruleset;
    assertCanEditDraft(actor, definition);
    const draft = await getRulesetDefinitionDraft(definition.id);
    if (draft === null) return toolError('ruleset_not_found');
    current = draft;
  } catch (error) {
    return toolErrorFromThrown(error, tool.name);
  }

  // Compare-and-set, early: the model must read again and no snapshot or ledger row is made for a write that cannot happen.
  if (current.draft_rev !== args.draft_rev) return toolError('ruleset_stale_revision', { draft_rev: current.draft_rev });
  if (!isRecord(current.document)) {
    console.error(`[admin-agent] ${tool.name}: the stored draft is not a JSON object`);
    return toolError('agent_harness_error');
  }
  const previous = current.document as Record<string, JsonValue>;

  if (jsonbTextBytes(previous) > SNAPSHOT_MAX_BYTES) return toolError('draft_too_large');
  let docHashBefore: string;
  try {
    docHashBefore = hashJson(previous);
  } catch {
    return toolError('draft_too_large');
  }

  const patched = patchDocument(previous, ops.ops);
  if (!patched.ok) return toolError('validation_failed', { issues: patched.issues });
  let docHashAfter: string | null;
  try {
    docHashAfter = hashJson(patched.document);
  } catch {
    // Too large or too deep for the canonical form: the route refuses it with its own code; no hash to log.
    docHashAfter = null;
  }

  return writeDraft(drafts, dispatch, ctx, {
    tool,
    binding,
    args: { ruleset_id: args.ruleset_id, draft_rev: args.draft_rev, document: patched.document },
    ledgerArgs: { ruleset_id: args.ruleset_id, draft_rev: args.draft_rev, ops: ops.ops.length, ops_hash: hashJson(ops.ops) },
    knownRulesetId: args.ruleset_id.toLowerCase(),
    before: { draft_rev: current.draft_rev, doc_hash: docHashBefore },
    snapshot: { document: previous as Json, docHash: docHashBefore },
    docHashAfter,
    read: readSaved(args.ruleset_id.toLowerCase()),
    undo: (rulesetId, revAfter) => ({
      // The previous document is the snapshot of this ledger row; restoring is a save at `draft_rev_after` (CAS).
      recipe: { kind: 'restore_draft_snapshot', ruleset_id: rulesetId, draft_rev_after: revAfter },
      reversibility: 'snapshot',
    }),
    // Revision plus the hash of the document the save sent (the route stores it as sent).
    afterFingerprint: (rev) => (rev === null || docHashAfter === null ? null : stateHash(draftDocState(rev, docHashAfter))),
  });
}
