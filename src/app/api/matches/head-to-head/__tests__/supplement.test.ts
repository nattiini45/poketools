/**
 * GET /api/matches/head-to-head with pack extensions (docs/format-packs.md, "Pack extensions"):
 * without a head-to-head provider the body is exactly `{ success, data }` and nothing extra runs;
 * with one, `supplement` carries the pair's earlier record (or says it is excluded or failed),
 * resolved after the cached read, from player 1's side, as an allowlist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  extensions: {} as Record<string, unknown>,
  getSessionPlayer: vi.fn(),
}));

vi.mock('@pack-extensions', () => ({ default: mocks.extensions }));
vi.mock('@/lib/auth/helpers', () => ({ getSessionPlayer: mocks.getSessionPlayer }));
vi.mock('@/lib/cache/public-reads', () => ({
  publicReads: { tournamentHeadToHead: vi.fn() },
}));

import { GET } from '@/app/api/matches/head-to-head/route';
import { publicReads } from '@/lib/cache/public-reads';

const T_ID = '11111111-1111-4111-8111-111111111111';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function request(): NextRequest {
  const url = new URL('http://localhost:3000/api/matches/head-to-head');
  url.searchParams.set('tournament_id', T_ID);
  url.searchParams.set('player_1_id', ALICE);
  url.searchParams.set('player_2_id', BOB);
  return new Request(url.toString()) as unknown as NextRequest;
}

function setExtensions(ext: Record<string, unknown>): void {
  for (const key of Object.keys(mocks.extensions)) delete mocks.extensions[key];
  Object.assign(mocks.extensions, ext);
}

beforeEach(() => {
  vi.clearAllMocks();
  setExtensions({});
  mocks.getSessionPlayer.mockResolvedValue(null);
  vi.mocked(publicReads.tournamentHeadToHead).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/matches/head-to-head: supplementary records', () => {
  it('without a provider the body is exactly { success, data } and no session is read', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [] });
    expect(mocks.getSessionPlayer).not.toHaveBeenCalled();
  });

  it("adds the pair's earlier record from player 1's side, as an allowlist", async () => {
    const provider = vi.fn().mockResolvedValue({ wins: 3, draws: 1, losses: 2, secret: 'x' });
    setExtensions({ supplementaryHeadToHead: provider });
    const res = await GET(request());
    expect(await res.json()).toEqual({
      success: true,
      data: [],
      supplement: { state: 'ready', record: { wins: 3, draws: 1, losses: 2 } },
    });
    expect(provider).toHaveBeenCalledWith(ALICE, BOB, { viewerPlayerId: null });
    // the supplement is resolved after the cached read, never inside it
    expect(vi.mocked(publicReads.tournamentHeadToHead).mock.invocationCallOrder[0]).toBeLessThan(
      provider.mock.invocationCallOrder[0],
    );
  });

  it('says ready with no record when the pair never met there', async () => {
    setExtensions({ supplementaryHeadToHead: vi.fn().mockResolvedValue(null) });
    expect(await (await GET(request())).json()).toMatchObject({ supplement: { state: 'ready', record: null } });
  });

  it('says excluded (and skips the provider) when the records do not count for the viewer', async () => {
    const provider = vi.fn();
    setExtensions({ includeSupplementaryRecords: vi.fn().mockResolvedValue(false), supplementaryHeadToHead: provider });
    expect(await (await GET(request())).json()).toMatchObject({ supplement: { state: 'excluded' } });
    expect(provider).not.toHaveBeenCalled();
  });

  it('says failed, keeps the live matches and logs the provider error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('timeout');
    setExtensions({ supplementaryHeadToHead: vi.fn().mockRejectedValue(boom) });
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [], supplement: { state: 'failed' } });
    expect(error).toHaveBeenCalledWith('[pack-extensions] supplementaryHeadToHead failed:', boom);
  });
});
