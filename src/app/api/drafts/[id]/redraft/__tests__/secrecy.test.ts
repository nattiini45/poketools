/**
 * Redraft secrecy — no-leak tests (draft-backend §14.1 "No-leak tests"; B-RED).
 *
 * Before publish only the owner and the pool admins may read a submission.
 * The submission reads run the REAL `drafts-redraft.ts` over a fake Supabase
 * client that applies the `.eq` / `.in` filters to in-memory rows holding BOTH
 * players' secret lists, so a missing player filter would leak A's lines into
 * B's response. Every response shape is checked for A's line and tracker ids.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';

type Row = Record<string, unknown>;
interface Call {
  table: string;
  filters: [string, string, unknown][];
}

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as { table: string; filters: [string, string, unknown][] }[],
}));

vi.mock('@/lib/supabase/client', () => {
  function builder(table: string) {
    const call: Call = { table, filters: [] };
    db.calls.push(call);
    let columns: string[] | null = null;
    const rows = (): Row[] =>
      (db.tables[table] ?? [])
        .filter((r) =>
          call.filters.every(([op, col, value]) =>
            op === 'eq' ? r[col] === value : Array.isArray(value) && value.includes(r[col]),
          ),
        )
        .map((r) => (columns ? Object.fromEntries(columns.map((c) => [c, r[c]])) : { ...r }));
    const chain: Record<string, unknown> = {
      select: (cols: string) => {
        columns = cols === '*' ? null : cols.split(',').map((c) => c.trim());
        return chain;
      },
      eq: (col: string, value: unknown) => {
        call.filters.push(['eq', col, value]);
        return chain;
      },
      in: (col: string, value: unknown) => {
        call.filters.push(['in', col, value]);
        return chain;
      },
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows(), error: null }),
    };
    return chain;
  }
  return { supabase: { from: (table: string) => builder(table), rpc: vi.fn() } };
});

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireDraftAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn() }));
vi.mock('@/lib/supabase/queries/evolutions', () => ({ getPlayerTrackers: vi.fn() }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(), getSeasonParticipants: vi.fn() }));
vi.mock('@/lib/draft/progress-engine', () => ({ computeRemainingPoints: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireDraftReads: vi.fn() }));
vi.mock('@/lib/draft/notify', () => ({ dispatchDraftNotifications: vi.fn() }));
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: vi.fn() };
});
vi.mock('@/lib/draft/rpc-errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/draft/rpc-errors')>('@/lib/draft/rpc-errors');
  return { ...actual, callDraftRpc: vi.fn() };
});

import { GET as getSubmission, PUT as putSubmission } from '@/app/api/drafts/[id]/redraft/submission/route';
import { GET as getSubmissions } from '@/app/api/drafts/[id]/redraft/submissions/route';
import { POST as publish } from '@/app/api/drafts/[id]/redraft/publish/route';
import { GET as getAudit } from '@/app/api/drafts/[id]/audit/route';
import { requireDraftAdmin, requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { getPlayerTrackers } from '@/lib/supabase/queries/evolutions';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { computeRemainingPoints } from '@/lib/draft/progress-engine';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { DraftRuleError } from '@/lib/draft/errors';
import { toDraftSnapshotDTO } from '@/lib/draft/snapshot';

const POOL = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** A's secret drops: none of these may reach anyone but A or an admin before publish. */
const A_LINES = ['alphaline--alphafinal', 'betaline--betafinal'];
const A_TRACKERS = ['trk-a-alpha', 'trk-a-beta'];
const B_LINE = 'gammaline--gammafinal';

