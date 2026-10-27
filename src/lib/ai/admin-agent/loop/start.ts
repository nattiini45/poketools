/**
 * Starting a turn (plan 3.1, 3.4; spec §18.10; spike S7).
 *
 * `startTurn` does the checks that can still be answered with a status (unknown conversation, a role or version that no
 * longer fits, text the loop refuses, a continue with nothing to continue, a busy conversation or admin), takes the turn
 * lease, and then starts the loop. It returns the event stream for the response and a completion promise for the route to
 * hand to `after()`; the loop is not tied to either. Whatever happens after this returns is persisted step by step and
 * reported on the stream; the lease is released when the loop ends, not when the client leaves.
 *
 * History is loaded by conversation id after the admin check. A crash can leave an assistant message whose tool results
 * were never written; the next turn answers those calls with `unknown_outcome` before anything else is appended, so the
 * history the API sees is always valid.
 */
import { createHash } from 'node:crypto';
import type { ConversationRecord } from '../store/types';
import { AdminAgentStoreError } from '../store/errors';
import { turnLeaseError } from '../store/conversations';
import { findForbiddenMessageContent } from '../store/payload-guard';
import type { ToolRole, ToolSet } from '../registry';
import { AdminAgentLoopError, loopCode } from './codes';
import { createEventStream, safeSink } from './events';
import { harnessEventMessage, LOOP_EVENTS, neutralizeAdminText } from './harness';
import { appendEntry, runSteps, type TurnRun } from './loop';
import { composeDynamicState, stateData, storedStateHash } from './state';
import { danglingRepairMessage } from './repair';
import { generateTitle } from './titles';
import { danglingToolUses, entryOf, firstPairingViolation, rebuildTranscript, type TranscriptEntry } from './transcript';
import type { AgentStreamEvent, EventSink, LoopDeps, TurnOutcome, TurnRequest } from './types';

export interface StartedTurn {
  /** Server-sent events for the response body. */
  stream: ReadableStream<Uint8Array>;
  /**
   * Resolves when the turn has ended, the lease is released and the title (if any) is written. Never rejects. The route
   * passes it to `after()` so a platform that implements `after()` with `waitUntil` keeps the invocation alive.
   */
  completion: Promise<TurnOutcome>;
}

function validateConversation(deps: LoopDeps, request: TurnRequest, conversation: ConversationRecord | null): { conversation: ConversationRecord; toolSet: ToolSet } {
  // The route answers 404 for a switched-off assistant before it gets here; this is the second line of defence.
  if (!deps.config().enabled) throw new AdminAgentLoopError('agent_disabled', 'disabled');
  if (conversation === null) throw new AdminAgentStoreError('conversation_not_found');
  if (conversation.status !== 'active') throw new AdminAgentLoopError(loopCode('outdated'), 'archived');
  // A tier change away from the conversation's tool set makes it read-only: start a new one.
  if (conversation.tool_set !== request.role) throw new AdminAgentLoopError('tool_not_available', 'tool_set_changed');
  const toolSet = deps.buildToolSet({ role: conversation.tool_set as ToolRole, maxPhase: deps.config().maxPhase });
  // A deploy that changes tool text or the system prompt only affects new conversations (the cache prefix and the
  // thinking-block binding both depend on the exact bytes).
  if (toolSet.registryVersion !== conversation.tool_registry_version) throw new AdminAgentLoopError(loopCode('outdated'), 'tool_registry_changed');
  if (deps.systemPrompt.version !== conversation.system_prompt_version) throw new AdminAgentLoopError(loopCode('outdated'), 'system_prompt_changed');
  return { conversation, toolSet };
}

/** The admin's message as it will be stored: defused, bounded, and free of private fields and webhook URLs. */
function checkedText(deps: LoopDeps, request: TurnRequest, conversationId: string, text: string): string {
  const sentinel = deps.stateChannel === 'sentinel-user' ? deps.sentinelFor(conversationId) : undefined;
  const cleaned = neutralizeAdminText(text, sentinel);
  if (cleaned.trim() === '') throw new AdminAgentLoopError('validation_failed', 'empty_text', { issues: 'The message is empty.' });
  const max = deps.config().limits.maxTextChars;
  if (Array.from(cleaned).length > max) throw new AdminAgentLoopError('agent_text_too_long', 'text_too_long', { max });
  if (findForbiddenMessageContent('user', [{ type: 'text', text: cleaned }]) !== null) throw new AdminAgentLoopError('text_not_allowed', 'forbidden_payload');
  return cleaned;
}

