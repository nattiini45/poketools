import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import sharp from 'sharp';
import {
  TEST_AVATAR_PUBLIC_BASE,
  TEST_SUPABASE_URL,
  createFakeAvatarBucket,
  makeTestPng,
  publicAvatarUrl,
} from '@/lib/avatar/__tests__/avatar-test-helpers';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

const storage = vi.hoisted(() => ({ bucket: null as unknown }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => storage.bucket),
    },
  },
}));

/**
 * In-memory stand-in for the query module. The players filter mirrors the SQL
 * in listPlayersNeedingAvatarThumb (this project's bucket URL prefix, not a
 * thumbnail), which has its own query test. Tests that must prove the route's
 * own path checks feed rows past this filter with mockResolvedValueOnce.
 */
const db = vi.hoisted(() => ({
  players: [] as Array<{ id: string; avatar_url: string | null }>,
  gallery: [] as Array<{ id: string; player_id: string; image_url: string }>,
}));

vi.mock('@/lib/supabase/queries/avatar-gallery', () => ({
  listPlayersNeedingAvatarThumb: vi.fn(async ({ limit, afterId }: { limit: number; afterId?: string | null }) =>
    db.players
      .filter((p): p is { id: string; avatar_url: string } =>
        typeof p.avatar_url === 'string'
        && p.avatar_url.startsWith('https://proj.supabase.co/storage/v1/object/public/avatars/')
        && !p.avatar_url.endsWith('.thumb.webp'))
      .filter((p) => !afterId || p.id > afterId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((p) => ({ ...p }))),
  listGalleryItemsForThumbs: vi.fn(async ({ limit, afterId }: { limit: number; afterId?: string | null }) =>
    db.gallery
      .filter((g) => !afterId || g.id > afterId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((g) => ({ ...g }))),
  swapPlayerAvatarUrl: vi.fn(async (playerId: string, fromUrl: string, toUrl: string) => {
    const player = db.players.find((p) => p.id === playerId);
    if (!player || player.avatar_url !== fromUrl) return false;
    player.avatar_url = toUrl;
    return true;
  }),
}));

import { POST } from '../route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { revalidatePath, revalidateTag } from 'next/cache';
import { logAuditEvent } from '@/lib/audit/log';
import {
  listGalleryItemsForThumbs,
  listPlayersNeedingAvatarThumb,
  swapPlayerAvatarUrl,
} from '@/lib/supabase/queries/avatar-gallery';

// ── Fixtures ───────────────────────────────────────────────────────────

const ADMIN = { playerId: 'admin-1', isAdmin: true, isResourceAdmin: false, status: 'active', name: 'Admin' };

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
}

function galleryPath(n: number): string {
  return `gallery/${uuid(900)}/${uuid(n)}.png`;
}

function makeRequest(body?: unknown, raw?: string): NextRequest {
  const text = raw ?? (body === undefined ? '' : JSON.stringify(body));
  return { text: vi.fn().mockResolvedValue(text) } as unknown as NextRequest;
}

async function call(body?: unknown, raw?: string) {
  const res = await POST(makeRequest(body, raw));
  return { res, json: await res.json() };
}

let png: Buffer;
let fake: ReturnType<typeof createFakeAvatarBucket>;

beforeAll(async () => {
  png = await makeTestPng(1024, 1024);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', TEST_SUPABASE_URL);
  fake = createFakeAvatarBucket();
  storage.bucket = fake.api;
  db.players = [];
  db.gallery = [];
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Three players on gallery originals; the second one's thumbnail already exists. */
function seedPlayers(): void {
  for (const n of [1, 2, 3]) {
    fake.objects.set(galleryPath(n), png);
    db.players.push({ id: uuid(n), avatar_url: publicAvatarUrl(galleryPath(n)) });
  }
  fake.objects.set(`${galleryPath(2)}.thumb.webp`, Buffer.from('existing-thumb'));
}

// ── Auth ───────────────────────────────────────────────────────────────

describe('POST /api/admin/avatars/thumbnails — auth', () => {
  it('rejects non-admins with 403 before reading or writing anything', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Admin access required', 403));

    const { res, json } = await call({ dryRun: false });

    expect(res.status).toBe(403);
    expect(json).toEqual({ success: false, error: 'Admin access required' });
    expect(listPlayersNeedingAvatarThumb).not.toHaveBeenCalled();
    expect(listGalleryItemsForThumbs).not.toHaveBeenCalled();
    expect(fake.api.upload).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers with 401', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Not authenticated', 401));

    const { res } = await call();

    expect(res.status).toBe(401);
    expect(listPlayersNeedingAvatarThumb).not.toHaveBeenCalled();
  });
});

