/**
 * The public player shapes are the security boundary between player rows and
 * anything serialized to a browser. These tests feed the mappers FULL rows
 * carrying every private column (with recognisable values) and prove that
 * nothing outside the public field lists survives — by key and by value.
 */
import { describe, expect, it } from 'vitest';
import type { SeasonParticipant } from '@/types/season';
import type { ParticipantWithSeed } from '@/types/tournament';
import {
  ADMIN_SEASON_PARTICIPANT_FIELDS,
  ADMIN_TOURNAMENT_PARTICIPANT_FIELDS,
  PUBLIC_PARTICIPANT_FIELDS,
  PUBLIC_PLAYER_FIELDS,
  PUBLIC_PLAYER_REF_FIELDS,
  PUBLIC_SEASON_PARTICIPANT_FIELDS,
  PUBLIC_TOURNAMENT_PARTICIPANT_FIELDS,
  toAdminSeasonParticipant,
  toAdminTournamentParticipant,
  toPublicParticipant,
  toPublicParticipants,
  toPublicPlayer,
  toPublicPlayerRef,
  toPublicSeasonParticipant,
  toPublicTournamentParticipant,
} from '../public-player';
import { expectNoPrivatePlayerData, fullPlayerRow } from './private-player-fields';

const PRIVATE_VALUES = {
  discord_id: 'discord-SECRET-123',
  auth_user_id: 'auth-SECRET-456',
  ban_reason: 'SECRET moderation note',
  suspended_until: '2099-01-01T00:00:00.000Z',
} as const;

function fullParticipant(overrides: Partial<SeasonParticipant> = {}): SeasonParticipant {
  return {
    id: 'player-1',
    name: 'Mara Feldkamp',
    ...PRIVATE_VALUES,
    ps_username: 'SECRET-ps',
    champions_username: 'SECRET-champ',
    is_admin: true,
    is_creator: true,
    is_guest: false,
    is_test_account: true,
    joined_date: '2026-01-01T00:00:00.000Z',
    avatar_url: 'https://cdn.example.test/a.png',
    avatar_config: null,
    status: 'suspended',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    gym_type: 'Fire',
    core_types: ['Fire', 'Water', 'Grass'],
    core_assigned_at: '2026-01-03T00:00:00.000Z',
    ...overrides,
  };
}

describe('public player field lists', () => {
  it('the participant shape is exactly id, name and gym band', () => {
    expect([...PUBLIC_PARTICIPANT_FIELDS]).toEqual(['id', 'name', 'gym_type']);
    expect([...PUBLIC_PLAYER_REF_FIELDS]).toEqual(['id', 'name']);
  });

  it('no public field list names a private player column', () => {
    const privateColumns = [
      'discord_id',
      'auth_user_id',
      'ban_reason',
      'suspended_until',
      'status',
      'is_admin',
      'is_test_account',
      'is_creator',
      'is_guest',
      'ps_username',
      'champions_username',
      'avatar_config',
      'joined_date',
    ];
    for (const list of [PUBLIC_PARTICIPANT_FIELDS, PUBLIC_PLAYER_REF_FIELDS, PUBLIC_SEASON_PARTICIPANT_FIELDS]) {
      for (const column of privateColumns) {
        expect(list as readonly string[]).not.toContain(column);
      }
    }
  });
});

describe('toPublicParticipant', () => {
  it('keeps only the public fields of a full participant row', () => {
    const result = toPublicParticipant(fullParticipant());

    expect(result).toEqual({ id: 'player-1', name: 'Mara Feldkamp', gym_type: 'Fire' });
    expect(Object.keys(result).sort()).toEqual([...PUBLIC_PARTICIPANT_FIELDS].sort());
  });

  it('no private value survives serialization (the RSC payload is JSON)', () => {
    const serialized = JSON.stringify(toPublicParticipants([fullParticipant(), fullParticipant({ id: 'player-2' })]));

    for (const value of Object.values(PRIVATE_VALUES)) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toContain('SECRET');
    for (const key of ['discord_id', 'auth_user_id', 'ban_reason', 'suspended_until', 'is_admin', 'is_test_account', 'status']) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });

  it('a column added to players later cannot leak through (no spread)', () => {
    const withFutureColumn = { ...fullParticipant(), email: 'SECRET@example.test' } as SeasonParticipant;

    expect(toPublicParticipant(withFutureColumn)).not.toHaveProperty('email');
  });

  it('a missing gym band becomes null, never undefined (JSON-stable)', () => {
    const result = toPublicParticipant({ id: 'p', name: 'N', gym_type: undefined as unknown as null });
    expect(result.gym_type).toBeNull();
  });

  it('maps a list in order', () => {
    const rows = [fullParticipant({ id: 'a', name: 'A' }), fullParticipant({ id: 'b', name: 'B', gym_type: null })];
    expect(toPublicParticipants(rows)).toEqual([
      { id: 'a', name: 'A', gym_type: 'Fire' },
      { id: 'b', name: 'B', gym_type: null },
    ]);
  });
});

