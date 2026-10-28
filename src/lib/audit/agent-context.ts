/**
 * Agent audit context: who stands behind a write that the Admin Assistant
 * dispatched, so `logAuditEvent` can tag the routes' own audit events with it
 * (docs/poketools-spec.md §18, "Audit").
 *
 * The assistant's dispatch layer wraps each route call in
 * `runWithAgentAuditContext(ctx, () => handler(...))`. While that call runs,
 * `logAuditEvent` (`./log.ts`) merges the context into `metadata`. `actor_id`
 * and `actor_name` are untouched: the human admin stays accountable.
 *
 * Plain `AsyncLocalStorage` scope, same pattern as the request meter in
 * `src/lib/supabase/metering.ts`. The store is module-private; only the two
 * functions below touch it. This module lives in `lib` and imports nothing from
 * `app` or from the assistant itself.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The fields land in `audit_log.metadata` under exactly these keys, next to
 * `via: 'agent'`. The first four identify the proposal and its approver; the
 * rest tie an outcome to the prompt and registry versions behind it. A private
 * draft write (class D) is never approved: it carries the conversation and the
 * tool, and no proposal, step or approver.
 */
export interface AgentAuditContext {
  /** The assistant conversation the write belongs to. */
  agent_conversation_id: string;
  /** The approved proposal the step is part of (absent for a class D draft write). */
  agent_proposal_id?: string;
  /** The step's key inside the proposal (absent for a class D draft write). */
  agent_step?: string;
  /** The admin who approved the proposal, the accountable human (absent for a class D draft write). */
  approved_by?: string;
  agent_tool?: string;
  approved_at?: string;
  plan_code?: string;
  args_hash?: string;
  model?: string;
  effort?: string;
  system_prompt_version?: string;
  tool_registry_version?: string;
  user_text_hash?: string;
}

const store = new AsyncLocalStorage<Readonly<AgentAuditContext>>();

/**
 * Run `fn` (and everything it awaits) with `ctx` as the agent audit context.
 * The context is copied and frozen, so later changes to `ctx` do not reach the
 * run. A nested call replaces the outer context for its own duration; the outer
 * one is back once it returns. Concurrent runs never see each other's context.
 */
export function runWithAgentAuditContext<T>(ctx: AgentAuditContext, fn: () => T): T {
  return store.run(Object.freeze({ ...ctx }), fn);
}

/** The context of the current run, or `undefined` outside `runWithAgentAuditContext`. */
export function getAgentAuditContext(): Readonly<AgentAuditContext> | undefined {
  return store.getStore();
}
