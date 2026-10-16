import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock (chained builder) ──────────────────────────────────
const chainMethods = [
  'from', 'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'contains', 'filter', 'not', 'or', 'order', 'limit', 'range', 'match',
  'returns', 'throwOnError',
];

const { mockBuilder } = vi.hoisted(() => {
  const mb = {} as Record<string, ReturnType<typeof vi.fn>> & {
    auth: {
      admin: {
        createUser: ReturnType<typeof vi.fn>;
        updateUserById: ReturnType<typeof vi.fn>;
        deleteUser: ReturnType<typeof vi.fn>;
      };
    };
  };
  const methods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
    'contains', 'filter', 'not', 'or', 'order', 'limit', 'range', 'match',
    'returns', 'throwOnError',
  ];
  for (const m of methods) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  mb.maybeSingle = vi.fn();
  mb.auth = {
    admin: {
      createUser: vi.fn(),
      updateUserById: vi.fn(),
      deleteUser: vi.fn(),
    },
  };
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

import {
  STANDARD_TEST_PLAYERS,
  STANDARD_TEST_PLAYER_COUNT,
  ensureStandardTestPlayers,
  listTestAccounts,
  getTestAccountIds,
  getTestAccount,
  assertTestAccount,
  shouldExcludeFromAllTime,
  mintLoginCredentials,
  clearLoginCredentials,
} from '../test-accounts';
import { UserFacingError } from '@/lib/api/user-facing-error';

function resetMocks() {
  for (const m of chainMethods) {
    mockBuilder[m].mockClear().mockReturnValue(mockBuilder);
  }
  mockBuilder.single.mockReset();
  mockBuilder.maybeSingle.mockReset();
  mockBuilder.auth.admin.createUser.mockReset();
  mockBuilder.auth.admin.updateUserById.mockReset();
  mockBuilder.auth.admin.deleteUser.mockReset();
}

function makePlayerRow(index: number) {
  const n = String(index + 1).padStart(2, '0');
  return {
    id: `test-id-${n}`,
    name: `EvoTest${n}`,
    discord_id: `__test__EvoTest${n}`,
    auth_user_id: null,
    ps_username: `EvoTest${n}`,
    champions_username: '',
    is_admin: false,
    is_creator: false,
    is_test_account: true,
    joined_date: '2026-08-13T00:00:00Z',
    avatar_url: null,
    avatar_config: null,
    status: 'active',
    suspended_until: null,
    ban_reason: null,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:00:00Z',
  };
}

// ─────────────────────────────────────────────────────────────────────
describe('test-accounts / spec §1', () => {
  beforeEach(resetMocks);

  describe('STANDARD_TEST_PLAYERS', () => {
    it('defines exactly 14 canonical dummy players', () => {
      expect(STANDARD_TEST_PLAYER_COUNT).toBe(14);
      expect(STANDARD_TEST_PLAYERS).toHaveLength(14);
    });

    it('names them EvoTest01–EvoTest14 with stable synthetic discord IDs', () => {
      STANDARD_TEST_PLAYERS.forEach((spec, i) => {
        const n = String(i + 1).padStart(2, '0');
        expect(spec.name).toBe(`EvoTest${n}`);
        expect(spec.psUsername).toBe(`EvoTest${n}`);
        expect(spec.discordId).toBe(`__test__EvoTest${n}`);
      });
    });
  });

  describe('ensureStandardTestPlayers', () => {
    it('upserts all 14 marked is_test_account, keyed on synthetic discord_id', async () => {
      mockBuilder.order.mockReturnValue({
        data: Array.from({ length: 14 }, (_, i) => makePlayerRow(i)),
        error: null,
      });

      const players = await ensureStandardTestPlayers();

      expect(players).toHaveLength(14);
      expect(mockBuilder.upsert).toHaveBeenCalledTimes(1);
      const [rows, opts] = mockBuilder.upsert.mock.calls[0];
      expect(rows).toHaveLength(14);
      expect((opts as { onConflict: string }).onConflict).toBe('discord_id');
      for (const row of rows as Array<{ is_test_account: boolean; discord_id: string }>) {
        expect(row.is_test_account).toBe(true);
        expect(row.discord_id).toMatch(/^__test__EvoTest\d{2}$/);
      }
      // Idempotency: every returned account is flagged + has synthetic discord_id.
      for (const p of players) {
        expect(p.is_test_account).toBe(true);
      }
    });

    it('upserts exactly the 14 synthetic __test__EvoTestNN discord_ids (spec §27 "exactly 14 created")', async () => {
      mockBuilder.order.mockReturnValue({
        data: Array.from({ length: 14 }, (_, i) => makePlayerRow(i)),
        error: null,
      });

      await ensureStandardTestPlayers();

      const [rows] = mockBuilder.upsert.mock.calls[0];
      const discordIds = (rows as Array<{ discord_id: string }>).map(
        (r) => r.discord_id,
      );
      // Exact synthetic-key set, in EvoTest01–EvoTest14 order.
      expect(discordIds).toEqual(
        Array.from({ length: 14 }, (_, i) => `__test__EvoTest${String(i + 1).padStart(2, '0')}`),
      );
    });

    it('is idempotent: a second call re-upserts the same 14 rows on discord_id, never duplicating (spec §27 "idempotent creation")', async () => {
      mockBuilder.order.mockReturnValue({
        data: Array.from({ length: 14 }, (_, i) => makePlayerRow(i)),
        error: null,
      });

      await ensureStandardTestPlayers();
      await ensureStandardTestPlayers();

      // Two calls => two upserts, each gated by onConflict: 'discord_id'. The
      // upsert-on-conflict IS the idempotency mechanism; nothing in the code path
      // ever inserts net-new rows outside that upsert.
      expect(mockBuilder.upsert).toHaveBeenCalledTimes(2);
      for (const call of mockBuilder.upsert.mock.calls) {
        const [rows, opts] = call;
        expect(rows).toHaveLength(14);
        expect((opts as { onConflict: string }).onConflict).toBe('discord_id');
        for (const row of rows as Array<{ is_test_account: boolean; discord_id: string }>) {
          expect(row.is_test_account).toBe(true);
          expect(row.discord_id).toMatch(/^__test__EvoTest\d{2}$/);
        }
      }
    });
  });

  describe('listTestAccounts', () => {
    it('queries is_test_account = true', async () => {
      mockBuilder.order.mockReturnValue({
        data: [makePlayerRow(0), makePlayerRow(1)],
        error: null,
      });
      const result = await listTestAccounts();
      expect(result).toHaveLength(2);
      expect(mockBuilder.from).toHaveBeenCalledWith('players');
      expect(mockBuilder.eq).toHaveBeenCalledWith('is_test_account', true);
    });
  });

  describe('getTestAccountIds', () => {
    it('returns the IDs of test accounts', async () => {
      mockBuilder.eq.mockReturnValue({ data: [{ id: 't1' }, { id: 't2' }], error: null });
      const ids = await getTestAccountIds();
      expect(ids).toEqual(['t1', 't2']);
    });

    it('filters to is_test_account = true and selects only id (spec §27 isolation)', async () => {
      mockBuilder.eq.mockReturnValue({ data: [{ id: 't1' }], error: null });
      await getTestAccountIds();
      expect(mockBuilder.from).toHaveBeenCalledWith('players');
      expect(mockBuilder.select).toHaveBeenCalledWith('id');
      expect(mockBuilder.eq).toHaveBeenCalledWith('is_test_account', true);
    });

    it('returns an empty array when there are no test accounts', async () => {
      mockBuilder.eq.mockReturnValue({ data: [], error: null });
      const ids = await getTestAccountIds();
      expect(ids).toEqual([]);
    });
  });

  describe('getTestAccount / assertTestAccount', () => {
    it('assertTestAccount throws a UserFacingError for a non-test player', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      await expect(assertTestAccount('not-test')).rejects.toBeInstanceOf(UserFacingError);
    });

    it('getTestAccount returns null for a non-test player', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getTestAccount('not-test')).toBeNull();
    });
  });

  describe('shouldExcludeFromAllTime', () => {
    it('excludes when the season is a test season', async () => {
      // season query: .eq('id', sid) chains to maybeSingle
      mockBuilder.eq.mockReturnValueOnce(mockBuilder);
      mockBuilder.maybeSingle.mockResolvedValue({
        data: { is_test_season: true },
        error: null,
      });
      const exclude = await shouldExcludeFromAllTime('season-1', ['p1']);
      expect(exclude).toBe(true);
    });

    it('excludes when a participant is a test account', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder) // season .eq('id')
        .mockReturnValueOnce({ data: [{ id: 'p1' }], error: null }); // getTestAccountIds .eq('is_test_account')
      mockBuilder.maybeSingle.mockResolvedValue({
        data: { is_test_season: false },
        error: null,
      });
      const exclude = await shouldExcludeFromAllTime('season-1', ['p1', 'p2']);
      expect(exclude).toBe(true);
    });

    it('does not exclude a normal season with no test accounts', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ data: [], error: null });
      mockBuilder.maybeSingle.mockResolvedValue({
        data: { is_test_season: false },
        error: null,
      });
      const exclude = await shouldExcludeFromAllTime('season-1', ['real-p1', 'real-p2']);
      expect(exclude).toBe(false);
    });

    it('does not exclude a null season with no test accounts', async () => {
      mockBuilder.eq.mockReturnValue({ data: [], error: null });
      const exclude = await shouldExcludeFromAllTime(null, ['real-p1']);
      expect(exclude).toBe(false);
    });
  });

  describe('mintLoginCredentials / clearLoginCredentials', () => {
    it('updates the existing auth user when one is already linked', async () => {
      const player = { ...makePlayerRow(0), auth_user_id: 'existing-u' };
      mockBuilder.maybeSingle.mockResolvedValue({ data: player, error: null });
      mockBuilder.auth.admin.updateUserById.mockResolvedValue({ data: {}, error: null });

      const creds = await mintLoginCredentials('test-id-01');

      expect(creds.email).toBe('evotest01@plc-test.local');
      expect(mockBuilder.auth.admin.updateUserById).toHaveBeenCalledWith(
        'existing-u',
        expect.objectContaining({ email: creds.email }),
      );
      expect(mockBuilder.auth.admin.createUser).not.toHaveBeenCalled();
    });

    it('creates an auth user and links it when none exists', async () => {
      const player = { ...makePlayerRow(0), auth_user_id: null };
      mockBuilder.maybeSingle.mockResolvedValue({ data: player, error: null });
      mockBuilder.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'new-u' } }, error: null });
      mockBuilder.is.mockReturnValueOnce({ count: 1, error: null }); // guarded link

      const creds = await mintLoginCredentials('test-id-01');

      expect(creds.email).toBe('evotest01@plc-test.local');
      expect(mockBuilder.auth.admin.createUser).toHaveBeenCalled();
      expect(mockBuilder.auth.admin.deleteUser).not.toHaveBeenCalled();
    });

    it('cleans up the created auth user and throws when a concurrent mint wins the link', async () => {
      const player = { ...makePlayerRow(0), auth_user_id: null };
      mockBuilder.maybeSingle.mockResolvedValue({ data: player, error: null });
      mockBuilder.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'new-u' } }, error: null });
      mockBuilder.is.mockReturnValueOnce({ count: 0, error: null }); // link lost
      mockBuilder.auth.admin.deleteUser.mockResolvedValue({ data: {}, error: null });

      await expect(mintLoginCredentials('test-id-01')).rejects.toThrow();
      expect(mockBuilder.auth.admin.deleteUser).toHaveBeenCalledWith('new-u');
    });

    it('clear is a no-op when no auth user is linked', async () => {
      const player = { ...makePlayerRow(0), auth_user_id: null };
      mockBuilder.maybeSingle.mockResolvedValue({ data: player, error: null });

      await clearLoginCredentials('test-id-01');

      expect(mockBuilder.auth.admin.deleteUser).not.toHaveBeenCalled();
    });

    it('clear deletes the auth user on the happy path', async () => {
      const player = { ...makePlayerRow(0), auth_user_id: 'u-clear' };
      mockBuilder.maybeSingle.mockResolvedValue({ data: player, error: null });
      // eq call order: getTestAccount(id), getTestAccount(is_test_account),
      // unlink(id), unlink(auth_user_id) -> terminal
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ count: 1, error: null });
      mockBuilder.auth.admin.deleteUser.mockResolvedValue({ data: {}, error: null });

      await clearLoginCredentials('test-id-01');

      expect(mockBuilder.auth.admin.deleteUser).toHaveBeenCalledWith('u-clear');
    });

    it('clear aborts without deleting when the link changed concurrently', async () => {
      const player = { ...makePlayerRow(0), auth_user_id: 'u-clear' };
      mockBuilder.maybeSingle.mockResolvedValue({ data: player, error: null });
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ count: 0, error: null }); // link changed under us
      mockBuilder.auth.admin.deleteUser.mockResolvedValue({ data: {}, error: null });

      await clearLoginCredentials('test-id-01');

      expect(mockBuilder.auth.admin.deleteUser).not.toHaveBeenCalled();
    });
  });
});
