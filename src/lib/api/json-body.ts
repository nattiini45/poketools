/**
 * Read a request's JSON body with a distinct error for malformed JSON.
 *
 * A body that does not parse is a 400 `invalid_json` (`errors/common`), not
 * an empty object: swallowing the parse error would turn it into a
 * misleading `validation_failed` about missing fields. The parse error is
 * logged by `safeErrorResponse` and never echoed to the client.
 */
import type { NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse<ApiResult<never>> };

export async function readJsonBody(request: Pick<Request, 'json'>): Promise<JsonBodyResult> {
  try {
    return { ok: true, value: await request.json() };
  } catch (err) {
    return { ok: false, response: safeErrorResponse(err, 'Invalid JSON body', 400, 'invalid_json') };
  }
}
