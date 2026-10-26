import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The routes expire the format-library tag after a write. Outside a Next request `revalidateTag` throws.
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
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/cache/format-reads', () => ({ formatReads: { gallery: vi.fn(), seasonFormat: vi.fn() } }));
vi.mock('@/lib/supabase/queries/format-definitions', () => ({
  listFormatDefinitions: vi.fn(),
  createFormatDefinition: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/players', () => ({ resolvePlayerNames: vi.fn() }));

import { revalidateTag } from 'next/cache';
import { AuthError, requireAnyAdmin } from '@/lib/auth/helpers';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import { formatReads } from '@/lib/cache/format-reads';
import { createFormatDefinition, listFormatDefinitions } from '@/lib/supabase/queries/format-definitions';
import { PRESETS } from '@/lib/format-kit';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';
import type { SessionPlayer } from '@/types/auth';
import type { FormatDefinitionSummary, FormatGalleryItem } from '@/lib/format-studio/library-types';
import { GET, POST } from '../route';

const OWNER = '11111111-1111-4111-8111-111111111111';

const leagueAdmin: SessionPlayer = {
  playerId: OWNER,
  name: 'League Admin',
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
};
const siteAdmin: SessionPlayer = { ...leagueAdmin, playerId: '99999999-9999-4999-8999-999999999999', name: 'Site Admin', isAdmin: true };

const summary: FormatDefinitionSummary = {
  id: '33333333-3333-4333-8333-333333333333',
  slug: 'spring-cup',
  name: { base: 'en', en: { v: 'Spring cup', s: 'human' } },
  description: null,
  kind: 'custom',
  visibility: 'private',
  forked_from: null,
  draft_rev: 1,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
  owner: { id: OWNER, name: 'League Admin' },
  current_version: null,
};

const galleryItem: FormatGalleryItem = {
  id: summary.id,
  slug: 'spring-cup',
  name: summary.name,
  description: null,
  kind: 'custom',
  version_no: 1,
  content_hash: 'a'.repeat(64),
  updated_at: '2026-10-02T00:00:00.000Z',
};

const listRequest = (query = '') => new NextRequest(`http://localhost/api/formats${query}`);
const postRequest = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/formats', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(leagueAdmin);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 19, retryAfterSeconds: 0 });
  vi.mocked(createFormatDefinition).mockImplementation(async (input) => ({
    id: summary.id,
    slug: input.slug,
    name: input.name,
    description: input.description,
    kind: 'custom',
    owner_id: input.ownerId,
    visibility: 'private',
    forked_from: input.forkedFrom,
    draft_rev: 1,
    current_version_id: null,
    created_at: summary.created_at,
    updated_at: summary.updated_at,
  }));
});

describe('GET /api/formats', () => {
  it('answers 401 to an unauthenticated caller', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Not authenticated', 401, 'unauthenticated'));
    const response = await GET(listRequest());
    expect(response.status).toBe(401);
    expect(listFormatDefinitions).not.toHaveBeenCalled();
  });

  it('answers 403 to a player without an admin tier', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    const response = await GET(listRequest());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('forbidden');
    expect(listFormatDefinitions).not.toHaveBeenCalled();
  });

  it('lists with the live actor, the defaults and the page the caller asked for', async () => {
    vi.mocked(listFormatDefinitions).mockResolvedValue({ items: [summary], total: 41 });
    const response = await GET(listRequest('?scope=shared&kind=custom&visibility=league&limit=10&offset=20'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { items: [summary], total: 41, limit: 10, offset: 20 } });
    expect(listFormatDefinitions).toHaveBeenCalledWith({
      actor: { playerId: OWNER, isAdmin: false },
      scope: 'shared',
      visibility: 'league',
      kind: 'custom',
      limit: 10,
      offset: 20,
    });
    expectNoPrivatePlayerData(body);
  });

  it('defaults to scope all, 50 items from the start; a site admin is passed as one', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue(siteAdmin);
    vi.mocked(listFormatDefinitions).mockResolvedValue({ items: [], total: 0 });
    await GET(listRequest());
    expect(listFormatDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { playerId: siteAdmin.playerId, isAdmin: true }, scope: 'all', limit: 50, offset: 0 }),
    );
  });

  it('serves scope=gallery from the cached shelf without touching the list query', async () => {
    vi.mocked(formatReads.gallery).mockResolvedValue([galleryItem]);
    const response = await GET(listRequest('?scope=gallery'));
    const body = await response.json();
    expect(body).toEqual({ success: true, data: { items: [galleryItem] } });
    expect(listFormatDefinitions).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('owner');
    expectNoPrivatePlayerData(body);
  });

  it.each(['?scope=everything', '?limit=0', '?limit=101', '?offset=-1', '?visibility=public', '?owner=x'])(
    'answers 400 validation_failed for %s',
    async (query) => {
      const response = await GET(listRequest(query));
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('validation_failed');
      expect(listFormatDefinitions).not.toHaveBeenCalled();
    },
  );

  it('does not leak a database error', async () => {
    vi.mocked(listFormatDefinitions).mockRejectedValue(new Error('connection to db.internal refused'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await GET(listRequest());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('db.internal');
    log.mockRestore();
  });
});

