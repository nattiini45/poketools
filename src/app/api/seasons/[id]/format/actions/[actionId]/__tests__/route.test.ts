import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/season-member', () => ({ requireSeasonMember: vi.fn(), assertSeasonOpenForPlay: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/actions-server', () => ({ saveAction: vi.fn(), submitAction: vi.fn() }));

import { logAuditEvent } from '@/lib/audit/log';
import { assertSeasonOpenForPlay, requireSeasonMember } from '@/lib/auth/season-member';
import { saveAction } from '@/lib/format-engine/runtime/actions-server';
import { refuse } from '@/lib/format-engine/runtime/refusal';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { FormatRuntimeError } from '@/lib/supabase/queries/format-runtime';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import { PUT } from '../route';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VIEWER = '11111111-1111-4111-8111-111111111111';
const HIDDEN_TARGET = '77777777-7777-4777-8777-777777777777';

class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
  ) {
    super(message);
  }
}

const player: SessionPlayer = {
  playerId: VIEWER,
  name: 'Mara',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
};

/** A full stored submission row, with the columns that must never reach the browser. */
const row = (over: Record<string, unknown> = {}) =>
  ({
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    season_id: SEASON_ID,
    action_key: 'choose_gift',
    actor_id: VIEWER,
    target_player_id: HIDDEN_TARGET,
    status: 'draft',
    picks: [{ step: 0, item_id: 'pikachu' }],
    submitted_at: null,
    updated_at: '2026-11-05T10:00:00.000Z',
    ...over,
  }) as never;

