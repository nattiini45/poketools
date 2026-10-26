import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ltext } from '@/lib/format-kit';
import type { SessionPlayer } from '@/types/auth';
import type { RulesetDefinitionMeta } from '@/lib/ruleset-studio/library-types';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireAnyAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(message: string, public statusCode: number, public code?: string) {
      super(message);
    }
  },
}));
vi.mock('@/lib/ruleset-studio/guards', () => ({ requireRulesetViewer: vi.fn() }));
vi.mock('@/lib/ruleset-studio/library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ruleset-studio/library')>()),
  createFromBody: vi.fn(),
  forkDefinition: vi.fn(),
  forkPreset: vi.fn(),
  getRulesetDetail: vi.fn(),
  saveDraft: vi.fn(),
  publish: vi.fn(),
  changeVisibility: vi.fn(),
  removeDefinition: vi.fn(),
}));
vi.mock('@/lib/ruleset-studio/pins', () => ({ movePins: vi.fn(), listUsage: vi.fn() }));
vi.mock('@/lib/ruleset-studio/pin-impact.server', () => ({ computePinImpact: vi.fn() }));
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({
  listRulesetDefinitions: vi.fn(),
  getRulesetVersion: vi.fn(),
  getPinTargetStates: vi.fn(),
}));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn(), expireTournamentReads: vi.fn() }));

import { requireAnyAdmin, AuthError } from '@/lib/auth/helpers';
import { requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import { RulesetStudioError } from '@/lib/ruleset-studio/errors';
import { changeVisibility, createFromBody, forkDefinition, forkPreset, getRulesetDetail, publish, removeDefinition, saveDraft } from '@/lib/ruleset-studio/library';
import { listUsage, movePins } from '@/lib/ruleset-studio/pins';
import { computePinImpact } from '@/lib/ruleset-studio/pin-impact.server';
import { getPinTargetStates, getRulesetVersion, listRulesetDefinitions } from '@/lib/supabase/queries/ruleset-definitions';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import { expireSeasonReads, expireTournamentReads } from '@/lib/revalidation';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import * as list from '../route';
import * as item from '../[id]/route';
import * as draft from '../[id]/draft/route';
import * as publishRoute from '../[id]/publish/route';
import * as fork from '../[id]/fork/route';
import * as presetFork from '../presets/[presetId]/fork/route';
import * as pins from '../[id]/pins/route';
import * as pinImpact from '../[id]/pins/impact/route';
import * as usage from '../[id]/usage/route';
import * as versions from '../[id]/versions/[no]/route';

const ME = '11111111-1111-4111-8111-111111111111';
const ID = '33333333-3333-4333-8333-333333333333';
const SEASON = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

const player = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: ME, name: 'League Admin', isAdmin: false, isResourceAdmin: true, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active', ...overrides,
});
const definition = (overrides: Partial<RulesetDefinitionMeta> = {}): RulesetDefinitionMeta => ({
  id: ID, slug: 'spring-ou', name: ltext('en', 'Spring OU'), description: null, kind: 'custom', owner_id: ME, visibility: 'private', season_id: null,
  forked_from: null, draft_rev: 2, current_version_id: null, created_at: '', updated_at: '', ...overrides,
});
const access = (overrides: Partial<RulesetDefinitionMeta> = {}, p: SessionPlayer = player()) => {
  const meta = definition(overrides);
  return { player: p, definition: meta, actor: { playerId: p.playerId, isAdmin: p.isAdmin } };
};
// The handlers type their own params; the test passes the same shape for any route.
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;
const request = (body?: unknown, url = 'http://localhost/api/ruleset-definitions') =>
  new NextRequest(url, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(player());
  vi.mocked(requireRulesetViewer).mockResolvedValue(access());
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 } as never);
});

