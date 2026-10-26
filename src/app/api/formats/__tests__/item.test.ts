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
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-definitions', () => ({
  getFormatDefinitionDraft: vi.fn(),
  getLatestPublishedVersion: vi.fn(),
  listFormatVersions: vi.fn(),
  setFormatVisibility: vi.fn(),
  countSeasonFormatsOfDefinition: vi.fn(),
  countFormatVersions: vi.fn(),
  deleteFormatDefinition: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/players', () => ({ resolvePlayerNames: vi.fn() }));

import { revalidateTag } from 'next/cache';
import { AuthError, requireFormatViewer } from '@/lib/auth/helpers';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import {
  countFormatVersions,
  countSeasonFormatsOfDefinition,
  deleteFormatDefinition,
  getFormatDefinitionDraft,
  getLatestPublishedVersion,
  listFormatVersions,
  setFormatVisibility,
} from '@/lib/supabase/queries/format-definitions';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import { PRESETS, compile, ltext, type FormatDefinition } from '@/lib/format-kit';
import { FormatStudioError } from '@/lib/format-studio/errors';
import type { FormatDefinitionMeta, FormatVersion, FormatVersionSummary } from '@/lib/format-studio/library-types';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import type { SessionPlayer } from '@/types/auth';
import { DELETE, GET, PATCH } from '../[id]/route';

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

const cup = (): FormatDefinition => compile(PRESETS.find((p) => p.id === 'cup')!.definition).definition as FormatDefinition;

const versionSummary: FormatVersionSummary = {
  id: 'v1',
  version_no: 1,
  schema_version: 1,
  content_hash: 'a'.repeat(64),
  changelog: null,
  created_by: OWNER,
  created_at: '2026-10-03T00:00:00.000Z',
};
const publishedVersion = (): FormatVersion => ({ ...versionSummary, definition_id: ID, spec: cup(), status: 'published' });

