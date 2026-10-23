import { describe, expect, it } from 'vitest';
import {
  adminMatchListQuerySchema,
  buildMatchListApiQuery,
  buildMatchListSearch,
  parseMatchListUrl,
  STANDALONE_LEAGUE,
} from '../match-list';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

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

describe('match list URL state', () => {
  it('parses a deep link and drops bad values instead of failing', () => {
    const ok = parseMatchListUrl(new URLSearchParams(`league=${UUID_A}&phase=${UUID_B}&status=disputed&q=mara&page=3`));
    expect(ok).toEqual({ status: 'disputed', league: UUID_A, phase: UUID_B, q: 'mara', page: 3 });

    const bad = parseMatchListUrl(new URLSearchParams('league=x&phase=y&status=z&page=-4'));
    expect(bad).toEqual({ status: '', league: '', phase: '', q: '', page: 1 });

    expect(parseMatchListUrl(new URLSearchParams(`league=${STANDALONE_LEAGUE}`)).league).toBe(STANDALONE_LEAGUE);
  });

  it('round-trips through buildMatchListSearch and omits defaults', () => {
    const state = { status: 'disputed' as const, league: UUID_A, phase: UUID_B, q: 'mara', page: 2 };
    expect(parseMatchListUrl(new URLSearchParams(buildMatchListSearch(state)))).toEqual(state);
    expect(buildMatchListSearch({ status: '', league: '', phase: '', q: '  ', page: 1 })).toBe('');
  });

  it('maps the state onto the API query: phase wins over league, standalone has its own flag', () => {
    const base = { status: '' as const, q: '', page: 1 };
    expect(buildMatchListApiQuery({ ...base, league: UUID_A, phase: '' })).toBe(`season_id=${UUID_A}`);
    expect(buildMatchListApiQuery({ ...base, league: UUID_A, phase: UUID_B })).toBe(`tournament_id=${UUID_B}`);
    expect(buildMatchListApiQuery({ ...base, league: STANDALONE_LEAGUE, phase: '' })).toBe('standalone=true');
    expect(buildMatchListApiQuery({ status: 'disputed', league: '', phase: '', q: ' mara ', page: 2 })).toBe(
      'status=disputed&q=mara&page=2',
    );
  });
});
