import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { socialIntegrationUpdateSchema, formatZodErrors } from '@/lib/validation';
import {
  deleteSocialIntegration,
  getSocialIntegrationById,
  updateSocialIntegration,
  type UpdateSocialIntegrationRecord,
} from '@/lib/supabase/queries/social-integrations';
import { encryptJson } from '@/lib/social/crypto';
import type { ApiResult } from '@/types/api';
import { checkCredentials, toCredentialHint } from '@/lib/social/validation';
import type { SocialIntegration } from '@/types/social';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/social-integrations/[id]
 * Admin: update social integration config.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id } = await params;
    const rawBody = await request.json();
    const zodResult = socialIntegrationUpdateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const body = zodResult.data;

    const existing = await getSocialIntegrationById(id);
    if (!existing) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Integration not found', code: 'social_integration_not_found' },
        { status: 404 },
      );
    }

    if (body.clear_credentials && body.credentials) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Provide either credentials or clear_credentials, not both',
          code: 'social_credentials_conflict',
        },
        { status: 400 },
      );
    }

    const updateRecord: UpdateSocialIntegrationRecord = {
      label: body.label,
      enabled: body.enabled,
      event_filter: body.event_filter,
      post_options: body.post_options,
    };

    if (body.clear_credentials) {
      updateRecord.credentials_encrypted = null;
      updateRecord.credential_hint = null;
    }

    if (body.credentials) {
      if (body.credentials.provider !== existing.provider) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'credentials.provider must match integration provider',
            code: 'social_credentials_provider_mismatch',
          },
          { status: 400 },
        );
      }

      const credentialError = checkCredentials(body.credentials);
      if (credentialError) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: credentialError.message,
            code: 'social_credentials_field_required',
            params: { provider: credentialError.provider, field: credentialError.field },
          },
          { status: 400 },
        );
      }

      updateRecord.credentials_encrypted = encryptJson(body.credentials);
      updateRecord.credential_hint = toCredentialHint(body.credentials);
    }

    const updated = await updateSocialIntegration(id, updateRecord);
    return NextResponse.json<ApiResult<SocialIntegration>>({
      success: true,
      data: updated,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update social integration');
  }
}

/**
 * DELETE /api/social-integrations/[id]
 * Admin: remove social integration.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id } = await params;
    const existing = await getSocialIntegrationById(id);
    if (!existing) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Integration not found', code: 'social_integration_not_found' },
        { status: 404 },
      );
    }

    await deleteSocialIntegration(id);
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete social integration');
  }
}
