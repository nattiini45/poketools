import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode: number, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }
  return { requireAnyAdmin: vi.fn(), AuthError };
});

// Real scope predicates, mocked scope read.
vi.mock('@/lib/auth/admin-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/admin-scope')>()),
  getAdminScope: vi.fn(),
}));

// Real response builder, mocked limiter.
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByIds: vi.fn(),
  getMatchById: vi.fn(),
  updateMatchStatus: vi.fn(),
  setMatchScheduledAtIfOpen: vi.fn(),
  updateMatchNotesIfUnchanged: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/match-proposals', () => ({ cancelPendingMatchProposalsForMatch: vi.fn() }));
vi.mock('@/lib/match/finalize', () => ({ finalizeMatchCompletion: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ revalidateMatchPages: vi.fn() }));

// The real processor, wrapped so a test can see (or replace) the call.
vi.mock('@/lib/match/bulk-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/match/bulk-actions')>();
  return { ...actual, runBulkAction: vi.fn(actual.runBulkAction) };
});

import { POST } from '@/app/api/admin/matches/batch/route';
import { requireAnyAdmin, AuthError } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import type { AdminScope } from '@/lib/auth/admin-scope';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import {
  getMatchesByIds,
  setMatchScheduledAtIfOpen,
  updateMatchNotesIfUnchanged,
  updateMatchStatus,
} from '@/lib/supabase/queries/matches';
import { cancelPendingMatchProposalsForMatch } from '@/lib/supabase/queries/match-proposals';
import { finalizeMatchCompletion } from '@/lib/match/finalize';
import { runBulkAction } from '@/lib/match/bulk-actions';
import type { MatchWithPlayers } from '@/types/match';

const PLAYER = { playerId: 'p-admin', isAdmin: true, isResourceAdmin: false, name: 'Admin Anna' };
const PHASE_A = '22222222-2222-4222-8222-222222222222';
const PHASE_B = '33333333-3333-4333-8333-333333333333';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const SITE_SCOPE: AdminScope = { playerId: 'p-admin', isSiteAdmin: true, seasonIds: null, tournamentIds: null };
/** A league admin whose league has the phase A only. */
const LEAGUE_ADMIN_SCOPE: AdminScope = {
  playerId: 'p-res',
  isSiteAdmin: false,
  seasonIds: ['11111111-1111-4111-8111-111111111111'],
  tournamentIds: [PHASE_A],
};

/** `00000000-0000-4000-8000-00000000000n` */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = (count: number, from = 1) => Array.from({ length: count }, (_, i) => uuid(from + i));

function match(id: string, overrides: Partial<MatchWithPlayers> = {}): MatchWithPlayers {
  return {
    id,
    round_id: 'round-1',
    tournament_id: PHASE_A,
    player_1_id: P1,
    player_2_id: P2,
    winner_id: P1,
    status: 'pending_confirmation',
    submitter_id: P1,
    date_played: null,
    scheduled_at: null,
    auto_confirm_at: null,
    confirmed_at: null,
    notes: '',
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-24T10:00:00.000000+00:00',
    player_1_name: 'Mara',
    player_2_name: 'Nora',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: 'Mara',
    round_status: 'active',
    games: [],
    ...overrides,
  } as MatchWithPlayers;
}

function req(body: unknown): NextRequest & { json: ReturnType<typeof vi.fn> } {
  return {
    url: 'http://localhost:3000/api/admin/matches/batch',
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest & { json: ReturnType<typeof vi.fn> };
}

/** A confirm as the dialog sends it: the previewed winner (player 1 unless given) and status of every match. */
const confirmBody = (matchIds: string[], winner = P1) => ({
  action: 'confirm',
  match_ids: matchIds,
  params: {
    expected: matchIds.map((id) => ({ match_id: id, winner_id: winner, status: 'pending_confirmation' })),
  },
});
const noteBody = (matchIds: string[], note = 'Check the replay') => ({
  action: 'note',
  match_ids: matchIds,
  params: { note },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(PLAYER as never);
  vi.mocked(getAdminScope).mockResolvedValue(SITE_SCOPE);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 29, retryAfterSeconds: 0 });
  vi.mocked(getMatchesByIds).mockImplementation(async (matchIds: string[]) => matchIds.map((id) => match(id)));
  vi.mocked(updateMatchStatus).mockResolvedValue({} as never);
  vi.mocked(finalizeMatchCompletion).mockResolvedValue({ finalized: true, failed_steps: [], complete: true });
  vi.mocked(updateMatchNotesIfUnchanged).mockResolvedValue({} as never);
  vi.mocked(setMatchScheduledAtIfOpen).mockResolvedValue({} as never);
  vi.mocked(cancelPendingMatchProposalsForMatch).mockResolvedValue([]);
});

