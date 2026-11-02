/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { withI18n } from '@/test/i18n';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import type { LiveMatchState } from '@/types/broadcast';
import LiveStatBar from '../LiveStatBar';

const STATE: LiveMatchState = {
  match_id: 'm1',
  series_score: { player1: 1, player2: 0 },
  player1: { id: 'p1', name: 'Alice Overlay', avatar_url: null },
  player2: { id: 'p2', name: 'Bob Overlay', avatar_url: null },
  current_game: null,
  recent_moments: [],
  match_status: 'in_progress',
  winner_id: null,
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, ...init });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('LiveStatBar polling under a rate limit', () => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the last good data, honours Retry-After and recovers when the limit lifts', async () => {
    const config = { ...parseOverlayConfig(new URLSearchParams('poll=1000')) };
    fetchMock.mockResolvedValueOnce(json({ success: true, data: STATE }));
    render(withI18n(<LiveStatBar config={config} matchId="m1" />));
    await advance(0);
    expect(screen.getByText('Alice Overlay')).toBeTruthy();

    fetchMock.mockImplementation(async () =>
      json({ success: false, error: 'Rate limit exceeded', code: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '10' } }),
    );
    await advance(30_000);
    // Base interval is 1 s: an unchanged client would have sent about 30 more requests.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
    expect(screen.getByText('Alice Overlay')).toBeTruthy();

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => json({ success: true, data: STATE }));
    await advance(30_000);
    const recovered = fetchMock.mock.calls.length;
    expect(recovered).toBeGreaterThan(0);
    fetchMock.mockClear();
    await advance(5000);
    expect(fetchMock.mock.calls.length).toBe(5);
  });
});
