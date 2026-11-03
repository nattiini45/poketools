import { NextRequest, NextResponse } from 'next/server';
import { requireCreator } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { deleteStoryline, getStorylineById, updateStoryline } from '@/lib/supabase/queries/storylines';
import { storylineUpdateSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

export const dynamic = 'force-dynamic';

// Public: no auth required — storylines are broadcast content
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(id, 'INVALID_STORYLINE_ID');
    if (invalidId) return invalidId;
    const storyline = await getStorylineById(id);
    if (!storyline) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not found', code: 'not_found_generic' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: storyline });
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
    const invalidId = rejectInvalidPathId(id, 'INVALID_STORYLINE_ID');
    if (invalidId) return invalidId;
    const rawBody = await req.json();
    const zodResult = storylineUpdateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data: await updateStoryline(id, zodResult.data) });
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
    const invalidId = rejectInvalidPathId(id, 'INVALID_STORYLINE_ID');
    if (invalidId) return invalidId;

    await deleteStoryline(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete storyline');
  }
}
