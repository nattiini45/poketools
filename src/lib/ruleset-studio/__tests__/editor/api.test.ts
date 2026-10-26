import { describe, expect, it } from 'vitest';
import { ltext } from '@/lib/studio-core/ltext';
import type { FetchLike } from '@/lib/studio-core/request';
import { RULESET_ERROR_CODES } from '../../errors';
import {
  classifyApiError,
  createRulesetRequest,
  deleteRulesetRequest,
  forkPresetRequest,
  forkRulesetRequest,
  loadRulesetDetail,
  movePinsRequest,
  pinImpactRequest,
  publishRequest,
  saveDraftRequest,
  visibilityRequest,
} from '../../editor/api';

interface Call {
  url: string;
  method: string | undefined;
  body: unknown;
}

/** A fetch that answers every request with the given data and records what it was asked. */
function fake(data: unknown = {}, status = 200): { f: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: 'no', ...(data as object) }), { status });
  };
  return { f, calls };
}

describe('the ruleset requests', () => {
  it('save a draft with the revision the editor holds', async () => {
    const { f, calls } = fake({ draft_rev: 5, updated_at: 'now' });
    expect(await saveDraftRequest('a/b', 4, { x: 1 }, f)).toMatchObject({ ok: true, data: { draft_rev: 5 } });
    expect(calls).toEqual([{ url: '/api/ruleset-definitions/a%2Fb/draft', method: 'PUT', body: { draft_rev: 4, document: { x: 1 } } }]);
  });

  it('load the detail, delete and fork without a body', async () => {
    const { f, calls } = fake();
    await loadRulesetDetail('id1', f);
    await deleteRulesetRequest('id1', f);
    await forkRulesetRequest('id1', f);
    expect(calls).toEqual([
      { url: '/api/ruleset-definitions/id1', method: 'GET', body: undefined },
      { url: '/api/ruleset-definitions/id1', method: 'DELETE', body: undefined },
      { url: '/api/ruleset-definitions/id1/fork', method: 'POST', body: undefined },
    ]);
  });

  it('publish at a revision, with the changelog only when there is one', async () => {
    const { f, calls } = fake();
    await publishRequest('id1', 7, undefined, f);
    await publishRequest('id1', 8, ltext('en', 'Fixed'), f);
    expect(calls.map((c) => c.body)).toEqual([{ draft_rev: 7 }, { draft_rev: 8, changelog: ltext('en', 'Fixed') }]);
    expect(calls[0]).toMatchObject({ url: '/api/ruleset-definitions/id1/publish', method: 'POST' });
  });

  it('change the visibility with PATCH', async () => {
    const { f, calls } = fake();
    await visibilityRequest('id1', 'league', f);
    expect(calls).toEqual([{ url: '/api/ruleset-definitions/id1', method: 'PATCH', body: { visibility: 'league' } }]);
  });

  it('fork a preset: no body, or the Smogon tour toggle', async () => {
    const { f, calls } = fake();
    await forkPresetRequest('gen9ou', {}, f);
    await forkPresetRequest('gen9natdexdraft', { tourOverlay: true }, f);
    await forkPresetRequest('gen9natdexdraft', { tourOverlay: false }, f);
    expect(calls.map((c) => [c.url, c.body])).toEqual([
      ['/api/ruleset-definitions/presets/gen9ou/fork', undefined],
      ['/api/ruleset-definitions/presets/gen9natdexdraft/fork', { tour_overlay: true }],
      ['/api/ruleset-definitions/presets/gen9natdexdraft/fork', undefined],
    ]);
  });

  it('create from a name, a preset and the toggle, or from a document', async () => {
    const { f, calls } = fake();
    await createRulesetRequest({ name: 'Our draft', base_locale: 'de', preset: 'gen9natdexdraft', tour_overlay: true }, f);
    await createRulesetRequest({ document: { identity: {} } }, f);
    expect(calls).toEqual([
      { url: '/api/ruleset-definitions', method: 'POST', body: { name: 'Our draft', base_locale: 'de', preset: 'gen9natdexdraft', tour_overlay: true } },
      { url: '/api/ruleset-definitions', method: 'POST', body: { document: { identity: {} } } },
    ]);
  });

  it('move pins: the version number and the targets, with the confirmation only when there is one', async () => {
    const { f, calls } = fake({ version_id: 'v3', version_no: 3, moved: [] });
    const targets = [
      { kind: 'season' as const, id: 's1' },
      { kind: 'tournament' as const, id: 't1' },
    ];
    expect(await movePinsRequest('def 1', 3, targets, [], f)).toMatchObject({ ok: true, data: { version_no: 3 } });
    await movePinsRequest('def 1', 3, targets, ['s1'], f);
    expect(calls).toEqual([
      { url: '/api/ruleset-definitions/def%201/pins', method: 'POST', body: { to_version_no: 3, targets } },
      { url: '/api/ruleset-definitions/def%201/pins', method: 'POST', body: { to_version_no: 3, targets, confirm_started: ['s1'] } },
    ]);
  });

  it('ask what a pin move would do to the submitted teams: the targets and the version, no confirmation, no write verb', async () => {
    const answer = { version_no: 3, checked: 12, would_break: 2, truncated: false, targets: [] };
    const { f, calls } = fake(answer);
    const targets = [{ kind: 'season' as const, id: 's1' }];

    expect(await pinImpactRequest('def 1', 3, targets, f)).toEqual({ ok: true, data: answer });
    expect(calls).toEqual([{ url: '/api/ruleset-definitions/def%201/pins/impact', method: 'POST', body: { to_version_no: 3, targets } }]);
  });

  it('a refused impact check gives the server code (rate limited, forbidden, not found) instead of a count', async () => {
    const { f } = fake({ code: 'ruleset_pin_locked' }, 409);
    expect(await pinImpactRequest('d', 2, [{ kind: 'season', id: 's1' }], f)).toMatchObject({ ok: false, status: 409, error: { code: 'ruleset_pin_locked' } });
  });

  it('a pin that needs the confirmation comes back with the names the server put in the params', async () => {
    const { f } = fake({ code: 'ruleset_pin_confirm_required', params: { targets: 'Summer League' } }, 409);
    expect(await movePinsRequest('d', 2, [{ kind: 'season', id: 's1' }], [], f)).toMatchObject({
      ok: false,
      status: 409,
      error: { code: 'ruleset_pin_confirm_required', params: { targets: 'Summer League' } },
    });
  });

  it('give the server\'s code and params for a failure', async () => {
    const { f } = fake({ code: 'ruleset_slug_taken' }, 409);
    expect(await createRulesetRequest({ name: 'x', base_locale: 'en' }, f)).toMatchObject({ ok: false, status: 409, error: { code: 'ruleset_slug_taken' } });
  });
});

