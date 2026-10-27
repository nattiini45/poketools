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
  getFormatDefinitionMeta: vi.fn(),
  getFormatVersion: vi.fn(),
  listFormatVersions: vi.fn(),
  publishFormatVersion: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/players', () => ({ resolvePlayerNames: vi.fn() }));

import { revalidateTag } from 'next/cache';
import { AuthError, requireFormatViewer } from '@/lib/auth/helpers';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import {
  getFormatDefinitionDraft,
  getFormatDefinitionMeta,
  getFormatVersion,
  listFormatVersions,
  publishFormatVersion,
} from '@/lib/supabase/queries/format-definitions';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import { PRESETS, contentHash } from '@/lib/format-kit';
import { ltext } from '@/lib/studio-core/ltext';
import { FormatStudioError } from '@/lib/format-studio/errors';
import type { FormatDefinitionMeta, FormatVersion } from '@/lib/format-studio/library-types';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import type { SessionPlayer } from '@/types/auth';
import { POST } from '../[id]/publish/route';

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
const stored = (): FormatVersion => ({
  id: 'v-new',
  definition_id: ID,
  version_no: 1,
  schema_version: 1,
  content_hash: 'a'.repeat(64),
  changelog: null,
  created_by: OWNER,
  created_at: '2026-10-06T00:00:00.000Z',
  spec: cup(),
  status: 'published',
});

const params = (id: string = ID) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new NextRequest(`http://localhost/api/formats/${ID}/publish`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireFormatViewer).mockResolvedValue({ player: player(), definition: meta() });
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 29, retryAfterSeconds: 0 });
  vi.mocked(getFormatDefinitionDraft).mockResolvedValue({ document: cup(), draft_rev: 3 });
  vi.mocked(publishFormatVersion).mockResolvedValue({ versionId: 'v-new', versionNo: 1 });
  vi.mocked(getFormatVersion).mockResolvedValue(stored());
  vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta({ current_version_id: 'v-new' }));
  vi.mocked(listFormatVersions).mockResolvedValue([{ ...stored() }]);
  vi.mocked(resolvePlayerNames).mockResolvedValue({ [OWNER]: 'League Admin' });
});

