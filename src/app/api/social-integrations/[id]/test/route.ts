import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSocialIntegrationByIdWithSecrets } from '@/lib/supabase/queries/social-integrations';
import { sendSocialTestMessage } from '@/lib/social/notify';
import { getRequestLocale } from '@/i18n/server';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/social-integrations/[id]/test
 * Admin: send a provider test post.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_INTEGRATION_ID');
    if (invalidId) return invalidId;
    const integration = await getSocialIntegrationByIdWithSecrets(id);
    if (!integration) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Integration not found', code: 'social_integration_not_found' },
        { status: 404 },
      );
    }

    // The admin pressed the button, so the test post speaks their UI language.
    await sendSocialTestMessage(integration, getRequestLocale(request));

    return NextResponse.json<ApiResult<null>>({
      success: true,
      data: null,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to send test post');
  }
}
