/**
 * The wiring the approve and resume routes and the chat route share to tell a conversation what happened to a proposal: the
 * harness-event channel and the reaper of one admin's overdue executions. This file imports no executor and no binding (a
 * module-graph test), so the chat route may use it.
 */
import { appendHarnessEvent } from '@/lib/ai/admin-agent/loop/repair';
import { reapOverdueProposals } from '@/lib/ai/admin-agent/proposals/reaper';
import { adminAgentStore } from '@/lib/ai/admin-agent/store';
import type { AdminId } from '@/lib/ai/admin-agent/store/ids';
import type { Json } from '@/lib/ai/admin-agent/store/types';

/** The harness event is appended under the conversation's turn lease, held only while the append runs. */
const EVENT_LEASE_SECONDS = 30;

/** Appends a harness event to a conversation, under its turn lease. */
export function recordHarnessEvent(adminId: AdminId, conversationId: string, event: string, data: Readonly<Record<string, Json | undefined>>): Promise<void> {
  return adminAgentStore.conversations.withTurnLease(adminId, conversationId, () => appendHarnessEvent(adminAgentStore, adminId, conversationId, event, data), EVENT_LEASE_SECONDS);
}

/** Reaps this admin's overdue `executing` proposals (best effort, never throws): the start of every chat turn calls it. */
export function reapOverdueFor(adminId: AdminId): Promise<void> {
  return reapOverdueProposals({ proposals: adminAgentStore.proposals, recordEvent: recordHarnessEvent, now: () => new Date() }, adminId);
}