// ── Input validation ───────────────────────────────────────────────────

describe('POST /api/admin/avatars/thumbnails — input', () => {
  it('defaults to a dry run of the players scope with limit 10 when the body is empty', async () => {
    const { res, json } = await call();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ scope: 'players', dryRun: true, limit: 10, cursor: null });
    expect(listPlayersNeedingAvatarThumb).toHaveBeenCalledWith({ limit: 10, afterId: null });
  });

  it('stays a dry run when dryRun is omitted from a non-empty body', async () => {
    const { json } = await call({ scope: 'gallery', limit: 5 });
    expect(json.data).toMatchObject({ scope: 'gallery', dryRun: true, limit: 5 });
  });

  it.each([
    ['dryRun as a string', { dryRun: 'false' }],
    ['limit above the batch cap', { limit: 26 }],
    ['limit of zero', { limit: 0 }],
    ['fractional limit', { limit: 2.5 }],
    ['unknown scope', { scope: 'everything' }],
    ['non-uuid cursor', { cursor: 'abc' }],
    ['misspelled key', { dry_run: false }],
  ])('rejects %s with 400', async (_label, body) => {
    const { res, json } = await call(body);

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe('validation_failed');
    expect(json.params.issues).toBe(json.error);
    expect(listPlayersNeedingAvatarThumb).not.toHaveBeenCalled();
    expect(listGalleryItemsForThumbs).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON, logging the parse error first', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { res, json } = await call(undefined, '{dryRun: false');

    expect(res.status).toBe(400);
    expect(json.error).toBe('Request body must be valid JSON');
    expect(json.code).toBe('invalid_json');
    expect(consoleError).toHaveBeenCalledWith(
      '[admin/avatars/thumbnails] Request body is not valid JSON:',
      expect.any(SyntaxError),
    );
    expect(listPlayersNeedingAvatarThumb).not.toHaveBeenCalled();
  });
});

// ── Dry run ────────────────────────────────────────────────────────────

describe('POST /api/admin/avatars/thumbnails — dry run', () => {
  it('reports what it would do for players without downloading, uploading or updating', async () => {
    seedPlayers();
    const before = JSON.stringify(db.players);

    const { json } = await call({});

    expect(json.data.items.map((i: { action: string }) => i.action))
      .toEqual(['would_create', 'would_link', 'would_create']);
    expect(json.data.items[0]).toMatchObject({
      id: uuid(1),
      originalPath: galleryPath(1),
      thumbPath: `${galleryPath(1)}.thumb.webp`,
    });
    expect(json.data.counts).toMatchObject({ would_create: 2, would_link: 1, created: 0, linked: 0 });
    expect(fake.api.exists).toHaveBeenCalledTimes(3);
    expect(fake.api.download).not.toHaveBeenCalled();
    expect(fake.api.upload).not.toHaveBeenCalled();
    expect(swapPlayerAvatarUrl).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(JSON.stringify(db.players)).toBe(before);
  });

  it('reports gallery rows without writing', async () => {
    for (const n of [1, 2]) {
      fake.objects.set(galleryPath(n), png);
      db.gallery.push({ id: uuid(n), player_id: uuid(900), image_url: publicAvatarUrl(galleryPath(n)) });
    }
    fake.objects.set(`${galleryPath(2)}.thumb.webp`, Buffer.from('existing-thumb'));

    const { json } = await call({ scope: 'gallery' });

    expect(json.data.items).toEqual([
      expect.objectContaining({ id: uuid(1), action: 'would_create' }),
      expect.objectContaining({ id: uuid(2), action: 'skipped', reason: 'thumbnail_exists' }),
    ]);
    expect(fake.api.upload).not.toHaveBeenCalled();
    expect(fake.api.download).not.toHaveBeenCalled();
  });
});

