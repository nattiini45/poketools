/**
 * scripts/sprites/mirror-broadcast.mjs with a mocked fetch and generated fixture
 * images only: it never reaches the real source. Covers the download gate
 * (--download), the polite GET (identifying User-Agent, <= 4 in flight, retry with
 * backoff, 404 = missing, a broken body retried), the feed -> @pkmn id mapping,
 * the sharp variants in a content-versioned set directory, the deterministic map,
 * the offline rebuild and the pruning rules (a --limit trial never prunes).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Dex } from '@pkmn/dex';
import {
  FEED_URL,
  MAX_CONCURRENCY,
  SOURCE_BASE,
  SOURCE_QUERY,
  USER_AGENT,
  main,
  mapFeedToSpecies,
  parseArgs,
  politeGet,
  stemOf,
  isProcessAlive,
} from '../mirror-broadcast.mjs';
import { setVersion, sha256 } from '../lib.mjs';

const png = (r, g, b, size = 320) =>
  sharp({ create: { width: size, height: size, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();

const FEED = {
  total: 6,
  data: [
    { identifier: 'Bulbasaur', number: 1, form_identifier: null, is_default: true },
    { identifier: 'Rattata-Alola', number: 19, form_identifier: 'regional-a', is_default: false },
    { identifier: 'Charizard', number: 6, form_identifier: null, is_default: true },
    { identifier: 'Notamon', number: 9999, form_identifier: null, is_default: true },
    { identifier: 'Pikachu', number: 26, form_identifier: null, is_default: true }, // wrong number: unmapped
    { identifier: 'Mew', number: 151, form_identifier: null, is_default: true }, // 404 at the source
  ],
};

function response(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    arrayBuffer: async () => {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}

describe('parseArgs', () => {
  it('defaults to no download and the maximum polite concurrency', () => {
    expect(parseArgs([]).options).toMatchObject({ download: false, concurrency: MAX_CONCURRENCY, limit: null });
  });
  it('refuses more than 4 lanes, a bad limit, --refresh-feed without --download and unknown flags', () => {
    expect(parseArgs(['--concurrency', '5']).error).toMatch(/1 to 4/);
    expect(parseArgs(['--limit', '0']).error).toMatch(/--limit/);
    expect(parseArgs(['--refresh-feed']).error).toMatch(/needs --download/);
    expect(parseArgs(['--hotlink']).error).toMatch(/unknown argument/);
  });
});

describe('feed -> stems -> @pkmn ids', () => {
  it('derives {number} and {number}-{form} stems and rejects unusable ones', () => {
    expect(stemOf({ number: 26, form_identifier: null })).toBe('26');
    expect(stemOf({ number: 52, form_identifier: 'regional-g' })).toBe('52-regional-g');
    expect(stemOf({ number: 0, form_identifier: null })).toBeNull();
    expect(stemOf({ number: 1, form_identifier: '../x' })).toBeNull();
  });

  it('maps by identifier + dex number, reports unmapped rows and keeps the default form on duplicates', () => {
    const rows = [
      ...FEED.data,
      { identifier: 'Charizard', number: 6, form_identifier: 'alt', is_default: false },
      { identifier: '', number: 7, form_identifier: '!!', is_default: true },
    ];
    const out = mapFeedToSpecies(rows, Dex);
    expect(out.entries).toEqual([
      { id: 'bulbasaur', stem: '1' },
      { id: 'charizard', stem: '6' },
      { id: 'mew', stem: '151' },
      { id: 'rattataalola', stem: '19-regional-a' },
    ]);
    expect(out.unmapped.map((u) => u.identifier).sort()).toEqual(['Notamon', 'Pikachu']);
    expect(out.duplicates).toEqual([{ id: 'charizard', kept: '6', dropped: '6-alt' }]);
    expect(out.invalid).toHaveLength(1);
  });
});

describe('politeGet', () => {
  it('retries 429 / 5xx / network errors with backoff (Retry-After honoured) and treats 404 as final', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(response(429, '', { 'retry-after': '3' }))
      .mockResolvedValueOnce(response(503, ''))
      .mockResolvedValueOnce(response(200, 'ok'));
    const got = await politeGet('https://example.test/a', { fetchImpl, sleep, backoffMs: 10, accept: 'image/png' });
    expect(got.status).toBe(200);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 3000, 40]);
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toBe(USER_AGENT);

    const notFound = vi.fn().mockResolvedValue(response(404, ''));
    expect(await politeGet('https://example.test/b', { fetchImpl: notFound, sleep, accept: 'image/png' })).toEqual({ status: 404 });
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('retries a body that breaks mid-stream instead of aborting the run', async () => {
    const sleep = vi.fn(async () => {});
    const broken = { ...response(200, ''), arrayBuffer: async () => Promise.reject(new Error('socket hang up')) };
    const fetchImpl = vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(response(200, 'ok'));
    const got = await politeGet('https://example.test/d', { fetchImpl, sleep, backoffMs: 10, accept: 'image/png' });
    expect(got.status).toBe(200);
    expect(got.body.toString()).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10]);

    const alwaysBroken = vi.fn().mockResolvedValue(broken);
    expect(await politeGet('https://example.test/e', { fetchImpl: alwaysBroken, sleep, accept: 'image/png' })).toEqual({
      status: 'error',
      error: 'socket hang up',
    });
    expect(alwaysBroken).toHaveBeenCalledTimes(4);
  });

  it('gives up after the attempt budget', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(500, ''));
    const got = await politeGet('https://example.test/c', { fetchImpl, sleep: async () => {}, accept: 'image/png' });
    expect(got).toEqual({ status: 'error', error: 'HTTP 500' });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe('main', () => {
  let dir;
  let paths;
  const quiet = () => {};
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sprites-mirror-'));
    paths = ['--cache', join(dir, 'cache'), '--mirror', join(dir, 'mirror'), '--map', join(dir, 'broadcast.json'), '--delay-ms', '0'];
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A fake source: the feed, three PNGs, a 404 for Mew; counts requests in flight. */
  async function fakeSource() {
    const images = {
      1: await png(0, 160, 80),
      6: await png(230, 90, 20, 560),
      '19-regional-a': await png(90, 60, 120, 300),
    };
    const state = { inFlight: 0, maxInFlight: 0, urls: [] };
    const fetchImpl = vi.fn(async (url, init) => {
      state.urls.push(url);
      expect(init.headers['User-Agent']).toBe(USER_AGENT);
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await new Promise((r) => setTimeout(r, 5));
      state.inFlight -= 1;
      if (url === FEED_URL) return response(200, FEED);
      const m = url.match(/\/([^/]+)\.png\?v=3$/);
      expect(url.startsWith(`${SOURCE_BASE}/`) && url.endsWith(SOURCE_QUERY)).toBe(true);
      const img = m && images[m[1]];
      return img ? response(200, img) : response(404, '');
    });
    return { fetchImpl, state };
  }

  it('refuses to download anything without --download (no cached feed): exit 2, fetch never called', async () => {
    const fetchImpl = vi.fn();
    const code = await main(paths, { fetch: fetchImpl, log: quiet, sleep: async () => {} });
    expect(code).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/REFUSED: .*--download was not passed/));
    expect(existsSync(join(dir, 'broadcast.json'))).toBe(false);
  });

  it('with --download: fetches the feed and originals politely, writes a content-versioned set and a deterministic map', async () => {
    const { fetchImpl, state } = await fakeSource();
    const code = await main(['--download', ...paths], { fetch: fetchImpl, log: quiet, sleep: async () => {}, backoffMs: 1 });
    expect(code).toBe(0);
    expect(state.maxInFlight).toBeLessThanOrEqual(MAX_CONCURRENCY);
    expect(state.urls.every((u) => u === FEED_URL || u.startsWith(SOURCE_BASE))).toBe(true);

    const mapText = readFileSync(join(dir, 'broadcast.json'), 'utf8');
    const map = JSON.parse(mapText);
    expect(map.schema).toBe(2);
    expect(map.entries).toEqual({ bulbasaur: '1', charizard: '6', rattataalola: '19-regional-a' });
    const setDir = join(dir, 'mirror', map.version);
    const files = [];
    for (const stem of Object.values(map.entries)) {
      const thumb = readFileSync(join(setDir, '256', `${stem}.webp`));
      const full = readFileSync(join(setDir, 'full', `${stem}.webp`));
      files.push({ logical: `256/${stem}.webp`, sha256: sha256(thumb) }, { logical: `full/${stem}.webp`, sha256: sha256(full) });
      const meta = await sharp(thumb).metadata();
      expect(meta.format).toBe('webp');
      expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(256);
    }
    // The version is the content hash of exactly these files.
    expect(setVersion(files)).toBe(map.version);
    expect((await sharp(readFileSync(join(setDir, 'full', '6.webp'))).metadata()).width).toBe(560);
    expect(readdirSync(join(dir, 'mirror'))).toEqual([map.version]);

    const report = JSON.parse(readFileSync(join(dir, 'cache', 'report.json'), 'utf8'));
    expect(report.missingSource).toEqual(['151']);
    expect(report.unmapped).toEqual([
      { identifier: 'Pikachu', stem: '26' },
      { identifier: 'Notamon', stem: '9999' },
    ]);

    // Offline rebuild from the cache: no request, byte-identical map.
    fetchImpl.mockClear();
    expect(await main(paths, { fetch: fetchImpl, log: quiet, sleep: async () => {} })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readFileSync(join(dir, 'broadcast.json'), 'utf8')).toBe(mapText);
  });

  it('offline with the feed cached but originals missing: maps nothing it has not got, reports them, prunes stale sets', async () => {
    mkdirSync(join(dir, 'cache'), { recursive: true });
    writeFileSync(join(dir, 'cache', 'feed.json'), JSON.stringify(FEED));
    mkdirSync(join(dir, 'mirror', '256'), { recursive: true });
    writeFileSync(join(dir, 'mirror', '256', '1.deadbeefdead.webp'), 'stale schema-1 file');
    writeFileSync(join(dir, 'mirror', '256', 'README.txt'), 'not ours');
    mkdirSync(join(dir, 'mirror', 'aaaaaaaaaaaa', '256'), { recursive: true });
    writeFileSync(join(dir, 'mirror', 'aaaaaaaaaaaa', '256', '1.webp'), 'stale set');
    const fetchImpl = vi.fn();
    expect(await main(paths, { fetch: fetchImpl, log: quiet, sleep: async () => {} })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    const map = JSON.parse(readFileSync(join(dir, 'broadcast.json'), 'utf8'));
    expect(map.entries).toEqual({});
    // The empty set's version equals the committed empty map's.
    expect(map.version).toBe('e3b0c44298fc');
    expect(JSON.parse(readFileSync(join(dir, 'cache', 'report.json'), 'utf8')).notCached).toEqual(['1', '151', '19-regional-a', '6']);
    expect(readdirSync(join(dir, 'mirror', '256'))).toEqual(['README.txt']);
    expect(existsSync(join(dir, 'mirror', 'aaaaaaaaaaaa'))).toBe(false);
  });

  it('a full run prunes staging directories of crashed runs and keeps a live concurrent one', async () => {
    mkdirSync(join(dir, 'cache'), { recursive: true });
    writeFileSync(join(dir, 'cache', 'feed.json'), JSON.stringify(FEED));
    mkdirSync(join(dir, 'mirror', '.staging-111', '256'), { recursive: true });
    writeFileSync(join(dir, 'mirror', '.staging-111', '256', '1.webp'), 'half-written');
    mkdirSync(join(dir, 'mirror', '.staging-222'), { recursive: true });
    mkdirSync(join(dir, 'mirror', '.staging-notapid'), { recursive: true });
    const isProcessAliveFake = vi.fn((pid) => pid === 222);
    const deps = { fetch: vi.fn(), log: quiet, sleep: async () => {}, isProcessAlive: isProcessAliveFake };
    expect(await main(paths, deps)).toBe(0);
    const left = readdirSync(join(dir, 'mirror')).sort();
    expect(left).toContain('.staging-222');
    expect(left).toContain('.staging-notapid');
    expect(left).not.toContain('.staging-111');
    expect(isProcessAliveFake).toHaveBeenCalledWith(111);
  });

  it('a --limit trial leaves a crashed staging directory alone (trials never prune)', async () => {
    const { fetchImpl } = await fakeSource();
    mkdirSync(join(dir, 'mirror', '.staging-111'), { recursive: true });
    const trial = ['--download', '--limit', '1', '--cache', join(dir, 'cache'), '--mirror', join(dir, 'mirror'), '--map', join(dir, 'trial.json'), '--delay-ms', '0'];
    expect(await main(trial, { fetch: fetchImpl, log: quiet, sleep: async () => {}, isProcessAlive: () => false })).toBe(0);
    expect(existsSync(join(dir, 'mirror', '.staging-111'))).toBe(true);
  });

  it('isProcessAlive: true for this process, false for a pid that does not exist', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2 ** 22 + 12345)).toBe(false);
  });

  it('a --limit trial without --map leaves the default map untouched', async () => {
    const { fetchImpl } = await fakeSource();
    const trial = ['--download', '--limit', '1', '--cache', join(dir, 'cache'), '--mirror', join(dir, 'mirror'), '--delay-ms', '0'];
    // deps.mapFile stands in for the default map path (src/lib/pkmn/sprite-maps/broadcast.json):
    // without --limit main() writes it (the tests above), with --limit it must not.
    const defaultMap = join(dir, 'default-map.json');
    expect(await main(trial, { fetch: fetchImpl, log: quiet, sleep: async () => {}, mapFile: defaultMap })).toBe(0);
    expect(existsSync(defaultMap)).toBe(false);
    expect(readdirSync(join(dir, 'cache', 'originals'))).toEqual(['1.png']);
  });

  it('a --limit trial with an explicit --map writes the trial map there only and prunes nothing', async () => {
    const { fetchImpl } = await fakeSource();
    // A full run first: the mirror holds the full set the committed map names.
    expect(await main(['--download', ...paths], { fetch: fetchImpl, log: quiet, sleep: async () => {}, backoffMs: 1 })).toBe(0);
    const fullMap = JSON.parse(readFileSync(join(dir, 'broadcast.json'), 'utf8'));
    const fullSet = readdirSync(join(dir, 'mirror', fullMap.version, '256')).sort();
    expect(fullSet).toEqual(['1.webp', '19-regional-a.webp', '6.webp']);

    const trialMap = join(dir, 'trial-map.json');
    const defaultMap = join(dir, 'default-map.json');
    const trial = ['--limit', '1', '--cache', join(dir, 'cache'), '--mirror', join(dir, 'mirror'), '--delay-ms', '0', '--map', trialMap];
    expect(await main(trial, { fetch: fetchImpl, log: quiet, sleep: async () => {}, mapFile: defaultMap })).toBe(0);
    expect(existsSync(defaultMap)).toBe(false);
    const trialVersion = JSON.parse(readFileSync(trialMap, 'utf8'));
    expect(Object.keys(trialVersion.entries)).toHaveLength(1);
    expect(trialVersion.version).not.toBe(fullMap.version);
    // The full set is untouched: the committed map still names files that exist.
    expect(readdirSync(join(dir, 'mirror', fullMap.version, '256')).sort()).toEqual(fullSet);
    expect(readdirSync(join(dir, 'mirror')).sort()).toEqual([fullMap.version, trialVersion.version].sort());
  });

  it('fails (exit 1) when an original keeps failing, keeping what it cached', async () => {
    const { fetchImpl } = await fakeSource();
    const flaky = vi.fn(async (url, init) => (url.includes('/6.png') ? response(500, '') : fetchImpl(url, init)));
    expect(await main(['--download', ...paths], { fetch: flaky, log: quiet, sleep: async () => {}, backoffMs: 1 })).toBe(1);
    expect(existsSync(join(dir, 'cache', 'originals', '1.png'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'cache', 'report.json'), 'utf8')).failed).toEqual([{ stem: '6', error: 'HTTP 500' }]);
  });
});