describe('classifyApiError', () => {
  it('classes every ruleset error code (a new code is a type error until it is classed)', () => {
    for (const code of RULESET_ERROR_CODES) {
      if (code === 'ruleset_stale_revision') continue;
      expect(classifyApiError({ code }).kind, code).not.toBe('other');
    }
  });

  it('a stale revision names the revision the server holds', () => {
    expect(classifyApiError({ code: 'ruleset_stale_revision', params: { draft_rev: 9 } })).toEqual({ kind: 'stale_revision', staleRev: 9 });
    expect(classifyApiError({ code: 'format_stale_revision', params: { draft_rev: 9 } })).toEqual({ kind: 'other' });
  });

  it('a pin that a concurrent change moved is a conflict to refresh and retry, not a dead end', () => {
    expect(classifyApiError({ code: 'ruleset_pin_moved', params: { target: 'Summer League' } }, 409)).toEqual({ kind: 'conflict' });
    // The other pin refusals stay refusals: retrying them unchanged cannot work.
    for (const code of ['ruleset_pin_locked', 'ruleset_pin_started', 'ruleset_pin_confirm_required', 'ruleset_pin_mismatch']) {
      expect(classifyApiError({ code }, 409).kind, code).toBe('blocked');
    }
  });

  it('puts size, permission and lookup failures in their classes', () => {
    expect(classifyApiError({ code: 'ruleset_document_too_large' }).kind).toBe('too_large');
    expect(classifyApiError({ code: 'ruleset_preset_locked' }).kind).toBe('forbidden');
    expect(classifyApiError({ code: 'ruleset_not_found' }).kind).toBe('not_found');
    expect(classifyApiError({ code: 'ruleset_in_use', params: { count: 2 } }).kind).toBe('blocked');
    expect(classifyApiError({ code: 'ruleset_document_invalid', params: { count: 1 } }).kind).toBe('invalid');
  });
});
