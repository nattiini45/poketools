/**
 * Test-only helpers for the player-PII boundary (not a test file itself: no
 * `.test.` suffix). Route and mapper tests build FULL player rows whose
 * private columns carry recognisable sentinel values, then assert that a
 * serialized response carries none of those columns, by key and by value.
 */
import { expect } from 'vitest';
import type { Player } from '@/types/player';

/**
 * Columns that must never reach another player's browser or an anonymous
 * caller. (The profile card's public fields, such as `ps_username`, are not
 * here: `PublicPlayer` shows them on purpose.)
 */
export const PRIVATE_PLAYER_KEYS = [
  'discord_id',
  'auth_user_id',
  'ban_reason',
  'suspended_until',
  'is_admin',
  'is_test_account',
  'avatar_config',
  'status',
] as const;

/** Values no public field ever holds; finding one means a private column leaked. */
export const PRIVATE_SENTINELS = {
  discord_id: 'discord-SECRET-111',
  auth_user_id: 'auth-SECRET-222',
  ban_reason: 'SECRET moderation note',
  suspended_until: '2099-12-31T00:00:00.000Z',
  avatar_config_marker: 'SECRET-avatar-config',
} as const;

/** A full `players` row with every private column set to a sentinel. */
export function fullPlayerRow(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    name: 'Mara Feldkamp',
    discord_id: PRIVATE_SENTINELS.discord_id,
    auth_user_id: PRIVATE_SENTINELS.auth_user_id,
    ps_username: 'mara_ps',
    champions_username: 'mara_champs',
    is_admin: true,
    is_creator: true,
    is_guest: false,
    is_test_account: true,
    joined_date: '2026-01-01',
    avatar_url: 'https://cdn.example.test/mara.thumb.webp',
    avatar_config: { marker: PRIVATE_SENTINELS.avatar_config_marker } as unknown as Player['avatar_config'],
    status: 'suspended',
    suspended_until: PRIVATE_SENTINELS.suspended_until,
    ban_reason: PRIVATE_SENTINELS.ban_reason,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Asserts `JSON.stringify(body)` contains no private player key (as a JSON
 * key) and no sentinel value. `allowKeys` names keys a shape may carry on
 * purpose (the roster admin shape's `is_test_account`).
 */
export function expectNoPrivatePlayerData(
  body: unknown,
  { allowKeys = [] }: { allowKeys?: readonly string[] } = {},
): void {
  const json = JSON.stringify(body);
  for (const key of PRIVATE_PLAYER_KEYS) {
    if (allowKeys.includes(key)) continue;
    expect(json, `private key "${key}" in ${json}`).not.toContain(`"${key}"`);
  }
  for (const value of Object.values(PRIVATE_SENTINELS)) {
    expect(json, `private value "${value}" in ${json}`).not.toContain(value);
  }
  expect(json).not.toContain('SECRET');
}
