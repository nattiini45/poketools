/**
 * Draft route responses. Server only.
 *
 * Every draft route's catch block returns `draftErrorResponse(err, '<fallback>')`:
 * - `DraftRuleError` → its status with `{ success:false, error, code, params, detail?, snapshot? }`
 *   (`DraftApiErrorBody`; `error` is the English catalog text, `detail` is never rendered);
 * - `ZodError` → `400 validation_failed {issues}` (`errors/common`);
 * - `SyntaxError` (a malformed body from `request.json()`) → `400 invalid_json` (`errors/common`);
 * - anything else → `safeErrorResponse` (logged, static fallback, 500).
 */
import 'server-only';

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { DraftRuleError } from '@/lib/draft/errors';
import { formatZodErrors } from '@/lib/validation';
import type { DraftApiErrorBody, DraftSnapshotDTO } from '@/types/draft-queue';

export { toDraftSnapshotDTO, type ViewerContext } from '@/lib/draft/snapshot';

export function draftErrorResponse(
  err: unknown,
  fallback: string,
  extra?: { snapshot?: DraftSnapshotDTO },
): NextResponse {
  if (err instanceof DraftRuleError) {
    console.error(`[API] ${fallback}:`, err);
    const body: DraftApiErrorBody = { success: false, error: err.message, code: err.code };
    if (err.params !== undefined) body.params = { ...err.params };
    if (err.detail !== undefined) body.detail = { ...err.detail };
    if (extra?.snapshot !== undefined) body.snapshot = extra.snapshot;
    return NextResponse.json(body, { status: err.statusCode });
  }
  if (err instanceof ZodError) {
    const issues = formatZodErrors(err);
    return safeErrorResponse(
      new UserFacingError(`Invalid request: ${issues}`, { code: 'validation_failed', params: { issues }, status: 400 }),
      fallback,
    );
  }
  if (err instanceof SyntaxError) {
    return safeErrorResponse(err, 'Invalid JSON body', 400, 'invalid_json');
  }
  return safeErrorResponse(err, fallback);
}
