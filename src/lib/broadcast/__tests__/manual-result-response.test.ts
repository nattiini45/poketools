import { describe, expect, it, vi } from 'vitest';
import { nextTrackerWarning, readManualResultResponse, submitManualResult } from '@/lib/broadcast/manual-result-response';
import { apiErrorText } from '@/i18n/api-errors';
import { errorsMatches } from '@/i18n/messages/errors/matches';
import { MOMENTS_NOT_SAVED_WARNING } from '@/lib/broadcast/moment-limits';

const WARNING = {
  code: MOMENTS_NOT_SAVED_WARNING,
  error: 'The game was recorded, but its 2 marked moments could not be saved. The failure was logged.',
  params: { count: 2 },
};

describe('readManualResultResponse', () => {
  it('returns the game id and no warning for a plain success', () => {
    expect(
      readManualResultResponse({ success: true, data: { game_id: 'g-1', bo_reached: false, moments_saved: 3 } })
    ).toEqual({ ok: true, gameId: 'g-1', warning: null });
  });

  it('returns the warning the server sent with a recorded game', () => {
    expect(
      readManualResultResponse({ success: true, data: { game_id: 'g-1', moments_saved: 0, warning: WARNING } })
    ).toEqual({ ok: true, gameId: 'g-1', warning: WARNING });
  });

  it('ignores a warning that carries neither code nor message', () => {
    expect(readManualResultResponse({ success: true, data: { game_id: 'g-1', warning: { params: {} } } })).toEqual({
      ok: true,
      gameId: 'g-1',
      warning: null,
    });
  });

  it('returns a null game id when the success body has none', () => {
    expect(readManualResultResponse({ success: true })).toEqual({ ok: true, gameId: null, warning: null });
  });

  it('keeps the API error of a failed response', () => {
    expect(
      readManualResultResponse({ success: false, error: 'Match not found', code: 'match_not_found' })
    ).toEqual({ ok: false, error: { error: 'Match not found', code: 'match_not_found' } });
  });

  it.each([[{ success: false }], [null], [{}], [42]])(
    'returns a null error for a failure body %j without error or code',
    (body) => {
      expect(readManualResultResponse(body)).toEqual({ ok: false, error: null });
    }
  );
});

describe('moments-not-saved warning text', () => {
  it('renders in English and German with the count', () => {
    expect(apiErrorText(WARNING, { locale: 'en', catalogs: [errorsMatches] })).toBe(WARNING.error);
    expect(apiErrorText(WARNING, { locale: 'de', catalogs: [errorsMatches] })).toBe(
      'Die Partie wurde eingetragen, aber 2 markierte Momente konnten nicht gespeichert werden. Der Fehler wurde protokolliert.'
    );
    expect(
      apiErrorText({ code: MOMENTS_NOT_SAVED_WARNING, params: { count: 1 } }, { locale: 'de', catalogs: [errorsMatches] })
    ).toBe(
      'Die Partie wurde eingetragen, aber 1 markierter Moment konnte nicht gespeichert werden. Der Fehler wurde protokolliert.'
    );
  });
});

describe('submitManualResult', () => {
  const PAYLOAD = { match_id: 'm-1', game_number: 1, winner_id: 'p-1' };

  function answering(status: number, body: unknown) {
    return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  }

  it('POSTs the payload as JSON to the manual-result route', async () => {
    const fetchFn = answering(200, { success: true, data: { game_id: 'g-1' } });
    await submitManualResult(PAYLOAD, fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/api/manual-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PAYLOAD),
    });
  });

  it('a 200 with data.warning records the game and carries the warning', async () => {
    const fetchFn = answering(200, { success: true, data: { game_id: 'g-1', moments_saved: 0, warning: WARNING } });
    expect(await submitManualResult(PAYLOAD, fetchFn)).toEqual({ ok: true, gameId: 'g-1', warning: WARNING });
  });

  it('a failed response keeps its API error', async () => {
    const fetchFn = answering(404, { success: false, error: 'Match not found', code: 'match_not_found' });
    expect(await submitManualResult(PAYLOAD, fetchFn)).toEqual({
      ok: false,
      error: { error: 'Match not found', code: 'match_not_found' },
    });
  });

  it('a network failure is a failed outcome with network_error, never a success', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await submitManualResult(PAYLOAD, fetchFn)).toEqual({ ok: false, error: { code: 'network_error' } });
  });

  it('a non-JSON answer is a failed outcome carrying the parse error', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('<html>502</html>', { status: 502 }));
    const outcome = await submitManualResult(PAYLOAD, fetchFn);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error?.error).toEqual(expect.any(String));
  });
});

describe('nextTrackerWarning (the tracker banner wiring)', () => {
  const warning = { error: 'Moments not saved', code: 'moments_not_saved' };

  it('submit clears, a 200 with a warning sets it, dismiss clears it', async () => {
    let state = nextTrackerWarning(warning, { type: 'submit' });
    expect(state).toBeNull();

    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { game_id: 'g-1', warning } }), { status: 200 })
    );
    const outcome = await submitManualResult({}, fetchFn as unknown as typeof fetch);
    state = nextTrackerWarning(state, { type: 'outcome', outcome });
    expect(state).toEqual(warning);

    expect(nextTrackerWarning(state, { type: 'dismiss' })).toBeNull();
  });

  it('a 200 without a warning leaves no banner; a failed submit shows none (the error line covers it)', () => {
    expect(nextTrackerWarning(null, { type: 'outcome', outcome: { ok: true, gameId: 'g-1', warning: null } })).toBeNull();
    expect(nextTrackerWarning(null, { type: 'outcome', outcome: { ok: false, error: null } })).toBeNull();
  });
});
