import { describe, expect, it } from 'vitest';
import {
  ADMIN_MATCH_BEST_OF_CHOICES,
  ADMIN_MATCH_BRACKET_TYPES,
  ADMIN_MATCH_FORMAT_TYPES,
  ADMIN_MATCH_MAX_PAGE,
  ADMIN_MATCH_PRESETS,
  ADMIN_MATCH_SORTS,
  ADMIN_MATCH_STATUSES,
  ADMIN_MATCH_STATUS_PRIORITY,
  EMPTY_MATCH_LIST_STATE,
  STANDALONE_LEAGUE,
  activeMatchListFilters,
  adminMatchLastPage,
  adminMatchListQuerySchema,
  buildMatchListApiQuery,
  buildMatchListSearch,
  clearMatchListFilters,
  matchListBackHref,
  matchListScopeCorrection,
  matchPageBackSuffix,
  parseMatchListBack,
  parseMatchListUrl,
  reconcileMatchListScope,
  type MatchListUrlState,
} from '../match-list';
import type { AdminMatchFilterOptions } from '@/lib/supabase/queries/matches';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const FROM = '2026-10-24T22:00:00.000Z';
const TO = '2026-10-25T23:00:00.000Z';

function parse(query: Record<string, string>) {
  return adminMatchListQuerySchema.safeParse(query);
}

describe('adminMatchListQuerySchema', () => {
  it('defaults page to 1 and page_size to 50 with no params', () => {
    const r = parse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.page_size).toBe(50);
      expect(r.data.status).toBeUndefined();
      expect(r.data.q).toBeUndefined();
    }
  });

  it('accepts one status or a comma separated list, de-duplicated', () => {
    const one = parse({ status: 'disputed' });
    const many = parse({ status: 'disputed, completed,disputed' });
    expect(one.success && one.data.status).toEqual(['disputed']);
    expect(many.success && many.data.status).toEqual(['disputed', 'completed']);
  });

  it.each([
    ['unknown status', { status: 'nope' }],
    ['one unknown status in a list', { status: 'disputed,nope' }],
    ['non-uuid season_id', { season_id: 'abc' }],
    ['non-uuid tournament_id', { tournament_id: 'abc' }],
    ['q over 100 chars', { q: 'x'.repeat(101) }],
    ['page 0', { page: '0' }],
    ['non-numeric page', { page: 'two' }],
    ['fractional page', { page: '1.5' }],
    ['page past the last allowed page', { page: String(ADMIN_MATCH_MAX_PAGE + 1) }],
    ['a million pages deep', { page: '1000000' }],
    ['page_size 10', { page_size: '10' }],
    ['page_size 1000', { page_size: '1000' }],
    ['unknown key', { limit: '10' }],
    ['standalone=false', { standalone: 'false' }],
    ['standalone with season_id', { standalone: 'true', season_id: UUID_A }],
  ])('rejects %s', (_label, query) => {
    expect(parse(query).success).toBe(false);
  });

  it('accepts the three page sizes and a trimmed q', () => {
    for (const size of ['25', '50', '100']) {
      const r = parse({ page_size: size });
      expect(r.success && r.data.page_size).toBe(Number(size));
    }
    const r = parse({ q: '  mara  ', page: '3', season_id: UUID_A, tournament_id: UUID_B });
    expect(r.success && r.data.q).toBe('mara');
    expect(r.success && r.data.page).toBe(3);
  });

  it('accepts the last allowed page', () => {
    const r = parse({ page: String(ADMIN_MATCH_MAX_PAGE) });
    expect(r.success && r.data.page).toBe(ADMIN_MATCH_MAX_PAGE);
  });

  it('treats empty values as absent', () => {
    const r = parse({ status: '', season_id: '', q: '', page: '', page_size: '' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBeUndefined();
      expect(r.data.season_id).toBeUndefined();
      expect(r.data.page).toBe(1);
    }
  });
});

