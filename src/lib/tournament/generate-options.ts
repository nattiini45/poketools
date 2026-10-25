import { NextResponse, type NextRequest } from 'next/server';
import { generateRoundOptionsSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

export type GenerateOptionsResult =
  | { ok: true; startRound: boolean }
  | { ok: false; response: NextResponse<ApiResult<never>> };

/**
 * Reads the optional JSON body of the generate routes (`{ "start_round": true }`).
 *
 * A missing, empty or unparsable body means "no options" (the pre-existing callers send none); a body that parses
 * but does not match `generateRoundOptionsSchema` is a 400 `validation_failed`, so a typo never silently leaves a
 * round pending.
 */
export async function parseGenerateOptions(request: NextRequest): Promise<GenerateOptionsResult> {
  let rawBody: unknown = {};
  try {
    rawBody = await request.json();
  } catch {
    rawBody = {};
  }
  const parsed = generateRoundOptionsSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    const issues = formatZodErrors(parsed.error);
    return {
      ok: false,
      response: NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      ),
    };
  }
  return { ok: true, startRound: parsed.data.start_round === true };
}
