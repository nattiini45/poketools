/**
 * scripts/sprites/upload-supabase.mjs: dry run by default, `--live` bound to a
 * dry run's plan, the set-version check, upsert-false uploads into a public
 * bucket (a private one is refused) and the post-upload verification (listing
 * plus one public read). A fake Storage client and a fake fetch stand in for
 * Supabase; nothing reaches the network and no env is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CACHE_CONTROL, buildPublishSet, comparePlans, ensureBucket, main, parseArgs, readMap } from '../upload-supabase.mjs';
import { setVersion, sha256 } from '../lib.mjs';

describe('readMap', () => {
  const text = (entries, version = '0123456789ab') => JSON.stringify({ schema: 2, version, entries });

  it('accepts a well-formed map', () => {
    expect(readMap(text({ charizardmegax: '6-mega-x' })).entries.charizardmegax).toBe('6-mega-x');
  });

  it('rejects stems, versions and schemas that are not safe Storage path segments', () => {
    expect(() => readMap(text({ x: '../6' }))).toThrow(/malformed map entry "x"/);
    expect(() => readMap(text({ x: '6/../../etc' }))).toThrow(/malformed/);
    expect(() => readMap(text({ 'Bad Key': '6' }))).toThrow(/malformed/);
    expect(() => readMap(text({ x: null }))).toThrow(/malformed/);
    expect(() => readMap(text({ x: '6' }, '../aaaaaaaa'))).toThrow(/version/);
    expect(() => readMap(text({ x: '6' }, 'ZZ'))).toThrow(/version/);
    expect(() => readMap(JSON.stringify({ schema: 1, entries: {} }))).toThrow(/schema/);
  });
});

describe('parseArgs', () => {
  it('is a dry run unless --live, and --live needs --expect-plan', () => {
    expect(parseArgs([]).options.live).toBe(false);
    expect(parseArgs(['--live']).error).toMatch(/--expect-plan/);
    expect(parseArgs(['--live', '--dry-run', '--expect-plan', 'x']).error).toMatch(/mutually exclusive/);
    expect(parseArgs(['--bucket', 'x']).error).toMatch(/unknown argument/);
  });
});

describe('ensureBucket', () => {
  it('refuses an existing private bucket instead of uploading into it', async () => {
    const client = { storage: { getBucket: vi.fn(async () => ({ data: { id: 'sprites', public: false }, error: null })), createBucket: vi.fn() } };
    await expect(ensureBucket(client, () => {})).rejects.toThrow(/not public/);
    expect(client.storage.createBucket).not.toHaveBeenCalled();
  });

  it('accepts an existing public bucket', async () => {
    const client = { storage: { getBucket: vi.fn(async () => ({ data: { id: 'sprites', public: true }, error: null })), createBucket: vi.fn() } };
    await expect(ensureBucket(client, () => {})).resolves.toBeUndefined();
    expect(client.storage.createBucket).not.toHaveBeenCalled();
  });
});

describe('main', () => {
  let dir;
  let mapFile;
  let mirror;
  let version;
  const quiet = () => {};

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sprites-upload-'));
    mirror = join(dir, 'mirror');
    const files = [];
    const contents = {};
    for (const stem of ['1', '19-regional-a']) {
      for (const variant of ['256', 'full']) {
        const bytes = Buffer.from(`${variant}-${stem}`);
        contents[`${variant}/${stem}.webp`] = bytes;
        files.push({ logical: `${variant}/${stem}.webp`, sha256: sha256(bytes) });
      }
    }
    version = setVersion(files);
    for (const [logical, bytes] of Object.entries(contents)) {
      mkdirSync(join(mirror, version, logical.split('/')[0]), { recursive: true });
      writeFileSync(join(mirror, version, logical), bytes);
    }
    mapFile = join(dir, 'broadcast.json');
    writeFileSync(mapFile, JSON.stringify({ schema: 2, version, entries: { bulbasaur: '1', rattataalola: '19-regional-a' } }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const args = (...extra) => ['--map', mapFile, '--mirror', mirror, ...extra];

  it('dry run: writes a sorted plan of every mapped object (both variants, under the set version), uploads nothing', async () => {
    const client = { storage: { getBucket: vi.fn(), from: vi.fn() } };
    const planDir = join(dir, 'r1');
    expect(await main(args('--plan-dir', planDir), { log: quiet, client })).toBe(0);
    expect(client.storage.getBucket).not.toHaveBeenCalled();
    const plan = JSON.parse(readFileSync(join(planDir, 'publish-plan.json'), 'utf8'));
    expect(plan.bucket).toBe('sprites');
    expect(plan.entries.map((e) => e.path)).toEqual([
      `broadcast/${version}/256/1.webp`,
      `broadcast/${version}/256/19-regional-a.webp`,
      `broadcast/${version}/full/1.webp`,
      `broadcast/${version}/full/19-regional-a.webp`,
    ]);
    expect(plan.entries.every((e) => e.cacheControl === CACHE_CONTROL && e.contentType === 'image/webp')).toBe(true);
  });

  it('refuses a mirror that does not hash to the map version, missing files and an empty map', async () => {
    writeFileSync(join(mirror, version, '256', '1.webp'), 'tampered');
    expect(await main(args(), { log: quiet })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/version mismatch/));

    const map = JSON.parse(readFileSync(mapFile, 'utf8'));
    const set = buildPublishSet({ map, readFile: () => Buffer.from(''), exists: () => false });
    expect(set.missing).toHaveLength(4);
    expect(set.mismatched).toEqual([]);

    writeFileSync(mapFile, JSON.stringify({ schema: 2, version: setVersion([]), entries: {} }));
    expect(await main(args(), { log: quiet })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/empty set/));
  });

  it("--live refuses a set that differs from R1's plan, before any Storage call", async () => {
    const planDir = join(dir, 'r1');
    await main(args('--plan-dir', planDir), { log: quiet });
    // A re-mirror: one render changed, so the whole set gets a new version.
    const files = [];
    for (const stem of ['1', '19-regional-a']) {
      for (const variant of ['256', 'full']) {
        const bytes = stem === '1' && variant === '256' ? Buffer.from('a new render') : readFileSync(join(mirror, version, variant, `${stem}.webp`));
        files.push({ logical: `${variant}/${stem}.webp`, sha256: sha256(bytes), bytes });
      }
    }
    const next = setVersion(files);
    for (const f of files) {
      mkdirSync(join(mirror, next, f.logical.split('/')[0]), { recursive: true });
      writeFileSync(join(mirror, next, f.logical), f.bytes);
    }
    writeFileSync(mapFile, JSON.stringify({ schema: 2, version: next, entries: { bulbasaur: '1', rattataalola: '19-regional-a' } }));
    const client = { storage: { getBucket: vi.fn(), from: vi.fn() } };
    expect(await main(args('--live', '--expect-plan', planDir), { log: quiet, client })).toBe(1);
    expect(client.storage.getBucket).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/REFUSED: the recomputed publish set differs/));
    expect(comparePlans([], { bucket: 'world-assets', entries: [] })).toEqual(['plan bucket world-assets is not sprites']);
  });

  /**
   * A fake Storage API: records uploads; `existing` paths answer 409; list
   * returns what `stored` holds (files, plus folder rows one level down).
   */
  function fakeClient({ existing = [], drop = [], bucket = null } = {}) {
    const stored = new Set(existing);
    const uploads = [];
    const bucketApi = {
      upload: vi.fn(async (path, body, opts) => {
        uploads.push({ path, opts });
        if (stored.has(path)) return { error: { statusCode: '409', message: 'The resource already exists' } };
        if (!drop.includes(path)) stored.add(path);
        return { error: null };
      }),
      list: vi.fn(async (prefix, { limit, offset }) => {
        const names = new Set([...stored].filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1).split('/')[0]));
        return { data: [...names].sort().map((name) => ({ name })).slice(offset, offset + limit), error: null };
      }),
      getPublicUrl: vi.fn((path) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/sprites/${path}` } })),
    };
    const client = {
      storage: {
        getBucket: vi.fn(async () => (bucket ? { data: bucket, error: null } : { data: null, error: { message: 'Bucket not found' } })),
        createBucket: vi.fn(async () => ({ data: {}, error: null })),
        from: vi.fn(() => bucketApi),
      },
    };
    return { client, uploads };
  }

  it('--live with the matching plan: creates the public bucket, uploads with upsert false and a 1-year cache, verifies a public read', async () => {
    const planDir = join(dir, 'r1');
    await main(args('--plan-dir', planDir), { log: quiet });
    const existingPath = `broadcast/${version}/full/1.webp`;
    const { client, uploads } = fakeClient({ existing: [existingPath, 'broadcast/aaaaaaaaaaaa/256/1.webp'] });
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 206 }));
    const lines = [];
    expect(await main(args('--live', '--expect-plan', planDir), { log: (l) => lines.push(l), client, fetch: fetchImpl })).toBe(0);
    expect(client.storage.createBucket).toHaveBeenCalledWith('sprites', expect.objectContaining({ public: true, allowedMimeTypes: ['image/webp'] }));
    expect(uploads).toHaveLength(4);
    expect(uploads.every((u) => u.opts.upsert === false && u.opts.cacheControl === '31536000' && u.opts.contentType === 'image/webp')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://proj.supabase.co/storage/v1/object/public/sprites/broadcast/${version}/256/1.webp`,
      expect.objectContaining({ headers: { Range: 'bytes=0-0' } }),
    );
    // The older set is reported, never deleted.
    expect(lines.some((l) => /other set version\(s\).*aaaaaaaaaaaa/.test(l))).toBe(true);
  });

  it('--live fails when an uploaded object is missing on verification', async () => {
    const planDir = join(dir, 'r1');
    await main(args('--plan-dir', planDir), { log: quiet });
    const lost = `broadcast/${version}/256/1.webp`;
    const { client } = fakeClient({ drop: [lost] });
    expect(await main(args('--live', '--expect-plan', planDir), { log: quiet, client, fetch: vi.fn() })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(lost));
  });

  it('--live fails when the public URL does not serve the object (private bucket, wrong policy)', async () => {
    const planDir = join(dir, 'r1');
    await main(args('--plan-dir', planDir), { log: quiet });
    const { client } = fakeClient();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }));
    expect(await main(args('--live', '--expect-plan', planDir), { log: quiet, client, fetch: fetchImpl })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/answered HTTP 400; the bucket must serve public reads/));
  });

  it('--live refuses an existing private bucket before uploading', async () => {
    const planDir = join(dir, 'r1');
    await main(args('--plan-dir', planDir), { log: quiet });
    const { client, uploads } = fakeClient({ bucket: { id: 'sprites', public: false } });
    await expect(main(args('--live', '--expect-plan', planDir), { log: quiet, client, fetch: vi.fn() })).rejects.toThrow(/not public/);
    expect(uploads).toHaveLength(0);
  });
});