const ctx = { params: Promise.resolve({ id: POOL }) };
const req = (path: string, init?: { method: string; body?: unknown }) =>
  new NextRequest(`http://localhost/api/drafts/${POOL}/redraft${path}`, {
    method: init?.method ?? 'GET',
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

const forbidden = () =>
  new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required for this draft', 403);

/** Neither A's line ids nor A's tracker ids appear anywhere in `body`. */
function expectNoSecretOfA(body: unknown): void {
  const json = JSON.stringify(body);
  for (const secret of [...A_LINES, ...A_TRACKERS]) expect(json, `leaked ${secret}`).not.toContain(secret);
}

const submissionReads = () => db.calls.filter((c) => c.table === 'redraft_submissions');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  db.calls = [];
  db.tables = {
    redraft_submissions: [
      { draft_pool_id: POOL, player_id: A, tracker_id: A_TRACKERS[0], line_id: A_LINES[0], updated_at: '2026-10-12T10:00:00Z' },
      { draft_pool_id: POOL, player_id: A, tracker_id: A_TRACKERS[1], line_id: A_LINES[1], updated_at: '2026-10-12T10:00:00Z' },
      { draft_pool_id: POOL, player_id: B, tracker_id: 'trk-b-gamma', line_id: B_LINE, updated_at: '2026-10-13T09:00:00Z' },
    ],
    draft_participants: [
      { draft_pool_id: POOL, player_id: A },
      { draft_pool_id: POOL, player_id: B },
    ],
    players: [
      { ...fullPlayerRow({ id: A, name: 'Ash' }) } as unknown as Row,
      { ...fullPlayerRow({ id: B, name: 'Brock' }) } as unknown as Row,
    ],
    draft_action_log: [
      { id: 1, draft_pool_id: POOL, action: 'submission_changed', player_id: A, after: { line_ids: A_LINES }, is_public: false },
    ],
  };
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: B, isAdmin: false } as never);
  vi.mocked(requireDraftAdmin).mockRejectedValue(forbidden());
  vi.mocked(getDraftPoolById).mockResolvedValue({
    id: POOL, season_id: 'season-1', engine: 'queue', kind: 'redraft', phase: 'submissions',
    list_version_id: 'list-1', redraft_max_lines: 3, submission_deadline_at: '2099-01-01T00:00:00Z',
  } as never);
  vi.mocked(getPlayerTrackers).mockImplementation(async (_season, playerId) =>
    (playerId === A
      ? [
          { id: A_TRACKERS[0], player_id: A, line_id: A_LINES[0], real_kills: 4 },
          { id: A_TRACKERS[1], player_id: A, line_id: A_LINES[1], real_kills: 1 },
        ]
      : [{ id: 'trk-b-gamma', player_id: B, line_id: B_LINE, real_kills: 2 }]) as never,
  );
  vi.mocked(getListEntries).mockResolvedValue([
    { line_id: A_LINES[0], price: 20, special_rules: null },
    { line_id: A_LINES[1], price: 11, special_rules: null },
    { line_id: B_LINE, price: 14, special_rules: null },
  ] as never);
  vi.mocked(getFormatRules).mockResolvedValue({ draft_budget: 180, draft_token_ratio: 3 } as never);
  vi.mocked(computeRemainingPoints).mockResolvedValue(5);
});

describe('(1) GET submission: a player reads only their own list', () => {
  it('player B gets only B\'s lines; every read is filtered by B\'s id', async () => {
    const res = await getSubmission(req('/submission'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.line_ids).toEqual([B_LINE]);
    expect(body.data.own_lines.map((l: { line_id: string }) => l.line_id)).toEqual([B_LINE]);
    expectNoSecretOfA(body);

    expect(submissionReads()).toHaveLength(1);
    expect(submissionReads()[0].filters).toContainEqual(['eq', 'player_id', B]);
    expect(getPlayerTrackers).toHaveBeenCalledWith('season-1', B);
    expect(getPlayerTrackers).not.toHaveBeenCalledWith('season-1', A);
    expect(computeRemainingPoints).toHaveBeenCalledWith('season-1', B, 180, 3);
  });

  it('?player_id=A as a non-admin → 403 before any submission read, nothing of A in the body', async () => {
    const res = await getSubmission(req(`/submission?player_id=${A}`), ctx);
    expect(res.status).toBe(403);
    expectNoSecretOfA(await res.json());
    expect(requireDraftAdmin).toHaveBeenCalledWith(POOL);
    expect(submissionReads()).toHaveLength(0);
    expect(getPlayerTrackers).not.toHaveBeenCalled();
  });

  it('?player_id=<own id> needs no admin guard', async () => {
    const res = await getSubmission(req(`/submission?player_id=${B}`), ctx);
    expect(res.status).toBe(200);
    expect(requireDraftAdmin).not.toHaveBeenCalled();
    expectNoSecretOfA(await res.json());
  });

  it('a pool admin may read A\'s list with ?player_id=A', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: ADMIN, isAdmin: true } as never);
    vi.mocked(requireDraftAdmin).mockResolvedValue({ playerId: ADMIN, isAdmin: true } as never);
    const res = await getSubmission(req(`/submission?player_id=${A}`), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data.line_ids).toEqual([...A_LINES].sort());
    expect(submissionReads()[0].filters).toContainEqual(['eq', 'player_id', A]);
  });

  it('a non-participant gets NOT_PARTICIPANT and no submission read', async () => {
    db.tables.draft_participants = [{ draft_pool_id: POOL, player_id: A }];
    const res = await getSubmission(req('/submission'), ctx);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('NOT_PARTICIPANT');
    expectNoSecretOfA(body);
    expect(submissionReads()).toHaveLength(0);
  });
});