describe('GET / POST /api/ruleset-definitions', () => {
  it('lists with the caller as actor; the gallery scope is the gallery visibility', async () => {
    vi.mocked(listRulesetDefinitions).mockResolvedValue({ items: [], total: 0 });
    const res = await list.GET(request(undefined, 'http://localhost/api/ruleset-definitions?scope=gallery&limit=5'));
    expect(res.status).toBe(200);
    expect(vi.mocked(listRulesetDefinitions).mock.calls[0][0]).toMatchObject({ actor: { playerId: ME, isAdmin: false }, scope: 'all', visibility: 'gallery', limit: 5, offset: 0 });
    expect((await list.GET(request(undefined, 'http://localhost/api/ruleset-definitions?scope=nope'))).status).toBe(400);
  });

  it('answers the guard\'s refusal for a non-admin', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Admin access required', 403));
    expect((await list.GET(request())).status).toBe(403);
    expect((await list.POST(request({ name: 'x', base_locale: 'en' }))).status).toBe(403);
  });

  it('creates (201), audits with ids only, and rate limits before reading the body', async () => {
    vi.mocked(createFromBody).mockResolvedValue({ definition: { id: ID, slug: 'spring-ou' } as never, check: { ok: true } as never });
    const res = await list.POST(request({ name: 'Spring OU', base_locale: 'en', preset: 'gen9ou' }));
    expect(res.status).toBe(201);
    expect(createFromBody).toHaveBeenCalledWith(expect.objectContaining({ playerId: ME }), { name: 'Spring OU', base_locale: 'en', preset: 'gen9ou' });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'ruleset.create', resource_type: 'ruleset', resource_id: ID, actor_id: ME }));
    expect(JSON.stringify(vi.mocked(logAuditEvent).mock.calls[0][0])).not.toContain('document');

    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 42 } as never);
    vi.mocked(createFromBody).mockClear();
    const limited = await list.POST(request({ name: 'x', base_locale: 'en' }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('42');
    expect(createFromBody).not.toHaveBeenCalled();
  });

  it('refuses bad input before the database: an invalid envelope (400) and an oversized document (413)', async () => {
    expect((await list.POST(request({ name: '', base_locale: 'en' }))).status).toBe(400);
    expect((await list.POST(request({ document: { text: 'x'.repeat(300_000) } }))).status).toBe(413);
    expect((await list.POST(request({ document: [] }))).status).toBe(400);
    expect(createFromBody).not.toHaveBeenCalled();
  });
});

describe('/api/ruleset-definitions/[id]', () => {
  it('GET returns the detail for a viewer', async () => {
    vi.mocked(getRulesetDetail).mockResolvedValue({ definition: { id: ID }, draft: null, published: null, versions: [], check: null } as never);
    const res = await item.GET(request(), ctx({ id: ID }));
    expect(res.status).toBe(200);
    expect(getRulesetDetail).toHaveBeenCalledWith(expect.objectContaining({ playerId: ME }), expect.objectContaining({ id: ID }));
  });

  it('a malformed or unknown id is a 404 from the guard', async () => {
    vi.mocked(requireRulesetViewer).mockRejectedValue(new RulesetStudioError('ruleset_not_found'));
    const res = await item.GET(request(), ctx({ id: 'nope' }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('ruleset_not_found');
  });

  it('PATCH changes the visibility and audits the before and after', async () => {
    vi.mocked(changeVisibility).mockResolvedValue({ id: ID, visibility: 'league' } as never);
    const res = await item.PATCH(request({ visibility: 'league' }), ctx({ id: ID }));
    expect(res.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'ruleset.visibility', changes: { visibility: { before: 'private', after: 'league' } } }));
    expect((await item.PATCH(request({ visibility: 'public' }), ctx({ id: ID }))).status).toBe(400);
  });

  it('DELETE answers ruleset_in_use as 409 and maps a league in the trash to its own 409', async () => {
    vi.mocked(removeDefinition).mockRejectedValue(new RulesetStudioError('ruleset_in_use', { count: 2 }));
    const used = await item.DELETE(request(), ctx({ id: ID }));
    expect(used.status).toBe(409);
    expect((await used.json()).code).toBe('ruleset_in_use');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(removeDefinition).mockRejectedValue({ code: '23503', message: 'violates foreign key constraint "league_trash_rulesets_ruleset_id_fkey" on table "league_trash_rulesets"' });
    const trashed = await item.DELETE(request(), ctx({ id: ID }));
    errorSpy.mockRestore();
    expect(trashed.status).toBe(409);
    expect((await trashed.json()).code).toBe('ruleset_in_trashed_league');

    vi.mocked(removeDefinition).mockResolvedValue(undefined);
    const ok = await item.DELETE(request(), ctx({ id: ID }));
    expect((await ok.json()).data).toEqual({ deleted: true });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'ruleset.delete', resource_id: ID }));
  });

  it('DELETE refuses someone who may only view the ruleset before touching anything', async () => {
    vi.mocked(requireRulesetViewer).mockResolvedValue(access({ owner_id: 'someone-else', visibility: 'gallery' }));
    const res = await item.DELETE(request(), ctx({ id: ID }));
    expect(res.status).toBe(403);
    expect(removeDefinition).not.toHaveBeenCalled();
  });
});

