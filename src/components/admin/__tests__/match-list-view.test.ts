import { describe, expect, it } from 'vitest';
import {
  autoConfirmCountdown,
  bulkConfirmPreview,
  bulkResultRows,
  bulkScheduleSplit,
  isRetryableLoadError,
  matchListEmptyKey,
  matchPlayerSearchScope,
  matchScore,
  offersStandaloneLeague,
  replayCount,
  rulesetChoices,
} from '../match-list-view';
import {
  EMPTY_MATCH_LIST_STATE,
  STANDALONE_LEAGUE,
  buildMatchListApiQuery,
  type MatchListUrlState,
} from '@/lib/admin/match-list';
import type { BulkItemResult } from '@/lib/admin/match-bulk';
import type { AdminMatchFilterOptions, AdminMatchRow } from '@/lib/supabase/queries/matches';
import type { GameSummary } from '@/types/match';

const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function game(n: number, winner: string | null, replay = `https://replay.example/${n}`): GameSummary {
  return { id: `g${n}`, game_number: n, winner_id: winner, replay_url: replay, source: 'ps_replay', stats_locked: false };
}

describe('matchScore', () => {
  const ids = { player_1_id: P1, player_2_id: P2 };

  it('counts games won per seat', () => {
    expect(matchScore({ ...ids, games: [game(1, P1), game(2, P2), game(3, P1)] })).toEqual({ p1: 2, p2: 1 });
    expect(matchScore({ ...ids, games: [game(1, P1)] })).toEqual({ p1: 1, p2: 0 });
  });

  it('is null without games', () => {
    expect(matchScore({ ...ids, games: [] })).toBeNull();
  });
});

describe('replayCount', () => {
  it('counts only games that carry a replay link', () => {
    expect(replayCount([game(1, P1), game(2, P2, ''), game(3, P1, '  ')])).toBe(1);
    expect(replayCount([])).toBe(0);
  });
});

describe('autoConfirmCountdown', () => {
  const now = Date.UTC(2026, 9, 24, 12, 0, 0);
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const pending = (auto_confirm_at: string | null) => ({ status: 'pending_confirmation' as const, auto_confirm_at });

  it('rounds the remaining hours up', () => {
    expect(autoConfirmCountdown(pending(at(23 * 3_600_000 + 10 * 60_000)), now)).toEqual({ kind: 'hours', hours: 24 });
    expect(autoConfirmCountdown(pending(at(2 * 3_600_000)), now)).toEqual({ kind: 'hours', hours: 2 });
    expect(autoConfirmCountdown(pending(at(3_600_000)), now)).toEqual({ kind: 'hours', hours: 1 });
  });

  it('says "under an hour" below one hour', () => {
    expect(autoConfirmCountdown(pending(at(59 * 60_000)), now)).toEqual({ kind: 'underHour' });
    expect(autoConfirmCountdown(pending(at(1)), now)).toEqual({ kind: 'underHour' });
  });

  it('is due once the moment has passed', () => {
    expect(autoConfirmCountdown(pending(at(0)), now)).toEqual({ kind: 'due' });
    expect(autoConfirmCountdown(pending(at(-5 * 3_600_000)), now)).toEqual({ kind: 'due' });
  });

  it('is null for other statuses, a missing moment and an unreadable one', () => {
    expect(autoConfirmCountdown({ status: 'in_progress', auto_confirm_at: at(3_600_000) }, now)).toBeNull();
    expect(autoConfirmCountdown({ status: 'completed', auto_confirm_at: at(3_600_000) }, now)).toBeNull();
    expect(autoConfirmCountdown(pending(null), now)).toBeNull();
    expect(autoConfirmCountdown(pending('not a date'), now)).toBeNull();
  });
});

// ── filter options ──
const RS_A = '10000000-0000-4000-8000-00000000000a';
const RS_B = '10000000-0000-4000-8000-00000000000b';
const RS_C = '10000000-0000-4000-8000-00000000000c';
const LEAGUE_1 = '20000000-0000-4000-8000-000000000001';
const LEAGUE_2 = '20000000-0000-4000-8000-000000000002';
const LEAGUE_EMPTY = '20000000-0000-4000-8000-000000000003';
const PHASE_1A = '30000000-0000-4000-8000-00000000001a';
const PHASE_1B = '30000000-0000-4000-8000-00000000001b';
const PHASE_2A = '30000000-0000-4000-8000-00000000002a';
const SOLO = '40000000-0000-4000-8000-000000000001';

