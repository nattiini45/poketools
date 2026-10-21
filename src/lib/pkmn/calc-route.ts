/**
 * Shared request gate of the public `/api/calc/*` routes (code review H4):
 * the per-IP rate limit, then JSON parsing and strict validation.
 * Every rejection is a 4xx with a distinct `code` (`rate_limited`,
 * `invalid_json`, `validation_failed`, or the CalcError code of an unresolvable
 * combatant such as `unknown_species`).
 */
import 'server-only';

import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { readJsonBody } from '@/lib/api/json-body';
import { formatZodErrors } from '@/lib/validation';
import { checkPublicRateLimit, rateLimitedResponse, type RateLimitOptions } from '@/lib/utils/rate-limit';
import type { CalcError } from '@/lib/pkmn/calc-engine';
import type { ApiResult } from '@/types/api';

/** Calc requests per client IP (all compute routes share the bucket); fails open. */
export const CALC_RATE_LIMIT: RateLimitOptions = { limit: 120, windowSeconds: 60 };
/** Threat-list reads per client IP (each one reads usage stats); fails open. */
export const CALC_THREATS_RATE_LIMIT: RateLimitOptions = { limit: 60, windowSeconds: 60 };

export type GateResult<T> = { ok: true; value: T } | { ok: false; response: NextResponse<ApiResult<never>> };

/** 400 `validation_failed` with the issues as the message and its param (the repo's validation shape). */
export function validationFailed(issues: string): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: issues, code: 'validation_failed', params: { issues } },
    { status: 400 },
  );
}

/**
 * Count the request against `bucket` for the client IP; a denial becomes the
 * standard 429. Same no-IP rule as the other public routes
 * (`checkPublicRateLimit`): a local run without a proxy and the in-memory
 * store is not limited, instead of sharing one site-wide "unknown" bucket.
 */
export async function gateCalcRateLimit(
  request: Request,
  bucket: 'calc' | 'calc-threats',
  options: RateLimitOptions,
): Promise<NextResponse<ApiResult<never>> | null> {
  const result = await checkPublicRateLimit(bucket, request, options);
  return result.allowed ? null : rateLimitedResponse(result.retryAfterSeconds);
}

/**
 * 400 for a combatant whose names do not resolve (unknown species, item,
 * move, ...): carries the CalcError's own `code` and `params` (an
 * `errors/stats` key) so clients can tell the causes apart; the English
 * message names the side.
 */
export function calcInputRejected(side: 'attacker' | 'defender', error: CalcError): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: `${side}: ${error.message}`, code: error.code, params: { ...error.params } },
    { status: 400 },
  );
}

/** Rate-limit, parse and validate a calc POST body. */
export async function parseCalcBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<GateResult<z.infer<S>>> {
  const limited = await gateCalcRateLimit(request, 'calc', CALC_RATE_LIMIT);
  if (limited) return { ok: false, response: limited };

  const body = await readJsonBody(request);
  if (!body.ok) return body;

  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return { ok: false, response: validationFailed(formatZodErrors(parsed.error)) };
  return { ok: true, value: parsed.data };
}
