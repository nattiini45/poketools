/**
 * Guest players in the players query layer (20261018160000_players_guest_identity.sql):
 * createPlayer's guest insert and identity guards, the constraint-violation mapping
 * (playerWriteError), and claimGuestPlayer's single atomic RPC.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'select', 'insert', 'update', 'delete', 'eq', 'rpc']) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));

import { claimGuestPlayer, createPlayer, createPlayersBatch, playerWriteError } from '../players';
import { UserFacingError } from '@/lib/api/user-facing-error';

const guestRow = {
  id: 'g-1',
  name: 'Guest Ash',
  discord_id: null,
  auth_user_id: null,
  ps_username: '',
  champions_username: '',
  is_admin: false,
  is_creator: false,
  is_guest: true,
  is_test_account: false,
  joined_date: '2026-10-18',
  avatar_url: null,
  avatar_config: null,
  status: 'active',
  suspended_until: null,
  ban_reason: null,
  world_experience: 'full',
  created_at: '2026-10-18T00:00:00Z',
  updated_at: '2026-10-18T00:00:00Z',
};

const identityCheckViolation = {
  code: '23514',
  message: 'new row for relation "players" violates check constraint "players_identity_check"',
  details: null,
  hint: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const [name, fn] of Object.entries(mockBuilder)) {
    if (name !== 'single') fn.mockReturnValue(mockBuilder);
  }
});

describe('createPlayer (guest)', () => {
  it('inserts a guest with no identity and is_guest = true', async () => {
    mockBuilder.single.mockResolvedValue({ data: guestRow, error: null });

    const player = await createPlayer({ name: 'Guest Ash', is_guest: true });

    expect(mockBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Guest Ash',
        discord_id: null,
        auth_user_id: null,
        is_guest: true,
      }),
    );
    expect(player.is_guest).toBe(true);
    expect(player.discord_id).toBeNull();
  });

  it('rejects a guest that carries an identity before touching the DB', async () => {
    await expect(
      createPlayer({ name: 'Guest Ash', is_guest: true, discord_id: '123456789012345678' }),
    ).rejects.toThrow('A guest player cannot have a discord_id or auth_user_id');
    await expect(
      createPlayer({ name: 'Guest Ash', is_guest: true, auth_user_id: 'auth-1' }),
    ).rejects.toThrow('A guest player cannot have a discord_id or auth_user_id');
    expect(mockBuilder.insert).not.toHaveBeenCalled();
  });

  it('rejects a registration with neither identity nor is_guest', async () => {
    await expect(createPlayer({ name: 'Nobody' })).rejects.toThrow(
      'Player registration requires a discord_id, auth_user_id, or is_guest',
    );
    expect(mockBuilder.insert).not.toHaveBeenCalled();
  });

  it('maps a players_identity_check violation to player_identity_required (400)', async () => {
    mockBuilder.single.mockResolvedValue({ data: null, error: identityCheckViolation });

    const err = await createPlayer({ name: 'Guest Ash', is_guest: true }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UserFacingError);
    expect(err).toMatchObject({ code: 'player_identity_required', statusCode: 400 });
  });

  it('maps a duplicate Discord ID to player_identity_taken (409)', async () => {
    mockBuilder.single.mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "players_discord_id_key"',
        details: 'Key (discord_id)=(123456789012345678) already exists.',
        hint: null,
      },
    });

    const err = await createPlayer({ name: 'Ash', discord_id: '123456789012345678' }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(UserFacingError);
    expect(err).toMatchObject({ code: 'player_identity_taken', statusCode: 409 });
  });

  it('maps the batch insert the same way', async () => {
    mockBuilder.select.mockResolvedValueOnce({ data: null, error: identityCheckViolation });

    await expect(createPlayersBatch([{ name: 'Guest Ash', is_guest: true }])).rejects.toMatchObject({
      code: 'player_identity_required',
    });
  });
});

describe('playerWriteError', () => {
  it('passes unrelated errors through unchanged', () => {
    const other = { code: '23514', message: 'violates check constraint "players_status_check"' };
    expect(playerWriteError(other)).toBe(other);
    const fk = { code: '23503', message: 'foreign key violation' };
    expect(playerWriteError(fk)).toBe(fk);
    const otherUnique = { code: '23505', message: 'duplicate key value violates unique constraint "players_pkey"' };
    expect(playerWriteError(otherUnique)).toBe(otherUnique);
  });

  it('recognises the auth_user_id unique key', () => {
    expect(
      playerWriteError({ code: '23505', message: 'violates unique constraint "players_auth_user_id_key"' }),
    ).toMatchObject({ code: 'player_identity_taken' });
  });
});

describe('claimGuestPlayer', () => {
  it('runs the claim as one claim_guest_player RPC and returns the claimed, non-guest row', async () => {
    const claimedRow = {
      ...guestRow,
      discord_id: '123456789012345678',
      auth_user_id: 'auth-1',
      is_guest: false,
    };
    mockBuilder.single.mockResolvedValue({ data: claimedRow, error: null });

    const claimed = await claimGuestPlayer('g-1', 's-1');

    expect(mockBuilder.rpc).toHaveBeenCalledTimes(1);
    expect(mockBuilder.rpc).toHaveBeenCalledWith('claim_guest_player', {
      p_guest_id: 'g-1',
      p_source_id: 's-1',
    });
    // No PostgREST row writes: the old three-step update/update/delete is gone.
    expect(mockBuilder.update).not.toHaveBeenCalled();
    expect(mockBuilder.delete).not.toHaveBeenCalled();
    expect(claimed).toMatchObject({
      id: 'g-1',
      discord_id: '123456789012345678',
      auth_user_id: 'auth-1',
      is_guest: false,
    });
  });

  it('rethrows the RPC error (e.g. 23503 from a remaining reference) unchanged', async () => {
    const fkError = { code: '23503', message: 'update or delete on table "players" violates foreign key constraint' };
    mockBuilder.single.mockResolvedValue({ data: null, error: fkError });

    await expect(claimGuestPlayer('g-1', 's-1')).rejects.toBe(fkError);
  });
});
