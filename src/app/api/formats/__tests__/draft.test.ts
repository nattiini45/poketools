import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock('@/lib/auth/helpers', () => ({
  requireAnyAdmin: vi.fn(),
  requireFormatViewer: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/format-definitions', () => ({
  saveFormatDraft: vi.fn(),
  getFormatDefinitionMeta: vi.fn(),
}));

import { revalidateTag } from 'next/cache';
import { AuthError, requireFormatViewer } from '@/lib/auth/helpers';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { getFormatDefinitionMeta, saveFormatDraft } from '@/lib/supabase/queries/format-definitions';
import { PRESETS } from '@/lib/format-kit';
import { ltext } from '@/lib/studio-core/ltext';
import { FormatStudioError } from '@/lib/format-studio/errors';
import type { FormatDefinitionMeta } from '@/lib/format-studio/library-types';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import type { SessionPlayer } from '@/types/auth';
import { PUT } from '../[id]/draft/route';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';

const player = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: OWNER,
  name: 'League Admin',
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
  ...overrides,
});

const meta = (overrides: Partial<FormatDefinitionMeta> = {}): FormatDefinitionMeta => ({
  id: ID,
  slug: 'spring-cup',
  name: ltext('en', 'Spring cup'),
  description: null,
  kind: 'custom',
  owner_id: OWNER,
  visibility: 'private',
  forked_from: null,
  draft_rev: 3,
  current_version_id: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
  ...overrides,
});

