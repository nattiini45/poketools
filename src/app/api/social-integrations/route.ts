import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { socialIntegrationCreateSchema, formatZodErrors } from '@/lib/validation';
import {
  createSocialIntegration,
  listAllSocialIntegrations,
  type CreateSocialIntegrationRecord,
} from '@/lib/supabase/queries/social-integrations';
import { encryptJson } from '@/lib/social/crypto';
import type { ApiResult } from '@/types/api';
import { checkCredentials, toCredentialHint } from '@/lib/social/validation';
import type { SocialIntegration, CreateSocialIntegrationInput } from '@/types/social';

/** A client-facing 400 for credentials that cannot be stored. */
type CredentialRejection = NextResponse<ApiResult<never>>;

function toCreateRecord(
  body: CreateSocialIntegrationInput,
): CreateSocialIntegrationRecord | CredentialRejection {
  const record: CreateSocialIntegrationRecord = {
    provider: body.provider,
    scope_type: body.scope_type,
    scope_id: body.scope_id,
    label: body.label,
    event_filter: body.event_filter,
    post_options: body.post_options,
  };

  if (body.credentials) {
    if (body.credentials.provider !== body.provider) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'credentials.provider must match provider',
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

    record.credentials_encrypted = encryptJson(body.credentials);
    record.credential_hint = toCredentialHint(body.credentials);
  }

  return record;
}

/**
 * GET /api/social-integrations
 * Admin: list all social integrations.
 */
export async function GET() {
  try {
    await requireAdmin();

    const integrations = await listAllSocialIntegrations();
    return NextResponse.json<ApiResult<SocialIntegration[]>>({
      success: true,
      data: integrations,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch social integrations');
  }
}

/**
 * POST /api/social-integrations
 * Admin: create an X / Threads / Bluesky integration.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    const rawBody = await request.json();
    const zodResult = socialIntegrationCreateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const record = toCreateRecord(zodResult.data as unknown as CreateSocialIntegrationInput);
    if (record instanceof NextResponse) return record;
    const integration = await createSocialIntegration(record);

    return NextResponse.json<ApiResult<SocialIntegration>>(
      { success: true, data: integration },
      { status: 201 },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create social integration');
  }
}
