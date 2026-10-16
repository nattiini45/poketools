import { NextRequest, NextResponse } from 'next/server';
import { requireCreator } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { supabase } from '@/lib/supabase/client';
import { storylineInsertSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';
import type { Storyline } from '@/types/storyline';

export const dynamic = 'force-dynamic';

// Public: no auth required — storylines are broadcast content
export async function GET(req: NextRequest) {
  try {
    const seasonId = req.nextUrl.searchParams.get('season_id');
    if (!seasonId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'season_id required', code: 'storyline_season_id_required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('season_storylines')
      .select('*')
      .eq('season_id', seasonId)
      .order('featured', { ascending: false })
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ success: true, data: data as Storyline[] });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch storylines');
  }
}

export async function POST(req: NextRequest) {
  try {
    const player = await requireCreator();
    const rawBody = await req.json();
    const zodResult = storylineInsertSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body = zodResult.data;

    const { data, error } = await supabase
      .from('season_storylines')
      .insert({
        season_id: body.season_id,
        title: body.title,
        body: body.body,
        tags: body.tags ?? [],
        featured: body.featured ?? false,
        created_by: player.playerId,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data: data as Storyline }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create storyline');
  }
}
