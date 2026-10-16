/**
 * Pure URL/method builders for the trade-consent API (3B-2-b).
 *
 * Kept free of any DOM or React dependency so the click -> request mapping can
 * be unit-tested in the `node` vitest environment (the project has no jsdom
 * setup, see vitest.config.ts). `TradeConsentPrompt` and the admin pending
 * view both delegate here so the URL shape lives in one place.
 *
 * Endpoints (defined in 3B-2-a):
 *  - POST /api/seasons/[id]/redraft/trade-request/[rid]/consent  (player consents)
 *  - POST /api/seasons/[id]/redraft/trade-request/[rid]/cancel   (admin OR either player)
 */

export type TradeConsentAction = 'consent' | 'cancel';

export interface TradeConsentRequest {
  url: string;
  method: 'POST';
}

/**
 * Build the request descriptor for a consent/cancel action. Both endpoints are
 * POST with no body — the caller id is resolved server-side from the session.
 */
export function buildTradeConsentRequest(
  action: TradeConsentAction,
  seasonId: string,
  requestId: string
): TradeConsentRequest {
  if (!seasonId || !requestId) {
    throw new Error('seasonId and requestId are required for a trade-consent request');
  }
  return {
    url: `/api/seasons/${seasonId}/redraft/trade-request/${requestId}/${action}`,
    method: 'POST',
  };
}