export async function startTurn(deps: LoopDeps, request: TurnRequest): Promise<StartedTurn> {
  const { store } = deps;
  const found = await store.conversations.getConversation(request.adminId, request.conversationId);
  const { conversation, toolSet } = validateConversation(deps, request, found);
  const text = request.input.kind === 'message' ? checkedText(deps, request, conversation.id, request.input.text) : null;

  const lease = await store.conversations.acquireTurnLease(request.adminId, conversation.id);
  if (!lease.ok) throw turnLeaseError(lease.reason);
  const releaseLease = () =>
    store.conversations.releaseTurnLease(request.adminId, conversation.id, lease.leaseUntil).catch((error: unknown) => {
      console.error('[admin-agent] turn lease release failed; it expires on its own', error);
      return false;
    });

  const events = createEventStream();
  // `done` is the signal that a client may send its next message, so it is sent only after the lease is released: a client
  // that reacts to it at once must not meet 409 `agent_conversation_busy` from the turn that just ended.
  let held: AgentStreamEvent | null = null;
  const emit: EventSink = (event) => {
    if (event.type === 'done') held = event;
    else events.emit(event);
  };
  const run: TurnRun = { deps, request, conversation, toolSet, transcript: [], emit: safeSink(emit) };

  let skip = false;
  try {
    skip = await prepareTurn(run, text);
    run.userTextHash = userTextHashOf(run.transcript);
  } catch (error) {
    events.close();
    await releaseLease();
    throw error;
  }

  const completion = (async (): Promise<TurnOutcome> => {
    let outcome: TurnOutcome = { reason: 'duplicate', resumable: false, steps: 0, toolCalls: 0, stagings: 0, costUsdMicro: 0 };
    try {
      if (skip) run.emit({ type: 'done', reason: 'duplicate', resumable: false });
      else outcome = await runSteps(run);
    } catch (error) {
      console.error('[admin-agent] turn crashed', error);
      outcome = { ...outcome, reason: 'failed' };
    } finally {
      await releaseLease();
      if (held !== null) events.emit(held);
      events.close();
    }
    if (outcome.reason === 'completed' && !conversation.title) {
      const first = run.transcript.find((entry): entry is Extract<TranscriptEntry, { role: 'user'; kind: 'chat' }> => entry.role === 'user' && entry.kind === 'chat');
      if (first) {
        await generateTitle(deps, { adminId: request.adminId, adminName: request.adminName, conversation, firstUserText: first.blocks.map((b) => b.text).join('\n') });
      }
    }
    return outcome;
  })();

  return { stream: events.stream, completion };
}

/** The hash of the latest admin message in the transcript (the one this turn answers), or `null`. */
function userTextHashOf(transcript: readonly TranscriptEntry[]): string | null {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const entry = transcript[i];
    if (entry.role === 'user' && entry.kind === 'chat') {
      return createHash('sha256').update(entry.blocks.map((block) => block.text).join('\n'), 'utf8').digest('hex').slice(0, 16);
    }
  }
  return null;
}

/**
 * Loads the history, repairs a dangling tool call, stores the admin's message and the state refresh. Returns `true` when
 * there is nothing for the model to answer (the same message id was already answered).
 */
