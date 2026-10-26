import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { getWebhookById } from '@/lib/supabase/queries/discord-webhooks';
import { sendWebhookTestMessage } from '@/lib/discord/webhook-test';
import { logAuditEvent } from '@/lib/audit/log';
import { getRequestLocale } from '@/i18n/server';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/discord-webhooks/[id]/test
 * Admin: post a fixed test embed to one stored webhook. The URL is loaded here
 * by id and never travels to or from the browser; the request has no body.
 * A disabled webhook can still be tested. Every attempt is audited, without
 * the URL.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const admin = await requireAdmin();

    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_WEBHOOK_ID');
    if (invalidId) return invalidId;

    // Before the database read: the button posts to a third party on every click.
    const limit = await checkRateLimit('discord-webhook-test', admin.playerId, {
      limit: 10,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

    const webhook = await getWebhookById(id);
    if (!webhook) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Webhook not found', code: 'webhook_not_found' },
        { status: 404 },
      );
    }

    // The admin pressed the button, so a webhook that follows the league tests in their UI language.
    const outcome = await sendWebhookTestMessage(webhook, getRequestLocale(request));

    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'discord_webhook.test',
      resource_type: 'discord_webhook',
      resource_id: id,
      resource_name: webhook.label,
      metadata: outcome.ok
        ? { ok: true, status: outcome.status }
        : outcome.kind === 'rejected'
          ? { ok: false, kind: outcome.kind, status: outcome.status }
          : { ok: false, kind: outcome.kind },
    });

    if (outcome.ok) {
      return NextResponse.json<ApiResult<{ status: number }>>({
        success: true,
        data: { status: outcome.status },
      });
    }
    if (outcome.kind === 'rejected') {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `Discord rejected the test message (HTTP ${outcome.status})`,
          code: 'discord_webhook_test_rejected',
          params: { status: outcome.status },
        },
        { status: 502 },
      );
    }
    if (outcome.kind === 'unreachable') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Discord could not be reached', code: 'discord_webhook_test_unreachable' },
        { status: 502 },
      );
    }
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: 'The stored webhook URL is not a valid Discord webhook URL',
        code: 'discord_webhook_url_invalid',
      },
      { status: 422 },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to send test message');
  }
}