describe('toPublicPlayerRef', () => {
  it('keeps only id and name', () => {
    expect(toPublicPlayerRef(fullParticipant())).toEqual({ id: 'player-1', name: 'Mara Feldkamp' });
  });
});

// ─── Shapes added for the participant and profile API routes ─────────────

/** Columns no shape below may carry, whoever the caller. */
const IDENTITY_AND_MODERATION = [
  'discord_id',
  'auth_user_id',
  'ban_reason',
  'suspended_until',
  'status',
  'is_admin',
  'avatar_config',
  'created_at',
  'updated_at',
];

function fullTournamentRow(overrides: Partial<ParticipantWithSeed> = {}): ParticipantWithSeed {
  return { ...fullPlayerRow(), seed: 3, starting_bracket: 'losers', ...overrides };
}

describe('toPublicPlayer (the profile card)', () => {
  it('keeps exactly the profile card fields', () => {
    const result = toPublicPlayer(fullPlayerRow());

    expect(Object.keys(result)).toEqual([...PUBLIC_PLAYER_FIELDS]);
    expect(result).toEqual({
      id: 'player-1',
      name: 'Mara Feldkamp',
      avatar_url: 'https://cdn.example.test/mara.thumb.webp',
      ps_username: 'mara_ps',
      champions_username: 'mara_champs',
      joined_date: '2026-01-01',
      is_creator: true,
      is_guest: false,
    });
    expectNoPrivatePlayerData(result);
  });
});

describe('toPublicTournamentParticipant', () => {
  it('keeps { id, name, avatar_url, seed, starting_bracket } only', () => {
    const result = toPublicTournamentParticipant(fullTournamentRow());

    expect(Object.keys(result)).toEqual([...PUBLIC_TOURNAMENT_PARTICIPANT_FIELDS]);
    expect(result).toEqual({
      id: 'player-1',
      name: 'Mara Feldkamp',
      avatar_url: 'https://cdn.example.test/mara.thumb.webp',
      seed: 3,
      starting_bracket: 'losers',
    });
    expectNoPrivatePlayerData(result);
  });
});

describe('toPublicSeasonParticipant', () => {
  it('keeps the public season fields only', () => {
    const result = toPublicSeasonParticipant(fullParticipant());

    expect(Object.keys(result)).toEqual([...PUBLIC_SEASON_PARTICIPANT_FIELDS]);
    expectNoPrivatePlayerData(result);
  });
});

describe('roster admin shapes', () => {
  it('the season admin row adds only the guest and test-account flags', () => {
    const result = toAdminSeasonParticipant(fullParticipant({ is_guest: true }));

    expect(Object.keys(result)).toEqual([...ADMIN_SEASON_PARTICIPANT_FIELDS]);
    expect(result).toMatchObject({ is_guest: true, is_test_account: true });
    expectNoPrivatePlayerData(result, { allowKeys: ['is_test_account'] });
  });

  it('the tournament admin row adds only the guest flag', () => {
    const result = toAdminTournamentParticipant(fullTournamentRow({ is_guest: true }));

    expect(Object.keys(result)).toEqual([...ADMIN_TOURNAMENT_PARTICIPANT_FIELDS]);
    expect(result.is_guest).toBe(true);
    expectNoPrivatePlayerData(result);
  });

  it('no shape names an identity or moderation column', () => {
    for (const list of [
      PUBLIC_PLAYER_FIELDS,
      PUBLIC_TOURNAMENT_PARTICIPANT_FIELDS,
      ADMIN_SEASON_PARTICIPANT_FIELDS,
      ADMIN_TOURNAMENT_PARTICIPANT_FIELDS,
    ]) {
      for (const column of IDENTITY_AND_MODERATION) {
        expect(list as readonly string[]).not.toContain(column);
      }
    }
  });
});
