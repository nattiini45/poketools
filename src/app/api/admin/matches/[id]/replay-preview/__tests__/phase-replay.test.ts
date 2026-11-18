import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as preview } from '../route';
import { POST as importReplay } from '../../replay-import/route';
import { computeReplayHash } from '@/lib/pkmn/replay-identity';
import { ReplaySidePlayerNotParticipantError, ReplaySidesNotDistinctError } from '@/lib/pkmn/replay-binding';

const mocks = vi.hoisted(() => ({
  requirePlayer: vi.fn(),
  canAdministerPhase: vi.fn(),
  canAdministerTournament: vi.fn(),
  storageMode: vi.fn(),
  findOwner: vi.fn(),
  isStandalone: vi.fn(),
  nativeMatch: vi.fn(),
  legacyMatch: vi.fn(),
  globalReplayHash: vi.fn(),
  legacyReplayHash: vi.fn(),
  findShowdownPlayer: vi.fn(),
  fetch: vi.fn(),
  nativeRecord: vi.fn(),
  legacyRecord: vi.fn(),
  nativeEffects: vi.fn(),
  legacyEffects: vi.fn(),
  nativeServices: vi.fn(),
  revalidate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: mocks.requirePlayer }));
vi.mock('@/lib/auth/phase-access', () => ({ canAdministerPhaseAccess: mocks.canAdministerPhase }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.canAdministerTournament }));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: mocks.storageMode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findNativePhaseAliasOwner: mocks.findOwner, standaloneMatchAliasExists: mocks.isStandalone,
}));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: mocks.nativeMatch }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: mocks.legacyMatch }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ findPhaseGameIdByReplayHash: mocks.globalReplayHash }));
vi.mock('@/lib/supabase/queries/games', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/supabase/queries/games')>(),
  findGameIdByReplayHash: mocks.legacyReplayHash,
}));
vi.mock('@/lib/supabase/queries/players', () => ({ getPlayerByPsUsername: mocks.findShowdownPlayer }));
vi.mock('@/lib/league-phase/services', () => ({ createNativePhaseServices: mocks.nativeServices }));
vi.mock('@/lib/revalidation', () => ({ revalidatePhaseMatchPages: mocks.revalidate, expireSeasonReads: vi.fn() }));
vi.mock('@/lib/pkmn/game-pipeline', () => ({ recordGameResult: mocks.legacyRecord }));
vi.mock('@/lib/league-phase/result-effects', () => ({ emitPhaseResultEffects: mocks.nativeEffects }));
vi.mock('@/lib/match/result-effects', () => ({ emitMatchResultEffects: mocks.legacyEffects }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: mocks.audit }));
vi.mock('@/lib/utils/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 19, retryAfterSeconds: 0 })),
}));

const MATCH = 'daa274a2-59da-43fd-84a5-8cede96e15a4';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const owner = {
  kind: 'phase',
  phase_id: '33333333-3333-4333-8333-333333333333',
  season_id: '44444444-4444-4444-8444-444444444444',
};
const actor = { playerId: P2, name: 'Organizer', isAdmin: false };
const match = {
  id: MATCH, phase_id: owner.phase_id, player_1_id: P1, player_2_id: P2,
  player_1_name: 'Trainer One', player_2_name: 'Trainer Two',
};
const url = 'https://replay.pokemonshowdown.com/gen9ou-100';
const log = ['|player|p1|Substitute', '|player|p2|Registered', '|turn|1', '|win|Substitute'].join('\n');
const hash = computeReplayHash(log);
const assignment = { replay_url: url, replay_hash: hash, side_player_ids: [P2, P1] };
const result = {
  game_id: 'game-1', game_winner_id: P2, match_winner_id: P2,
  bo_reached: true, match_status: 'pending_confirmation',
};

function responseWithLog(replayLog: string) {
  return Response.json({ log: replayLog, players: ['Substitute', 'Registered'] });
}