// ── Batch limit and paging ─────────────────────────────────────────────

describe('POST /api/admin/avatars/thumbnails — batch limit', () => {
  it('processes at most `limit` rows and returns a cursor to the next page', async () => {
    seedPlayers();

    const first = await call({ limit: 2 });

    expect(listPlayersNeedingAvatarThumb).toHaveBeenCalledWith({ limit: 2, afterId: null });
    expect(first.json.data.scanned).toBe(2);
    expect(first.json.data.nextCursor).toBe(uuid(2));

    const second = await call({ limit: 2, cursor: first.json.data.nextCursor });

    expect(listPlayersNeedingAvatarThumb).toHaveBeenLastCalledWith({ limit: 2, afterId: uuid(2) });
    expect(second.json.data.items.map((i: { id: string }) => i.id)).toEqual([uuid(3)]);
    expect(second.json.data.nextCursor).toBeNull();
  });

  it('caps a live batch at the limit too', async () => {
    seedPlayers();

    const { json } = await call({ dryRun: false, limit: 1 });

    expect(json.data.scanned).toBe(1);
    expect(fake.api.upload).toHaveBeenCalledTimes(1);
    expect(db.players[1].avatar_url).toBe(publicAvatarUrl(galleryPath(2)));
    expect(db.players[2].avatar_url).toBe(publicAvatarUrl(galleryPath(3)));
  });
});

// ── Live run ───────────────────────────────────────────────────────────