const cup = () => structuredClone(PRESETS.find((p) => p.id === 'cup')!.definition);
const params = (id: string = ID) => ({ params: Promise.resolve({ id }) });
const put = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/formats/${ID}/draft`, {
    method: 'PUT',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireFormatViewer).mockResolvedValue({ player: player(), definition: meta() });
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 299, retryAfterSeconds: 0 });
  vi.mocked(saveFormatDraft).mockResolvedValue({ draft_rev: 4, updated_at: '2026-10-05T00:00:00.000Z' });
});

describe('PUT /api/formats/[id]/draft', () => {
  it('answers 401 to an unauthenticated caller and 403 to a player without an admin tier', async () => {
    vi.mocked(requireFormatViewer).mockRejectedValue(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await PUT(put({ draft_rev: 3, document: cup() }), params())).status).toBe(401);
    vi.mocked(requireFormatViewer).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await PUT(put({ draft_rev: 3, document: cup() }), params())).status).toBe(403);
    expect(saveFormatDraft).not.toHaveBeenCalled();
  });

  it('answers 404 for a malformed or unknown id', async () => {
    vi.mocked(requireFormatViewer).mockRejectedValue(new FormatStudioError('format_not_found'));
    const response = await PUT(put({ draft_rev: 3, document: cup() }), params('not-a-uuid'));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('format_not_found');
    expect(saveFormatDraft).not.toHaveBeenCalled();
  });

  it('saves with a compare-and-set on the revision the client saw, and answers with the new revision and the check', async () => {
    const response = await PUT(put({ draft_rev: 3, document: cup() }), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ draft_rev: 4, updated_at: '2026-10-05T00:00:00.000Z' });
    expect(body.data.name.en.v).toBe('Cup');
    expect(body.data.check.ok).toBe(true);
    expect(saveFormatDraft).toHaveBeenCalledWith(expect.objectContaining({ id: ID, expectedRev: 3 }));
    expect(checkRateLimit).toHaveBeenCalledWith('format-draft', OWNER, { limit: 300, windowSeconds: 600 });
    expect(revalidateTag).toHaveBeenCalledWith('format-library', { expire: 0 });
    expectNoPrivatePlayerData(body);
  });

  it('lets the owner of a gallery format save, without changing the name or description shown to other admins', async () => {
    vi.mocked(requireFormatViewer).mockResolvedValue({ player: player(), definition: meta({ visibility: 'gallery' }) });
    const response = await PUT(put({ draft_rev: 3, document: cup() }), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.name).toEqual(ltext('en', 'Spring cup'));
    const call = vi.mocked(saveFormatDraft).mock.calls[0][0];
    expect(call).not.toHaveProperty('name');
    expect(call).not.toHaveProperty('description');
  });

  it('accepts an invalid draft and reports the problems in the check', async () => {
    const document = { schema_version: 1, identity: { name: ltext('en', 'Half built') }, stages: [] };
    const response = await PUT(put({ draft_rev: 3, document }), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.check.ok).toBe(false);
    expect(body.data.check.diagnostics.length).toBeGreaterThan(0);
    expect(saveFormatDraft).toHaveBeenCalledTimes(1);
  });

  it('answers 409 format_stale_revision with the current revision when another save came first', async () => {
    vi.mocked(saveFormatDraft).mockResolvedValue(null);
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta({ draft_rev: 8 }));
    const response = await PUT(put({ draft_rev: 3, document: cup() }), params());
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.code).toBe('format_stale_revision');
    expect(body.params).toMatchObject({ draft_rev: 8 });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('answers 404 when the format was deleted in the meantime', async () => {
    vi.mocked(saveFormatDraft).mockResolvedValue(null);
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(null);
    expect((await PUT(put({ draft_rev: 3, document: cup() }), params())).status).toBe(404);
  });

  it('answers 403 to another admin, even when the format is shared with all admins', async () => {
    vi.mocked(requireFormatViewer).mockResolvedValue({ player: player({ playerId: OTHER }), definition: meta({ visibility: 'league' }) });
    const response = await PUT(put({ draft_rev: 3, document: cup() }), params());
    expect(response.status).toBe(403);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(saveFormatDraft).not.toHaveBeenCalled();
  });

  it('answers 403 format_preset_locked for a preset row, but lets a site admin save it', async () => {
    vi.mocked(requireFormatViewer).mockResolvedValue({ player: player(), definition: meta({ kind: 'preset' }) });
    const locked = await PUT(put({ draft_rev: 3, document: cup() }), params());
    expect(locked.status).toBe(403);
    expect((await locked.json()).code).toBe('format_preset_locked');
    expect(saveFormatDraft).not.toHaveBeenCalled();

    vi.mocked(requireFormatViewer).mockResolvedValue({ player: player({ playerId: OTHER, isAdmin: true }), definition: meta({ kind: 'preset' }) });
    expect((await PUT(put({ draft_rev: 3, document: cup() }), params())).status).toBe(200);
  });

  it.each([
    ['no revision', { document: {} }],
    ['revision 0', { draft_rev: 0, document: {} }],
    ['a fractional revision', { draft_rev: 1.5, document: {} }],
    ['no document', { draft_rev: 1 }],
    ['an unknown member', { draft_rev: 1, document: {}, name: 'x' }],
  ])('answers 400 validation_failed for %s', async (_label, body) => {
    const response = await PUT(put(body), params());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
    expect(saveFormatDraft).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_json for a body that does not parse', async () => {
    const response = await PUT(put('{"draft_rev": 1,'), params());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_json');
  });

  it('refuses a document the kit cannot even inspect, before the envelope and the database', async () => {
    let deep: unknown = [];
    for (let i = 0; i < 100; i += 1) deep = [deep];
    const tooDeep = await PUT(put({ draft_rev: 3, document: { a: deep } }), params());
    expect(tooDeep.status).toBe(422);
    expect((await tooDeep.json()).code).toBe('format_document_too_deep');
    const notObject = await PUT(put({ draft_rev: 3, document: 'text' }), params());
    expect(notObject.status).toBe(400);
    expect((await notObject.json()).code).toBe('format_document_not_object');
    expect(saveFormatDraft).not.toHaveBeenCalled();
  });

  it('answers 413 for a canonical document over 256 KB and for a raw body over 1 MiB', async () => {
    const big = { schema_version: 1, filler: 'x'.repeat(300_000) };
    const tooLarge = await PUT(put({ draft_rev: 3, document: big }), params());
    expect(tooLarge.status).toBe(413);
    expect((await tooLarge.json()).code).toBe('format_document_too_large');
    const raw = await PUT(put('{}', { 'content-length': '5000000' }), params());
    expect(raw.status).toBe(413);
    expect(saveFormatDraft).not.toHaveBeenCalled();
  });

  it('answers 413 format_document_too_large_to_store when the database size check says so', async () => {
    vi.mocked(saveFormatDraft).mockRejectedValue(new FormatStudioError('format_document_too_large_to_store'));
    const response = await PUT(put({ draft_rev: 3, document: cup() }), params());
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('format_document_too_large_to_store');
  });

  it('answers 429 with Retry-After and does no write when the rate limit says no', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    const request = put({ draft_rev: 3, document: cup() });
    const text = vi.spyOn(request, 'text');
    const response = await PUT(request, params());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(text).not.toHaveBeenCalled();
    expect(saveFormatDraft).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