describe('POST /api/admin/matches/batch: guard and rate limit', () => {
  it('uses the any-admin guard and reads the scope of the live player', async () => {
    await POST(req(confirmBody(ids(1))));
    expect(requireAnyAdmin).toHaveBeenCalledTimes(1);
    expect(getAdminScope).toHaveBeenCalledWith(PLAYER);
  });

  it('returns the guard error before the body is read', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    const request = req(confirmBody(ids(1)));
    const res = await POST(request);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });
    expect(request.json).not.toHaveBeenCalled();
    expect(getAdminScope).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(getMatchesByIds).not.toHaveBeenCalled();
  });

  it('rate limits per player in its own bucket, never in the confirm-match bucket', async () => {
    await POST(req(confirmBody(ids(1))));
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith('admin-match-batch', 'p-admin', { limit: 30, windowSeconds: 3600 });
    expect(vi.mocked(checkRateLimit).mock.calls.some(([bucket]) => bucket === 'confirm-match')).toBe(false);
  });

  it('answers 429 with Retry-After, and reads no match, when the limit is reached', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 1234 });
    const request = req(confirmBody(ids(1)));
    const res = await POST(request);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('1234');
    expect(await res.json()).toMatchObject({ success: false, code: 'rate_limited', params: { seconds: 1234 } });
    expect(request.json).not.toHaveBeenCalled();
    expect(getMatchesByIds).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/matches/batch: validation', () => {
  it.each([
    ['no ids', confirmBody([])],
    ['101 ids', confirmBody(ids(101))],
    ['a duplicate id', confirmBody([uuid(1), uuid(2), uuid(1)])],
    ['a duplicate id that differs by case', confirmBody(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'])],
    ['a non-uuid id', confirmBody(['not-a-uuid'])],
    ['an unknown action', { action: 'delete', match_ids: ids(1) }],
    ['no action', { match_ids: ids(1) }],
    ['an extra top-level key', { ...confirmBody(ids(1)), force: true }],
    ['an extra param on confirm', { ...confirmBody(ids(1)), params: { winner_id: P2 } }],
    ['a naive scheduled time', { action: 'schedule', match_ids: ids(1), params: { scheduled_at: '2026-11-02T18:30:00' } }],
    ['a schedule without a time', { action: 'schedule', match_ids: ids(1) }],
    ['an empty note', noteBody(ids(1), '   ')],
    ['a note over 2000 characters', noteBody(ids(1), 'x'.repeat(2001))],
    ['an array body', []],
    ['a null body', null],
  ])('400s %s with the shared validation code, before reading any match', async (_label, body) => {
    const res = await POST(req(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toMatchObject({ success: false, code: 'validation_failed' });
    expect(typeof json.error).toBe('string');
    expect(json.params.issues).toBe(json.error);
    expect(getMatchesByIds).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('400s a body that is not JSON', async () => {
    const request = req(null);
    request.json.mockRejectedValue(new SyntaxError('Unexpected token'));
    const res = await POST(request);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(getMatchesByIds).not.toHaveBeenCalled();
  });

  it('accepts exactly 100 ids', async () => {
    const res = await POST(req(confirmBody(ids(100))));
    expect(res.status).toBe(200);
    expect(getMatchesByIds).toHaveBeenCalledWith(ids(100));
  });
});

describe('POST /api/admin/matches/batch: scope', () => {
  it('lets a site admin act on any tournament', async () => {
    vi.mocked(getMatchesByIds).mockResolvedValue([match(uuid(1), { tournament_id: PHASE_B })]);
    const res = await POST(req(confirmBody([uuid(1)])));
    expect(res.status).toBe(200);
    expect(updateMatchStatus).toHaveBeenCalledTimes(1);
  });

  it('lets a league admin act on matches of their own phases', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(LEAGUE_ADMIN_SCOPE);
    const res = await POST(req(confirmBody(ids(3))));
    expect(res.status).toBe(200);
    expect(updateMatchStatus).toHaveBeenCalledTimes(3);
  });

  it('refuses the whole request, writing and auditing nothing, when one of ten matches is out of scope', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(LEAGUE_ADMIN_SCOPE);
    vi.mocked(getMatchesByIds).mockImplementation(async (matchIds: string[]) =>
      matchIds.map((id, i) => match(id, { tournament_id: i === 6 ? PHASE_B : PHASE_A }))
    );

    const res = await POST(req(confirmBody(ids(10))));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Admin access required for this resource', code: 'forbidden' });
    // No per-id detail anywhere in the body.
    expect(JSON.stringify(body)).not.toContain(uuid(7));
    expect(runBulkAction).not.toHaveBeenCalled();
    expect(updateMatchStatus).not.toHaveBeenCalled();
    expect(finalizeMatchCompletion).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses a resource admin with no tournaments at all', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({ ...LEAGUE_ADMIN_SCOPE, seasonIds: [], tournamentIds: [] });
    const res = await POST(req(confirmBody(ids(1))));
    expect(res.status).toBe(403);
    expect(updateMatchStatus).not.toHaveBeenCalled();
  });

  it('turns an id that does not exist into a per-item not-found while the others still run', async () => {
    vi.mocked(getMatchesByIds).mockResolvedValue([match(uuid(1)), match(uuid(3))]);
    const res = await POST(req(confirmBody([uuid(1), uuid(2), uuid(3)])));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.results).toEqual([
      { id: uuid(1), ok: true, code: 'ok' },
      { id: uuid(2), ok: false, code: 'match_not_found' },
      { id: uuid(3), ok: true, code: 'ok' },
    ]);
    expect(body.data.summary).toEqual({ requested: 3, changed: 2, skipped: 0, conflicts: 0, failed: 1 });
  });
});

describe('POST /api/admin/matches/batch: response', () => {
  it('answers 200 with the action, results in request order and a summary', async () => {
    const order = [uuid(3), uuid(1), uuid(2)];
    vi.mocked(getMatchesByIds).mockResolvedValue([
      match(uuid(1)),
      match(uuid(2), { status: 'scheduled', winner_id: null }),
      match(uuid(3)),
    ]);
    vi.mocked(updateMatchStatus).mockResolvedValueOnce({} as never).mockResolvedValueOnce(null);

    const res = await POST(req(confirmBody(order)));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.action).toBe('confirm');
    expect(body.data.results).toEqual([
      { id: uuid(3), ok: true, code: 'ok' },
      { id: uuid(1), ok: false, code: 'match_bulk_conflict' },
      { id: uuid(2), ok: false, code: 'match_bulk_not_pending' },
    ]);
    expect(body.data.summary).toEqual({ requested: 3, changed: 1, skipped: 1, conflicts: 1, failed: 0 });
  });

  it('refuses a match whose reported winner changed after the preview, and writes nothing for it', async () => {
    vi.mocked(getMatchesByIds).mockResolvedValue([match(uuid(1)), match(uuid(2), { winner_id: P2, winner_name: 'Nora' })]);

    const res = await POST(req(confirmBody([uuid(1), uuid(2)], P1)));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.results).toEqual([
      { id: uuid(1), ok: true, code: 'ok' },
      { id: uuid(2), ok: false, code: 'match_bulk_conflict' },
    ]);
    expect(body.data.summary).toEqual({ requested: 2, changed: 1, skipped: 0, conflicts: 1, failed: 0 });
    expect(updateMatchStatus).toHaveBeenCalledTimes(1);
    expect(updateMatchStatus).toHaveBeenCalledWith(uuid(1), 'completed', P1, 'p-admin', undefined, 'pending_confirmation');
  });

  it('rejects a confirm without the previewed winners as a 400', async () => {
    const res = await POST(req({ action: 'confirm', match_ids: ids(1) }));
    expect(res.status).toBe(400);
    expect(updateMatchStatus).not.toHaveBeenCalled();
  });

  it('reports a confirmed match with a failing finalize as done with a warning, and audits it', async () => {
    vi.mocked(finalizeMatchCompletion).mockRejectedValue(new Error('rating service down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(req(confirmBody(ids(1))));
    const body = await res.json();
    spy.mockRestore();

    expect(body.data.results).toEqual([
      { id: uuid(1), ok: true, code: 'match_finalize_incomplete', params: { count: 1 } },
    ]);
    expect(body.data.summary).toEqual({ requested: 1, changed: 1, skipped: 0, conflicts: 0, failed: 0 });
    const events = vi.mocked(logAuditEvent).mock.calls.map(([entry]) => entry);
    expect(events.map((e) => e.action)).toEqual(['match.bulk_confirm', 'match.bulk_action']);
    expect(JSON.stringify(body)).not.toContain('rating service down');
  });

  it('answers 200 even when every item failed, because the request itself was processed', async () => {
    vi.mocked(getMatchesByIds).mockResolvedValue([]);
    const res = await POST(req(confirmBody(ids(2))));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.summary).toEqual({ requested: 2, changed: 0, skipped: 0, conflicts: 0, failed: 2 });
  });

  it('passes the actor and a fresh batch id to the processor', async () => {
    await POST(req(confirmBody(ids(1))));
    await POST(req(confirmBody(ids(1))));
    const calls = vi.mocked(runBulkAction).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2].actor).toEqual({ playerId: 'p-admin', name: 'Admin Anna' });
    expect(calls[0][2].batchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0][2].batchId).not.toBe(calls[1][2].batchId);
  });

  it('answers 500 with the fixed message, not the internal one, on an unexpected error', async () => {
    vi.mocked(getMatchesByIds).mockRejectedValue(new Error('relation "matches" does not exist'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(req(confirmBody(ids(1))));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Failed to run the bulk action' });
    expect(JSON.stringify(body)).not.toContain('relation');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('answers 500 when the processor itself throws', async () => {
    vi.mocked(runBulkAction).mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(req(confirmBody(ids(1))));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to run the bulk action');
    spy.mockRestore();
  });
});

describe('POST /api/admin/matches/batch: audit', () => {
  it('writes one event per changed match plus one summary, none for failed, skipped or conflicting items', async () => {
    // 3 changed, 1 skipped (scheduled), 1 conflict (update lost the race), 1 missing.
    const found = [
      match(uuid(1)),
      match(uuid(2)),
      match(uuid(3)),
      match(uuid(4), { status: 'scheduled', winner_id: null }),
      match(uuid(5)),
    ];
    vi.mocked(getMatchesByIds).mockResolvedValue(found);
    vi.mocked(updateMatchStatus).mockImplementation(async (id: string) => (id === uuid(5) ? null : ({} as never)));

    await POST(req(confirmBody(ids(6))));

    const events = vi.mocked(logAuditEvent).mock.calls.map(([entry]) => entry);
    expect(events).toHaveLength(3 + 1);

    const perMatch = events.filter((e) => e.action === 'match.bulk_confirm');
    expect(perMatch.map((e) => e.resource_id)).toEqual([uuid(1), uuid(2), uuid(3)]);
    for (const event of perMatch) {
      expect(event).toMatchObject({
        actor_id: 'p-admin',
        actor_name: 'Admin Anna',
        resource_type: 'match',
        resource_name: 'Mara vs Nora',
      });
    }

    const summaries = events.filter((e) => e.action === 'match.bulk_action');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      actor_id: 'p-admin',
      resource_type: 'match_batch',
      resource_id: null,
      metadata: {
        action: 'confirm',
        requested: 6,
        changed: 3,
        skipped: 1,
        conflicts: 1,
        failed: 1,
        match_ids: ids(6),
      },
    });

    // One batch id ties every event together.
    const batchIds = new Set(events.map((e) => (e.metadata as { batch_id: string }).batch_id));
    expect(batchIds.size).toBe(1);
    expect([...batchIds][0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('writes only the summary when nothing changed', async () => {
    vi.mocked(getMatchesByIds).mockResolvedValue([match(uuid(1), { status: 'scheduled', winner_id: null })]);
    await POST(req(confirmBody([uuid(1)])));
    const events = vi.mocked(logAuditEvent).mock.calls.map(([entry]) => entry);
    expect(events.map((e) => e.action)).toEqual(['match.bulk_action']);
  });

  it('puts the note text in the per-match event only as the appended line, never the full notes', async () => {
    vi.mocked(getMatchesByIds).mockResolvedValue([match(uuid(1), { notes: 'private earlier text' })]);

    const res = await POST(req(noteBody([uuid(1)], 'Check the replay')));
    expect(res.status).toBe(200);

    const events = vi.mocked(logAuditEvent).mock.calls.map(([entry]) => entry);
    const noteEvent = events.find((e) => e.action === 'match.bulk_note');
    expect(noteEvent?.metadata).toMatchObject({ note_line: expect.stringMatching(/^\[.+ UTC, Admin Anna\] Check the replay$/) });
    expect(noteEvent?.changes).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain('private earlier text');
    // The summary does not carry the text either.
    const summary = events.find((e) => e.action === 'match.bulk_action');
    expect(JSON.stringify(summary)).not.toContain('Check the replay');
    expect(updateMatchNotesIfUnchanged).toHaveBeenCalledWith(
      uuid(1),
      '2026-10-24T10:00:00.000000+00:00',
      expect.stringContaining('private earlier text\n[')
    );
  });

  it('audits a schedule with the before and after time', async () => {
    vi.mocked(getMatchesByIds).mockResolvedValue([match(uuid(1), { status: 'scheduled', scheduled_at: null })]);
    await POST(req({ action: 'schedule', match_ids: [uuid(1)], params: { scheduled_at: '2026-11-02T18:30:00+01:00' } }));

    expect(setMatchScheduledAtIfOpen).toHaveBeenCalledWith(uuid(1), '2026-11-02T18:30:00+01:00');
    const event = vi.mocked(logAuditEvent).mock.calls.map(([entry]) => entry).find((e) => e.action === 'match.bulk_schedule');
    expect(event?.changes).toEqual({ scheduled_at: { before: null, after: '2026-11-02T18:30:00+01:00' } });
  });
});
