import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import type { SessionPlayer } from '@/types/auth';

// The guard reads the live player (loadSessionPlayer) and the participant row from the database on every call.
vi.mock('server-only', () => ({}));
vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ isSeasonPlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime-reads', () => ({ getSeasonPlayState: vi.fn() }));

import { auth, loadSessionPlayer } from '@/auth';
import { getSeasonPlayState } from '@/lib/supabase/queries/format-runtime-reads';
import { isSeasonPlayer } from '@/lib/supabase/queries/seasons';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { AuthError } from '../helpers';
import { assertSeasonOpenForPlay, requireSeasonMember } from '../season-member';

const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
const mockedLoad = vi.mocked(loadSessionPlayer);
const mockedRow = vi.mocked(isSeasonPlayer);
const mockedPlayState = vi.mocked(getSeasonPlayState);

const SEASON = '3f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5b';
const PLAYER_ID = '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function player(overrides: Partial<SessionPlayer> = {}): SessionPlayer {
  return {
    playerId: PLAYER_ID,
    name: 'Ash',
    isAdmin: false,
    isResourceAdmin: false,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
    ...overrides,
  };
}

function signIn(live: SessionPlayer | null): void {
  mockedAuth.mockResolvedValue({
    user: { id: 'discord-1', name: 'T', email: 't@example.com', image: null },
    player: live,
    expires: '2099-01-01',
  });
  mockedLoad.mockImplementation(async () => (live ? { ...live } : null));
}

beforeEach(() => {
  vi.resetAllMocks();
  signIn(player());
  mockedRow.mockResolvedValue(true);
});

describe('requireSeasonMember', () => {
  it('lets a participant through and returns the live player and the league id', async () => {
    const member = await requireSeasonMember(SEASON);
    expect(member.seasonId).toBe(SEASON);
    expect(member.player.playerId).toBe(PLAYER_ID);
    expect(mockedRow).toHaveBeenCalledWith(SEASON, PLAYER_ID);
  });

  it('normalises an upper-case id and reads the participant row with the lower-case one', async () => {
    const member = await requireSeasonMember(SEASON.toUpperCase());
    expect(member.seasonId).toBe(SEASON);
    expect(mockedRow).toHaveBeenCalledWith(SEASON, PLAYER_ID);
  });

  it('answers a malformed id with a 404 INVALID_SEASON_ID, before any participant read', async () => {
    await expect(requireSeasonMember('nope')).rejects.toMatchObject({ code: 'INVALID_SEASON_ID', statusCode: 404 });
    await expect(requireSeasonMember('nope')).rejects.toBeInstanceOf(UserFacingError);
    expect(mockedRow).not.toHaveBeenCalled();
  });

  it('refuses a signed-in player who is not a participant with a 403 format_not_participant', async () => {
    mockedRow.mockResolvedValue(false);
    await expect(requireSeasonMember(SEASON)).rejects.toMatchObject({ code: 'format_not_participant', statusCode: 403 });
  });

  it('gives a site admin who does not play no bypass', async () => {
    signIn(player({ isAdmin: true }));
    mockedRow.mockResolvedValue(false);
    await expect(requireSeasonMember(SEASON)).rejects.toMatchObject({ code: 'format_not_participant', statusCode: 403 });
  });

  it('refuses a player who left the league (no participant row any more)', async () => {
    mockedRow.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(requireSeasonMember(SEASON)).resolves.toBeDefined();
    await expect(requireSeasonMember(SEASON)).rejects.toMatchObject({ code: 'format_not_participant' });
  });

  it('refuses a signed-out caller with 401, without reading the league', async () => {
    mockedAuth.mockResolvedValue(null);
    await expect(requireSeasonMember(SEASON)).rejects.toMatchObject({ statusCode: 401 });
    expect(mockedRow).not.toHaveBeenCalled();
  });

  it('checks the player before the participant: a banned player is refused first', async () => {
    signIn(player({ status: 'banned' }));
    await expect(requireSeasonMember(SEASON)).rejects.toBeInstanceOf(AuthError);
    expect(mockedRow).not.toHaveBeenCalled();
  });

  it('refuses an identity with no player row', async () => {
    signIn(null);
    await expect(requireSeasonMember(SEASON)).rejects.toMatchObject({ statusCode: 403 });
    expect(mockedRow).not.toHaveBeenCalled();
  });
});

describe('assertSeasonOpenForPlay', () => {
  it('lets an upcoming and an active league take moves', async () => {
    mockedPlayState.mockResolvedValue({ status: 'upcoming', archived: false });
    await expect(assertSeasonOpenForPlay(SEASON)).resolves.toBeUndefined();
    mockedPlayState.mockResolvedValue({ status: 'active', archived: false });
    await expect(assertSeasonOpenForPlay(SEASON)).resolves.toBeUndefined();
  });

  it('refuses a completed league with 409 format_season_closed', async () => {
    mockedPlayState.mockResolvedValue({ status: 'completed', archived: false });
    await expect(assertSeasonOpenForPlay(SEASON)).rejects.toMatchObject({ code: 'format_season_closed', statusCode: 409 });
  });

  it('refuses an archived league, whatever its status', async () => {
    mockedPlayState.mockResolvedValue({ status: 'active', archived: true });
    await expect(assertSeasonOpenForPlay(SEASON)).rejects.toMatchObject({ code: 'format_season_closed', statusCode: 409 });
  });

  it('refuses a league that does not exist with a 404', async () => {
    mockedPlayState.mockResolvedValue(null);
    await expect(assertSeasonOpenForPlay(SEASON)).rejects.toMatchObject({ code: 'SEASON_NOT_FOUND', statusCode: 404 });
  });
});
