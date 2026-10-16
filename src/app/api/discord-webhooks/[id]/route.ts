import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { webhookUpdateSchema, formatZodErrors } from '@/lib/validation';
import {
  getWebhookById,
  updateWebhook,
  deleteWebhook,
} from '@/lib/supabase/queries/discord-webhooks';
import type { ApiResult } from '@/types/api';
import type { DiscordWebhook } from '@/types/discord';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/discord-webhooks/[id]
 * Admin: Update a webhook (enable/disable, change filter, change URL/label).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
    const { id } = await params;
    const rawBody = await request.json();
    const zodResult = webhookUpdateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const existing = await getWebhookById(id);
    if (!existing) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Webhook not found', code: 'webhook_not_found' },
        { status: 404 }
      );
    }

    const updated = await updateWebhook(id, zodResult.data);
    return NextResponse.json<ApiResult<DiscordWebhook>>({
      success: true,
      data: updated,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update webhook');
  }
}

/**
 * DELETE /api/discord-webhooks/[id]
 * Admin: Remove a webhook mapping.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
    const { id } = await params;

    const existing = await getWebhookById(id);
    if (!existing) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Webhook not found', code: 'webhook_not_found' },
        { status: 404 }
      );
    }

    await deleteWebhook(id);
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete webhook');
  }
}