const PICKS = { picks: [{ step: 0, item_id: 'pikachu' }] };
const params = (actionId = 'choose_gift') => ({ params: Promise.resolve({ id: SEASON_ID.toUpperCase(), actionId }) });
const put = (body: unknown, raw?: string) =>
  new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format/actions/choose_gift`, {
    method: 'PUT',
    body: raw ?? JSON.stringify(body),
  });
const ALLOWED = { allowed: true, remaining: 10, retryAfterSeconds: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireSeasonMember).mockResolvedValue({ player, seasonId: SEASON_ID });
  vi.mocked(assertSeasonOpenForPlay).mockResolvedValue(undefined);
  vi.mocked(checkRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(saveAction).mockResolvedValue({ ok: true, submission: row() });
});

describe('PUT /api/seasons/[id]/format/actions/[actionId]', () => {
  it('answers 401 and 403 before reading anything', async () => {
    vi.mocked(requireSeasonMember).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await PUT(put(PICKS), params())).status).toBe(401);
    vi.mocked(requireSeasonMember).mockRejectedValueOnce(refuse('format_not_participant'));
    const notMember = await PUT(put(PICKS), params());
    expect(notMember.status).toBe(403);
    expect((await notMember.json()).code).toBe('format_not_participant');
    expect(assertSeasonOpenForPlay).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(saveAction).not.toHaveBeenCalled();
  });

  it('saves a draft for the session player in the league of the URL and maps the row to the viewer shape', async () => {
    const response = await PUT(put(PICKS), params());
    expect(response.status).toBe(200);
    expect(saveAction).toHaveBeenCalledWith({
      seasonId: SEASON_ID,
      actionId: 'choose_gift',
      actorId: VIEWER,
      picks: [{ step: 0, item_id: 'pikachu' }],
    });
    const text = await response.text();
    expect(JSON.parse(text).data).toEqual({ submission: { state: 'draft', picks: [{ step: 0, item_id: 'pikachu' }] } });
    // The stored row's other columns (a hidden target, row ids) stay on the server.
    expect(text).not.toContain('target_player_id');
    expect(text).not.toContain(HIDDEN_TARGET);
    expect(text).not.toContain('source_ref');
    expectNoPrivatePlayerData(JSON.parse(text));
    expect(requireSeasonMember).toHaveBeenCalledWith(SEASON_ID.toUpperCase());
  });

  it('does not audit a draft save', async () => {
    await PUT(put(PICKS), params());
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers 404 format_action_unknown for a path segment that is not a key, without touching the library', async () => {
    const response = await PUT(put(PICKS), params('Not A Key!'));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('format_action_unknown');
    expect(saveAction).not.toHaveBeenCalled();
  });

  it('refuses a completed or archived league with 409 format_season_closed, before the limiter and the body', async () => {
    vi.mocked(assertSeasonOpenForPlay).mockRejectedValueOnce(refuse('format_season_closed'));
    const response = await PUT(put(PICKS), params());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_season_closed');
    expect(assertSeasonOpenForPlay).toHaveBeenCalledWith(SEASON_ID);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(saveAction).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After and writes nothing', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    const response = await PUT(put(PICKS), params());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    expect(checkRateLimit).toHaveBeenCalledWith('format-action-save', VIEWER, expect.objectContaining({ limit: 60, windowSeconds: 600 }));
    expect(saveAction).not.toHaveBeenCalled();
  });

  it('rejects a malformed body with 400 and writes nothing', async () => {
    for (const bad of [
      {},
      { picks: 'pikachu' },
      { picks: [{ step: 0 }] },
      { picks: [{ step: 8, item_id: 'pikachu' }] },
      { picks: [{ step: -1, item_id: 'pikachu' }] },
      { picks: [{ step: 0, item_id: 'Pikachu!' }] },
      { picks: Array.from({ length: 129 }, () => ({ step: 0, item_id: 'pikachu' })) },
    ]) {
      const response = await PUT(put(bad), params());
      expect(response.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
      expect((await response.json()).code).toBe('validation_failed');
    }
    expect(saveAction).not.toHaveBeenCalled();
  });

  it('never takes the actor, the league or the target from the body: an extra member is a 400', async () => {
    for (const extra of [{ actor_id: HIDDEN_TARGET }, { season_id: HIDDEN_TARGET }, { target_player_id: HIDDEN_TARGET }]) {
      const response = await PUT(put({ ...PICKS, ...extra }), params());
      expect(response.status).toBe(400);
    }
    expect(saveAction).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_json for an empty or unparsable body', async () => {
    const empty = await PUT(put(null, ''), params());
    expect(empty.status).toBe(400);
    expect((await empty.json()).code).toBe('invalid_json');
    const garbage = await PUT(put(null, '{picks'), params());
    expect(garbage.status).toBe(400);
    expect(saveAction).not.toHaveBeenCalled();
  });

  it('answers 413 format_request_too_large for a body over 8 KiB', async () => {
    const response = await PUT(put({ picks: [], padding: 'x'.repeat(9 * 1024) }), params());
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('format_request_too_large');
    expect(saveAction).not.toHaveBeenCalled();
  });

  it('answers a rejected pick with format_action_invalid, the issues and the status of the first match', async () => {
    const cases: [{ code: string; step?: number; item_id?: string }[], number][] = [
      [[{ code: 'wrong_count', step: 0 }, { code: 'where_false', step: 1, item_id: 'pikachu' }], 422],
      [[{ code: 'window_closed' }], 409],
      [[{ code: 'actor_without_link' }], 403],
      [[{ code: 'action_unknown' }], 404],
      [[{ code: 'format_not_running' }], 409],
      [[{ code: 'resource_item_taken', step: 0, item_id: 'pikachu' }], 409],
    ];
    for (const [issues, status] of cases) {
      vi.mocked(saveAction).mockResolvedValueOnce({ ok: false, issues: issues as never });
      const response = await PUT(put(PICKS), params());
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.code).toBe('format_action_invalid');
      expect(body.params).toEqual({ count: issues.length });
      expect(body.issues).toEqual(issues);
      // Codes, step indexes and item ids the actor just sent, nothing else.
      expect(JSON.stringify(body)).not.toContain('target_player_id');
    }
  });

  it('maps the database signals to their catalog codes', async () => {
    vi.mocked(saveAction).mockRejectedValueOnce(new FormatRuntimeError('action_locked'));
    const locked = await PUT(put(PICKS), params());
    expect(locked.status).toBe(409);
    expect((await locked.json()).code).toBe('action_locked');

    // The format changed after the pick was validated: 409 with its own catalog code (the client reloads and validates again).
    vi.mocked(saveAction).mockRejectedValueOnce(new FormatRuntimeError('format_context_stale'));
    const stale = await PUT(put(PICKS), params());
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.code).toBe('format_context_stale');
    expect(body.error).toMatch(/format changed/i);
  });

  it('refuses a save over a submitted pick with 409 format_action_already_submitted', async () => {
    vi.mocked(saveAction).mockRejectedValueOnce(refuse('format_action_already_submitted'));
    const response = await PUT(put(PICKS), params());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_action_already_submitted');
  });

  it('hides an unexpected failure behind the static message', async () => {
    vi.mocked(saveAction).mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "x_pkey"'));
    const response = await PUT(put(PICKS), params());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to save the pick');
    expect(JSON.stringify(body)).not.toContain('x_pkey');
  });
});
