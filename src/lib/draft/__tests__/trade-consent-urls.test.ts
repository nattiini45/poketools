import { describe, it, expect } from 'vitest';
import {
  buildTradeConsentRequest,
  type TradeConsentAction,
} from '@/lib/draft/trade-consent-urls';

describe('buildTradeConsentRequest', () => {
  const seasonId = 'season-abc';
  const requestId = 'tr-123';

  it('builds the consent endpoint URL with POST method', () => {
    const req = buildTradeConsentRequest('consent', seasonId, requestId);
    expect(req).toEqual({
      url: '/api/seasons/season-abc/redraft/trade-request/tr-123/consent',
      method: 'POST',
    });
  });

  it('builds the cancel endpoint URL with POST method', () => {
    const req = buildTradeConsentRequest('cancel', seasonId, requestId);
    expect(req).toEqual({
      url: '/api/seasons/season-abc/redraft/trade-request/tr-123/cancel',
      method: 'POST',
    });
  });

  it('maps every supported action to a distinct URL', () => {
    const actions: TradeConsentAction[] = ['consent', 'cancel'];
    const urls = actions.map(
      (a) => buildTradeConsentRequest(a, seasonId, requestId).url
    );
    expect(new Set(urls).size).toBe(actions.length);
  });

  it('throws when the season id is missing', () => {
    expect(() => buildTradeConsentRequest('consent', '', requestId)).toThrow();
  });

  it('throws when the request id is missing', () => {
    expect(() => buildTradeConsentRequest('cancel', seasonId, '')).toThrow();
  });

  it('encodes ids as path segments without extra escaping of simple ids', () => {
    // Simple uuid-like ids land verbatim in the path (the API route params
    // decode them). This guards against accidental query-string encoding.
    const req = buildTradeConsentRequest('consent', '11111111-2222-3333-4444-555555555555', 'tr-xyz');
    expect(req.url).toBe(
      '/api/seasons/11111111-2222-3333-4444-555555555555/redraft/trade-request/tr-xyz/consent'
    );
  });
});