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
  createFormatDefinition: vi.fn(),
  getFormatDefinitionDraft: vi.fn(),
  getLatestPublishedVersion: vi.fn(),
}));

import { revalidateTag } from 'next/cache';
import { AuthError, requireAnyAdmin, requireFormatViewer } from '@/lib/auth/helpers';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import {
  createFormatDefinition,
  getFormatDefinitionDraft,
  getLatestPublishedVersion,
} from '@/lib/supabase/queries/format-definitions';
import { PRESETS, type FormatDefinition } from '@/lib/format-kit';
import { ltext } from '@/lib/studio-core/ltext';
import { FormatStudioError } from '@/lib/format-studio/errors';
import type { FormatDefinitionMeta, FormatVersion } from '@/lib/format-studio/library-types';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import type { SessionPlayer } from '@/types/auth';
import { POST as forkStored } from '../[id]/fork/route';
import { POST as forkPreset } from '../presets/[presetId]/fork/route';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const NEW_ID = '44444444-4444-4444-8444-444444444444';

const player = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: OTHER,
  name: 'Other Admin',
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
  visibility: 'league',
  forked_from: null,
  draft_rev: 3,
  current_version_id: 'v1',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
  ...overrides,
});

const cup = (): FormatDefinition => structuredClone(PRESETS.find((p) => p.id === 'cup')!.definition);
const publishedVersion = (): FormatVersion => ({
  id: 'v1',
  definition_id: ID,
  version_no: 1,
  schema_version: 1,
  content_hash: 'a'.repeat(64),
  changelog: null,
  created_by: OWNER,
  created_at: '2026-10-03T00:00:00.000Z',
  spec: cup(),
  status: 'published',
});

const storedParams = (id: string = ID) => ({ params: Promise.resolve({ id }) });
const presetParams = (presetId: string) => ({ params: Promise.resolve({ presetId }) });
const post = (url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(player());
  vi.mocked(requireFormatViewer).mockResolvedValue({ player: player(), definition: meta() });
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 19, retryAfterSeconds: 0 });
  vi.mocked(getLatestPublishedVersion).mockResolvedValue(publishedVersion());
  vi.mocked(createFormatDefinition).mockImplementation(async (input) => ({
    id: NEW_ID,
    slug: input.slug,
    name: input.name,
    description: input.description,
    kind: 'custom',
    owner_id: input.ownerId,
    visibility: 'private',
    forked_from: input.forkedFrom,
    draft_rev: 1,
    current_version_id: null,
    created_at: '2026-10-07T00:00:00.000Z',
    updated_at: '2026-10-07T00:00:00.000Z',
  }));
});

