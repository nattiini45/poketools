import { NextRequest, NextResponse } from 'next/server';
import { validateSetLegality } from '@/lib/pkmn/dex';
import { safeErrorResponse } from '@/lib/api/error-response';
import { validateSetSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

// Public — validates a single Pokémon set (moves learnability + ability legality)
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const zodResult = validateSetSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const result = await validateSetLegality(
      zodResult.data.species,
      zodResult.data.ability ?? '',
      zodResult.data.moves ?? [],
    );

    return NextResponse.json<ApiResult<typeof result>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to validate set');
  }
}