describe('adminMatchListQuerySchema: filter keys', () => {
  it('accepts every new key', () => {
    const r = parse({
      tournament_id: UUID_A,
      round_id: UUID_B,
      format_type: 'draft',
      bracket_type: 'swiss',
      best_of: '3',
      ruleset_id: UUID_C,
      date_field: 'played',
      date_from: FROM,
      date_to: '2026-10-25T23:00:00+02:00',
      player_id: UUID_A,
      player2_id: UUID_B,
      replay: 'has',
      hand_edited: 'true',
      has_notes: 'true',
      preset: 'overdue',
      include_test: 'true',
      include_archived: 'true',
      sort: 'status_priority',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toMatchObject({
        round_id: UUID_B,
        format_type: 'draft',
        bracket_type: 'swiss',
        best_of: 3,
        date_field: 'played',
        replay: 'has',
        hand_edited: 'true',
        preset: 'overdue',
        sort: 'status_priority',
      });
    }
  });

  it('accepts every enum value of the contract', () => {
    for (const format_type of ADMIN_MATCH_FORMAT_TYPES) expect(parse({ format_type }).success).toBe(true);
    for (const bracket_type of ADMIN_MATCH_BRACKET_TYPES) expect(parse({ bracket_type }).success).toBe(true);
    for (const preset of ADMIN_MATCH_PRESETS) expect(parse({ preset }).success).toBe(true);
    for (const sort of ADMIN_MATCH_SORTS) expect(parse({ sort }).success).toBe(true);
    for (const best_of of [1, 15]) expect(parse({ best_of: String(best_of) }).success).toBe(true);
  });

  it('accepts "no date set" for the scheduled (default) and played dates, and no_games with replay=none', () => {
    expect(parse({ date_none: 'true' }).success).toBe(true);
    expect(parse({ date_none: 'true', date_field: 'scheduled' }).success).toBe(true);
    expect(parse({ date_none: 'true', date_field: 'played' }).success).toBe(true);
    expect(parse({ no_games: 'true', replay: 'none' }).success).toBe(true);
    expect(parse({ date_to: TO }).success).toBe(true);
  });

  it.each([
    ['non-uuid round_id', { tournament_id: UUID_A, round_id: 'abc' }],
    ['round_id without tournament_id', { round_id: UUID_B }],
    ['round_id with only season_id', { season_id: UUID_A, round_id: UUID_B }],
    ['unknown format_type', { format_type: 'bo3' }],
    ['unknown bracket_type', { bracket_type: 'ladder' }],
    ['best_of 0', { best_of: '0' }],
    ['best_of 16', { best_of: '16' }],
    ['fractional best_of', { best_of: '2.5' }],
    ['non-uuid ruleset_id', { ruleset_id: 'abc' }],
    ['unknown date_field', { date_field: 'finished', date_from: FROM }],
    ['date_from without an offset', { date_from: '2026-10-25T00:00:00' }],
    ['date_to that is only a day', { date_to: '2026-10-25' }],
    ['date_from after date_to', { date_from: TO, date_to: FROM }],
    ['date_from equal to date_to', { date_from: FROM, date_to: FROM }],
    ['date_none with date_from', { date_none: 'true', date_from: FROM }],
    ['date_none with date_to', { date_none: 'true', date_to: TO }],
    ['date_none with date_field=created', { date_none: 'true', date_field: 'created' }],
    ['date_none with date_field=updated', { date_none: 'true', date_field: 'updated' }],
    ['date_field alone', { date_field: 'played' }],
    ['date_none=false', { date_none: 'false' }],
    ['non-uuid player_id', { player_id: 'abc' }],
    ['player2_id without player_id', { player2_id: UUID_B }],
    ['player2_id equal to player_id', { player_id: UUID_A, player2_id: UUID_A }],
    ['unknown replay filter', { replay: 'maybe' }],
    ['hand_edited=false', { hand_edited: 'false' }],
    ['has_notes=1', { has_notes: '1' }],
    ['no_games with replay=has', { no_games: 'true', replay: 'has' }],
    ['no_games with hand_edited', { no_games: 'true', hand_edited: 'true' }],
    ['replay=none with hand_edited', { replay: 'none', hand_edited: 'true' }],
    ['format_type with standalone', { format_type: 'singles', standalone: 'true' }],
    ['unknown preset', { preset: 'urgent' }],
    ['include_test=yes', { include_test: 'yes' }],
    ['include_archived=1', { include_archived: '1' }],
    ['unknown sort', { sort: 'random' }],
  ])('rejects %s', (_label, query) => {
    expect(parse(query).success).toBe(false);
  });

  it('still refuses an unknown key and treats empty values of the new keys as absent', () => {
    expect(parse({ offset: '10' }).success).toBe(false);
    const r = parse({
      round_id: '', format_type: '', bracket_type: '', best_of: '', ruleset_id: '', date_field: '', date_from: '',
      date_to: '', date_none: '', player_id: '', player2_id: '', replay: '', hand_edited: '', has_notes: '',
      no_games: '', preset: '', include_test: '', include_archived: '', sort: '',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.round_id).toBeUndefined();
      expect(r.data.best_of).toBeUndefined();
      expect(r.data.sort).toBeUndefined();
      expect(r.data.date_from).toBeUndefined();
    }
  });
});

describe('contract constants', () => {
  it('ranks every status exactly once', () => {
    expect([...ADMIN_MATCH_STATUS_PRIORITY].sort()).toEqual([...ADMIN_MATCH_STATUSES].sort());
    expect(ADMIN_MATCH_STATUS_PRIORITY[0]).toBe('disputed');
    expect(ADMIN_MATCH_STATUS_PRIORITY[ADMIN_MATCH_STATUS_PRIORITY.length - 1]).toBe('completed');
  });

  it('offers best-of 1, 3 and 5 in the UI', () => {
    expect([...ADMIN_MATCH_BEST_OF_CHOICES]).toEqual([1, 3, 5]);
  });
});

describe('match list URL state', () => {
  const FULL: MatchListUrlState = {
    status: 'disputed',
    league: UUID_A,
    phase: UUID_B,
    q: 'mara',
    page: 3,
    round: UUID_C,
    preset: 'overdue',
    dateField: 'played',
    range: '',
    from: '2026-10-01',
    to: '2026-10-31',
    format: 'draft',
    bracket: 'swiss',
    bestOf: 3,
    ruleset: UUID_C,
    player: UUID_A,
    player2: UUID_B,
    replay: 'has',
    edited: true,
    notes: true,
    noGames: false,
    showTest: true,
    showArchived: true,
    sort: 'status_priority',
  };
  const search = (query: string) => parseMatchListUrl(new URLSearchParams(query));

  it('parses a deep link and drops bad values instead of failing', () => {
    const ok = search(`league=${UUID_A}&phase=${UUID_B}&status=disputed&q=mara&page=3`);
    expect(ok).toEqual({
      ...EMPTY_MATCH_LIST_STATE,
      status: 'disputed',
      league: UUID_A,
      phase: UUID_B,
      q: 'mara',
      page: 3,
    });

    const bad = search('league=x&phase=y&status=z&page=-4');
    expect(bad).toEqual(EMPTY_MATCH_LIST_STATE);

    expect(search(`league=${STANDALONE_LEAGUE}`).league).toBe(STANDALONE_LEAGUE);
  });

  it('degrades every bad value of the new keys to its default', () => {
    const bad = search(
      [
        'round=nope', 'preset=urgent', 'date=finished', 'range=forever', 'from=yesterday', 'to=2026-02-30',
        'format=bo3', 'bracket=ladder', 'bo=abc', 'ruleset=nope', 'player=nope', 'player2=nope', 'replay=maybe',
        'edited=yes', 'notes=true', 'nogames=0', 'test=true', 'archived=on', 'sort=random',
      ].join('&'),
    );
    expect(bad).toEqual(EMPTY_MATCH_LIST_STATE);
  });

  it('adminMatchLastPage is at least 1 and never past the last page the API answers', () => {
    expect(adminMatchLastPage(0, 50)).toBe(1);
    expect(adminMatchLastPage(50, 50)).toBe(1);
    expect(adminMatchLastPage(51, 50)).toBe(2);
    expect(adminMatchLastPage(ADMIN_MATCH_MAX_PAGE * 50, 50)).toBe(ADMIN_MATCH_MAX_PAGE);
    expect(adminMatchLastPage(ADMIN_MATCH_MAX_PAGE * 50 + 1, 50)).toBe(ADMIN_MATCH_MAX_PAGE);
    expect(adminMatchLastPage(10_000_000, 25)).toBe(ADMIN_MATCH_MAX_PAGE);
  });

  it('keeps the page within the range the API accepts', () => {
    const page = (value: number) => search(`page=${value}`).page;
    expect(page(ADMIN_MATCH_MAX_PAGE)).toBe(ADMIN_MATCH_MAX_PAGE);
    expect(page(ADMIN_MATCH_MAX_PAGE + 1)).toBe(1);
    expect(page(99_999_999)).toBe(1);
  });

  it('round-trips through buildMatchListSearch and omits defaults', () => {
    const state = { ...EMPTY_MATCH_LIST_STATE, status: 'disputed' as const, league: UUID_A, phase: UUID_B, q: 'mara', page: 2 };
    expect(search(buildMatchListSearch(state))).toEqual(state);
    expect(buildMatchListSearch({ ...EMPTY_MATCH_LIST_STATE, q: '  ' })).toBe('');
    expect(buildMatchListSearch(EMPTY_MATCH_LIST_STATE)).toBe('');
  });

  it('round-trips a full state in a canonical key order', () => {
    const query = buildMatchListSearch(FULL);
    expect(query).toBe(
      [
        'status=disputed', `league=${UUID_A}`, `phase=${UUID_B}`, `round=${UUID_C}`, 'q=mara', 'page=3',
        'preset=overdue', 'date=played', 'from=2026-10-01', 'to=2026-10-31', 'format=draft', 'bracket=swiss', 'bo=3',
        `ruleset=${UUID_C}`, `player=${UUID_A}`, `player2=${UUID_B}`, 'replay=has', 'edited=1', 'notes=1', 'test=1',
        'archived=1', 'sort=status_priority',
      ].join('&'),
    );
    expect(search(query)).toEqual(FULL);
    // The order never depends on the order the keys were typed in.
    expect(buildMatchListSearch(search('sort=status_priority&archived=1&status=disputed'))).toBe(
      'status=disputed&archived=1&sort=status_priority',
    );
  });

  it('round-trips a relative range, no-games and the other replay value', () => {
    const state = { ...EMPTY_MATCH_LIST_STATE, range: 'next7' as const, dateField: 'created' as const, noGames: true, replay: 'none' as const };
    expect(buildMatchListSearch(state)).toBe('date=created&range=next7&replay=none&nogames=1');
    expect(search(buildMatchListSearch(state))).toEqual(state);
  });

  it('keeps the default date field out of the URL and resets it when no date is selected', () => {
    expect(buildMatchListSearch({ ...EMPTY_MATCH_LIST_STATE, range: 'today' })).toBe('range=today');
    expect(buildMatchListSearch({ ...EMPTY_MATCH_LIST_STATE, dateField: 'played' })).toBe('');
    expect(search('date=played').dateField).toBe('scheduled');
  });

  describe('dependencies', () => {
    it('drops the round without a phase', () => {
      expect(search(`round=${UUID_C}`).round).toBe('');
      expect(search(`league=${UUID_A}&round=${UUID_C}`).round).toBe('');
      expect(search(`phase=${UUID_B}&round=${UUID_C}`).round).toBe(UUID_C);
      expect(buildMatchListSearch({ ...EMPTY_MATCH_LIST_STATE, round: UUID_C })).toBe('');
    });

    it('drops the second player without the first and when both are the same', () => {
      expect(search(`player2=${UUID_B}`).player2).toBe('');
      expect(search(`player=${UUID_A}&player2=${UUID_A}`).player2).toBe('');
      expect(search(`player=${UUID_A}&player2=${UUID_B}`)).toMatchObject({ player: UUID_A, player2: UUID_B });
    });

    it('drops a to-day before the from-day and a day that does not exist', () => {
      expect(search('from=2026-10-20&to=2026-10-19')).toMatchObject({ from: '2026-10-20', to: '' });
      expect(search('from=2026-10-20&to=2026-10-20')).toMatchObject({ from: '2026-10-20', to: '2026-10-20' });
      expect(search('from=2026-02-30&to=2026-13-01')).toMatchObject({ from: '', to: '' });
    });

    it('lets a relative range win over from and to', () => {
      expect(search('range=today&from=2026-10-01&to=2026-10-31')).toMatchObject({ range: 'today', from: '', to: '' });
    });

    it('keeps "no date set" only for the scheduled and played dates', () => {
      expect(search('range=none').range).toBe('none');
      expect(search('range=none&date=played').range).toBe('none');
      expect(search('range=none&date=created').range).toBe('');
      expect(search('range=none&date=updated').range).toBe('');
      expect(search('range=today&date=updated')).toMatchObject({ range: 'today', dateField: 'updated' });
    });

    it('drops the league format for standalone tournaments', () => {
      expect(search(`league=${STANDALONE_LEAGUE}&format=draft`).format).toBe('');
      expect(search(`league=${UUID_A}&format=draft`).format).toBe('draft');
      expect(search('format=draft').format).toBe('draft');
    });

    it('accepts best-of 1 to 15 and nothing else', () => {
      expect(search('bo=1').bestOf).toBe(1);
      expect(search('bo=15').bestOf).toBe(15);
      for (const bad of ['0', '16', '99', '-1', '3.5', 'abc', '']) expect(search(`bo=${bad}`).bestOf).toBeNull();
    });

    it('drops the content filters the API would refuse together', () => {
      expect(search('nogames=1&replay=has').noGames).toBe(false);
      expect(search('nogames=1&edited=1').noGames).toBe(false);
      expect(search('nogames=1&replay=none')).toMatchObject({ noGames: true, replay: 'none' });
      expect(search('nogames=1&notes=1')).toMatchObject({ noGames: true, notes: true });
      expect(search('replay=none&edited=1')).toMatchObject({ replay: '', edited: true });
      expect(search('replay=has&edited=1')).toMatchObject({ replay: 'has', edited: true });
    });

    it('never produces a state the API schema refuses', () => {
      const queries = [
        `round=${UUID_C}`, `player2=${UUID_B}`, 'range=none&date=created', 'nogames=1&replay=has&edited=1',
        'replay=none&edited=1', `league=${STANDALONE_LEAGUE}&format=draft`, 'from=2026-10-20&to=2026-10-19',
        'range=today&from=2026-10-01',
      ];
      for (const query of queries) {
        const api = buildMatchListApiQuery(search(query), { timeZone: 'UTC', nowMs: Date.parse('2026-10-25T10:00:00Z') });
        const raw = Object.fromEntries(new URLSearchParams(api));
        expect(adminMatchListQuerySchema.safeParse(raw).success).toBe(true);
      }
    });
  });
});

describe('reconcileMatchListScope', () => {
  const league = (id: string, phases: string[]): AdminMatchFilterOptions['leagues'][number] => ({
    id,
    name: id,
    status: 'active',
    archived: false,
    is_test_season: false,
    phases: phases.map((phase, i) => ({ id: phase, name: phase, stage_order: i, archived: false, ruleset_id: UUID_C })),
  });
  const options: AdminMatchFilterOptions = {
    leagues: [league(UUID_A, [UUID_B])],
    tournaments: [{ id: UUID_C, name: 'Cup', status: 'active', archived: false, ruleset_id: UUID_C }],
    rulesets: [],
  };
  const base = (patch: Partial<MatchListUrlState>): MatchListUrlState => ({ ...EMPTY_MATCH_LIST_STATE, ...patch });
  const OTHER_LEAGUE = '44444444-4444-4444-8444-444444444444';
  const OTHER_PHASE = '55555555-5555-4555-8555-555555555555';

  it('returns the state itself without options, without a phase, or when league and phase agree', () => {
    const agreeing = base({ league: UUID_A, phase: UUID_B });
    expect(reconcileMatchListScope(agreeing, null)).toBe(agreeing);
    expect(reconcileMatchListScope(agreeing, options)).toBe(agreeing);
    const none = base({ league: OTHER_LEAGUE });
    expect(reconcileMatchListScope(none, options)).toBe(none);
  });

  it('derives the league from a phase that belongs to another league, so the list and the bar agree', () => {
    const state = base({ league: OTHER_LEAGUE, phase: UUID_B, round: UUID_C });
    const reconciled = reconcileMatchListScope(state, options);
    expect(reconciled).toMatchObject({ league: UUID_A, phase: UUID_B, round: UUID_C });
    expect(buildMatchListApiQuery(reconciled)).toBe(`tournament_id=${UUID_B}&round_id=${UUID_C}`);
  });

  it('derives the league from a phase given without one', () => {
    expect(reconcileMatchListScope(base({ phase: UUID_B }), options).league).toBe(UUID_A);
  });

  it('derives the standalone league from a standalone tournament and drops the league format', () => {
    const reconciled = reconcileMatchListScope(base({ league: UUID_A, phase: UUID_C, format: 'singles' }), options);
    expect(reconciled).toMatchObject({ league: STANDALONE_LEAGUE, phase: UUID_C, format: '' });
  });

  it('drops a phase the options do not contain, with its round', () => {
    const reconciled = reconcileMatchListScope(base({ league: UUID_A, phase: OTHER_PHASE, round: UUID_C }), options);
    expect(reconciled).toMatchObject({ league: UUID_A, phase: '', round: '' });
    expect(buildMatchListApiQuery(reconciled)).toBe(`season_id=${UUID_A}`);
  });

  describe('matchListScopeCorrection', () => {
    const correction = (state: MatchListUrlState) => matchListScopeCorrection(state, reconcileMatchListScope(state, options));

    it('is the corrected query when the phase won over a mismatched league', () => {
      expect(correction(base({ league: OTHER_LEAGUE, phase: UUID_B }))).toBe(`league=${UUID_A}&phase=${UUID_B}`);
    });

    it('is the query without the phase when an unknown phase was dropped', () => {
      expect(correction(base({ status: 'disputed', league: UUID_A, phase: OTHER_PHASE, round: UUID_C }))).toBe(
        `status=disputed&league=${UUID_A}`,
      );
    });

    it('is null while the options are missing or when the address already agrees, so no replace loops', () => {
      const mismatched = base({ league: OTHER_LEAGUE, phase: UUID_B });
      expect(matchListScopeCorrection(mismatched, reconcileMatchListScope(mismatched, null))).toBeNull();
      expect(correction(base({ league: UUID_A, phase: UUID_B }))).toBeNull();
      expect(correction(base({ league: OTHER_LEAGUE }))).toBeNull();
      const corrected = parseMatchListUrl(new URLSearchParams(correction(mismatched) ?? ''));
      expect(correction(corrected)).toBeNull();
    });
  });
});

describe('buildMatchListApiQuery', () => {
  const clock = { timeZone: 'Europe/Berlin', nowMs: Date.parse('2026-10-25T10:00:00Z') };
  const api = (state: Partial<MatchListUrlState>) =>
    Object.fromEntries(new URLSearchParams(buildMatchListApiQuery({ ...EMPTY_MATCH_LIST_STATE, ...state }, clock)));

  it('maps the state onto the API query: phase wins over league, standalone has its own flag', () => {
    expect(buildMatchListApiQuery({ ...EMPTY_MATCH_LIST_STATE, league: UUID_A })).toBe(`season_id=${UUID_A}`);
    expect(buildMatchListApiQuery({ ...EMPTY_MATCH_LIST_STATE, league: UUID_A, phase: UUID_B })).toBe(`tournament_id=${UUID_B}`);
    expect(buildMatchListApiQuery({ ...EMPTY_MATCH_LIST_STATE, league: STANDALONE_LEAGUE })).toBe('standalone=true');
    expect(buildMatchListApiQuery({ ...EMPTY_MATCH_LIST_STATE, status: 'disputed', q: ' mara ', page: 2 })).toBe(
      'status=disputed&q=mara&page=2',
    );
    expect(buildMatchListApiQuery(EMPTY_MATCH_LIST_STATE)).toBe('');
  });

  it('maps every filter of the contract', () => {
    expect(
      api({
        status: 'in_progress',
        phase: UUID_B,
        round: UUID_C,
        q: 'mara',
        preset: 'stale_in_progress',
        format: 'singles',
        bracket: 'round_robin',
        bestOf: 5,
        ruleset: UUID_C,
        player: UUID_A,
        player2: UUID_B,
        replay: 'none',
        notes: true,
        noGames: true,
        showTest: true,
        showArchived: true,
        sort: 'updated_asc',
        page: 4,
      }),
    ).toEqual({
      status: 'in_progress',
      tournament_id: UUID_B,
      round_id: UUID_C,
      q: 'mara',
      preset: 'stale_in_progress',
      format_type: 'singles',
      bracket_type: 'round_robin',
      best_of: '5',
      ruleset_id: UUID_C,
      player_id: UUID_A,
      player2_id: UUID_B,
      replay: 'none',
      has_notes: 'true',
      no_games: 'true',
      include_test: 'true',
      include_archived: 'true',
      sort: 'updated_asc',
      page: '4',
    });
    expect(api({ replay: 'has', edited: true })).toEqual({ replay: 'has', hand_edited: 'true' });
  });

  it('resolves dates in the viewer zone: a range, a custom window and "no date set"', () => {
    expect(api({ range: 'today' })).toEqual({
      date_field: 'scheduled',
      date_from: '2026-10-24T22:00:00.000Z',
      date_to: '2026-10-25T23:00:00.000Z',
    });
    expect(api({ dateField: 'created', from: '2026-10-20', to: '2026-10-25' })).toEqual({
      date_field: 'created',
      date_from: '2026-10-19T22:00:00.000Z',
      date_to: '2026-10-25T23:00:00.000Z',
    });
    expect(api({ dateField: 'played', range: 'none' })).toEqual({ date_field: 'played', date_none: 'true' });
    expect(api({ dateField: 'created' })).toEqual({});
  });

  it('sends the default sort and page 1 as nothing, and never sends page_size', () => {
    expect(api({ sort: 'created_desc', page: 1 })).toEqual({});
    const query = buildMatchListApiQuery({ ...EMPTY_MATCH_LIST_STATE, league: UUID_A, notes: true, page: 3 }, clock);
    expect(new URLSearchParams(query).has('page_size')).toBe(false);
  });

  it('is identical for equal states and an equal clock (a stable request key)', () => {
    const state = { ...EMPTY_MATCH_LIST_STATE, range: 'last7' as const, status: 'scheduled' as const };
    expect(buildMatchListApiQuery({ ...state }, clock)).toBe(buildMatchListApiQuery({ ...state }, { ...clock }));
    // A later "now" within the same local day gives the same instants.
    const later = { ...clock, nowMs: clock.nowMs + 60_000 };
    expect(buildMatchListApiQuery(state, later)).toBe(buildMatchListApiQuery(state, clock));
  });

  it('only consults the clock when a date is selected', () => {
    expect(buildMatchListApiQuery({ ...EMPTY_MATCH_LIST_STATE, status: 'disputed' })).toBe('status=disputed');
    // Without a clock the date falls back to UTC "now": the keys are there, whatever the instants.
    const withDate = new URLSearchParams(buildMatchListApiQuery({ ...EMPTY_MATCH_LIST_STATE, range: 'today' }));
    expect(withDate.get('date_field')).toBe('scheduled');
    expect(withDate.has('date_from') && withDate.has('date_to')).toBe(true);
  });
});

describe('parseMatchListBack / matchListBackHref', () => {
  it('accepts a real list query and returns it in canonical order', () => {
    expect(parseMatchListBack(`status=disputed&league=${UUID_A}&page=2`)).toBe(`status=disputed&league=${UUID_A}&page=2`);
    expect(parseMatchListBack(`page=2&league=${UUID_A}&status=disputed`)).toBe(`status=disputed&league=${UUID_A}&page=2`);
    expect(parseMatchListBack('?sort=updated_asc&preset=overdue')).toBe('preset=overdue&sort=updated_asc');
  });

  it('strips unknown keys and keeps only validated values', () => {
    expect(parseMatchListBack('status=disputed&evil=1&next=https://evil.example')).toBe('status=disputed');
    expect(parseMatchListBack('league=abc&status=disputed')).toBe('status=disputed');
    expect(parseMatchListBack('status=nope')).toBe('');
  });

  it.each([
    ['a protocol-relative URL', '//evil.example'],
    ['an absolute URL', 'https://evil.example/x'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a path', '/admin/matches?status=disputed'],
    ['a fragment-only value', '#status=disputed'],
    ['an empty value', ''],
  ])('returns "" for %s', (_label, raw) => {
    expect(parseMatchListBack(raw)).toBe('');
    expect(matchListBackHref(raw)).toBe('/admin/matches');
  });

  it('refuses an over-long value instead of truncating it', () => {
    expect(parseMatchListBack(`status=disputed&q=${'a'.repeat(1001)}`)).toBe('');
    expect(parseMatchListBack(`q=${'a'.repeat(990)}`)).toBe(`q=${'a'.repeat(100)}`);
  });

  it('takes the first value of a repeated parameter and ignores a missing one', () => {
    expect(parseMatchListBack(['status=disputed', 'status=completed'])).toBe('status=disputed');
    expect(parseMatchListBack([])).toBe('');
    expect(parseMatchListBack(null)).toBe('');
    expect(parseMatchListBack(undefined)).toBe('');
  });

  it('builds the ?back= suffix of a link between match pages from the canonical query, or nothing', () => {
    expect(matchPageBackSuffix('page=2&status=disputed')).toBe(`?back=${encodeURIComponent('status=disputed&page=2')}`);
    expect(matchPageBackSuffix('status=disputed&evil=1')).toBe(`?back=${encodeURIComponent('status=disputed')}`);
    expect(matchPageBackSuffix('//evil.example')).toBe('');
    expect(matchPageBackSuffix(undefined)).toBe('');
  });

  it('builds a same-origin /admin/matches href that cannot carry markup or a second query', () => {
    expect(matchListBackHref(`status=disputed&league=${UUID_A}&page=2`)).toBe(
      `/admin/matches?status=disputed&league=${UUID_A}&page=2`,
    );
    const href = matchListBackHref('q=<script>alert(1)</script>&x=%26y');
    expect(href.startsWith('/admin/matches?q=')).toBe(true);
    expect(href).not.toMatch(/[<>"']/);
    expect(href.split('?')).toHaveLength(2);
  });
});

describe('activeMatchListFilters / clearMatchListFilters', () => {
  const BUSY: MatchListUrlState = {
    ...EMPTY_MATCH_LIST_STATE,
    status: 'scheduled',
    league: UUID_A,
    phase: UUID_B,
    round: UUID_C,
    q: 'mara',
    preset: 'overdue',
    dateField: 'created',
    range: 'last7',
    format: 'draft',
    bracket: 'swiss',
    bestOf: 3,
    ruleset: UUID_C,
    player: UUID_A,
    player2: UUID_B,
    replay: 'has',
    edited: true,
    notes: true,
    showTest: true,
    showArchived: true,
    sort: 'updated_desc',
    page: 4,
  };

  it('lists nothing for the empty state and never lists the sort or the page', () => {
    expect(activeMatchListFilters(EMPTY_MATCH_LIST_STATE)).toEqual([]);
    expect(activeMatchListFilters({ ...EMPTY_MATCH_LIST_STATE, sort: 'status_priority', page: 7 })).toEqual([]);
    expect(activeMatchListFilters({ ...EMPTY_MATCH_LIST_STATE, q: '   ' })).toEqual([]);
  });

  it('lists every non-default filter in a fixed order', () => {
    expect(activeMatchListFilters(BUSY)).toEqual([
      'status', 'league', 'phase', 'round', 'q', 'preset', 'date', 'format', 'bracket', 'bestOf', 'ruleset', 'player',
      'player2', 'replay', 'edited', 'notes', 'showTest', 'showArchived',
    ]);
  });

  it('lists the date when only a range, only from or only to is set', () => {
    for (const patch of [{ range: 'today' as const }, { from: '2026-10-01' }, { to: '2026-10-02' }]) {
      expect(activeMatchListFilters({ ...EMPTY_MATCH_LIST_STATE, ...patch })).toEqual(['date']);
    }
    expect(activeMatchListFilters({ ...EMPTY_MATCH_LIST_STATE, noGames: true, bestOf: 1 })).toEqual(['bestOf', 'noGames']);
  });

  it('clears everything but the sort by default, and goes back to page 1', () => {
    const patch = clearMatchListFilters(BUSY);
    expect(patch.page).toBe(1);
    expect('sort' in patch).toBe(false);
    const cleared = { ...BUSY, ...patch };
    expect(cleared).toEqual({ ...EMPTY_MATCH_LIST_STATE, sort: 'updated_desc' });
    expect(activeMatchListFilters(cleared)).toEqual([]);
  });

  it('clears a league together with its phase and round', () => {
    expect(clearMatchListFilters(BUSY, ['league'])).toEqual({ page: 1, league: '', phase: '', round: '' });
  });

  it('clears a phase together with its round, but keeps the league', () => {
    expect(clearMatchListFilters(BUSY, ['phase'])).toEqual({ page: 1, phase: '', round: '' });
  });

  it('clears a round alone', () => {
    expect(clearMatchListFilters(BUSY, ['round'])).toEqual({ page: 1, round: '' });
  });

  it('clears the first player together with the head-to-head opponent, not the other way round', () => {
    expect(clearMatchListFilters(BUSY, ['player'])).toEqual({ page: 1, player: '', player2: '' });
    expect(clearMatchListFilters(BUSY, ['player2'])).toEqual({ page: 1, player2: '' });
  });

  it('clears the date together with its field, range, from and to', () => {
    expect(clearMatchListFilters(BUSY, ['date'])).toEqual({
      page: 1,
      dateField: 'scheduled',
      range: '',
      from: '',
      to: '',
    });
  });

  it('clears single flags and values', () => {
    expect(clearMatchListFilters(BUSY, ['bestOf', 'edited', 'showTest'])).toEqual({
      page: 1,
      bestOf: null,
      edited: false,
      showTest: false,
    });
  });
});