function league(id: string, phases: { id: string; ruleset_id: string }[]) {
  return {
    id,
    name: `League ${id.slice(-1)}`,
    status: 'active',
    archived: false,
    is_test_season: false,
    phases: phases.map((phase, index) => ({
      id: phase.id,
      name: `Phase ${phase.id.slice(-2)}`,
      stage_order: index,
      archived: false,
      ruleset_id: phase.ruleset_id,
    })),
  };
}

const OPTIONS: AdminMatchFilterOptions = {
  leagues: [
    league(LEAGUE_1, [
      { id: PHASE_1A, ruleset_id: RS_A },
      { id: PHASE_1B, ruleset_id: RS_B },
    ]),
    league(LEAGUE_2, [{ id: PHASE_2A, ruleset_id: RS_A }]),
  ],
  tournaments: [{ id: SOLO, name: 'Cup', status: 'active', archived: false, ruleset_id: RS_C }],
  rulesets: [
    { id: RS_A, name: 'Alpha' },
    { id: RS_B, name: 'Beta' },
    { id: RS_C, name: 'Gamma' },
  ],
};

const scopeOf = (options: AdminMatchFilterOptions | null, league = '', phase = '') =>
  matchPlayerSearchScope(options, { league, phase });

describe('matchPlayerSearchScope', () => {
  it('prefers the selected phase', () => {
    expect(scopeOf(OPTIONS, LEAGUE_1, PHASE_1B)).toEqual({ tournamentId: PHASE_1B });
    expect(scopeOf(OPTIONS, STANDALONE_LEAGUE, SOLO)).toEqual({ tournamentId: SOLO });
  });

  it('takes the first phase of the selected league', () => {
    expect(scopeOf(OPTIONS, LEAGUE_2)).toEqual({ tournamentId: PHASE_2A });
    expect(scopeOf(OPTIONS, LEAGUE_1)).toEqual({ tournamentId: PHASE_1A });
  });

  it('falls back to the first phase of any league when nothing is selected', () => {
    expect(scopeOf(OPTIONS)).toEqual({ tournamentId: PHASE_1A });
  });

  it('ignores a phase the options do not contain', () => {
    expect(scopeOf(OPTIONS, '', '30000000-0000-4000-8000-0000000000ff')).toEqual({ tournamentId: PHASE_1A });
  });

  it('uses a standalone tournament when no league has a phase', () => {
    const options = { ...OPTIONS, leagues: [league(LEAGUE_EMPTY, [])] };
    expect(scopeOf(options, STANDALONE_LEAGUE)).toEqual({ tournamentId: SOLO });
    expect(scopeOf(options)).toEqual({ tournamentId: SOLO });
  });

  it('uses the league itself when it is all there is (a league without phases)', () => {
    const options = { leagues: [league(LEAGUE_EMPTY, [])], tournaments: [], rulesets: [] };
    expect(scopeOf(options, LEAGUE_EMPTY)).toEqual({ seasonId: LEAGUE_EMPTY });
    expect(scopeOf(options)).toEqual({ seasonId: LEAGUE_EMPTY });
  });

  it('is null without options or with empty options', () => {
    expect(scopeOf(null)).toBeNull();
    expect(scopeOf({ leagues: [], tournaments: [], rulesets: [] }, LEAGUE_1)).toBeNull();
  });

  it('gives a tournament-only admin a tournament scope (their league lists only the phases they run)', () => {
    const options = { leagues: [league(LEAGUE_1, [{ id: PHASE_1B, ruleset_id: RS_B }])], tournaments: [], rulesets: [] };
    expect(scopeOf(options)).toEqual({ tournamentId: PHASE_1B });
    expect(scopeOf(options, LEAGUE_1)).toEqual({ tournamentId: PHASE_1B });
  });
});

