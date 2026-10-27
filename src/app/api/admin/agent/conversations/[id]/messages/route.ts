import { after, NextRequest } from 'next/server';
import { z } from 'zod';
import { isTimeZone, DEFAULT_TIME_ZONE, TZ_COOKIE } from '@/i18n/config';
import { getRequestLocale } from '@/i18n/server';
import { AdminAgentLoopError, loopCode } from '@/lib/ai/admin-agent/loop/codes';
import { SSE_HEADERS } from '@/lib/ai/admin-agent/loop/events';
import { hasUnconsumedHarnessEvent } from '@/lib/ai/admin-agent/loop/harness';
import { adminAgentStore, findForbiddenMessageContent } from '@/lib/ai/admin-agent/store';
import { safeErrorResponse } from '@/lib/api/error-response';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { getAdminAgent } from '../../../_lib/agent';
import { authorizeAgent } from '../../../_lib/auth';
import { agentError, conversationNotFound } from '../../../_lib/errors';
import { agentRateLimited, assertSameOriginRequest, readAgentJson } from '../../../_lib/request';

/**
 * The turn runs past the response in `after()` (spike S7: the loop is not tied to the connection), so the function
 * stays alive for the whole model loop. The loop's own deadline (240 s) stops new model steps before this.
 */
export const maxDuration = 300;

/** Largest accepted body, in bytes: the longest message (20,000 characters, up to 4 bytes each) plus the envelope. */
const MAX_BODY_BYTES = 20_000 * 4 + 1024;

const bodySchema = z.union([
  z.strictObject({ text: z.string(), client_msg_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) }),
  z.strictObject({ continue: z.literal(true) }),
]);

/**
 * POST /api/admin/agent/conversations/[id]/messages
 *
 * One user turn `{ text, client_msg_id }`, or `{ continue: true }` after a harness event. Order (plan 3.1): live
 * `requireAnyAdmin` and the audience check, the origin rule, the bounded body, ownership of the conversation, the text
 * checks, the limiter (charged only once the request is known to be valid and the admin's own), then the turn lease and
 * the loop. The response is a server-sent event stream; the history is loaded by id on the server, never from the client.
 *
 * Nothing here listens to `request.signal`: a closed tab ends the stream, not the turn, which persists every step and
 * releases the lease when it finishes.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorizeAgent({ record: true });
    assertSameOriginRequest(request);
    const { id } = await params;
    const body = await readAgentJson(request, bodySchema, MAX_BODY_BYTES);

    const store = adminAgentStore;
    const conversation = await store.conversations.getConversation(auth.adminId, id);
    if (conversation === null) throw conversationNotFound();

    const { limits } = auth.config;
    if ('text' in body) {
      if (body.text.trim() === '') throw agentError('validation_failed', 400, { issues: 'text' });
      if (Array.from(body.text).length > limits.maxTextChars) throw agentError('agent_text_too_long', 413, { max: limits.maxTextChars });
      if (findForbiddenMessageContent('user', [{ type: 'text', text: body.text }]) !== null) throw agentError('text_not_allowed', 400);
    } else {
      // `continue` is valid only while a harness event waits for the model.
      const tail = await store.messages.loadTail(auth.adminId, conversation.id, 1);
      if (!hasUnconsumedHarnessEvent(tail)) throw new AdminAgentLoopError(loopCode('nothingToContinue'), 'no_unconsumed_event');
    }

    const rate = await checkRateLimit('admin-agent-turn', auth.player.playerId, {
      limit: limits.turnsPerHour,
      windowSeconds: 60 * 60,
      failMode: 'closed',
    });
    if (!rate.allowed) return agentRateLimited(rate.retryAfterSeconds);

    const zone = request.cookies.get(TZ_COOKIE)?.value;
    const started = await getAdminAgent().startTurn({
      adminId: auth.adminId,
      adminName: auth.player.name,
      conversationId: conversation.id,
      input: 'text' in body ? { kind: 'message', text: body.text, clientMsgId: body.client_msg_id } : { kind: 'continue' },
      locale: getRequestLocale(request),
      timeZone: isTimeZone(zone) ? zone : DEFAULT_TIME_ZONE,
      role: auth.role,
    });
    // The completion promise never rejects. `after()` keeps the invocation alive until the turn has persisted its last
    // step and released the lease.
    after(started.completion);
    return new Response(started.stream, { headers: SSE_HEADERS });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to start the assistant turn');
  }
}
