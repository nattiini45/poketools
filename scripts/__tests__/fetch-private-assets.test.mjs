/**
 * fetch-private-assets.mjs: the env decision matrix, the tarball path filter, and
 * the extraction against an in-memory tar.gz with a mocked fetch (no network).
 * Importing the module must not run the CLI.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SizeLimitError, assetPathFor, decide, extractAssets, readTar, run } from '../fetch-private-assets.mjs';

const TOKEN = 'test-token-value-not-real';

function header(name, size, type = '0') {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}

function entry(name, content, type = '0') {
  const data = Buffer.from(content);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header(name, data.length, type), data, pad]);
}

function pax(path) {
  const rec = (k, v) => {
    const body = ` ${k}=${v}\n`;
    let len = body.length + 1;
    while (`${len}${body}`.length !== len) len = `${len}${body}`.length;
    return `${len}${body}`;
  };
  return entry('PaxHeader', rec('path', path), 'x');
}

function tarGz(...entries) {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

const TOP = 'owner-repo-abc123';
const goodTar = () =>
  tarGz(
    entry(`${TOP}/`, '', '5'),
    entry(`${TOP}/README.md`, 'secret readme'),
    entry(`${TOP}/public/avatar/male/base/default-light.png`, 'PNGDATA'),
    pax(`${TOP}/public/models/draft-room/regular/${'x'.repeat(120)}.glb`),
    entry('ignored-short-name', 'GLBDATA'),
    entry(`${TOP}/public/avatar/../../evil.txt`, 'nope'),
    entry(`${TOP}/public/avatar/link.png`, '', '2'),
    entry(`${TOP}/gauntlet/fidelity/NOTES.md`, 'private'),
    entry(`${TOP}/src/format-packs/private/index.ts`, 'export default {};'),
    entry(`${TOP}/src/format-packs/private/__tests__/golden/golden.json`, '{}'),
  );

/** A body stream that yields `body` in chunks of `chunk` bytes, counting how many it served. */
function streamOf(body, chunk = 64 * 1024) {
  const stats = { served: 0, cancelled: false };
  let offset = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= body.length) {
        controller.close();
        return;
      }
      const part = body.subarray(offset, offset + chunk);
      offset += part.length;
      stats.served += part.length;
      controller.enqueue(new Uint8Array(part));
    },
    cancel() {
      stats.cancelled = true;
    },
  });
  return { stream, stats };
}

function response(body, { status = 200, chunk } = {}) {
  const { stream, stats } = streamOf(body, chunk);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    body: stream,
    stats,
    arrayBuffer: async () => {
      throw new Error('the body must be streamed, not buffered whole');
    },
  };
}

function logger() {
  const lines = [];
  return { lines, log: (m) => lines.push(m), error: (m) => lines.push(m) };
}