describe('(1) PUT submission: own list only, own data back', () => {
  it('saves B\'s list as B (player = actor) and answers with B\'s data only', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({ line_ids: [B_LINE], updated_at: '2026-10-13T09:30:00Z' });
    const res = await putSubmission(req('/submission', { method: 'PUT', body: { line_ids: [B_LINE] } }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.line_ids).toEqual([B_LINE]);
    expectNoSecretOfA(body);
    expect(callDraftRpc).toHaveBeenCalledWith('redraft_set_submission', {
      p_pool_id: POOL, p_player_id: B, p_actor_id: B, p_actor_role: 'player', p_line_ids: [B_LINE],
    });
  });

  it('cannot target another player: a player_id in the body is a 400 (strict body)', async () => {
    const res = await putSubmission(
      req('/submission', { method: 'PUT', body: { line_ids: [], player_id: A } }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('a refused line (A\'s line in B\'s request) answers the code without any of A\'s data', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError('TRACKER_NOT_OWNED', undefined, { line_id: A_LINES[0] }));
    const res = await putSubmission(req('/submission', { method: 'PUT', body: { line_ids: [A_LINES[0]] } }), ctx);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('TRACKER_NOT_OWNED');
    // Only the line B named comes back (as machine detail); no tracker id, no other line of A.
    expect(JSON.stringify(body)).not.toContain(A_LINES[1]);
    expect(JSON.stringify(body)).not.toContain('trk-a');
  });
});

describe('(2) the public snapshot never carries submissions', () => {
  const rawSnapshot = (redraft: Row, extra: Row = {}): Row => ({
    state_version: 4,
    server_now: '2026-10-13T10:00:00Z',
    pool: {
      id: POOL, season_id: 'season-1', kind: 'redraft', mode: 'slow', status: 'pending', paused: false, paused_at: null,
      roster_size: 9, budget: 0, started_at: null, ended_at: null, phase: 'submissions', pause_reason: null,
      list_version_id: 'list-1',
    },
    config: { pick_seconds: 43200, makeup_seconds: 150, slow_ladder_seconds: [43200], extension_seconds: null, redraft_max_lines: 3 },
    participants: [
      { player_id: A, name: 'Ash', avatar_url: null, seat: 1, standing_rank: 2, slots_total: 0, picks_made: 0, open_slots: 0,
        budget_start: 0, budget_remaining: 0, penalty_stage: 0, timeout_count: 0,
        extensions: { plus120_used: false, plus60_used: false }, done: false },
      { player_id: B, name: 'Brock', avatar_url: null, seat: 2, standing_rank: 1, slots_total: 0, picks_made: 0, open_slots: 0,
        budget_start: 0, budget_remaining: 0, penalty_stage: 0, timeout_count: 0,
        extensions: { plus120_used: false, plus60_used: false }, done: false },
    ],
    active_slot: null,
    upcoming: [],
    picks: [],
    taken: {},
    prices: { [A_LINES[0]]: 20, [A_LINES[1]]: 11, [B_LINE]: 14 },
    restrictions: [],
    no_redraft_line_ids: [],
    redraft,
    recent_events: [],
    ...extra,
  });

  it('a raw payload that (wrongly) holds submissions, redraft_submissions and pre-publish drops leaks none of them', () => {
    const leaky = rawSnapshot(
      {
        phase: 'submissions', deadline_at: '2026-10-18T21:59:59Z', published_at: null,
        drops: A_LINES.map((line_id) => ({ player_id: A, line_id, transferred_real_kills: 3 })),
        submissions: [{ player_id: A, line_ids: A_LINES, tracker_ids: A_TRACKERS }],
        redraft_submissions: A_LINES.map((line_id, i) => ({ player_id: A, line_id, tracker_id: A_TRACKERS[i] })),
        all_slots: [{ redraft_slot_id: 'rs-a', player_id: A, label: 'A', dropped_line_id: A_LINES[0], transferred_real_kills: 3, filled_by_pick_id: null }],
      },
      {
        submissions: [{ player_id: A, line_ids: A_LINES }],
        redraft_submissions: A_LINES.map((line_id, i) => ({ player_id: A, line_id, tracker_id: A_TRACKERS[i] })),
      },
    );
    for (const viewer of [{ playerId: B, isPoolAdmin: false }, null]) {
      const dto = toDraftSnapshotDTO(leaky, viewer);
      expect(dto.redraft?.drops).toBeNull();
      expect(dto.redraft?.viewer_slots).toEqual([]);
      const json = JSON.stringify(dto);
      for (const tracker of A_TRACKERS) expect(json).not.toContain(tracker);
      expect(json).not.toContain('"submissions":');
      expect(json).not.toContain('"redraft_submissions":');
      expect(json).not.toContain('"line_ids"');
      expect(json).not.toContain('rs-a');
      // A's line ids may only appear as public catalog keys (prices → line_status), never tied to A's submission.
      expect(JSON.stringify(dto.redraft)).not.toMatch(/alphaline|betaline/);
    }
  });

  it('(5) recent_events drops submission_changed and submissions_frozen rows', () => {
    const dto = toDraftSnapshotDTO(
      rawSnapshot(
        { phase: 'submissions', deadline_at: '2026-10-18T21:59:59Z', published_at: null, drops: null, all_slots: [] },
        {
          recent_events: [
            { at: '2026-10-13T09:00:00Z', action: 'submission_changed', actor_role: 'player', player_id: A, line_id: A_LINES[0], slot_id: null },
            { at: '2026-10-13T09:01:00Z', action: 'submissions_frozen', actor_role: 'system', player_id: null, line_id: null, slot_id: null },
            { at: '2026-10-13T09:02:00Z', action: 'draft_configured', actor_role: 'admin', player_id: null, line_id: null, slot_id: null },
          ],
        },
      ),
      { playerId: B, isPoolAdmin: false },
    );
    expect(dto.recent_events.map((e) => e.action)).toEqual(['draft_configured']);
    expectNoSecretOfA(dto.recent_events);
  });
});

describe('(3) GET submissions (all players) requires the pool admin', () => {
  it('403 for a player, before any submission read', async () => {
    const res = await getSubmissions(req('/submissions'), ctx);
    expect(res.status).toBe(403);
    expectNoSecretOfA(await res.json());
    expect(submissionReads()).toHaveLength(0);
  });

  it('the admin gets every list with public player names only', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue({ playerId: ADMIN, isAdmin: true } as never);
    const res = await getSubmissions(req('/submissions'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      { player_id: A, player_name: 'Ash', line_ids: [...A_LINES].sort(), updated_at: '2026-10-12T10:00:00Z' },
      { player_id: B, player_name: 'Brock', line_ids: [B_LINE], updated_at: '2026-10-13T09:00:00Z' },
    ]);
    expectNoPrivatePlayerData(body);
    expect(db.calls.find((c) => c.table === 'players')).toBeDefined();
  });
});

describe('(4) the audit trail (holds submission_changed rows) is admin-only', () => {
  it('403 for a player, before the log is read', async () => {
    const res = await getAudit(new NextRequest(`http://localhost/api/drafts/${POOL}/audit`), ctx);
    expect(res.status).toBe(403);
    expectNoSecretOfA(await res.json());
    expect(db.calls.some((c) => c.table === 'draft_action_log')).toBe(false);
  });
});

describe('publish response shape', () => {
  it('answers only { state_version, drops } (a count), never the drop list', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue({ playerId: ADMIN, isAdmin: true } as never);
    vi.mocked(callDraftRpc).mockResolvedValue({
      state_version: 9, drops: 3, published: true, active_slot_id: 'slot-1',
      drop_list: A_LINES.map((line_id) => ({ player_id: A, line_id })),
    });
    const res = await publish(req('/publish', { method: 'POST', body: {} }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { state_version: 9, drops: 3 } });
    expectNoSecretOfA(body);
  });

  it('a non-admin cannot publish', async () => {
    const res = await publish(req('/publish', { method: 'POST', body: {} }), ctx);
    expect(res.status).toBe(403);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });
});