describe('POST /api/formats', () => {
  it('answers 401 to an unauthenticated caller and 403 to a player without an admin tier', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await POST(postRequest({ name: 'Cup', base_locale: 'en' }))).status).toBe(401);
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await POST(postRequest({ name: 'Cup', base_locale: 'en' }))).status).toBe(403);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('creates a private format from a name: 201, the check, the expiry and the audit event', async () => {
    const response = await POST(postRequest({ name: 'Spring cup', base_locale: 'en' }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.definition).toMatchObject({
      slug: 'spring-cup',
      kind: 'custom',
      visibility: 'private',
      owner: { id: OWNER, name: 'League Admin' },
      current_version: null,
    });
    expect(body.data.check.ok).toBe(false);
    expect(body.data.definition).not.toHaveProperty('owner_id');
    expectNoPrivatePlayerData(body);

    expect(checkRateLimit).toHaveBeenCalledWith('format-create', OWNER, { limit: 20, windowSeconds: 3600 });
    expect(revalidateTag).toHaveBeenCalledWith('format-library', { expire: 0 });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'format.create',
        actor_id: OWNER,
        actor_name: 'League Admin',
        resource_type: 'format',
        resource_id: summary.id,
        resource_name: 'spring-cup',
      }),
    );
  });

  it('creates from a whole document; the example compiles clean', async () => {
    const document = PRESETS.find((p) => p.id === 'cup')!.definition;
    const response = await POST(postRequest({ document, slug: 'my-cup' }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data.definition.slug).toBe('my-cup');
    expect(body.data.check.ok).toBe(true);
    expect(vi.mocked(createFormatDefinition).mock.calls[0][0]).toMatchObject({ ownerId: OWNER, forkedFrom: null });
  });

  it('answers 429 with Retry-After and does no work when the rate limit says no', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    const request = postRequest({ name: 'Cup', base_locale: 'en' });
    const text = vi.spyOn(request, 'text');
    const response = await POST(request);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    expect(text).not.toHaveBeenCalled();
    expect(createFormatDefinition).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty envelope', {}],
    ['both shapes at once', { document: {}, name: 'x', base_locale: 'en' }],
    ['a name without a language', { name: 'x' }],
    ['an unknown member', { name: 'x', base_locale: 'en', owner_id: OWNER }],
    ['a slug that is not one', { name: 'x', base_locale: 'en', slug: 'Not A Slug' }],
    ['a name with a NUL character', { name: 'Spring\u0000cup', base_locale: 'en' }],
    ['a name with a lone surrogate', { name: 'Spring\uD800cup', base_locale: 'de' }],
  ])('answers 400 validation_failed for %s', async (_label, body) => {
    const response = await POST(postRequest(body));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_json for a body that does not parse', async () => {
    const response = await POST(postRequest('{"name": '));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_json');
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('answers 413 for a body over 1 MiB, by header or by size, before anything is parsed', async () => {
    const byHeader = await POST(postRequest('{}', { 'content-length': '2000000' }));
    expect(byHeader.status).toBe(413);
    expect((await byHeader.json()).code).toBe('format_document_too_large');
    const bySize = await POST(postRequest({ name: 'x'.repeat(1_100_000), base_locale: 'en' }));
    expect(bySize.status).toBe(413);
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('runs the document pre-check before the envelope and the database', async () => {
    let deep: unknown = [];
    for (let i = 0; i < 100; i += 1) deep = [deep];
    const tooDeep = await POST(postRequest({ document: { a: deep } }));
    expect(tooDeep.status).toBe(422);
    expect((await tooDeep.json()).code).toBe('format_document_too_deep');
    const notObject = await POST(postRequest({ document: [1, 2] }));
    expect(notObject.status).toBe(400);
    expect((await notObject.json()).code).toBe('format_document_not_object');
    const nul = await POST(postRequest({ document: { a: 'x\u0000y' } }));
    expect(nul.status).toBe(400);
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('answers 422 format_document_name_required for a document without a valid name', async () => {
    const response = await POST(postRequest({ document: { schema_version: 1, identity: { name: 'plain' }, stages: [] } }));
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('format_document_name_required');
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('answers 409 format_slug_taken for an explicit slug that is taken', async () => {
    const { FormatStudioError } = await import('@/lib/format-studio/errors');
    vi.mocked(createFormatDefinition).mockRejectedValue(new FormatStudioError('format_slug_taken'));
    const response = await POST(postRequest({ name: 'Cup', base_locale: 'en', slug: 'cup' }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_slug_taken');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('never puts a players row in the answer, even when the guard hands back a full row', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue({ ...leagueAdmin, ...fullPlayerRow() } as unknown as SessionPlayer);
    const response = await POST(postRequest({ name: 'Spring cup', base_locale: 'en' }));
    expect(response.status).toBe(201);
    expectNoPrivatePlayerData(await response.json());
  });
});
