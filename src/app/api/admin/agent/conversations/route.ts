import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { ConversationList, ConversationSummary } from '@/components/admin/assistant/types';
import { adminAgentStore } from '@/lib/ai/admin-agent/store';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getRequestLocale } from '@/i18n/server';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { getAdminAgent } from '../_lib/agent';
import { authorizeAgent } from '../_lib/auth';
import { agentRateLimited, assertSameOriginRequest, readAgentJson, validationFailed } from '../_lib/request';
import { seedSchema, validateSeed } from '../_lib/seed';
import { toConversationSummary } from '../_lib/views';

/** The most a body of this route can hold: an optional seed. */
const MAX_BODY_BYTES = 2048;
/** New conversations per admin per hour. A conversation row is cheap, but the list should not be flooded. */
const NEW_CONVERSATIONS_PER_HOUR = 30;

const listQuerySchema = z.strictObject({
  status: z.enum(['active', 'archived']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const createBodySchema = z.strictObject({ seed: seedSchema.optional() });

/**
 * GET /api/admin/agent/conversations
 *
 * The signed-in admin's own conversations, newest activity first. Another admin's rows are never listed (the store
 * filters every read by the admin id). 404 while the assistant is switched off for this admin.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeAgent();
    const parsed = listQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw validationFailed(parsed.error);
    const { status, limit, offset } = parsed.data;

    const page = await adminAgentStore.conversations.listConversations(auth.adminId, { status, limit, offset });
    const now = new Date();
    return NextResponse.json<ApiResult<ConversationList>>({
      success: true,
      data: { items: page.items.map((row) => toConversationSummary(row, auth.role, now)), total: page.total, limit, offset },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list conversations');
  }
}

/**
 * POST /api/admin/agent/conversations
 *
 * Starts a conversation with the model, effort and tool set the live tier selects; they are pinned for its whole life.
 * The optional `seed` is a whitelisted key plus ids; the entity it names is checked with its own guard first.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeAgent();
    assertSameOriginRequest(request);
    const body = await readAgentJson(request, createBodySchema, MAX_BODY_BYTES);

    const rate = await checkRateLimit('admin-agent-new', auth.player.playerId, {
      limit: NEW_CONVERSATIONS_PER_HOUR,
      windowSeconds: 60 * 60,
      failMode: 'closed',
    });
    if (!rate.allowed) return agentRateLimited(rate.retryAfterSeconds);

    const context = body.seed === undefined ? {} : await validateSeed(body.seed);
    const agent = getAdminAgent();
    // Staging a Plan or a card is a write path, so a tool set that offers any D, B or G tool gets the write model.
    const writeCapable = [...agent.toolSetFor(auth.role).definitions.values()].some((tool) => tool.class === 'D' || tool.class === 'B' || tool.class === 'G');
    const defaults = agent.conversationDefaults({ role: auth.role, writeCapable });

    const row = await adminAgentStore.conversations.createConversation(auth.adminId, {
      adminName: auth.player.name,
      uiLocale: getRequestLocale(request),
      context,
      ...defaults,
    });
    return NextResponse.json<ApiResult<ConversationSummary>>(
      { success: true, data: toConversationSummary(row, auth.role, new Date()) },
      { status: 201 },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create the conversation');
  }
}
