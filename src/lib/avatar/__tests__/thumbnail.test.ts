import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  AVATAR_IMMUTABLE_CACHE_CONTROL,
  AVATAR_THUMB_TARGET_BYTES,
  AvatarThumbnailError,
  avatarContentHash,
  avatarThumbnailExists,
  createAvatarThumbnail,
  ensureAvatarThumbnail,
  legacyPlayerAvatarPaths,
  playerAvatarUploadPath,
  putAvatarThumbnail,
  stalePlayerAvatarPaths,
  tryWriteAvatarThumbnail,
  writeAvatarThumbnail,
} from '../thumbnail';
import {
  TEST_SUPABASE_URL,
  createFakeAvatarBucket,
  makeTestPng,
  publicAvatarUrl,
  testUuid,
} from './avatar-test-helpers';

let bigPng: Buffer;

/** A whitelisted gallery original and its thumbnail. */
const P1 = testUuid(1);
const P2 = testUuid(2);
const ORIGINAL = `gallery/${P1}/${testUuid(10)}.png`;
const THUMB = `${ORIGINAL}.thumb.webp`;

beforeAll(async () => {
  bigPng = await makeTestPng(1024, 1024);
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', TEST_SUPABASE_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('createAvatarThumbnail', () => {
  it('encodes a 256 px WebP within the 30 KB target', async () => {
    const thumb = await createAvatarThumbnail(bigPng);
    const meta = await sharp(thumb).metadata();

    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    expect(thumb.length).toBeLessThanOrEqual(AVATAR_THUMB_TARGET_BYTES);
    expect(thumb.length).toBeLessThan(bigPng.length / 10);
  });

  it('keeps the aspect ratio', async () => {
    const thumb = await createAvatarThumbnail(await makeTestPng(1024, 512));
    const meta = await sharp(thumb).metadata();
    expect([meta.width, meta.height]).toEqual([256, 128]);
  });

  it('never enlarges a small avatar (layer-built avatars are 160 px)', async () => {
    const thumb = await createAvatarThumbnail(await makeTestPng(160, 160));
    const meta = await sharp(thumb).metadata();
    expect([meta.width, meta.height]).toEqual([160, 160]);
  });

  it('rejects bytes that are not a decodable image with a decode-stage error', async () => {
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
    await expect(createAvatarThumbnail(fakePng)).rejects.toMatchObject({
      name: 'AvatarThumbnailError',
      stage: 'decode',
    });
  });
});

describe('putAvatarThumbnail', () => {
  it('uploads next to the original as WebP with the 1-year cache', async () => {
    const { api, bucket } = createFakeAvatarBucket();
    const result = await putAvatarThumbnail(bucket, 'gallery/p1/a.png', Buffer.from('webp'));

    expect(result).toEqual({ path: 'gallery/p1/a.png.thumb.webp', created: true, bytes: 4 });
    expect(AVATAR_IMMUTABLE_CACHE_CONTROL).toBe('31536000');
    expect(api.upload).toHaveBeenCalledWith(
      'gallery/p1/a.png.thumb.webp',
      Buffer.from('webp'),
      { contentType: 'image/webp', cacheControl: '31536000', upsert: false },
    );
  });

  it('treats an already existing thumbnail as success', async () => {
    const { bucket } = createFakeAvatarBucket({ 'gallery/p1/a.png.thumb.webp': Buffer.from('old') });
    const result = await putAvatarThumbnail(bucket, 'gallery/p1/a.png', Buffer.from('new'));
    expect(result).toEqual({ path: 'gallery/p1/a.png.thumb.webp', created: false, bytes: 0 });
  });

  it('throws an upload-stage error for any other storage error', async () => {
    const { api, bucket } = createFakeAvatarBucket();
    api.upload.mockResolvedValueOnce({ data: null, error: { message: 'Storage full', statusCode: '500', status: 500 } });

    const err = await putAvatarThumbnail(bucket, 'a.png', Buffer.from('x')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AvatarThumbnailError);
    expect((err as AvatarThumbnailError).stage).toBe('upload');
  });
});

describe('writeAvatarThumbnail / tryWriteAvatarThumbnail', () => {
  it('writes a real thumbnail for an in-memory original', async () => {
    const { objects, bucket } = createFakeAvatarBucket();
    const result = await writeAvatarThumbnail(bucket, 'gallery/p1/a.png', bigPng);

    expect(result.created).toBe(true);
    const stored = objects.get('gallery/p1/a.png.thumb.webp');
    expect(stored).toBeDefined();
    expect((await sharp(stored as Buffer).metadata()).format).toBe('webp');
  });

  it('logs and returns null instead of throwing when the thumbnail fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, bucket } = createFakeAvatarBucket();

    const result = await tryWriteAvatarThumbnail(bucket, 'gallery/p1/a.png', Buffer.from('nope'), 'test');

    expect(result).toBeNull();
    expect(api.upload).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[test] Avatar thumbnail failed at decode'),
      expect.any(AvatarThumbnailError),
    );
  });
});

