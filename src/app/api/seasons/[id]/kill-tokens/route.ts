import { retiredResponse } from '../tokens/_lib/retired';

/**
 * GET/POST /api/seasons/[id]/kill-tokens — RETIRED.
 *
 * "Kill tokens" are Comeback Tokens now: read them in the token overview
 * (`GET /api/seasons/[id]/tokens/me`) and spend them through
 * `POST /api/seasons/[id]/comeback-tokens/spend`. Both methods answer `410 ENDPOINT_REPLACED`;
 * they read and write nothing. The sweep deletes this file once no client calls it.
 */
// Public: no auth required — the endpoint is retired and touches no data.
export async function GET() {
  return retiredResponse('ENDPOINT_REPLACED');
}

// Public: no auth required — the endpoint is retired and touches no data.
export async function POST() {
  return retiredResponse('ENDPOINT_REPLACED');
}