describe('draft, publish, fork', () => {
  it('PUT saves a draft with a compare-and-set; a stale revision answers 409 with the current revision; saves are not audited', async () => {
    const document = newRulesetDocument('Spring OU', 'en', 'gen9ou');
    vi.mocked(saveDraft).mockResolvedValue({ draft_rev: 3, updated_at: 'now', name: ltext('en', 'x'), check: { ok: true } as never });
    const put = (body: unknown) => draft.PUT(new NextRequest('http://localhost/x', { method: 'PUT', body: JSON.stringify(body) }), ctx({ id: ID }));
    expect((await put({ draft_rev: 2, document })).status).toBe(200);
    expect(vi.mocked(saveDraft).mock.calls[0][1]).toEqual({ draftRev: 2, document });
    expect(logAuditEvent).not.toHaveBeenCalled();

    vi.mocked(saveDraft).mockRejectedValue(new RulesetStudioError('ruleset_stale_revision', undefined, { draft_rev: 5 }));
    const stale = await put({ draft_rev: 2, document });
    expect(stale.status).toBe(409);
    expect((await stale.json()).params).toEqual({ draft_rev: 5 });
    expect((await put({ draft_rev: 2, document: 'x' })).status).toBe(400);
  });

  it('POST publish returns 201 and audits the version number and both hashes', async () => {
    vi.mocked(publish).mockResolvedValue({ version: { version_no: 2, content_hash: 'c', resolved_hash: 'r' }, definition: { id: ID } } as never);
    const res = await publishRoute.POST(request({ draft_rev: 2 }), ctx({ id: ID }));
    expect(res.status).toBe(201);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'ruleset.publish', metadata: { version_no: 2, content_hash: 'c', resolved_hash: 'r' } }));
    vi.mocked(publish).mockRejectedValue(new RulesetStudioError('ruleset_document_invalid', { count: 2 }));
    expect((await publishRoute.POST(request({ draft_rev: 2 }), ctx({ id: ID }))).status).toBe(422);
  });

  it('POST fork and preset fork create a new ruleset for the caller and audit where it came from', async () => {
    vi.mocked(forkDefinition).mockResolvedValue({ definition: { id: 'new', slug: 'copy' } as never, check: {} as never });
    const forked = await fork.POST(request({}), ctx({ id: ID }));
    expect(forked.status).toBe(201);
    expect(logAuditEvent).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'ruleset.fork', metadata: { forked_from: ID, source_slug: 'spring-ou' } }));

    vi.mocked(forkPreset).mockResolvedValue({ definition: { id: 'new2', slug: 'gen9ou' } as never, check: {} as never });
    expect((await presetFork.POST(request({}), ctx({ presetId: 'gen9ou' }))).status).toBe(201);
    expect(forkPreset).toHaveBeenCalledWith(expect.objectContaining({ playerId: ME }), 'gen9ou', { slug: undefined, tourOverlay: undefined });
    vi.mocked(forkPreset).mockRejectedValue(new RulesetStudioError('ruleset_preset_unknown'));
    expect((await presetFork.POST(request({}), ctx({ presetId: 'nope' }))).status).toBe(404);
  });

  it('the preset fork passes the Smogon tour toggle only for a preset that has documented extras', async () => {
    vi.mocked(forkPreset).mockClear();
    vi.mocked(forkPreset).mockResolvedValue({ definition: { id: 'new3', slug: 'gen9natdexdraft' } as never, check: {} as never });
    const draft = await presetFork.POST(request({ tour_overlay: true }), ctx({ presetId: 'gen9natdexdraft' }));
    expect(draft.status).toBe(201);
    expect(forkPreset).toHaveBeenCalledWith(expect.objectContaining({ playerId: ME }), 'gen9natdexdraft', { slug: undefined, tourOverlay: true });
    expect(logAuditEvent).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'ruleset.fork', metadata: { preset: 'gen9natdexdraft', tour_overlay: true } }));

    // A preset without documented extras refuses the toggle before anything is created.
    vi.mocked(forkPreset).mockClear();
    const ou = await presetFork.POST(request({ tour_overlay: true }), ctx({ presetId: 'gen9ou' }));
    expect(ou.status).toBe(400);
    expect(await ou.json()).toMatchObject({ code: 'validation_failed' });
    expect(forkPreset).not.toHaveBeenCalled();

    // Switched off, the toggle is no request at all.
    expect((await presetFork.POST(request({ tour_overlay: false }), ctx({ presetId: 'gen9ou' }))).status).toBe(201);
    expect(forkPreset).toHaveBeenCalledWith(expect.anything(), 'gen9ou', { slug: undefined, tourOverlay: false });
  });
});