describe('ensureAvatarThumbnail', () => {
  it('does nothing when the thumbnail exists (HEAD check only)', async () => {
    const { api, bucket } = createFakeAvatarBucket({
      [ORIGINAL]: bigPng,
      [THUMB]: Buffer.from('thumb'),
    });

    const result = await ensureAvatarThumbnail(bucket, ORIGINAL);

    expect(result).toEqual({ path: THUMB, created: false, bytes: 0 });
    expect(api.exists).toHaveBeenCalledWith(THUMB);
    expect(api.download).not.toHaveBeenCalled();
    expect(api.upload).not.toHaveBeenCalled();
  });

  it('downloads the original once and uploads a thumbnail when it is missing', async () => {
    const { api, objects, bucket } = createFakeAvatarBucket({ [ORIGINAL]: bigPng });

    const result = await ensureAvatarThumbnail(bucket, ORIGINAL);

    expect(result.created).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(api.download).toHaveBeenCalledTimes(1);
    expect(api.download).toHaveBeenCalledWith(ORIGINAL);
    expect(objects.has(THUMB)).toBe(true);
  });

  it('is idempotent: a second call writes nothing', async () => {
    const { api, bucket } = createFakeAvatarBucket({ [ORIGINAL]: bigPng });

    await ensureAvatarThumbnail(bucket, ORIGINAL);
    const second = await ensureAvatarThumbnail(bucket, ORIGINAL);

    expect(second.created).toBe(false);
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.download).toHaveBeenCalledTimes(1);
  });

  it('throws a download-stage error when the original is missing', async () => {
    const { bucket } = createFakeAvatarBucket();
    await expect(ensureAvatarThumbnail(bucket, `gallery/${P1}/${testUuid(11)}.png`))
      .rejects.toMatchObject({ stage: 'download' });
  });

  it('throws an exists-stage error when the existence check itself fails', async () => {
    const { api, bucket } = createFakeAvatarBucket();
    api.exists.mockRejectedValueOnce(new Error('network down'));
    await expect(avatarThumbnailExists(bucket, ORIGINAL)).rejects.toMatchObject({ stage: 'exists' });
  });

  it.each([
    ['a traversal out of the bucket', '../world-assets/sky.png'],
    ['a traversal inside gallery', `gallery/${P1}/../../world-assets/sky.png`],
    ['a non-whitelisted name', 'gallery/p1/a.png'],
    ['a thumbnail', THUMB],
  ])('refuses %s with a path-stage error and never touches the bucket', async (_label, path) => {
    const { api, bucket } = createFakeAvatarBucket({ [path]: bigPng });

    await expect(ensureAvatarThumbnail(bucket, path)).rejects.toMatchObject({ stage: 'path' });
    await expect(avatarThumbnailExists(bucket, path)).rejects.toMatchObject({ stage: 'path' });
    expect(api.exists).not.toHaveBeenCalled();
    expect(api.download).not.toHaveBeenCalled();
    expect(api.upload).not.toHaveBeenCalled();
  });
});

describe('player avatar naming', () => {
  it('hashes content into a 16-hex version that changes with the bytes', () => {
    const a = avatarContentHash(Buffer.from('one'));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(avatarContentHash(Buffer.from('one'))).toBe(a);
    expect(avatarContentHash(Buffer.from('two'))).not.toBe(a);
  });

  it('versions the upload path so the stable <playerId>.<ext> name is no longer overwritten', () => {
    expect(playerAvatarUploadPath('p1', '0123456789abcdef', 'png')).toBe('p1.0123456789abcdef.png');
  });

  it('lists the legacy stable names and their backfill thumbnails', () => {
    expect(legacyPlayerAvatarPaths('p1')).toEqual([
      'p1.png', 'p1.png.thumb.webp',
      'p1.jpg', 'p1.jpg.thumb.webp',
      'p1.webp', 'p1.webp.thumb.webp',
    ]);
  });
});

describe('stalePlayerAvatarPaths', () => {
  const legacy = legacyPlayerAvatarPaths(P1);
  const previous = `${P1}.aaaaaaaaaaaaaaaa.png`;

  it('removes the previous versioned original and thumbnail', () => {
    const stale = stalePlayerAvatarPaths(P1, publicAvatarUrl(`${previous}.thumb.webp`));
    expect(stale).toEqual([...legacy, previous, `${previous}.thumb.webp`]);
  });

  it('never touches gallery objects, other players or foreign URLs', () => {
    expect(stalePlayerAvatarPaths(P1, publicAvatarUrl(`gallery/${P1}/${testUuid(10)}.png.thumb.webp`))).toEqual(legacy);
    expect(stalePlayerAvatarPaths(P1, publicAvatarUrl(`${P2}.aaaaaaaaaaaaaaaa.png.thumb.webp`))).toEqual(legacy);
    expect(stalePlayerAvatarPaths(P1, 'https://play.pokemonshowdown.com/sprites/trainers/red.png')).toEqual(legacy);
    expect(stalePlayerAvatarPaths(P1, null)).toEqual(legacy);
  });

  it('ignores a previous avatar of another origin or off the whitelist', () => {
    expect(stalePlayerAvatarPaths(P1, `https://other.supabase.co/storage/v1/object/public/avatars/${previous}`)).toEqual(legacy);
    expect(stalePlayerAvatarPaths(P1, publicAvatarUrl(`${P1}.aaaaaaaaaaaaaaaa.gif`))).toEqual(legacy);
    expect(stalePlayerAvatarPaths(P1, publicAvatarUrl(previous), [], null)).toEqual(legacy);
  });

  it('takes the origin as an argument', () => {
    const url = `https://staging.supabase.co/storage/v1/object/public/avatars/${previous}`;
    expect(stalePlayerAvatarPaths(P1, url, [], 'https://staging.supabase.co'))
      .toEqual([...legacy, previous, `${previous}.thumb.webp`]);
  });

  it('keeps the paths that were just written', () => {
    const current = publicAvatarUrl(`${previous}.thumb.webp`);
    const stale = stalePlayerAvatarPaths(P1, current, [previous, `${previous}.thumb.webp`]);
    expect(stale).toEqual(legacy);
  });
});