function send(handler: typeof preview | typeof importReplay, body: Record<string, unknown>) {
  return handler(new NextRequest('https://example.test/api/admin/replay', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { cookie: 'session=not-forwarded' },
  }), { params: Promise.resolve({ id: MATCH }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.requirePlayer.mockResolvedValue(actor);
  mocks.canAdministerPhase.mockResolvedValue(true);
  mocks.storageMode.mockResolvedValue('phase');
  mocks.findOwner.mockResolvedValue(owner);
  mocks.isStandalone.mockResolvedValue(false);
  mocks.nativeMatch.mockResolvedValue(match);
  mocks.fetch.mockImplementation(async () => responseWithLog(log));
  mocks.nativeServices.mockReturnValue({ matches: { recordGameResult: mocks.nativeRecord } });
  mocks.nativeRecord.mockResolvedValue(result);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('ID-only admin replay routes in phase mode', () => {
  it('previews the bound replay and suggests only a registered participant', async () => {
    mocks.findShowdownPlayer.mockImplementation(async (name: string) => ({ id: name === 'Registered' ? P1 : 'other' }));

    const response = await send(preview, { replay_url: url });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        winner_ps_username: 'Substitute',
        replay_hash: hash,
        suggestions: [
          { ps_username: 'Substitute', suggested_player_id: null },
          { ps_username: 'Registered', suggested_player_id: P1 },
        ],
      },
    });
    expect(mocks.findOwner).toHaveBeenCalledExactlyOnceWith({ matchId: MATCH });
    expect(mocks.canAdministerPhase).toHaveBeenCalledExactlyOnceWith(actor, owner.phase_id);
    expect(mocks.globalReplayHash).toHaveBeenCalledExactlyOnceWith(hash);
    expect(mocks.legacyMatch).not.toHaveBeenCalled();
    expect(mocks.nativeRecord).not.toHaveBeenCalled();
  });

  it('refuses a preview of a replay already bound in either store', async () => {
    mocks.globalReplayHash.mockResolvedValue('bound-game');

    const response = await send(preview, { replay_url: url });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'replay_already_recorded' });
    expect(mocks.globalReplayHash).toHaveBeenCalledExactlyOnceWith(hash);
    expect(mocks.findShowdownPlayer).not.toHaveBeenCalled();
  });

  it('fetches again and records only the bound replay and manual sides, with native effects and audit', async () => {
    const reviewed = await (await send(preview, { replay_url: url })).json();
    const response = await send(importReplay, {
      ...assignment,
      replay_hash: reviewed.data.replay_hash,
      winner_id: P1,
      pokemon_stats: [],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: result });
    expect(mocks.fetch.mock.calls).toEqual([
      [`${url}.json`, expect.objectContaining({ cache: 'no-store' })],
      [`${url}.json`, expect.objectContaining({ cache: 'no-store' })],
    ]);
    expect(mocks.nativeRecord).toHaveBeenCalledExactlyOnceWith({
      source: 'ps_replay', match_id: MATCH, submitter_id: P2, is_admin: true,
      side_player_ids: [P2, P1],
      replay: expect.objectContaining({ hash, url, parsed: expect.objectContaining({ winner_ps_username: 'Substitute' }) }),
    });
    expect(mocks.nativeEffects).toHaveBeenCalledExactlyOnceWith(owner, MATCH, result, { replayUrl: url });
    expect(mocks.legacyEffects).not.toHaveBeenCalled();
    expect(mocks.legacyRecord).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      actor_id: P2, action: 'game.import_replay', resource_type: 'phase_game', resource_id: result.game_id,
      metadata: {
        match_id: MATCH, phase_id: owner.phase_id, season_id: owner.season_id,
        replay_url: url, replay_hash: hash, winner_id: P2, legibility_gate_bypassed: true,
        assignments: [
          { ps_username: 'Substitute', player_id: P2, pokemon_count: 0 },
          { ps_username: 'Registered', player_id: P1, pokemon_count: 0 },
        ],
        match_status: result.match_status,
      },
    }));
  });

  it('rejects changed replay content before calling either writer or effects', async () => {
    const reviewed = await (await send(preview, { replay_url: url })).json();
    mocks.fetch.mockResolvedValueOnce(responseWithLog(log.replace('|win|Substitute', '|win|Registered')));

    const response = await send(importReplay, { ...assignment, replay_hash: reviewed.data.replay_hash });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'replay_changed_since_preview' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.nativeRecord).not.toHaveBeenCalled();
    expect(mocks.legacyRecord).not.toHaveBeenCalled();
    expect(mocks.nativeEffects).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([
    [[P1, owner.season_id], new ReplaySidePlayerNotParticipantError(owner.season_id), 'match_player_not_participant'],
    [[P1, P1], new ReplaySidesNotDistinctError(), 'replay_sides_not_distinct'],
  ])('keeps the native writer’s typed side rejection and skips successful-result effects (%j)', async (sides, error, code) => {
    mocks.nativeRecord.mockRejectedValue(error);

    const response = await send(importReplay, { ...assignment, side_player_ids: sides });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code });
    expect(mocks.nativeRecord).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ side_player_ids: sides }));
    expect(mocks.nativeEffects).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  describe.each([
    ['preview', preview],
    ['import', importReplay],
  ])('%s', (_operation, handler) => {
    it('denies a participant without live phase admin access before reading a replay', async () => {
      mocks.canAdministerPhase.mockResolvedValue(false);

      const response = await send(handler, assignment);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });
      expect(mocks.canAdministerTournament).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('refuses a foreign replay URL even for a live phase admin', async () => {
      const response = await send(handler, { ...assignment, replay_url: 'https://example.test/gen9ou-100' });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'replay_url_invalid' });
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('does not fall back when the match no longer belongs to the resolved native phase', async () => {
      mocks.nativeMatch.mockResolvedValue({ ...match, phase_id: owner.season_id });
      mocks.isStandalone.mockResolvedValue(true);

      const response = await send(handler, assignment);

      expect(response.status).toBe(404);
      expect(mocks.isStandalone).not.toHaveBeenCalled();
      expect(mocks.legacyMatch).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('does not read a legacy match unless it has a verified standalone owner', async () => {
      mocks.findOwner.mockResolvedValue(null);
      mocks.legacyMatch.mockResolvedValue({ ...match, tournament_id: 'legacy-linked' });

      const response = await send(handler, assignment);

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'match_not_found' });
      expect(mocks.isStandalone).toHaveBeenCalledExactlyOnceWith(MATCH);
      expect(mocks.legacyMatch).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it.each(['frozen_legacy', 'frozen_phase'])('refuses %s without trying either store', async (mode) => {
      mocks.storageMode.mockResolvedValue(mode);
      mocks.isStandalone.mockResolvedValue(true);

      const response = await send(handler, assignment);

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'phase_storage_unavailable' });
      expect(mocks.findOwner).not.toHaveBeenCalled();
      expect(mocks.isStandalone).not.toHaveBeenCalled();
      expect(mocks.legacyMatch).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('refuses an unreadable storage generation without trying either store', async () => {
      mocks.storageMode.mockRejectedValue(new Error('Invalid phase storage mode'));

      const response = await send(handler, assignment);

      expect(response.status).toBe(500);
      expect(mocks.findOwner).not.toHaveBeenCalled();
      expect(mocks.isStandalone).not.toHaveBeenCalled();
      expect(mocks.legacyMatch).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    });
  });

  it('keeps legacy admin replay available for verified standalone matches in phase mode', async () => {
    mocks.findOwner.mockResolvedValue(null);
    mocks.isStandalone.mockResolvedValue(true);
    mocks.legacyMatch.mockResolvedValue({ ...match, tournament_id: 'standalone' });
    mocks.canAdministerTournament.mockResolvedValue(true);
    mocks.legacyRecord.mockResolvedValue(result);

    const reviewed = await send(preview, { replay_url: url });
    const response = await send(importReplay, assignment);

    expect(reviewed.status).toBe(200);
    expect(response.status).toBe(200);
    expect(mocks.canAdministerTournament.mock.calls).toEqual([
      [P2, 'tournament', 'standalone'], [P2, 'tournament', 'standalone'],
    ]);
    expect(mocks.globalReplayHash).toHaveBeenCalledExactlyOnceWith(hash);
    expect(mocks.legacyRecord).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ match_id: MATCH }));
    expect(mocks.legacyEffects).toHaveBeenCalledExactlyOnceWith(MATCH, {
      boReached: true, requestCookie: 'session=not-forwarded', replayUrl: url,
    });
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      resource_type: 'game', metadata: expect.objectContaining({ tournament_id: 'standalone' }),
    }));
    expect(mocks.nativeMatch).not.toHaveBeenCalled();
    expect(mocks.canAdministerPhase).not.toHaveBeenCalled();
    expect(mocks.nativeEffects).not.toHaveBeenCalled();
  });

  it('does not read phase storage or phase replay hashes by default', async () => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', undefined);
    mocks.legacyMatch.mockResolvedValue({ ...match, tournament_id: 'legacy' });
    mocks.canAdministerTournament.mockResolvedValue(true);

    const response = await send(preview, { replay_url: url });

    expect(response.status).toBe(200);
    expect(mocks.legacyReplayHash).toHaveBeenCalledExactlyOnceWith(hash);
    expect(mocks.storageMode).not.toHaveBeenCalled();
    expect(mocks.findOwner).not.toHaveBeenCalled();
    expect(mocks.globalReplayHash).not.toHaveBeenCalled();
  });
});