describe('POST /api/formats/[id]/publish', () => {
  it('answers 401 to an unauthenticated caller and 403 to a player without an admin tier', async () => {
    vi.mocked(requireFormatViewer).mockRejectedValue(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await POST(post({ draft_rev: 3 }), params())).status).toBe(401);
    vi.mocked(requireFormatViewer).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await POST(post({ draft_rev: 3 }), params())).status).toBe(403);
    expect(publishFormatVersion).not.toHaveBeenCalled();
  });

  it('answers 404 for a malformed or unknown id', async () => {
    vi.mocked(requireFormatViewer).mockRejectedValue(new FormatStudioError('format_not_found'));
    const response = await POST(post({ draft_rev: 3 }), params('nope'));
    expect(response.status).toBe(404);
    expect(publishFormatVersion).not.toHaveBeenCalled();
  });

  it('answers with the definition row as the database left it after the publish: the listed name is the published one', async () => {
    vi.mocked(requireFormatViewer).mockResolvedValue({ player: player(), definition: meta({ visibility: 'league', current_version_id: 'v1' }) });
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(
      meta({ visibility: 'league', current_version_id: 'v-new', name: ltext('en', 'Published name'), description: ltext('en', 'Published summary') }),
    );
    const response = await POST(post({ draft_rev: 3 }), params());
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data.definition.name).toEqual(ltext('en', 'Published name'));
    expect(body.data.definition.description).toEqual(ltext('en', 'Published summary'));
    expect(revalidateTag).toHaveBeenCalledWith('format-library', { expire: 0 });
  });

  it('publishes the parsed draft with its canonical hash: 201, the version, the expiry and the audit event', async () => {
    const changelog = ltext('en', 'First version');
    const response = await POST(post({ draft_rev: 3, changelog }), params());
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data.version).toMatchObject({ id: 'v-new', version_no: 1 });
    expect(body.data.version).not.toHaveProperty('spec');
    expect(body.data.definition).toMatchObject({ id: ID, current_version: { id: 'v-new', version_no: 1 } });

    const call = vi.mocked(publishFormatVersion).mock.calls[0][0];
    expect(call).toMatchObject({ definitionId: ID, expectedRev: 3, actorId: OWNER, changelog });
    expect(call.contentHash).toBe(contentHash(call.specJson));
    expect(checkRateLimit).toHaveBeenCalledWith('format-publish', OWNER, { limit: 30, windowSeconds: 3600 });
    expect(revalidateTag).toHaveBeenCalledWith('format-library', { expire: 0 });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'format.publish',
        actor_id: OWNER,
        resource_type: 'format',
        resource_id: ID,
        resource_name: 'spring-cup',
        metadata: { version_no: 1, content_hash: 'a'.repeat(64) },
      }),
    );
    expectNoPrivatePlayerData(body);
  });

  it('answers 409 format_stale_revision before it compiles when the client saw an older draft', async () => {
    vi.mocked(getFormatDefinitionDraft).mockResolvedValue({ document: cup(), draft_rev: 5 });
    const response = await POST(post({ draft_rev: 3 }), params());
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.code).toBe('format_stale_revision');
    expect(body.params).toMatchObject({ draft_rev: 5 });
    expect(publishFormatVersion).not.toHaveBeenCalled();
  });

  it('answers 422 format_publish_invalid with the error count and calls no database function', async () => {
    vi.mocked(getFormatDefinitionDraft).mockResolvedValue({
      document: { schema_version: 1, identity: { name: ltext('en', 'Half built') }, stages: [] },
      draft_rev: 3,
    });
    const response = await POST(post({ draft_rev: 3 }), params());
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body.code).toBe('format_publish_invalid');
    expect(body.params.count).toBeGreaterThanOrEqual(1);
    expect(publishFormatVersion).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers 409 format_nothing_to_publish when the function finds the draft equal to the latest version', async () => {
    vi.mocked(publishFormatVersion).mockRejectedValue(new FormatStudioError('format_nothing_to_publish'));
    const response = await POST(post({ draft_rev: 3 }), params());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_nothing_to_publish');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('answers 403 to another admin, even for a format shared with all admins', async () => {
    vi.mocked(requireFormatViewer).mockResolvedValue({ player: player({ playerId: OTHER }), definition: meta({ visibility: 'league' }) });
    const response = await POST(post({ draft_rev: 3 }), params());
    expect(response.status).toBe(403);
    expect(publishFormatVersion).not.toHaveBeenCalled();
  });

  it('answers 403 format_published_locked when an owner publishes a gallery format, but lets a site admin', async () => {
    vi.mocked(requireFormatViewer).mockResolvedValue({ player: player(), definition: meta({ visibility: 'gallery' }) });
    const locked = await POST(post({ draft_rev: 3 }), params());
    expect(locked.status).toBe(403);
    expect((await locked.json()).code).toBe('format_published_locked');
    expect(publishFormatVersion).not.toHaveBeenCalled();

    vi.mocked(requireFormatViewer).mockResolvedValue({ player: player({ playerId: OTHER, isAdmin: true }), definition: meta({ visibility: 'gallery' }) });
    expect((await POST(post({ draft_rev: 3 }), params())).status).toBe(201);
  });

  it('answers 403 format_preset_locked for a preset row, but lets a site admin publish it', async () => {
    vi.mocked(requireFormatViewer).mockResolvedValue({ player: player(), definition: meta({ kind: 'preset' }) });
    const locked = await POST(post({ draft_rev: 3 }), params());
    expect(locked.status).toBe(403);
    expect((await locked.json()).code).toBe('format_preset_locked');

    vi.mocked(requireFormatViewer).mockResolvedValue({ player: player({ playerId: OTHER, isAdmin: true }), definition: meta({ kind: 'preset' }) });
    expect((await POST(post({ draft_rev: 3 }), params())).status).toBe(201);
  });

  it.each([{}, { draft_rev: 0 }, { draft_rev: 3, changelog: 'text' }, { draft_rev: 3, visibility: 'gallery' }])(
    'answers 400 validation_failed for %j',
    async (body) => {
      const response = await POST(post(body), params());
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('validation_failed');
      expect(publishFormatVersion).not.toHaveBeenCalled();
    },
  );

  it('answers 400 invalid_json for an empty body', async () => {
    const response = await POST(post(''), params());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_json');
  });

  it('answers 429 with Retry-After and publishes nothing when the rate limit says no', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 120 });
    const response = await POST(post({ draft_rev: 3 }), params());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(getFormatDefinitionDraft).not.toHaveBeenCalled();
    expect(publishFormatVersion).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