const params = (id: string = ID) => ({ params: Promise.resolve({ id }) });
const request = (method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/formats/${ID}`, { method, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });

function viewAs(who: SessionPlayer, definition: FormatDefinitionMeta) {
  vi.mocked(requireFormatViewer).mockResolvedValue({ player: who, definition });
}

beforeEach(() => {
  vi.resetAllMocks();
  viewAs(player(), meta());
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
  vi.mocked(resolvePlayerNames).mockResolvedValue({ [OWNER]: 'League Admin' });
  vi.mocked(listFormatVersions).mockResolvedValue([]);
  vi.mocked(getLatestPublishedVersion).mockResolvedValue(null);
  vi.mocked(getFormatDefinitionDraft).mockResolvedValue({ document: cup(), draft_rev: 3 });
});

describe.each([
  ['GET', () => GET(request('GET'), params())],
  ['PATCH', () => PATCH(request('PATCH', { visibility: 'league' }), params())],
  ['DELETE', () => DELETE(request('DELETE'), params())],
] as const)('%s /api/formats/[id]: access', (_method, call) => {
  it('answers 401 to an unauthenticated caller', async () => {
    vi.mocked(requireFormatViewer).mockRejectedValue(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await call()).status).toBe(401);
  });

  it('answers 403 to a player without an admin tier', async () => {
    vi.mocked(requireFormatViewer).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    const response = await call();
    expect(response.status).toBe(403);
    expect(setFormatVisibility).not.toHaveBeenCalled();
    expect(deleteFormatDefinition).not.toHaveBeenCalled();
  });

  it('answers 404 format_not_found for a malformed or unknown id', async () => {
    vi.mocked(requireFormatViewer).mockRejectedValue(new FormatStudioError('format_not_found'));
    const response = await call();
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('format_not_found');
    expect(setFormatVisibility).not.toHaveBeenCalled();
    expect(deleteFormatDefinition).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe('GET /api/formats/[id]', () => {
  it('gives the owner the summary, the published spec, the versions, the draft and its check', async () => {
    viewAs(player(), meta({ current_version_id: 'v1' }));
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(publishedVersion());
    vi.mocked(listFormatVersions).mockResolvedValue([versionSummary]);
    const response = await GET(request('GET'), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.definition).toMatchObject({ id: ID, slug: 'spring-cup', owner: { id: OWNER, name: 'League Admin' } });
    expect(body.data.definition).not.toHaveProperty('owner_id');
    expect(body.data.definition.current_version).toMatchObject({ id: 'v1', version_no: 1 });
    expect(body.data.published.spec.schema_version).toBe(1);
    expect(body.data.draft.draft_rev).toBe(3);
    expect(body.data.check.ok).toBe(true);
    expect(body.data.versions).toHaveLength(1);
    expectNoPrivatePlayerData(body);
  });

  it('gives another admin the summary and the published spec only', async () => {
    viewAs(player({ playerId: OTHER, name: 'Other Admin' }), meta({ visibility: 'league', current_version_id: 'v1' }));
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(publishedVersion());
    const response = await GET(request('GET'), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.draft).toBeNull();
    expect(body.data.check).toBeNull();
    expect(body.data.versions).toEqual([]);
    expect(body.data.published).not.toBeNull();
    expect(getFormatDefinitionDraft).not.toHaveBeenCalled();
    expectNoPrivatePlayerData(body);
  });

  it('gives a site admin the owner view of any definition', async () => {
    viewAs(player({ playerId: OTHER, isAdmin: true }), meta());
    const body = await (await GET(request('GET'), params())).json();
    expect(body.data.draft).not.toBeNull();
  });
});

describe('PATCH /api/formats/[id] (visibility)', () => {
  it('moves a published format to league: 200, the expiry and the audit event', async () => {
    viewAs(player(), meta({ current_version_id: 'v1' }));
    vi.mocked(setFormatVisibility).mockResolvedValue(meta({ visibility: 'league', current_version_id: 'v1' }));
    vi.mocked(listFormatVersions).mockResolvedValue([versionSummary]);
    const response = await PATCH(request('PATCH', { visibility: 'league' }), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.definition).toMatchObject({ visibility: 'league', owner: { id: OWNER, name: 'League Admin' } });
    expect(setFormatVisibility).toHaveBeenCalledWith(ID, 'league');
    expect(checkRateLimit).toHaveBeenCalledWith('format-write', OWNER, { limit: 60, windowSeconds: 3600 });
    expect(revalidateTag).toHaveBeenCalledWith('format-library', { expire: 0 });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'format.visibility',
        resource_type: 'format',
        resource_id: ID,
        resource_name: 'spring-cup',
        changes: { visibility: { before: 'private', after: 'league' } },
      }),
    );
    expectNoPrivatePlayerData(body);
  });

  it('answers 409 format_not_published when there is nothing to share yet', async () => {
    const response = await PATCH(request('PATCH', { visibility: 'league' }), params());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_not_published');
    expect(setFormatVisibility).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('answers 403 format_visibility_forbidden when an owner asks for the gallery', async () => {
    viewAs(player(), meta({ current_version_id: 'v1' }));
    const response = await PATCH(request('PATCH', { visibility: 'gallery' }), params());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('format_visibility_forbidden');
    expect(setFormatVisibility).not.toHaveBeenCalled();
  });

  it('answers 403 to another admin of a league-visible format', async () => {
    viewAs(player({ playerId: OTHER }), meta({ visibility: 'league', current_version_id: 'v1' }));
    const response = await PATCH(request('PATCH', { visibility: 'private' }), params());
    expect(response.status).toBe(403);
    expect(setFormatVisibility).not.toHaveBeenCalled();
  });

  it('answers 403 format_preset_locked for a preset row, but lets a site admin change it', async () => {
    viewAs(player(), meta({ kind: 'preset', current_version_id: 'v1' }));
    const locked = await PATCH(request('PATCH', { visibility: 'private' }), params());
    expect(locked.status).toBe(403);
    expect((await locked.json()).code).toBe('format_preset_locked');

    viewAs(player({ playerId: OTHER, isAdmin: true }), meta({ kind: 'preset', current_version_id: 'v1', visibility: 'gallery' }));
    vi.mocked(setFormatVisibility).mockResolvedValue(meta({ kind: 'preset', visibility: 'league' }));
    const allowed = await PATCH(request('PATCH', { visibility: 'league' }), params());
    expect(allowed.status).toBe(200);
  });

  it('lets a site admin put a published format in the gallery', async () => {
    viewAs(player({ playerId: OTHER, isAdmin: true }), meta({ current_version_id: 'v1' }));
    vi.mocked(setFormatVisibility).mockResolvedValue(meta({ visibility: 'gallery', current_version_id: 'v1' }));
    expect((await PATCH(request('PATCH', { visibility: 'gallery' }), params())).status).toBe(200);
  });

  it.each([{ visibility: 'public' }, {}, { visibility: 'league', owner_id: OTHER }])('answers 400 validation_failed for %j', async (body) => {
    const response = await PATCH(request('PATCH', body), params());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
    expect(setFormatVisibility).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_json for a body that does not parse', async () => {
    const response = await PATCH(request('PATCH', '{'), params());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_json');
  });

  it('answers 429 with Retry-After and writes nothing when the rate limit says no', async () => {
    viewAs(player(), meta({ current_version_id: 'v1' }));
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 17 });
    const response = await PATCH(request('PATCH', { visibility: 'league' }), params());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('17');
    expect(setFormatVisibility).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/formats/[id]', () => {
  beforeEach(() => {
    vi.mocked(countSeasonFormatsOfDefinition).mockResolvedValue(0);
    vi.mocked(countFormatVersions).mockResolvedValue(0);
  });

  it('deletes a never-published, unattached format: 200, the expiry and the audit event', async () => {
    const response = await DELETE(request('DELETE'), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { deleted: true } });
    expect(deleteFormatDefinition).toHaveBeenCalledWith(ID);
    expect(checkRateLimit).toHaveBeenCalledWith('format-write', OWNER, { limit: 60, windowSeconds: 3600 });
    expect(revalidateTag).toHaveBeenCalledWith('format-library', { expire: 0 });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'format.delete', resource_type: 'format', resource_id: ID, resource_name: 'spring-cup' }),
    );
  });

  it('answers 409 format_attached with the count', async () => {
    vi.mocked(countSeasonFormatsOfDefinition).mockResolvedValue(2);
    const response = await DELETE(request('DELETE'), params());
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: 'format_attached', params: { count: 2 } });
    expect(deleteFormatDefinition).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('answers 409 format_has_versions for a format that was published', async () => {
    vi.mocked(countFormatVersions).mockResolvedValue(1);
    const response = await DELETE(request('DELETE'), params());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_has_versions');
    expect(deleteFormatDefinition).not.toHaveBeenCalled();
  });

  it('answers 403 to another admin of a league-visible format, before any count or write', async () => {
    viewAs(player({ playerId: OTHER }), meta({ visibility: 'league' }));
    const response = await DELETE(request('DELETE'), params());
    expect(response.status).toBe(403);
    expect(countSeasonFormatsOfDefinition).not.toHaveBeenCalled();
    expect(deleteFormatDefinition).not.toHaveBeenCalled();
  });

  it('answers 403 format_preset_locked for a preset row', async () => {
    viewAs(player(), meta({ kind: 'preset' }));
    const response = await DELETE(request('DELETE'), params());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('format_preset_locked');
  });

  it('answers 429 with Retry-After and deletes nothing when the rate limit says no', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 9 });
    const response = await DELETE(request('DELETE'), params());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('9');
    expect(countSeasonFormatsOfDefinition).not.toHaveBeenCalled();
    expect(deleteFormatDefinition).not.toHaveBeenCalled();
  });
});
