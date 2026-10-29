import 'server-only';
/**
 * The reaper (spec §18.7): a proposal left `executing` for longer than the resume window plus one request belongs to a request
 * that died, so it moves to `unknown` and its conversation is told. Without it one crashed approve would hold the admin's conversation for
 * good (the executing-proposal index refuses a second claim).
 *
 * It runs for one admin at two points: on every approve (the executor, before the claim) and at the start of every chat turn
 * (the conversation route, before the loop). It lives in its own module because the chat side must never import the executor
 * (a module-graph test); this file imports nothing from it.
 *
 * Best effort by design: a failure is logged and the caller carries on. The status of the proposal is the record; the event
 * only tells the model.
 */
import { planCode } from '../plans/hash';
import type { ProposalRepository } from '../store/proposals';
import type { AdminId } from '../store/ids';
import type { Json } from '../store/types';
import { RESUME_WINDOW_MS } from './types';

/** `maxDuration` of the approve and resume routes. */
export const ROUTE_MAX_DURATION_SECONDS = 300;
/**
 * The reaper: an `executing` proposal whose claim is older than this is `unknown`, so a crash cannot hold the conversation. The age is
 * measured from the claim, and a Build may be resumed until `RESUME_WINDOW_MS` after it: a resume started at the end of that window
 * still runs for one whole request. The reaper therefore waits for the window plus `maxDuration` (plus a minute of slack), so it
 * never takes a proposal that a live resume is still working on. The stamp is not refreshed on a resume: that would let a Build be
 * resumed for ever.
 */
export const REAPER_AGE_MS = RESUME_WINDOW_MS + ROUTE_MAX_DURATION_SECONDS * 1000 + 60_000;

/** The event the executor appends to the conversation when a proposal ran (the UI catalog already labels it). */
export const RESULT_EVENT = 'proposal_executed';

/** The slice of the store and the wiring the reaper uses. */
export interface ReaperDeps {
  readonly proposals: Pick<ProposalRepository, 'reapExecutingProposals' | 'getProposal'>;
  /** Appends a harness event to a conversation (under its turn lease). */
  readonly recordEvent: (adminId: AdminId, conversationId: string, event: string, data: Readonly<Record<string, Json | undefined>>) => Promise<void>;
  readonly now: () => Date;
}

const logTag = '[admin-agent] reaper';

/**
 * Moves this admin's overdue `executing` proposals to `unknown` and tells their conversations. Never throws: a failure here is
 * logged and the claim or the turn that follows says what is wrong.
 */
export async function reapOverdueProposals(deps: ReaperDeps, adminId: AdminId): Promise<void> {
  let ids: string[];
  try {
    ids = await deps.proposals.reapExecutingProposals(adminId, new Date(deps.now().getTime() - REAPER_AGE_MS));
  } catch (error) {
    console.error(`${logTag}: the reaper failed`, error);
    return;
  }
  for (const id of ids) {
    try {
      const reaped = await deps.proposals.getProposal(adminId, id);
      if (reaped === null) continue;
      await deps.recordEvent(adminId, reaped.conversation_id, RESULT_EVENT, { proposal_id: reaped.id, plan_code: planCode(reaped.proposal_hash), status: 'unknown', reaped: true });
    } catch (error) {
      console.error(`${logTag}: could not tell the conversation about a reaped proposal`, error);
    }
  }
}
