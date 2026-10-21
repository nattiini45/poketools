/**
 * Cast Studio's MatchSelector, round → matches. The Match select used to
 * keep the previous round's matches when the next round's fetch failed or
 * came back late, so picking one populated the session with another round's
 * match. The helpers below decide what the select may offer; they run in the
 * vitest 'node' env with a fake fetch.
 *
 * Failures are kept as `ApiErrorLike` objects (the API's English `error`
 * plus any `code`), or `{}` when no answer arrived, and are translated only
 * when rendered (i18n-core §4.3).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';

vi.mock('../CastStudioContext', () => ({ useCastStudio: vi.fn() }));

import {
  fetchRoundMatchOptions,
  matchOptionsFor,
  MatchesLoadError,
  roundMatchesKey,
  type LoadedRoundMatches,
  type MatchOption,
} from '../MatchSelector';

const ROUND_A_MATCH: MatchOption = { id: 'm-a', player_1_name: 'Alice', player_2_name: 'Bob', status: 'scheduled' };
const ROUND_B_MATCH: MatchOption = { id: 'm-b', player_1_name: 'Cara', player_2_name: 'Dan', status: 'scheduled' };

const KEY_A = roundMatchesKey('t-1', 'r-a', 0);
const KEY_B = roundMatchesKey('t-1', 'r-b', 0);

const loadedA: LoadedRoundMatches = { key: KEY_A, result: { ok: true, matches: [ROUND_A_MATCH] } };

describe('matchOptionsFor', () => {
  it('lists the selected round’s matches once they arrive', () => {
    expect(matchOptionsFor(loadedA, KEY_A)).toEqual({ matches: [ROUND_A_MATCH], loading: false, error: null });
  });

  it('switching rounds clears the list while the new round loads (no stale round A matches)', () => {
    expect(matchOptionsFor(loadedA, KEY_B)).toEqual({ matches: [], loading: true, error: null });
  });

  it("a failed load of round B shows its error and none of round A's matches", () => {
    const failedB: LoadedRoundMatches = { key: KEY_B, result: { ok: false, error: { error: 'Failed to fetch round' } } };
    expect(matchOptionsFor(failedB, KEY_B)).toEqual({
      matches: [],
      loading: false,
      error: { error: 'Failed to fetch round' },
    });
  });

  it("a late response for round A does not show under round B", () => {
    // Round B is selected; the only answered request is A's.
    expect(matchOptionsFor(loadedA, KEY_B).matches).toEqual([]);
    const loadedB: LoadedRoundMatches = { key: KEY_B, result: { ok: true, matches: [ROUND_B_MATCH] } };
    expect(matchOptionsFor(loadedB, KEY_B).matches).toEqual([ROUND_B_MATCH]);
  });

  it('a retry is a new request: the failed result no longer counts', () => {
    const failedB: LoadedRoundMatches = { key: KEY_B, result: { ok: false, error: { error: 'boom' } } };
    expect(matchOptionsFor(failedB, roundMatchesKey('t-1', 'r-b', 1))).toEqual({
      matches: [],
      loading: true,
      error: null,
    });
  });

  it('offers nothing when no round is selected', () => {
    expect(matchOptionsFor(loadedA, null)).toEqual({ matches: [], loading: false, error: null });
  });
});

describe('fetchRoundMatchOptions', () => {
  it("returns the round's matches", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { id: 'r-a', matches: [ROUND_A_MATCH] } })),
    ) as unknown as typeof fetch;

    expect(await fetchRoundMatchOptions('t-1', 'r-a', fetchImpl)).toEqual({ ok: true, matches: [ROUND_A_MATCH] });
    expect(fetchImpl).toHaveBeenCalledWith('/api/tournaments/t-1/rounds/r-a');
  });

  it('returns an error response, a network failure or a non-JSON body as an error', async () => {
    const notFound = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: 'Round not found' }), { status: 404 }),
    ) as unknown as typeof fetch;
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const html = vi.fn(async () => new Response('<html>500</html>', { status: 500 })) as unknown as typeof fetch;

    expect(await fetchRoundMatchOptions('t-1', 'r-a', notFound)).toEqual({ ok: false, error: { error: 'Round not found' } });
    expect(await fetchRoundMatchOptions('t-1', 'r-a', offline)).toEqual({ ok: false, error: {} });
    expect(await fetchRoundMatchOptions('t-1', 'r-a', html)).toEqual({ ok: false, error: {} });
  });

  it('keeps the error code the route sends, for translation at render time', async () => {
    const coded = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: 'Round not found', code: 'round_not_found' }), { status: 404 }),
    ) as unknown as typeof fetch;

    expect(await fetchRoundMatchOptions('t-1', 'r-a', coded)).toEqual({
      ok: false,
      error: { error: 'Round not found', code: 'round_not_found' },
    });
  });
});

describe('MatchesLoadError', () => {
  it('shows the failure with a retry', () => {
    const html = renderToStaticMarkup(<MatchesLoadError error={{ error: 'Round not found' }} onRetry={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Round not found');
    expect(html).toContain('Retry');
  });

  it('names a failed request without an API answer', () => {
    const html = renderToStaticMarkup(<MatchesLoadError error={{}} onRetry={() => {}} />);
    expect(html).toContain('Failed to load matches');
  });

  it('renders in German', () => {
    const html = renderWithI18n(<MatchesLoadError error={{}} onRetry={() => {}} />, { locale: 'de' });
    expect(html).toContain('Die Spiele dieser Runde konnten nicht geladen werden');
    expect(html).toContain('Spiele konnten nicht geladen werden');
    expect(html).toContain('Erneut versuchen');
  });
});
