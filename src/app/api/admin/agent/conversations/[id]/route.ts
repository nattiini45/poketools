import { NextRequest, NextResponse } from 'next/server';
import type { ConversationDetail } from '@/components/admin/assistant/types';
import { adminAgentStore } from '@/lib/ai/admin-agent/store';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';
import { authorizeAgent } from '../../_lib/auth';
import { conversationNotFound } from '../../_lib/errors';
import { toPlanView } from '../../_lib/plan-view';
import { awaitsContinue, projectTranscript, toCapabilities, toConversationSummary, toLimits, toProposalSummaryView } from '../../_lib/views';

/** The most proposals one conversation view lists (at most 2 wait at a time; the rest are history). */
const PROPOSALS_SHOWN = 20;

/**
 * GET /api/admin/agent/conversations/[id]
 *
 * One of the signed-in admin's own conversations: the transcript, the active Plan with its readiness, and the
 * conversation's proposals (summaries; the frozen card and the approval token come from `GET /proposals/[id]`).
 * Another admin's id, a malformed id and an unknown id all answer 404 `conversation_not_found`.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorizeAgent();
    const { id } = await params;
    const store = adminAgentStore;

    const conversation = await store.conversations.getConversation(auth.adminId, id);
    if (conversation === null) throw conversationNotFound();

    const [history, plan, proposals] = await Promise.all([
      store.messages.loadHistory(auth.adminId, conversation.id),
      store.plans.getActivePlan(auth.adminId, conversation.id),
      store.proposals.listProposals(auth.adminId, conversation.id, { limit: PROPOSALS_SHOWN }),
    ]);
    const now = new Date();

    return NextResponse.json<ApiResult<ConversationDetail>>(
      {
        success: true,
        data: {
          conversation: toConversationSummary(conversation, auth.role, now),
          items: projectTranscript(history.messages),
          truncated: history.truncated,
          plan: plan === null ? null : toPlanView(plan),
          proposals: proposals.map((row) => toProposalSummaryView(row, now)),
          awaitingContinue: awaitsContinue(history.messages),
          limits: toLimits(auth.config),
          capabilities: toCapabilities(auth.config),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load the conversation');
  }
}