async function prepareTurn(run: TurnRun, text: string | null): Promise<boolean> {
  const { deps, request, conversation } = run;
  const history = await deps.store.messages.loadHistory(request.adminId, conversation.id);
  if (history.truncated) throw new AdminAgentLoopError('agent_context_full', 'history_truncated');
  run.transcript.push(...rebuildTranscript(history.messages));
  if (firstPairingViolation(run.transcript) !== null) throw new AdminAgentLoopError('agent_harness_error', 'bad_history:pairing');

  await repairDanglingToolCalls(run);

  const input = request.input;
  if (input.kind === 'continue') {
    const tail = run.transcript[run.transcript.length - 1];
    if (tail?.role !== 'event') throw new AdminAgentLoopError(loopCode('nothingToContinue'), 'no_unconsumed_event');
  } else {
    if (text === null) throw new AdminAgentLoopError('agent_harness_error', 'missing_text');
    const { message, duplicate } = await deps.store.messages.appendMessage(request.adminId, conversation.id, {
      role: 'user',
      kind: 'chat',
      content: [{ type: 'text', text }],
      clientMsgId: input.clientMsgId,
    });
    if (duplicate) {
      // A retried POST: the message is stored (and in the transcript already). Answer it only if nothing has.
      const tail = run.transcript[run.transcript.length - 1];
      if (tail?.role === 'assistant' && tail.blocks.every((block) => block.type !== 'tool_use')) return true;
    } else {
      run.transcript.push(entryOf(message));
    }
    // A uuid the admin typed or pasted is an id the conversation has seen (provenance, plan 6.3). A retried message was
    // recorded the first time.
    if (!duplicate) await recordTypedIds(run, text);
  }

  await refreshState(run);
  return false;
}

const UUID_IN_TEXT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** The most ids one admin message records (a pasted roster can hold more than a Build may name). */
const TYPED_IDS_MAX = 200;

/** Records the uuids in the admin's own text; best effort, since an unrecorded id only makes a later write ask again. */
async function recordTypedIds(run: TurnRun, text: string): Promise<void> {
  const ids = [...new Set((text.match(UUID_IN_TEXT) ?? []).map((id) => id.toLowerCase()))].slice(0, TYPED_IDS_MAX);
  if (ids.length === 0) return;
  try {
    await run.deps.store.refs.recordRefs(
      run.request.adminId,
      run.conversation.id,
      ids.map((id) => ({ kind: 'id', id, label: null, source: 'user_message' as const })),
    );
  } catch (error) {
    console.error('[admin-agent] could not record the ids the admin typed', error);
  }
}

/** Answers the tool calls of a trailing assistant message that has no results (a crash between the two writes). */
async function repairDanglingToolCalls(run: TurnRun): Promise<void> {
  const dangling = danglingToolUses(run.transcript);
  if (dangling.length === 0) return;
  const saved = await appendEntry(run, danglingRepairMessage(dangling));
  if (!saved) throw new AdminAgentLoopError('agent_harness_error', 'repair_failed');
}

/** Persists a `state_refresh` event when the server state differs from the last one the model saw. */
async function refreshState(run: TurnRun): Promise<void> {
  const { deps, request, conversation } = run;
  const [plan, pending, drift] = await Promise.all([
    deps.store.plans.getActivePlan(request.adminId, conversation.id).catch((error: unknown) => {
      console.error('[admin-agent] could not read the active plan for the state refresh', error);
      return null;
    }),
    deps.store.proposals.listPendingProposals(request.adminId, conversation.id).catch((error: unknown) => {
      console.error('[admin-agent] could not read the pending proposals for the state refresh', error);
      return [];
    }),
    (deps.drift?.({ adminId: request.adminId, conversationId: conversation.id }) ?? Promise.resolve([])).catch((error: unknown) => {
      console.error('[admin-agent] could not compute drift for the state refresh', error);
      return [] as readonly string[];
    }),
  ]);
  const state = composeDynamicState({
    now: deps.now(),
    timeZone: request.timeZone,
    locale: request.locale,
    plan: plan ? { revision: plan.revision, status: plan.status } : null,
    pending,
    drift,
  });
  const data = stateData(state);
  let last: string | null = null;
  for (let i = run.transcript.length - 1; i >= 0; i -= 1) {
    const entry = run.transcript[i];
    if (entry.role === 'event' && entry.event === LOOP_EVENTS.stateRefresh) {
      last = storedStateHash(entry.data);
      break;
    }
  }
  if (last === data.hash) return;
  const saved = await appendEntry(run, harnessEventMessage(LOOP_EVENTS.stateRefresh, data));
  if (!saved) throw new AdminAgentLoopError('agent_harness_error', 'state_refresh_failed');
}
