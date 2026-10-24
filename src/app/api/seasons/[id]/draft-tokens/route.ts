import { retiredResponse } from '../tokens/_lib/retired';

/**
 * POST /api/seasons/[id]/draft-tokens — RETIRED.
 *
 * The one-shot Draft Token allocation is replaced by buying single Draft Kill Tokens through
 * `POST /api/seasons/[id]/draft-kill-tokens`. Answers `410 ENDPOINT_REPLACED`; it reads and
 * writes nothing. The sweep deletes this file once no client calls it.
 */
// Public: no auth required — the endpoint is retired and touches no data.
export async function POST() {
  return retiredResponse('ENDPOINT_REPLACED');
}