let dirs = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'pa-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('decide', () => {
  it('skips when nothing is configured (local dev, CI, forks)', () => {
    expect(decide({}).action).toBe('skip');
    expect(decide({ PRIVATE_ASSETS_REPO: 'a/b' }).action).toBe('skip');
    expect(decide({ VERCEL_ENV: 'preview' }).action).toBe('skip');
  });
  it('fails a Vercel production build without a token unless placeholders are allowed', () => {
    expect(decide({ VERCEL_ENV: 'production' }).action).toBe('fail');
    expect(decide({ VERCEL_ENV: 'production', PRIVATE_ASSETS_REPO: 'a/b' }).action).toBe('fail');
    expect(decide({ VERCEL_ENV: 'production', ALLOW_PLACEHOLDER_ASSETS: '1' }).action).toBe('skip');
  });
  it('fails a token without a usable repo or ref', () => {
    expect(decide({ PRIVATE_ASSETS_TOKEN: TOKEN }).action).toBe('fail');
    expect(decide({ PRIVATE_ASSETS_TOKEN: TOKEN, PRIVATE_ASSETS_REPO: 'no-slash' }).action).toBe('fail');
    expect(decide({ PRIVATE_ASSETS_TOKEN: TOKEN, PRIVATE_ASSETS_REPO: 'a/b', PRIVATE_ASSETS_REF: '../x' }).action).toBe('fail');
  });
  it('fetches with a token and repo, defaulting the ref to main', () => {
    expect(decide({ PRIVATE_ASSETS_TOKEN: TOKEN, PRIVATE_ASSETS_REPO: 'a/b' })).toMatchObject({ action: 'fetch', repo: 'a/b', ref: 'main' });
    expect(decide({ PRIVATE_ASSETS_TOKEN: TOKEN, PRIVATE_ASSETS_REPO: 'a/b', PRIVATE_ASSETS_REF: 'v1.2' }).ref).toBe('v1.2');
  });
  it('a preview build tries the branch named like the public branch, with main as the fallback', () => {
    const base = { PRIVATE_ASSETS_TOKEN: TOKEN, PRIVATE_ASSETS_REPO: 'a/b', VERCEL_ENV: 'preview' };
    expect(decide({ ...base, VERCEL_GIT_COMMIT_REF: 'fix/x' })).toMatchObject({ action: 'fetch', ref: 'fix/x', fallbackRef: 'main' });
    // An explicit ref always wins, and main needs no fallback.
    expect(decide({ ...base, VERCEL_GIT_COMMIT_REF: 'fix/x', PRIVATE_ASSETS_REF: 'v1' })).toMatchObject({ ref: 'v1' });
    expect(decide({ ...base, VERCEL_GIT_COMMIT_REF: 'fix/x', PRIVATE_ASSETS_REF: 'v1' })).not.toHaveProperty('fallbackRef');
    expect(decide({ ...base, VERCEL_GIT_COMMIT_REF: 'main' })).toMatchObject({ ref: 'main' });
    expect(decide({ ...base, VERCEL_GIT_COMMIT_REF: 'main' })).not.toHaveProperty('fallbackRef');
    // Production never follows the git branch.
    expect(decide({ ...base, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'fix/x' })).toMatchObject({ ref: 'main' });
    expect(decide({ ...base, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'fix/x' })).not.toHaveProperty('fallbackRef');
    // An unusable branch name fails like an unusable PRIVATE_ASSETS_REF.
    expect(decide({ ...base, VERCEL_GIT_COMMIT_REF: '../x' }).action).toBe('fail');
  });
  it('never puts the token in a message', () => {
    for (const env of [{ PRIVATE_ASSETS_TOKEN: TOKEN }, { PRIVATE_ASSETS_TOKEN: TOKEN, PRIVATE_ASSETS_REPO: 'a/b' }]) {
      expect(decide(env).message).not.toContain(TOKEN);
    }
  });
});

describe('assetPathFor', () => {
  it('keeps only the asset folders and the format pack, and strips the tarball top directory', () => {
    expect(assetPathFor(`${TOP}/public/avatar/male/base/a.png`)).toBe('public/avatar/male/base/a.png');
    expect(assetPathFor(`${TOP}/public/models/draft-room/regular/1.glb`)).toBe('public/models/draft-room/regular/1.glb');
    expect(assetPathFor(`${TOP}/src/format-packs/private/index.ts`)).toBe('src/format-packs/private/index.ts');
    expect(assetPathFor(`${TOP}/src/format-packs/private/messages/en.ts`)).toBe('src/format-packs/private/messages/en.ts');
    expect(assetPathFor(`${TOP}/src/format-packs/example/index.ts`)).toBeNull();
    expect(assetPathFor(`${TOP}/public/models/world/manifest.json`)).toBeNull();
    expect(assetPathFor(`${TOP}/gauntlet/fidelity/x.md`)).toBeNull();
  });
  it("never extracts the format pack's companion tests", () => {
    expect(assetPathFor(`${TOP}/src/format-packs/private/__tests__/golden/golden.json`)).toBeNull();
    expect(assetPathFor(`${TOP}/src/format-packs/private/__tests__/parity.test.ts`)).toBeNull();
  });
  it('rejects traversal and odd names', () => {
    expect(assetPathFor(`${TOP}/public/avatar/../../evil`)).toBeNull();
    expect(assetPathFor(`${TOP}/public/avatar//a.png`)).toBeNull();
    expect(assetPathFor(`${TOP}\\public\\avatar\\a.png`)).toBeNull();
    expect(assetPathFor('public/avatar/a.png')).toBeNull();
  });
});

