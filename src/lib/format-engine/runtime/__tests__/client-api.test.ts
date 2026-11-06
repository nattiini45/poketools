/**
 * The request layer of the live-format surfaces: the path, method and body of each call, the `issues` of a rejected pick,
 * the network failure, and the classifier (no stale revision, ever).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  answerChallengeRequest,
  classifyFormatRuntimeError,
  loadMyFormatView,
  makeChallengeRequest,
  saveActionRequest,
  submitActionRequest,
  withdrawChallengeRequest,
} from '../client-api';
import {
  applyAdjustmentRequest,
  loadAdjustmentsRequest,
  loadChecksRequest,
  resolveCheckRequest,
  unmaskRelationsRequest,
} from '../client-api-admin';

const SEASON = '3f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5b';
const BASE = `/api/seasons/${SEASON}/format`;

interface Recorded {
  input: string;
  init?: RequestInit;
}

function fetchReturning(status: number, body: unknown, calls: Recorded[] = []) {
  const f = vi.fn(async (input: string, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return { f, calls };
}

const success = (data: unknown) => ({ success: true, data });
const bodyOf = (call: Recorded): unknown => JSON.parse(String(call.init?.body));

describe('player calls', () => {
  it('reads the view with a GET and no body', async () => {
    const { f, calls } = fetchReturning(200, success({ running: false }));
    await expect(loadMyFormatView(SEASON, f)).resolves.toEqual({ ok: true, data: { running: false } });
    expect(calls[0].input).toBe(`${BASE}/me`);
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.body).toBeUndefined();
  });

  it('saves with a PUT and submits with a POST, sending only step and item_id of each pick', async () => {
    const picks = [{ step: 0, item_id: 'garchomp', extra: 'dropped' } as { step: number; item_id: string }];
    const save = fetchReturning(200, success({ submission: { state: 'draft', picks: [] } }));
    await saveActionRequest(SEASON, 'choose_gift', picks, save.f);
    expect(save.calls[0].input).toBe(`${BASE}/actions/choose_gift`);
    expect(save.calls[0].init?.method).toBe('PUT');
    expect(bodyOf(save.calls[0])).toEqual({ picks: [{ step: 0, item_id: 'garchomp' }] });

    const submit = fetchReturning(200, success({ submission: { state: 'submitted', picks: [] } }));
    await expect(submitActionRequest(SEASON, 'choose_gift', picks, submit.f)).resolves.toMatchObject({ ok: true });
    expect(submit.calls[0].input).toBe(`${BASE}/actions/choose_gift/submit`);
    expect(submit.calls[0].init?.method).toBe('POST');
    expect(bodyOf(submit.calls[0])).toEqual({ picks: [{ step: 0, item_id: 'garchomp' }] });
  });

  it('carries the issues of a rejected pick on the failure of save and submit', async () => {
    const issues = [{ code: 'wrong_count', step: 0 }, { code: 'where_false', step: 1, item_id: 'pikachu' }];
    const body = { success: false, error: 'The submission has problems.', code: 'format_action_invalid', params: { count: 2 }, issues };
    for (const call of [saveActionRequest, submitActionRequest]) {
      const result = await call(SEASON, 'a', [], fetchReturning(422, body).f);
      expect(result).toEqual({
        ok: false,
        status: 422,
        error: { error: 'The submission has problems.', code: 'format_action_invalid', params: { count: 2 }, issues },
      });
    }
  });

  it('ignores an issues member of the wrong shape and never lets it replace the code', async () => {
    const result = await saveActionRequest(SEASON, 'a', [], fetchReturning(422, { success: false, error: 'x', code: 'format_action_invalid', issues: ['nope', 4] }).f);
    expect(result).toMatchObject({ ok: false, error: { code: 'format_action_invalid' } });
    expect(result.ok ? null : result.error.issues).toBeUndefined();
  });

  it('returns no issues for the calls that do not take picks', async () => {
    const body = { success: false, error: 'x', code: 'challenge_cooldown', issues: [{ code: 'wrong_count' }] };
    const result = await makeChallengeRequest(SEASON, 'p', 'd', fetchReturning(409, body).f);
    expect(result).toEqual({ ok: false, status: 409, error: { error: 'x', code: 'challenge_cooldown' } });
  });

  it('makes, answers and withdraws a challenge on the right paths with the right bodies', async () => {
    const ok = fetchReturning(200, success({ challenge: { id: 'c' } }));
    await makeChallengeRequest(SEASON, 'phase-1', 'defender-1', ok.f);
    await answerChallengeRequest(SEASON, 'c 1', true, ok.f);
    await withdrawChallengeRequest(SEASON, 'c-1', 'self', ok.f);
    await withdrawChallengeRequest(SEASON, 'c-1', 'admin', ok.f);
    expect(ok.calls.map((c) => [c.init?.method, c.input])).toEqual([
      ['POST', `${BASE}/challenges`],
      ['POST', `${BASE}/challenges/c%201/answer`],
      ['DELETE', `${BASE}/challenges/c-1?as=self`],
      ['DELETE', `${BASE}/challenges/c-1?as=admin`],
    ]);
    expect(bodyOf(ok.calls[0])).toEqual({ phase_id: 'phase-1', defender_id: 'defender-1' });
    expect(bodyOf(ok.calls[1])).toEqual({ accept: true });
    expect(ok.calls[2].init?.body).toBeUndefined();
  });

  it('encodes every path segment', async () => {
    const { f, calls } = fetchReturning(200, success({ submission: {} }));
    await saveActionRequest('a/b', 'x/../y', [], f);
    expect(calls[0].input).toBe('/api/seasons/a%2Fb/format/actions/x%2F..%2Fy');
  });

  it('answers a request that never reached the server with network_error and status 0', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('offline');
    });
    await expect(loadMyFormatView(SEASON, f)).resolves.toEqual({ ok: false, status: 0, error: { code: 'network_error' } });
    await expect(saveActionRequest(SEASON, 'a', [], f)).resolves.toEqual({ ok: false, status: 0, error: { code: 'network_error' } });
  });

  it('turns a rate limit into rate_limited with the seconds of Retry-After', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '7' } }));
    await expect(answerChallengeRequest(SEASON, 'c', true, f)).resolves.toEqual({ ok: false, status: 429, error: { code: 'rate_limited', params: { seconds: 7 } } });
  });
});

describe('admin calls', () => {
  it('pages the adjustments and the checks through the query string', async () => {
    const { f, calls } = fetchReturning(200, success({ checks: [], total: 0 }));
    await loadAdjustmentsRequest(SEASON, { limit: 25, offset: 50 }, f);
    await loadChecksRequest(SEASON, 'all', { limit: 10, offset: 0 }, f);
    expect(calls.map((c) => [c.init?.method, c.input])).toEqual([
      ['GET', `${BASE}/adjustments?limit=25&offset=50`],
      ['GET', `${BASE}/checks?status=all&limit=10&offset=0`],
    ]);
  });

  it('posts an adjustment body as it is', async () => {
    const { f, calls } = fetchReturning(201, success({ adjustment_id: 'adj' }));
    const body = { reason: 'fair', adjustment: { kind: 'action' as const, action: 'a', state: 'locked' as const } };
    await expect(applyAdjustmentRequest(SEASON, body, f)).resolves.toEqual({ ok: true, data: { adjustment_id: 'adj' } });
    expect(calls[0].input).toBe(`${BASE}/adjustments`);
    expect(calls[0].init?.method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual(body);
  });

  it('resolves a check with a verdict and leaves an empty note out', async () => {
    const { f, calls } = fetchReturning(200, success({ check_id: 'k', state: 'confirmed' }));
    await resolveCheckRequest(SEASON, 'k', 'confirmed', null, f);
    await resolveCheckRequest(SEASON, 'k', 'rejected', '  seen ', f);
    await resolveCheckRequest(SEASON, 'k', 'rejected', '   ', f);
    expect(calls[0].input).toBe(`${BASE}/checks/k/resolve`);
    expect(bodyOf(calls[0])).toEqual({ verdict: 'confirmed' });
    expect(bodyOf(calls[1])).toEqual({ verdict: 'rejected', note: 'seen' });
    expect(bodyOf(calls[2])).toEqual({ verdict: 'rejected' });
    expect(JSON.stringify(calls.map(bodyOf))).not.toContain('"status"');
  });

  it('unmasks with an empty body', async () => {
    const { f, calls } = fetchReturning(200, success({ relations: [], submissions: [] }));
    await unmaskRelationsRequest(SEASON, f);
    expect(calls[0].input).toBe(`${BASE}/relations/unmask`);
    expect(calls[0].init?.method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual({});
  });

  it('gives the failure of an admin call as code and params only', async () => {
    const { f } = fetchReturning(409, { success: false, error: 'resolved', code: 'format_check_not_open' });
    await expect(resolveCheckRequest(SEASON, 'k', 'confirmed', null, f)).resolves.toEqual({
      ok: false,
      status: 409,
      error: { error: 'resolved', code: 'format_check_not_open' },
    });
  });
});

describe('the classifier serves the player and the admin calls', () => {
  it('never classes anything as a stale revision', () => {
    for (const code of ['action_locked', 'format_check_not_open', 'draft_rev', 'stale_revision', 'format_stale_revision']) {
      expect(classifyFormatRuntimeError({ code, params: { draft_rev: 3 } }).kind).not.toBe('stale_revision');
    }
  });

  it('classes a rejected pick by its status: a stale-state answer is a conflict (reload), a wrong pick stays invalid', () => {
    // The statuses `actionRejectedStatus` sends under the one code `format_action_invalid`.
    for (const status of [404, 409, 403]) expect(classifyFormatRuntimeError({ code: 'format_action_invalid' }, status).kind, String(status)).toBe('conflict');
    expect(classifyFormatRuntimeError({ code: 'format_action_invalid' }, 422).kind).toBe('invalid');
    expect(classifyFormatRuntimeError({ code: 'format_action_invalid' }).kind).toBe('invalid');
    // Only that code is read by status: another code keeps its own class whatever the status.
    expect(classifyFormatRuntimeError({ code: 'format_adjust_not_allowed' }, 409).kind).toBe('invalid');
  });

  it('reads status 0 as a network failure, 401 as unauthenticated and an unknown code as other', () => {
    expect(classifyFormatRuntimeError({ code: 'network_error' }, 0).kind).toBe('network');
    expect(classifyFormatRuntimeError({}, 401).kind).toBe('unauthenticated');
    expect(classifyFormatRuntimeError({ code: 'something_new' }, 500).kind).toBe('other');
  });
});
