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
import { submitAction } from '@/lib/format-engine/runtime/actions-server';
import { refuse } from '@/lib/format-engine/runtime/refusal';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { FormatRuntimeError } from '@/lib/supabase/queries/format-runtime';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import { POST } from '../route';

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

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    season_id: SEASON_ID,
    action_key: 'choose_gift',
    actor_id: VIEWER,
    target_player_id: HIDDEN_TARGET,
    status: 'submitted',
    picks: [{ step: 0, item_id: 'pikachu' }],
    submitted_at: '2026-11-05T10:00:00.000Z',
    updated_at: '2026-11-05T10:00:00.000Z',
    ...over,
  }) as never;

const PICKS = { picks: [{ step: 0, item_id: 'pikachu' }] };
const params = (actionId = 'choose_gift') => ({ params: Promise.resolve({ id: SEASON_ID.toUpperCase(), actionId }) });
const post = (body: unknown, raw?: string) =>
  new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format/actions/choose_gift/submit`, {
    method: 'POST',
    body: raw ?? JSON.stringify(body),
  });
const ALLOWED = { allowed: true, remaining: 10, retryAfterSeconds: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireSeasonMember).mockResolvedValue({ player, seasonId: SEASON_ID });
  vi.mocked(assertSeasonOpenForPlay).mockResolvedValue(undefined);
  vi.mocked(checkRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(submitAction).mockResolvedValue({ ok: true, submission: row(), giverHidden: false });
});

describe('POST /api/seasons/[id]/format/actions/[actionId]/submit', () => {
  it('answers 401 and 403 before reading anything', async () => {
    vi.mocked(requireSeasonMember).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await POST(post(PICKS), params())).status).toBe(401);
    vi.mocked(requireSeasonMember).mockRejectedValueOnce(refuse('format_not_participant'));
    const notMember = await POST(post(PICKS), params());
    expect(notMember.status).toBe(403);
    expect((await notMember.json()).code).toBe('format_not_participant');
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(submitAction).not.toHaveBeenCalled();
  });

  it('submits for the session player in the league of the URL and answers the viewer shape', async () => {
    const response = await POST(post(PICKS), params());
    expect(response.status).toBe(200);
    expect(submitAction).toHaveBeenCalledWith({
      seasonId: SEASON_ID,
      actionId: 'choose_gift',
      actorId: VIEWER,
      picks: [{ step: 0, item_id: 'pikachu' }],
    });
    const text = await response.text();
    expect(JSON.parse(text).data).toEqual({ submission: { state: 'submitted', picks: [{ step: 0, item_id: 'pikachu' }] } });
    expect(text).not.toContain('target_player_id');
    expect(text).not.toContain(HIDDEN_TARGET);
    expectNoPrivatePlayerData(JSON.parse(text));
  });

  it('audits the submit with ids and counts only, never the picks', async () => {
    await POST(post(PICKS), params());
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'season.format.action.submit',
      actor_id: VIEWER,
      actor_name: 'Mara',
      resource_type: 'season',
      resource_id: SEASON_ID,
      metadata: { action_id: 'choose_gift', pick_count: 1, locked: false },
    });
    expect(JSON.stringify(entry)).not.toContain('pikachu');
  });

  it('names no giver in the audit entry of an action a relation still hides, so an admin who plays cannot read it', async () => {
    vi.mocked(submitAction).mockResolvedValueOnce({ ok: true, submission: row(), giverHidden: true });
    const response = await POST(post(PICKS), params());
    expect(response.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'season.format.action.submit',
      actor_id: null,
      actor_name: 'Player',
      resource_id: SEASON_ID,
      metadata: { action_id: 'choose_gift', pick_count: 1, locked: false, giver_hidden: true },
    });
    const json = JSON.stringify(entry);
    expect(json).not.toContain(VIEWER);
    expect(json).not.toContain('Mara');
  });

  it('keeps the giver in the audit entry when the submit reports the giver is not hidden', async () => {
    await POST(post(PICKS), params());
    expect(vi.mocked(logAuditEvent).mock.calls[0][0]).toMatchObject({ actor_id: VIEWER, actor_name: 'Mara' });
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).not.toHaveProperty('giver_hidden');
  });

  it('records locked: true when the action locks on submit', async () => {
    vi.mocked(submitAction).mockResolvedValueOnce({ ok: true, submission: row({ status: 'locked' }), giverHidden: false });
    const response = await POST(post(PICKS), params());
    expect((await response.json()).data.submission.state).toBe('locked');
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({ locked: true });
  });

  it('answers 404 format_action_unknown for a path segment that is not a key', async () => {
    const response = await POST(post(PICKS), params('..%2Fx'));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('format_action_unknown');
    expect(submitAction).not.toHaveBeenCalled();
  });

  it('refuses a completed or archived league with 409 format_season_closed and writes nothing', async () => {
    vi.mocked(assertSeasonOpenForPlay).mockRejectedValueOnce(refuse('format_season_closed'));
    const response = await POST(post(PICKS), params());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_season_closed');
    expect(submitAction).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After and writes nothing', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 90 });
    const response = await POST(post(PICKS), params());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('90');
    expect(checkRateLimit).toHaveBeenCalledWith('format-action-submit', VIEWER, expect.objectContaining({ limit: 30, windowSeconds: 3600 }));
    expect(submitAction).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects a malformed body and an extra member (an actor id) with 400', async () => {
    for (const bad of [{}, { picks: [{ step: 0 }] }, { ...PICKS, actor_id: HIDDEN_TARGET }, { ...PICKS, season_id: HIDDEN_TARGET }]) {
      const response = await POST(post(bad), params());
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('validation_failed');
    }
    expect(submitAction).not.toHaveBeenCalled();
  });

  it('answers 413 format_request_too_large for a body over 8 KiB', async () => {
    const response = await POST(post({ picks: [], padding: 'x'.repeat(9 * 1024) }), params());
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('format_request_too_large');
    expect(submitAction).not.toHaveBeenCalled();
  });

  it('answers a rejected pick with format_action_invalid and the issues, and does not audit it', async () => {
    vi.mocked(submitAction).mockResolvedValueOnce({
      ok: false,
      issues: [{ code: 'wrong_count', step: 0 }, { code: 'where_false', step: 1, item_id: 'pikachu' }],
    });
    const response = await POST(post(PICKS), params());
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, code: 'format_action_invalid', params: { count: 2 } });
    expect(body.issues).toEqual([{ code: 'wrong_count', step: 0 }, { code: 'where_false', step: 1, item_id: 'pikachu' }]);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers 409 / 403 for a closed window and for an actor without a link', async () => {
    vi.mocked(submitAction).mockResolvedValueOnce({ ok: false, issues: [{ code: 'window_closed' }] });
    expect((await POST(post(PICKS), params())).status).toBe(409);
    vi.mocked(submitAction).mockResolvedValueOnce({ ok: false, issues: [{ code: 'actor_without_link' }] });
    expect((await POST(post(PICKS), params())).status).toBe(403);
  });

  it('answers 403 with the issue actor_not_in_league for a giver who left the league, and writes no audit entry', async () => {
    vi.mocked(submitAction).mockResolvedValueOnce({ ok: false, issues: [{ code: 'actor_not_in_league' }] });
    const response = await POST(post(PICKS), params());
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, code: 'format_action_invalid' });
    expect(body.issues).toEqual([{ code: 'actor_not_in_league' }]);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('maps the signals the database raises under its lock to 409 with the catalog code', async () => {
    vi.mocked(submitAction).mockRejectedValueOnce(new FormatRuntimeError('action_locked'));
    const locked = await POST(post(PICKS), params());
    expect(locked.status).toBe(409);
    expect((await locked.json()).code).toBe('action_locked');

    vi.mocked(submitAction).mockRejectedValueOnce(new FormatRuntimeError('resource_item_taken'));
    const taken = await POST(post(PICKS), params());
    expect(taken.status).toBe(409);
    expect((await taken.json()).code).toBe('resource_item_taken');

    vi.mocked(submitAction).mockRejectedValueOnce(new FormatRuntimeError('resource_capacity_reached'));
    const full = await POST(post(PICKS), params());
    expect(full.status).toBe(409);
    expect((await full.json()).code).toBe('resource_capacity_reached');

    // The format was replaced or amended after the pick was validated: 409, the client reloads and validates again.
    vi.mocked(submitAction).mockRejectedValueOnce(new FormatRuntimeError('format_context_stale'));
    const stale = await POST(post(PICKS), params());
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('format_context_stale');
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('hides an unexpected failure behind the static message', async () => {
    vi.mocked(submitAction).mockRejectedValueOnce(new Error('deadlock detected'));
    const response = await POST(post(PICKS), params());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to submit the pick');
    expect(JSON.stringify(body)).not.toContain('deadlock');
  });
});
