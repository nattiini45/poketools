import { NextResponse } from 'next/server';
import { AVATAR_CATEGORIES_BY_GENDER } from '@/lib/avatar/manifest';

/**
 * GET /api/avatar/manifest — Serve the avatar asset manifest (public, cached).
 * Returns categories grouped by gender.
 */
export async function GET() {
  return NextResponse.json(
    { success: true, data: AVATAR_CATEGORIES_BY_GENDER },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    }
  );
}
