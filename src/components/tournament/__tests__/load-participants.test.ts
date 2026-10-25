/**
 * The participant manager announces its roster to the round manager's start-up checklist, but only a roster that
 * was actually read. `loadParticipants` reports a roster it could not read as `participants: null`, which keeps
 * the manager from announcing an empty tournament (and so blocking Generate) after a transient failure.
 */
import { describe, expect, it, vi } from 'vitest';
import { loadParticipants } from '../load-participants';

const TOURNAMENT = {
  id: 't-1',
  season_id: null,
  current_round: 0,
  enrollment_source: null,
  status: 'upcoming',
};

const ROSTER = [
  { id: 'p1', name: 'Ash', avatar_url: null, seed: 1, starting_bracket: 'winners', is_guest: false },
  { id: 'p2', name: 'Misty', avatar_url: null, seed: null, starting_bracket: 'winners', is_guest: false },
];

function json(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

const ok = (data: unknown) => json({ success: true, data });
const fail = (error: string) => json({ success: false, error });

/** A fetch stub that answers by URL (and method); an answer may be a function to throw. */
function stubFetch(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected request: ${key}`);
    return route();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const TOURNAMENT_URL = 'GET /api/tournaments/t-1';
const PARTICIPANTS_URL = 'GET /api/tournaments/t-1/participants';
const RATINGS_URL = 'GET /api/ratings';

describe('loadParticipants', () => {
  it('returns the roster, the tournament and the ratings when every read succeeds', async () => {
    const fetchImpl = stubFetch({
      [TOURNAMENT_URL]: () => ok(TOURNAMENT),
      [PARTICIPANTS_URL]: () => ok(ROSTER),
      [RATINGS_URL]: () => ok([{ player_id: 'p1', rating: 1500 }]),
    });
    const loaded = await loadParticipants('t-1', fetchImpl);
    expect(loaded.error).toBeNull();
    expect(loaded.tournament).toEqual(TOURNAMENT);
    expect(loaded.participants).toEqual(ROSTER);
    expect(loaded.ratings).toEqual({ p1: 1500 });
  });

  it('keeps a genuinely empty roster apart from a failed one', async () => {
    const fetchImpl = stubFetch({
      [TOURNAMENT_URL]: () => ok(TOURNAMENT),
      [PARTICIPANTS_URL]: () => ok([]),
      [RATINGS_URL]: () => ok([]),
    });
    const loaded = await loadParticipants('t-1', fetchImpl);
    expect(loaded.participants).toEqual([]);
    expect(loaded.error).toBeNull();
  });

  it('reports no roster when the participants read fails, and still returns the tournament', async () => {
    const fetchImpl = stubFetch({
      [TOURNAMENT_URL]: () => ok(TOURNAMENT),
      [PARTICIPANTS_URL]: () => fail('boom'),
      [RATINGS_URL]: () => ok([]),
    });
    const loaded = await loadParticipants('t-1', fetchImpl);
    expect(loaded.participants).toBeNull();
    expect(loaded.tournament).toEqual(TOURNAMENT);
    expect(loaded.error).toMatchObject({ api: { error: 'boom' } });
  });

  it('reports no roster when the tournament read fails', async () => {
    const fetchImpl = stubFetch({
      [TOURNAMENT_URL]: () => fail('nope'),
      [PARTICIPANTS_URL]: () => ok(ROSTER),
    });
    const loaded = await loadParticipants('t-1', fetchImpl);
    expect(loaded.participants).toBeNull();
    expect(loaded.tournament).toBeNull();
    expect(loaded.error).toMatchObject({ api: { error: 'nope' } });
  });

  it('reports no roster when a request throws', async () => {
    const fetchImpl = stubFetch({
      [TOURNAMENT_URL]: () => ok(TOURNAMENT),
      [PARTICIPANTS_URL]: () => {
        throw new Error('network down');
      },
    });
    const loaded = await loadParticipants('t-1', fetchImpl);
    expect(loaded.participants).toBeNull();
    expect(loaded.error).toEqual({ key: 'participants.loadFailed' });
  });

  it('reports no roster when the response is not JSON', async () => {
    const fetchImpl = stubFetch({
      [TOURNAMENT_URL]: () => ok(TOURNAMENT),
      [PARTICIPANTS_URL]: () =>
        ({
          json: async () => {
            throw new SyntaxError('Unexpected token <');
          },
        }) as unknown as Response,
    });
    const loaded = await loadParticipants('t-1', fetchImpl);
    expect(loaded.participants).toBeNull();
    expect(loaded.error).toEqual({ key: 'participants.loadFailed' });
  });

  describe('league phase sync', () => {
    const phase = { ...TOURNAMENT, season_id: 's-1', enrollment_source: { frozen: false } };
    const SYNC_URL = 'POST /api/seasons/s-1/phases/t-1/participants/sync-standings';

    it('takes the roster from the refreshed read after a successful sync', async () => {
      const synced = [ROSTER[0]];
      let reads = 0;
      const fetchImpl = stubFetch({
        [TOURNAMENT_URL]: () => ok(phase),
        [PARTICIPANTS_URL]: () => (reads++ === 0 ? ok([]) : ok(synced)),
        [SYNC_URL]: () => ok({ enrollment_source: { frozen: false, synced: true }, source_phase_name: 'Group stage' }),
        [RATINGS_URL]: () => ok([]),
      });
      const loaded = await loadParticipants('t-1', fetchImpl);
      expect(loaded.participants).toEqual(synced);
      expect(loaded.sourcePhaseName).toBe('Group stage');
      expect(loaded.enrollmentSource).toEqual({ frozen: false, synced: true });
    });

    it('counts the refreshed read as the roster even when the first read failed', async () => {
      let reads = 0;
      const fetchImpl = stubFetch({
        [TOURNAMENT_URL]: () => ok(phase),
        [PARTICIPANTS_URL]: () => (reads++ === 0 ? fail('boom') : ok(ROSTER)),
        [SYNC_URL]: () => ok({ enrollment_source: { frozen: false }, source_phase_name: null }),
        [RATINGS_URL]: () => ok([]),
      });
      const loaded = await loadParticipants('t-1', fetchImpl);
      expect(loaded.participants).toEqual(ROSTER);
    });

    it('reports no roster when the first read failed and the sync did not refresh it', async () => {
      const fetchImpl = stubFetch({
        [TOURNAMENT_URL]: () => ok(phase),
        [PARTICIPANTS_URL]: () => fail('boom'),
        [SYNC_URL]: () => fail('locked'),
        [RATINGS_URL]: () => ok([]),
      });
      const loaded = await loadParticipants('t-1', fetchImpl);
      expect(loaded.participants).toBeNull();
    });
  });
});