describe('rulesetChoices', () => {
  const names = (league: string, phase = '') =>
    rulesetChoices(OPTIONS, { league, phase }).map((ruleset) => ruleset.name);

  it('offers every ruleset in scope when no league is selected', () => {
    expect(names('')).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('narrows to the rulesets of the selected league, phase or the standalone tournaments', () => {
    expect(names(LEAGUE_1)).toEqual(['Alpha', 'Beta']);
    expect(names(LEAGUE_2)).toEqual(['Alpha']);
    expect(names(LEAGUE_1, PHASE_1B)).toEqual(['Beta']);
    expect(names(STANDALONE_LEAGUE)).toEqual(['Gamma']);
  });

  it('keeps every ruleset for a league the options do not know yet, and is empty without options', () => {
    expect(names('30000000-0000-4000-8000-0000000000ee')).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(rulesetChoices(null, { league: '', phase: '' })).toEqual([]);
  });
});

describe('isRetryableLoadError', () => {
  it('retries a load or network failure and a server error', () => {
    expect(isRetryableLoadError({ kind: 'loadFailed' })).toBe(true);
    expect(isRetryableLoadError({ kind: 'api', error: { code: 'network_error' } })).toBe(true);
    expect(isRetryableLoadError({ kind: 'api', error: { code: 'upstream_timeout' } })).toBe(true);
    expect(isRetryableLoadError({ kind: 'api', error: { error: 'Failed to list matches' } })).toBe(true);
  });

  it('does not retry a refusal or a rejected request', () => {
    for (const code of ['forbidden', 'unauthenticated', 'account_banned', 'account_suspended', 'validation_failed']) {
      expect(isRetryableLoadError({ kind: 'api', error: { code } })).toBe(false);
    }
  });
});

describe('offersStandaloneLeague', () => {
  const options = (tournaments: AdminMatchFilterOptions['tournaments']): AdminMatchFilterOptions => ({
    leagues: [],
    tournaments,
    rulesets: [],
  });
  const tournament = { id: 't1', name: 'Open Cup', status: 'active', archived: false, ruleset_id: 'r1' };

  it('offers it while the options load, with a standalone tournament, or when selected', () => {
    expect(offersStandaloneLeague(null, false)).toBe(true);
    expect(offersStandaloneLeague(options([tournament]), false)).toBe(true);
    expect(offersStandaloneLeague(options([]), true)).toBe(true);
  });

  it('hides it when the caller has no standalone tournament', () => {
    expect(offersStandaloneLeague(options([]), false)).toBe(false);
  });
});

describe('matchListEmptyKey', () => {
  const key = (overrides: Partial<MatchListUrlState>) => matchListEmptyKey({ ...EMPTY_MATCH_LIST_STATE, ...overrides });

  it('blames the search only when it is the only filter', () => {
    expect(key({})).toBe('none');
    expect(key({ q: 'mara' })).toBe('noSearchResults');
  });

  it('blames the filters as soon as one other than the search is active', () => {
    expect(key({ status: 'disputed' })).toBe('noFilterResults');
    expect(key({ preset: 'overdue' })).toBe('noFilterResults');
    expect(key({ showTest: true })).toBe('noFilterResults');
    expect(key({ q: 'mara', replay: 'none' })).toBe('noFilterResults');
  });

  it('does not count the sort or the page as a filter', () => {
    expect(key({ sort: 'status_priority', page: 2 })).toBe('none');
  });
});

describe('the request key', () => {
  const state: MatchListUrlState = { ...EMPTY_MATCH_LIST_STATE, status: 'scheduled', range: 'today', player: P1 };
  const clock = { timeZone: 'Europe/Berlin', nowMs: Date.UTC(2026, 9, 24, 10, 0, 0) };

  it('is identical for equal states and an equal anchor, whatever the object identity', () => {
    expect(buildMatchListApiQuery({ ...state }, { ...clock })).toBe(buildMatchListApiQuery(state, clock));
  });

  it('does not move while the anchor stays on the same local day', () => {
    const later = { ...clock, nowMs: clock.nowMs + 3 * 3_600_000 };
    expect(buildMatchListApiQuery(state, later)).toBe(buildMatchListApiQuery(state, clock));
  });

  it('moves with the anchor once the local day changes', () => {
    const nextDay = { ...clock, nowMs: clock.nowMs + 24 * 3_600_000 };
    expect(buildMatchListApiQuery(state, nextDay)).not.toBe(buildMatchListApiQuery(state, clock));
  });
});

describe('bulk helpers', () => {
  const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  function row(n: number, overrides: Partial<AdminMatchRow> = {}): AdminMatchRow {
    return {
      id: ID(n),
      player_1_id: P1,
      player_2_id: P2,
      player_1_name: `Mara${n}`,
      player_2_name: `Joel${n}`,
      winner_id: null,
      winner_name: null,
      status: 'pending_confirmation',
      best_of: 3,
      games: [],
      ...overrides,
    } as AdminMatchRow;
  }

  describe('bulkConfirmPreview', () => {
    it('splits eligible and skipped rows, with winner, score and the reason', () => {
      const rows = [
        row(1, { winner_id: P1, winner_name: 'Mara1', games: [game(1, P1), game(2, P2), game(3, P1)] }),
        row(2, { status: 'scheduled', winner_id: P1 }),
        row(3),
        row(4, { winner_id: OTHER, winner_name: 'Nobody' }),
        row(5, { winner_id: P2, winner_name: 'Joel5' }),
      ];

      expect(bulkConfirmPreview(rows)).toEqual({
        items: [
          { id: ID(1), label: 'Mara1 vs Joel1', winnerId: P1, winnerName: 'Mara1', score: { p1: 2, p2: 1 }, bestOf: 3 },
          { id: ID(5), label: 'Mara5 vs Joel5', winnerId: P2, winnerName: 'Joel5', score: null, bestOf: 3 },
        ],
        skipped: [
          { id: ID(2), label: 'Mara2 vs Joel2', code: 'match_bulk_not_pending' },
          { id: ID(3), label: 'Mara3 vs Joel3', code: 'match_complete_no_winner' },
          { id: ID(4), label: 'Mara4 vs Joel4', code: 'match_winner_not_participant' },
        ],
      });
    });

    it('uses the given label format and is empty for no rows', () => {
      const preview = bulkConfirmPreview([row(1, { winner_id: P1 })], (a, b) => `${a} / ${b}`);
      expect(preview.items[0].label).toBe('Mara1 / Joel1');
      expect(bulkConfirmPreview([])).toEqual({ items: [], skipped: [] });
    });
  });

  describe('bulkScheduleSplit', () => {
    it('skips only completed matches, a disputed one included in the eligible', () => {
      const rows = [
        row(1, { status: 'scheduled' }),
        row(2, { status: 'completed' }),
        row(3, { status: 'disputed' }),
        row(4, { status: 'pending_confirmation' }),
        row(5, { status: 'in_progress' }),
      ];
      expect(bulkScheduleSplit(rows)).toEqual({
        eligibleIds: [ID(1), ID(3), ID(4), ID(5)],
        skipped: [{ id: ID(2), label: 'Mara2 vs Joel2', code: 'match_bulk_schedule_completed' }],
      });
    });
  });

  describe('bulkResultRows', () => {
    const rows = [row(1), row(2), row(3), row(4), row(5)];
    const results: BulkItemResult[] = [
      { id: ID(1), ok: true, code: 'ok' },
      { id: ID(2), ok: true, code: 'match_finalize_incomplete', params: { count: 2 } },
      { id: ID(3), ok: false, code: 'match_bulk_conflict' },
      { id: ID(4), ok: false, code: 'match_bulk_not_pending' },
      { id: ID(5), ok: false, code: 'match_not_found' },
      { id: ID(9), ok: false, code: 'match_bulk_item_failed' },
    ];

    it('joins every result that is not a plain success to its match label, in request order', () => {
      expect(bulkResultRows(results, rows)).toEqual([
        { id: ID(2), label: 'Mara2 vs Joel2', kind: 'warning', code: 'match_finalize_incomplete', params: { count: 2 } },
        { id: ID(3), label: 'Mara3 vs Joel3', kind: 'conflict', code: 'match_bulk_conflict' },
        { id: ID(4), label: 'Mara4 vs Joel4', kind: 'skipped', code: 'match_bulk_not_pending' },
        { id: ID(5), label: 'Mara5 vs Joel5', kind: 'failed', code: 'match_not_found' },
        // A match that is no longer among the rows is named by its id.
        { id: ID(9), label: ID(9), kind: 'failed', code: 'match_bulk_item_failed' },
      ]);
    });

    it('is empty when everything was done', () => {
      expect(bulkResultRows([{ id: ID(1), ok: true, code: 'ok' }], rows)).toEqual([]);
    });
  });
});
