import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { webhookCreateSchema, webhookScopeTypeSchema, formatZodErrors } from '@/lib/validation';
import {
  listAllWebhooks,
  getWebhooksByScope,
  createWebhook,
} from '@/lib/supabase/queries/discord-webhooks';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import { toWebhookView } from '@/lib/discord/webhook-view';
import type { DiscordWebhookView } from '@/types/discord';

/**
 * GET /api/discord-webhooks?scope_type=season&scope_id=xxx
 * Admin: List webhooks for a given scope. The webhook URL is write-only: each
 * entry carries `webhook_url_hint` (its last four characters), never the URL.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const scopeType = searchParams.get('scope_type');

    // No scope_type = list all webhooks
    if (!scopeType) {
      const webhooks = await listAllWebhooks();
      return NextResponse.json<ApiResult<DiscordWebhookView[]>>({
        success: true,
        data: webhooks.map(toWebhookView),
      });
    }

    const scopeResult = webhookScopeTypeSchema.safeParse(scopeType);
    if (!scopeResult.success) {
      const issues = formatZodErrors(scopeResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const webhooks = await getWebhooksByScope(
      scopeResult.data,
      searchParams.get('scope_id')
    );
    return NextResponse.json<ApiResult<DiscordWebhookView[]>>({
      success: true,
      data: webhooks.map(toWebhookView),
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch webhooks');
  }
}

/**
 * POST /api/discord-webhooks
 * Admin: Create a new webhook mapping.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();

    const rawBody = await request.json();
    const zodResult = webhookCreateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const webhook = await createWebhook(zodResult.data);
    logAuditEvent({
      action: 'discord_webhook.create',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: zodResult.data.scope_type,
      // A global webhook has no scope; '' would be rejected by the uuid column and the audit entry lost.
      resource_id: zodResult.data.scope_id ?? null,
      metadata: {
        label: zodResult.data.label,
      },
    });
    return NextResponse.json<ApiResult<DiscordWebhookView>>(
      { success: true, data: toWebhookView(webhook) },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create webhook');
  }
}