describe('POST /api/admin/avatars/thumbnails — live run (dryRun: false)', () => {
  it('creates missing thumbnails and points avatar_url at them', async () => {
    seedPlayers();

    const { json } = await call({ dryRun: false });

    expect(json.data.items.map((i: { action: string }) => i.action)).toEqual(['created', 'linked', 'created']);
    for (const n of [1, 2, 3]) {
      expect(db.players[n - 1].avatar_url).toBe(publicAvatarUrl(`${galleryPath(n)}.thumb.webp`));
    }

    const [path, thumb, options] = fake.api.upload.mock.calls[0] as unknown as [string, Buffer, Record<string, unknown>];
    expect(path).toBe(`${galleryPath(1)}.thumb.webp`);
    expect(options).toEqual({ contentType: 'image/webp', cacheControl: '31536000', upsert: false });
    expect((await sharp(thumb).metadata()).width).toBe(256);
    expect(json.data.items[0].bytes).toBe(thumb.length);
    // The existing thumbnail is linked, not rebuilt.
    expect(fake.api.upload).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith('/');
    // The public read cache embeds avatars under the `players` tag (D37).
    expect(revalidateTag).toHaveBeenCalledWith('players', { expire: 0 });
    // One audit entry for the batch: who rewrote which players' avatar_url.
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: 'admin-1',
      actor_name: 'Admin',
      action: 'admin.backfill',
      resource_type: 'player',
      resource_id: null,
      resource_name: 'avatar thumbnails',
      metadata: {
        scope: 'players',
        cursor: null,
        limit: 10,
        counts: json.data.counts,
        player_ids: [uuid(1), uuid(2), uuid(3)],
      },
    });
  });

  it('is idempotent for players: a second live run finds nothing to do', async () => {
    seedPlayers();
    await call({ dryRun: false });
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(revalidateTag).mockClear();
    vi.mocked(logAuditEvent).mockClear();
    fake.api.upload.mockClear();
    fake.api.download.mockClear();

    const { json } = await call({ dryRun: false });

    expect(json.data.scanned).toBe(0);
    expect(json.data.nextCursor).toBeNull();
    expect(fake.api.upload).not.toHaveBeenCalled();
    expect(fake.api.download).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('is idempotent for the gallery: existing thumbnails are skipped, never re-uploaded', async () => {
    for (const n of [1, 2]) {
      fake.objects.set(galleryPath(n), png);
      db.gallery.push({ id: uuid(n), player_id: uuid(900), image_url: publicAvatarUrl(galleryPath(n)) });
    }

    const first = await call({ scope: 'gallery', dryRun: false });
    const second = await call({ scope: 'gallery', dryRun: false });

    expect(first.json.data.counts).toMatchObject({ created: 2, skipped: 0 });
    expect(second.json.data.counts).toMatchObject({ created: 0, skipped: 2 });
    expect(fake.api.upload).toHaveBeenCalledTimes(2);
    expect(swapPlayerAvatarUrl).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('leaves a player alone when the avatar changed between read and write', async () => {
    seedPlayers();
    vi.mocked(swapPlayerAvatarUrl).mockResolvedValueOnce(false);

    const { json } = await call({ dryRun: false, limit: 1 });

    expect(json.data.items[0]).toMatchObject({ action: 'skipped', reason: 'avatar_changed' });
    // No row changed, so no audit entry.
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('reports a per-item failure with its stage and carries on with the batch', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    seedPlayers();
    fake.objects.delete(galleryPath(1)); // original missing → download fails

    const { res, json } = await call({ dryRun: false });

    expect(res.status).toBe(200);
    expect(json.data.items[0]).toMatchObject({ id: uuid(1), action: 'failed', reason: 'download_failed' });
    expect(json.data.items[2]).toMatchObject({ id: uuid(3), action: 'created' });
    // The audit entry names only the rows whose avatar_url changed.
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata?.player_ids).toEqual([uuid(2), uuid(3)]);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(`player ${uuid(1)}: download_failed`),
      expect.anything(),
    );
  });

  it('reports a failed avatar_url update distinctly', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seedPlayers();
    vi.mocked(swapPlayerAvatarUrl).mockRejectedValueOnce(new Error('db down'));

    const { json } = await call({ dryRun: false, limit: 1 });

    expect(json.data.items[0]).toMatchObject({ action: 'failed', reason: 'update_failed' });
  });

  it('skips gallery rows that are not in the avatars bucket as unsafe_path', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.gallery.push({ id: uuid(1), player_id: uuid(900), image_url: 'https://example.com/elsewhere.png' });

    const { json } = await call({ scope: 'gallery', dryRun: false });

    expect(json.data.items[0]).toMatchObject({ action: 'skipped', reason: 'unsafe_path' });
    expect(fake.api.exists).not.toHaveBeenCalled();
  });
});

// ── Path safety (security verifier blocker 2) ──────────────────────────

/** The attack: a player stores this as a "Showdown sprite", then the backfill reads world-assets/x.png. */
const SHOWDOWN_TRAVERSAL_URL =
  'https://play.pokemonshowdown.com/sprites/trainers/x/storage/v1/object/public/avatars/..%2Fworld-assets%2Fx.png';