describe('POST /api/formats/[id]/fork', () => {
  it('answers 401 to an unauthenticated caller and 403 to a player without an admin tier', async () => {
    vi.mocked(requireFormatViewer).mockRejectedValue(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await forkStored(post(`/api/formats/${ID}/fork`, {}), storedParams())).status).toBe(401);
    vi.mocked(requireFormatViewer).mockRejectedValue(new AuthError('Format access required', 403, 'forbidden'));
    expect((await forkStored(post(`/api/formats/${ID}/fork`, {}), storedParams())).status).toBe(403);
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('answers 404 for a malformed or unknown id', async () => {
    vi.mocked(requireFormatViewer).mockRejectedValue(new FormatStudioError('format_not_found'));
    const response = await forkStored(post('/api/formats/x/fork', {}), storedParams('x'));
    expect(response.status).toBe(404);
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('copies the published spec into a private format owned by the caller: 201, based_on, forked_from, the expiry, the audit event', async () => {
    const response = await forkStored(post(`/api/formats/${ID}/fork`, {}), storedParams());
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data.definition).toMatchObject({
      id: NEW_ID,
      slug: 'spring-cup-copy',
      kind: 'custom',
      visibility: 'private',
      forked_from: ID,
      owner: { id: OTHER, name: 'Other Admin' },
      current_version: null,
    });
    expect(body.data.check.ok).toBe(true);
    const input = vi.mocked(createFormatDefinition).mock.calls[0][0];
    expect(input.ownerId).toBe(OTHER);
    expect((input.document as { identity: { based_on: string } }).identity.based_on).toBe('spring-cup');
    expect(checkRateLimit).toHaveBeenCalledWith('format-create', OTHER, { limit: 20, windowSeconds: 3600 });
    expect(revalidateTag).toHaveBeenCalledWith('format-library', { expire: 0 });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'format.fork',
        actor_id: OTHER,
        resource_type: 'format',
        resource_id: NEW_ID,
        resource_name: 'spring-cup-copy',
        metadata: { forked_from: ID, source_slug: 'spring-cup' },
      }),
    );
    expectNoPrivatePlayerData(body);
  });

  it('works without a body and takes an explicit slug', async () => {
    expect((await forkStored(post(`/api/formats/${ID}/fork`), storedParams())).status).toBe(201);
    await forkStored(post(`/api/formats/${ID}/fork`, { slug: 'my-copy' }), storedParams());
    expect(vi.mocked(createFormatDefinition).mock.calls[1][0].slug).toBe('my-copy');
  });

  it('answers 409 format_not_published when a non-owner forks a format with nothing published', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(null);
    const response = await forkStored(post(`/api/formats/${ID}/fork`, {}), storedParams());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_not_published');
    expect(getFormatDefinitionDraft).not.toHaveBeenCalled();
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('lets the owner fork their own draft when nothing is published', async () => {
    vi.mocked(requireFormatViewer).mockResolvedValue({ player: player({ playerId: OWNER }), definition: meta({ visibility: 'private', current_version_id: null }) });
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(null);
    vi.mocked(getFormatDefinitionDraft).mockResolvedValue({ document: cup(), draft_rev: 3 });
    expect((await forkStored(post(`/api/formats/${ID}/fork`, {}), storedParams())).status).toBe(201);
  });

  it('answers 409 format_slug_taken for an explicit slug that is taken', async () => {
    vi.mocked(createFormatDefinition).mockRejectedValue(new FormatStudioError('format_slug_taken'));
    const response = await forkStored(post(`/api/formats/${ID}/fork`, { slug: 'taken' }), storedParams());
    expect(response.status).toBe(409);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it.each([{ slug: 'Not A Slug' }, { owner_id: OWNER }])('answers 400 validation_failed for %j', async (body) => {
    const response = await forkStored(post(`/api/formats/${ID}/fork`, body), storedParams());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After and copies nothing when the rate limit says no', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 61 });
    const response = await forkStored(post(`/api/formats/${ID}/fork`, {}), storedParams());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('61');
    expect(getLatestPublishedVersion).not.toHaveBeenCalled();
    expect(createFormatDefinition).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe('POST /api/formats/presets/[presetId]/fork', () => {
  it('answers 401 to an unauthenticated caller and 403 to a player without an admin tier', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await forkPreset(post('/api/formats/presets/cup/fork', {}), presetParams('cup'))).status).toBe(401);
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await forkPreset(post('/api/formats/presets/cup/fork', {}), presetParams('cup'))).status).toBe(403);
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it.each(PRESETS.map((p) => p.id))('forks the shipped example %s: 201, based_on the example, no forked_from', async (presetId) => {
    const response = await forkPreset(post(`/api/formats/presets/${presetId}/fork`, {}), presetParams(presetId));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data.definition).toMatchObject({ slug: presetId, kind: 'custom', visibility: 'private', forked_from: null, owner: { id: OTHER } });
    expect(body.data.check.ok).toBe(true);
    const input = vi.mocked(createFormatDefinition).mock.calls[0][0];
    expect((input.document as { identity: { based_on: string } }).identity.based_on).toBe(presetId);
    expect(revalidateTag).toHaveBeenCalledWith('format-library', { expire: 0 });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'format.fork', resource_type: 'format', metadata: { preset_id: presetId } }),
    );
    expectNoPrivatePlayerData(body);
  });

  it('pre-picks a rule preset on every stage when the body names one, and audits it', async () => {
    const response = await forkPreset(post('/api/formats/presets/cup/fork', { ruleset_preset: 'gen9doublesou' }), presetParams('cup'));
    expect(response.status).toBe(201);
    const input = vi.mocked(createFormatDefinition).mock.calls[0][0];
    const stages = (input.document as { stages: { ruleset: unknown; doubles: boolean }[] }).stages;
    expect(stages.map((s) => s.ruleset)).toEqual([
      { kind: 'preset', preset: 'gen9doublesou' },
      { kind: 'preset', preset: 'gen9doublesou' },
    ]);
    expect(stages.every((s) => s.doubles)).toBe(true);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'format.fork', metadata: { preset_id: 'cup', ruleset_preset: 'gen9doublesou' } }),
    );
  });

  it('answers 400 validation_failed for a rule preset the catalog does not know, and for one on the stored-format route', async () => {
    const unknown = await forkPreset(post('/api/formats/presets/cup/fork', { ruleset_preset: 'gen99xx' }), presetParams('cup'));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).code).toBe('validation_failed');
    const blank = await forkPreset(post('/api/formats/presets/cup/fork', { ruleset_preset: 'blank' }), presetParams('cup'));
    expect(blank.status).toBe(400);
    expect(createFormatDefinition).not.toHaveBeenCalled();
    // Only the example route takes a rule preset.
    const stored = await forkStored(post(`/api/formats/${ID}/fork`, { ruleset_preset: 'gen9ou' }), storedParams());
    expect(stored.status).toBe(400);
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('answers 404 format_preset_not_found for an unknown example and writes nothing', async () => {
    const response = await forkPreset(post('/api/formats/presets/nope/fork', {}), presetParams('nope'));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('format_preset_not_found');
    expect(createFormatDefinition).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('answers 400 validation_failed for an unknown member and 429 when rate limited', async () => {
    const bad = await forkPreset(post('/api/formats/presets/cup/fork', { name: 'x' }), presetParams('cup'));
    expect(bad.status).toBe(400);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 5 });
    const limited = await forkPreset(post('/api/formats/presets/cup/fork', {}), presetParams('cup'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('5');
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });
});
