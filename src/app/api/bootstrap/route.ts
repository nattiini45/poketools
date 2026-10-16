import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase/client';
import { safeErrorResponse } from '@/lib/api/error-response';
import { bootstrapSchema, formatZodErrors } from '@/lib/validation';
import { timingSafeCompare } from '@/lib/utils/crypto';
import type { ApiResult } from '@/types/api';

/**
 * POST /api/bootstrap
 *
 * First-time setup: creates the first admin player from the current
 * Discord session. Requires:
 *   1. A secret key matching BOOTSTRAP_SECRET env var
 *   2. The players table must be completely empty
 *
 * After the first admin exists, this route is permanently disabled.
 */
export async function POST(request: NextRequest) {
  try {
    // 0. Verify bootstrap secret
    const rawBody = await request.json().catch(() => ({}));
    const zodResult = bootstrapSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const secret = zodResult.data.secret;
    const expectedSecret = process.env.BOOTSTRAP_SECRET;

    if (!expectedSecret) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'BOOTSTRAP_SECRET not configured on server.', code: 'bootstrap_not_configured' },
        { status: 500 }
      );
    }

    // Constant-time delay to make brute force impractical
    await new Promise((r) => setTimeout(r, 1000));

    if (!secret || !timingSafeCompare(secret, expectedSecret)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Invalid or missing bootstrap secret.', code: 'bootstrap_secret_invalid' },
        { status: 403 }
      );
    }

    // 1. Check if any players exist
    const { count, error: countError } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true });

    if (countError) throw countError;

    if ((count ?? 0) > 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Bootstrap disabled — players already exist. Use the admin panel to add players.', code: 'bootstrap_disabled' },
        { status: 403 }
      );
    }

    // 2. Get the current session
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'You must be signed in to bootstrap.', code: 'bootstrap_sign_in_required' },
        { status: 401 }
      );
    }

    const displayName = session.user.name ?? 'Admin';
    // session.user.id is the Discord snowflake for Discord sign-ins and the
    // Supabase auth user UUID for email/password sign-ins.
    const identity =
      session.provider === 'credentials'
        ? { auth_user_id: session.user.id }
        : { discord_id: session.user.id };

    // 3. Create the first player as admin
    const { data, error: insertError } = await supabase
      .from('players')
      .insert({
        name: displayName,
        ...identity,
        is_admin: true,
        ps_username: '',
        champions_username: '',
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json<ApiResult<{ message: string; playerId: string }>>({
      success: true,
      data: {
        message: `Admin player "${displayName}" created! Sign out and back in for the session to update.`,
        playerId: data.id,
      },
    }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error, 'Bootstrap failed');
  }
}