describe('pins, usage, versions', () => {
  const body = { to_version_no: 2, targets: [{ kind: 'season', id: SEASON }, { kind: 'tournament', id: ID }], confirm_started: [SEASON] };

  it('moves the pins, expires the public reads of every moved target and audits one event per target', async () => {
    vi.mocked(movePins).mockResolvedValue({
      version_id: 'v2', version_no: 2,
      moved: [
        { kind: 'season', id: SEASON, name: 'Spring League', from_version_id: 'v1', started: true, difference: null },
        { kind: 'tournament', id: ID, name: 'Groups', from_version_id: 'v1', started: false, difference: null },
      ],
    });
    vi.mocked(getPinTargetStates).mockResolvedValue([
      { kind: 'season', id: SEASON, name: 'Spring League', status: 'active', season_id: null, ruleset_id: 'v2' },
      { kind: 'tournament', id: ID, name: 'Groups', status: 'upcoming', season_id: SEASON, ruleset_id: 'v2' },
    ]);
    const res = await pins.POST(request(body), ctx({ id: ID }));
    expect(res.status).toBe(200);
    expect(movePins).toHaveBeenCalledWith(expect.objectContaining({ toVersionNo: 2, confirmStarted: [SEASON] }));
    expect(expireSeasonReads).toHaveBeenCalledWith(SEASON);
    expect(expireTournamentReads).toHaveBeenCalledWith(ID, SEASON);
    expect(vi.mocked(logAuditEvent).mock.calls.map(([e]) => [e.action, e.resource_type, e.resource_id])).toEqual([['ruleset.pin', 'season', SEASON], ['ruleset.pin', 'tournament', ID]]);
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].changes).toEqual({ ruleset_id: { before: 'v1', after: 'v2' } });
  });

  it('a started target without a confirmation is a 409 that names it, with no cache expiry and no audit', async () => {
    vi.mocked(movePins).mockRejectedValue(new RulesetStudioError('ruleset_pin_confirm_required', { targets: 'Spring League' }));
    const res = await pins.POST(request({ ...body, confirm_started: [] }), ctx({ id: ID }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('ruleset_pin_confirm_required');
    expect(expireSeasonReads).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect((await pins.POST(request({ ...body, targets: [] }), ctx({ id: ID }))).status).toBe(400);
  });

  describe('POST .../pins/impact', () => {
    const impactBody = { to_version_no: 2, targets: body.targets };
    const answer = { version_no: 2, checked: 9, would_break: 3, truncated: false, targets: [] };

    it('answers the count for a viewer, with the live caller as the actor and the targets of the request', async () => {
      vi.mocked(computePinImpact).mockResolvedValue(answer);

      const res = await pinImpact.POST(request(impactBody), ctx({ id: ID }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: answer });
      expect(computePinImpact).toHaveBeenCalledWith(expect.objectContaining({ actor: expect.objectContaining({ playerId: ME }), toVersionNo: 2, targets: body.targets }));
      expect(requireRulesetViewer).toHaveBeenCalledWith(ID);
    });

    it('writes nothing: no cache expiry, no audit event, no pin write', async () => {
      vi.mocked(computePinImpact).mockResolvedValue(answer);
      await pinImpact.POST(request(impactBody), ctx({ id: ID }));
      expect(expireSeasonReads).not.toHaveBeenCalled();
      expect(expireTournamentReads).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
      expect(movePins).not.toHaveBeenCalled();
    });

    it('has its own rate limit bucket, checked before the check runs, and a refusal names the wait', async () => {
      vi.mocked(computePinImpact).mockResolvedValue(answer);
      await pinImpact.POST(request(impactBody), ctx({ id: ID }));
      expect(checkRateLimit).toHaveBeenCalledWith('ruleset-pin-impact', ME, { limit: 60, windowSeconds: 3600 });

      vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 17 } as never);
      vi.mocked(computePinImpact).mockClear();
      const limited = await pinImpact.POST(request(impactBody), ctx({ id: ID }));
      expect(limited.status).toBe(429);
      expect(limited.headers.get('Retry-After')).toBe('17');
      expect(computePinImpact).not.toHaveBeenCalled();
    });

    it('refuses a body the move itself would not take: no targets, too many, a stray confirmation or a bad version', async () => {
      for (const bad of [
        { ...impactBody, targets: [] },
        { ...impactBody, targets: Array.from({ length: 51 }, () => ({ kind: 'season', id: SEASON })) },
        { ...impactBody, confirm_started: [SEASON] },
        { ...impactBody, to_version_no: 0 },
        { targets: impactBody.targets },
      ]) {
        expect((await pinImpact.POST(request(bad), ctx({ id: ID }))).status).toBe(400);
      }
      expect(computePinImpact).not.toHaveBeenCalled();
    });

    it('passes the refusals of the guard and of the check through: not found (404), not administered (403), a finished target (409)', async () => {
      vi.mocked(requireRulesetViewer).mockRejectedValue(new RulesetStudioError('ruleset_not_found'));
      expect((await pinImpact.POST(request(impactBody), ctx({ id: ID }))).status).toBe(404);

      vi.mocked(requireRulesetViewer).mockResolvedValue(access());
      vi.mocked(computePinImpact).mockRejectedValue(new AuthError('Admin access required for this league or phase', 403, 'forbidden'));
      expect((await pinImpact.POST(request(impactBody), ctx({ id: ID }))).status).toBe(403);

      vi.mocked(computePinImpact).mockRejectedValue(new RulesetStudioError('ruleset_pin_locked'));
      const locked = await pinImpact.POST(request(impactBody), ctx({ id: ID }));
      expect(locked.status).toBe(409);
      expect((await locked.json()).code).toBe('ruleset_pin_locked');
    });
  });

  it('usage is the viewer\'s view of the pins; the version route rejects a number that is no version number', async () => {
    vi.mocked(listUsage).mockResolvedValue({ counts: [], targets: null });
    expect((await usage.GET(request(), ctx({ id: ID }))).status).toBe(200);

    vi.mocked(getRulesetVersion).mockResolvedValue({ version_no: 2 } as never);
    expect((await versions.GET(request(), ctx({ id: ID, no: '2' }))).status).toBe(200);
    for (const no of ['0', '-1', '1.5', 'abc', '99999999999']) expect((await versions.GET(request(), ctx({ id: ID, no }))).status, no).toBe(404);
    vi.mocked(getRulesetVersion).mockResolvedValue(null);
    expect((await versions.GET(request(), ctx({ id: ID, no: '7' }))).status).toBe(404);
  });
});