describe('readTar / extractAssets', () => {
  it('applies pax long names', () => {
    const names = [...readTar(gunzipSync(goodTar()))].map((e) => e.name);
    expect(names).toContain(`${TOP}/public/models/draft-room/regular/${'x'.repeat(120)}.glb`);
    expect(names).not.toContain('ignored-short-name');
  });
  it('writes only regular files under the allowed folders', () => {
    const root = tmp();
    const counts = extractAssets(goodTar(), root);
    expect(counts).toEqual({ 'public/avatar/': 1, 'public/models/draft-room/': 1, 'src/format-packs/private/': 1 });
    expect(readFileSync(join(root, 'src/format-packs/private/index.ts'), 'utf8')).toBe('export default {};');
    expect(existsSync(join(root, 'src/format-packs/private/__tests__'))).toBe(false);
    expect(readFileSync(join(root, 'public/avatar/male/base/default-light.png'), 'utf8')).toBe('PNGDATA');
    expect(existsSync(join(root, 'README.md'))).toBe(false);
    expect(existsSync(join(root, 'gauntlet'))).toBe(false);
    expect(existsSync(join(root, 'public/avatar/link.png'))).toBe(false);
    expect(existsSync(join(root, '..', 'evil.txt'))).toBe(false);
  });
});

describe('run', () => {
  const env = { PRIVATE_ASSETS_TOKEN: TOKEN, PRIVATE_ASSETS_REPO: 'owner/repo', PRIVATE_ASSETS_REF: 'feat/x' };

  it('skips without calling fetch when nothing is configured', async () => {
    const fetchImpl = vi.fn();
    const log = logger();
    expect(await run({ env: {}, fetchImpl, root: tmp(), log })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails a production build without a token, without calling fetch', async () => {
    const fetchImpl = vi.fn();
    expect(await run({ env: { VERCEL_ENV: 'production' }, fetchImpl, root: tmp(), log: logger() })).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('downloads the tarball with a bearer token and extracts the assets', async () => {
    const root = tmp();
    const fetchImpl = vi.fn(async () => response(goodTar()));
    const log = logger();
    expect(await run({ env, fetchImpl, root, log })).toBe(0);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/owner/repo/tarball/feat/x');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(existsSync(join(root, 'public/avatar/male/base/default-light.png'))).toBe(true);
    expect(log.lines.join('\n')).not.toContain(TOKEN);
  });

  it('a preview build falls back to main only when its branch does not exist', async () => {
    const previewEnv = { PRIVATE_ASSETS_TOKEN: TOKEN, PRIVATE_ASSETS_REPO: 'owner/repo', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'fix/x' };
    const fetchImpl = vi.fn(async (url) => (url.endsWith('/tarball/fix/x') ? response(Buffer.alloc(0), { status: 404 }) : response(goodTar())));
    const log = logger();
    expect(await run({ env: previewEnv, fetchImpl, root: tmp(), log })).toBe(0);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/owner/repo/tarball/fix/x',
      'https://api.github.com/repos/owner/repo/tarball/main',
    ]);
    expect(log.lines.join(' ')).toContain('no branch fix/x');
    // Any other error is not a missing branch: no fallback.
    const failing = vi.fn(async () => response(Buffer.alloc(0), { status: 401 }));
    expect(await run({ env: previewEnv, fetchImpl: failing, root: tmp(), log: logger() })).toBe(1);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('fails on an HTTP error', async () => {
    const log = logger();
    expect(await run({ env, fetchImpl: async () => response(Buffer.alloc(0), { status: 404 }), root: tmp(), log })).toBe(1);
    expect(log.lines.join('\n')).toContain('HTTP 404');
  });

  it('fails when a folder is missing from the tarball', async () => {
    const only = tarGz(entry(`${TOP}/public/avatar/a.png`, 'x'));
    const log = logger();
    expect(await run({ env, fetchImpl: async () => response(only), root: tmp(), log })).toBe(1);
    expect(log.lines.join('\n')).toContain('public/models/draft-room/');
  });

  it('fails when the format pack is missing from the tarball (its tests alone count as missing)', async () => {
    const noPack = tarGz(
      entry(`${TOP}/public/avatar/a.png`, 'x'),
      entry(`${TOP}/public/models/draft-room/a.glb`, 'y'),
      entry(`${TOP}/src/format-packs/private/__tests__/parity.test.ts`, 'z'),
    );
    const log = logger();
    expect(await run({ env, fetchImpl: async () => response(noPack), root: tmp(), log })).toBe(1);
    expect(log.lines.join('\n')).toContain('the tarball has no files under src/format-packs/private/');
  });

  it('mentions the example format pack when it skips', async () => {
    const log = logger();
    expect(await run({ env: {}, fetchImpl: vi.fn(), root: tmp(), log })).toBe(0);
    expect(log.lines.join('\n')).toContain('the example format pack will be used');
  });

  it('fails on a network error and redacts the token from the message', async () => {
    const log = logger();
    const fetchImpl = async () => {
      throw new Error(`boom ${TOKEN}`);
    };
    expect(await run({ env, fetchImpl, root: tmp(), log })).toBe(1);
    expect(log.lines.join('\n')).not.toContain(TOKEN);
  });

  it('fails on a corrupt tarball', async () => {
    expect(await run({ env, fetchImpl: async () => response(Buffer.from('not gzip')), root: tmp(), log: logger() })).toBe(1);
  });

  it('aborts a streamed body past the download cap without buffering the rest', async () => {
    const big = Buffer.alloc(1024 * 1024, 7);
    const res = response(big, { chunk: 1024 });
    const log = logger();
    const root = tmp();
    expect(await run({ env, fetchImpl: async () => res, root, log, maxDownloadBytes: 10 * 1024 })).toBe(1);
    const text = log.lines.join('\n');
    expect(text).toContain('tarball is larger than the allowed maximum');
    expect(text).not.toContain(TOKEN);
    expect(res.stats.cancelled).toBe(true);
    expect(res.stats.served).toBeLessThan(64 * 1024);
    expect(existsSync(join(root, 'public'))).toBe(false);
  });

  it('fails cleanly when the tarball unpacks past the unpacked cap', async () => {
    // Highly compressible: a few KB gzipped, 2 MB unpacked.
    const bomb = tarGz(entry(`${TOP}/public/avatar/a.png`, Buffer.alloc(2 * 1024 * 1024)));
    const log = logger();
    const root = tmp();
    expect(await run({ env, fetchImpl: async () => response(bomb), root, log, maxUnpackedBytes: 1024 * 1024 })).toBe(1);
    expect(log.lines.join('\n')).toContain('tarball too large when unpacked');
    expect(existsSync(join(root, 'public'))).toBe(false);
  });
});

describe('extractAssets size bound', () => {
  it('throws a SizeLimitError past maxUnpackedBytes and extracts within it', () => {
    const tar = tarGz(entry(`${TOP}/public/avatar/a.png`, Buffer.alloc(64 * 1024)));
    expect(() => extractAssets(tar, tmp(), { maxUnpackedBytes: 16 * 1024 })).toThrow(SizeLimitError);
    expect(() => extractAssets(tar, tmp(), { maxUnpackedBytes: 1024 * 1024 })).not.toThrow();
  });
});