describe('POST /api/admin/avatars/thumbnails — path safety', () => {
  it.each([
    ['the Showdown-prefixed traversal URL', SHOWDOWN_TRAVERSAL_URL],
    ['an encoded traversal on the project origin', `${TEST_AVATAR_PUBLIC_BASE}/..%2Fworld-assets%2Fx.png`],
    ['an encoded traversal inside gallery', `${TEST_AVATAR_PUBLIC_BASE}/gallery%2F..%2F..%2Fworld-assets%2Fx.png`],
    ['double encoding', `${TEST_AVATAR_PUBLIC_BASE}/..%252Fworld-assets%252Fx.png`],
    ['another Supabase project', `https://other.supabase.co/storage/v1/object/public/avatars/${galleryPath(1)}`],
    ['another bucket of this project', `${TEST_SUPABASE_URL}/storage/v1/object/public/world-assets/${galleryPath(1)}`],
    ['a name off the whitelist', `${TEST_AVATAR_PUBLIC_BASE}/gallery/p1/a.png`],
  ])('players, live: skips %s as unsafe_path with no Storage call', async (_label, url) => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.objects.set('../world-assets/x.png', png);
    fake.objects.set(galleryPath(1), png);
    db.players.push({ id: uuid(1), avatar_url: url });
    // Feed the row past the query filter: the route must hold on its own.
    vi.mocked(listPlayersNeedingAvatarThumb).mockResolvedValueOnce([{ id: uuid(1), avatar_url: url }]);

    const { res, json } = await call({ dryRun: false });

    expect(res.status).toBe(200);
    expect(json.data.items).toEqual([{ id: uuid(1), action: 'skipped', reason: 'unsafe_path' }]);
    expect(fake.api.exists).not.toHaveBeenCalled();
    expect(fake.api.download).not.toHaveBeenCalled();
    expect(fake.api.upload).not.toHaveBeenCalled();
    expect(swapPlayerAvatarUrl).not.toHaveBeenCalled();
    expect(db.players[0].avatar_url).toBe(url);
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining(`player ${uuid(1)}: unsafe_path`));
  });

  it('players, dry run: the Showdown-prefixed traversal URL is unsafe_path with no Storage call', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(listPlayersNeedingAvatarThumb).mockResolvedValueOnce([{ id: uuid(1), avatar_url: SHOWDOWN_TRAVERSAL_URL }]);

    const { json } = await call({});

    expect(json.data.items).toEqual([{ id: uuid(1), action: 'skipped', reason: 'unsafe_path' }]);
    expect(fake.api.exists).not.toHaveBeenCalled();
    expect(fake.api.download).not.toHaveBeenCalled();
    expect(fake.api.upload).not.toHaveBeenCalled();
  });

  it('gallery, live: a traversal image_url is unsafe_path with no Storage call', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.objects.set('../world-assets/x.png', png);
    db.gallery.push({ id: uuid(1), player_id: uuid(900), image_url: SHOWDOWN_TRAVERSAL_URL });
    db.gallery.push({ id: uuid(2), player_id: uuid(900), image_url: `${TEST_AVATAR_PUBLIC_BASE}/..%2Fworld-assets%2Fx.png` });

    const { json } = await call({ scope: 'gallery', dryRun: false });

    expect(json.data.items.map((i: { reason: string }) => i.reason)).toEqual(['unsafe_path', 'unsafe_path']);
    expect(fake.api.exists).not.toHaveBeenCalled();
    expect(fake.api.download).not.toHaveBeenCalled();
    expect(fake.api.upload).not.toHaveBeenCalled();
    expect(fake.objects.has('../world-assets/x.png.thumb.webp')).toBe(false);
  });

  it('reports a thumbnail of a whitelisted original as already_thumbnail', async () => {
    const thumbUrl = publicAvatarUrl(`${galleryPath(1)}.thumb.webp`);
    vi.mocked(listPlayersNeedingAvatarThumb).mockResolvedValueOnce([{ id: uuid(1), avatar_url: thumbUrl }]);

    const { json } = await call({ dryRun: false });

    expect(json.data.items).toEqual([{ id: uuid(1), action: 'skipped', reason: 'already_thumbnail' }]);
    expect(fake.api.exists).not.toHaveBeenCalled();
  });

  it('fails closed (500, no reads) when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');

    const { res, json } = await call({ dryRun: false });

    expect(res.status).toBe(500);
    expect(json).toEqual({ success: false, error: 'Failed to backfill avatar thumbnails' });
    expect(listPlayersNeedingAvatarThumb).not.toHaveBeenCalled();
    expect(fake.api.exists).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('[API] Failed to backfill avatar thumbnails:', expect.any(Error));
  });
});

// ── Unexpected errors ──────────────────────────────────────────────────

describe('POST /api/admin/avatars/thumbnails — errors', () => {
  it('returns the static fallback through safeErrorResponse when the row query fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(listPlayersNeedingAvatarThumb).mockRejectedValueOnce(new Error('relation missing'));

    const { res, json } = await call();

    expect(res.status).toBe(500);
    expect(json).toEqual({ success: false, error: 'Failed to backfill avatar thumbnails' });
    expect(consoleError).toHaveBeenCalledWith('[API] Failed to backfill avatar thumbnails:', expect.any(Error));
  });
});
