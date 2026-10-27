/**
 * `propose_build` and the `propose_*` Go-live tools (plan 3.6.5, 3.6.6) and `request_clarification` (plan 3.6.4).
 *
 * Staging goes through `stageProposal` only: it re-checks the tool, the phase, the audience, the per-turn limits, the
 * arguments, the text, the provenance of every id and the live guards, derives the steps by code and stores one immutable
 * row. Nothing here executes anything. A refusal is a catalogued failure (the card was not staged, so the call counts as a
 * failed write: the writes after it in the same step are skipped); the blockers behind it travel as a short `findings` string
 * and `plan_validate` has the full list.
 */
import { newTurnStaging } from '../proposals/turn';
import type { StageRefused } from '../proposals/types';
import { toolError } from '../registry/errors';
import type { StagedTool } from '../registry';
import type { StagedToolContext } from '../loop/tool-runtime';
import type { ToolRunResult } from '../loop/types';
import type { AdminId } from '../store/ids';
import type { Json } from '../store/types';
import type { StagedRunnerDeps } from './types';

const FINDINGS_SHOWN = 6;

/** The params a refusal carries to the model: its own, plus the first findings as `code@section` (bounded by the loop). */
function refusalParams(refusal: StageRefused): Record<string, string | number> {
  const params: Record<string, string | number> = { ...(refusal.params ?? {}) };
  if (refusal.findings !== undefined && refusal.findings.length > 0) {
    params.findings = refusal.findings
      .slice(0, FINDINGS_SHOWN)
      .map((finding) => (finding.section ? `${finding.code}@${finding.section}` : finding.code))
      .join(';');
  }
  return params;
}

/** Stages a B or G tool call. */
export async function stageTool(deps: StagedRunnerDeps, tool: StagedTool, input: unknown, ctx: StagedToolContext): Promise<ToolRunResult> {
  const adminId = ctx.adminId as AdminId;
  const conversation = await deps.store.conversations.getConversation(adminId, ctx.conversationId);
  if (conversation === null) return toolError('conversation_not_found');

  const result = await deps.stage({
    conversation: { id: conversation.id, tool_set: conversation.tool_set, tool_registry_version: conversation.tool_registry_version, ui_locale: conversation.ui_locale },
    // The live tier of this request: startTurn refuses a conversation whose tool set differs from it.
    admin: { id: adminId, isSiteAdmin: ctx.toolSet.role === 'site' },
    toolName: tool.name,
    args: input,
    // The loop enforces the per-turn limits before it runs a call; a fresh counter here checks the call alone.
    turn: newTurnStaging(),
  });
  if (result.status === 'refused') return toolError(result.code, refusalParams(result));

  const events: ToolRunResult['events'] = [];
  try {
    const row = await deps.store.proposals.getProposal(adminId, result.proposal_id);
    if (row !== null) (events as unknown[]).push({ type: 'proposal', id: row.id, hash: row.proposal_hash, preview: row.preview as Json });
  } catch (error) {
    // The card is stored and the UI can fetch it; only the live notice is lost.
    console.error('[admin-agent] could not read back the staged proposal for the stream', error);
  }
  return { ok: true, data: result, ui: { proposal_id: result.proposal_id }, ...(events.length > 0 ? { events } : {}) };
}

/** `request_clarification`: a structured question for the admin. The answer is the admin's next message, never an approval. */
export function requestClarification(args: { question: string; kind: string; options?: ReadonlyArray<{ value: string; label: string }> }): ToolRunResult {
  const options = args.options ?? [];
  return {
    ok: true,
    data: { status: 'waiting_for_admin' },
    ui: { clarification: { kind: args.kind, question: args.question, ...(options.length > 0 ? { options: options.map((option) => ({ value: option.value, label: option.label })) } : {}) } },
  };
}
