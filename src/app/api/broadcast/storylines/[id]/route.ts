import { NextRequest, NextResponse } from 'next/server';
import { requireCreator } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { supabase } from '@/lib/supabase/client';
import { storylineUpdateSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';
import type { Storyline } from '@/types/storyline';

export const dynamic = 'force-dynamic';

// Public: no auth required — storylines are broadcast content
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data, error } = await supabase
      .from('season_storylines')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not found', code: 'not_found_generic' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: data as Storyline });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch storyline');
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireCreator();
    const { id } = await params;
    const rawBody = await req.json();
    const zodResult = storylineUpdateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('season_storylines')
      .update({ ...zodResult.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data: data as Storyline });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update storyline');
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireCreator();
    const { id } = await params;

    const { error } = await supabase
      .from('season_storylines')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete storyline');
  }
}
