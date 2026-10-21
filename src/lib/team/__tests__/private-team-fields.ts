/**
 * Test-only helpers for the share-link columns (not a test file itself: no
 * `.test.` suffix). Route and mapper tests build team rows that carry the
 * share columns with recognisable sentinel values (as a raw database row
 * would), then assert that a serialized payload carries none of them, by key
 * and by value.
 */
import { expect } from 'vitest';
import type { Team } from '@/types/team';
import { PRIVATE_TEAM_FIELDS } from '../public-team';

/** Columns no team response carries (the owner gets the token only from the share route). */
export const PRIVATE_TEAM_KEYS = PRIVATE_TEAM_FIELDS;

/** Values no public field ever holds; finding one means a share column leaked. */
export const PRIVATE_TEAM_SENTINELS = {
  share_token: '5e17e1a1-dead-4bee-8f00-5ec2e7700000',
  share_enabled_at: '2099-10-10T10:10:10.101Z',
} as const satisfies Record<(typeof PRIVATE_TEAM_KEYS)[number], string>;

/**
 * A team as a raw `teams` row would come back from `select('*')`: every
 * `Team` field plus the share columns set to sentinels. Typed as `Team` (the
 * extra keys ride along at runtime), which is exactly the leak the mappers
 * must stop.
 */
export function teamRowWithShareSecrets(overrides: Partial<Team> = {}): Team {
  const team: Team = {
    id: 'team-1',
    player_id: 'owner-1',
    name: 'Rain',
    tournament_id: 'tourney-1',
    season_id: null,
    match_id: null,
    pokemon: [
      {
        name: '',
        species: 'Pelipper',
        gender: '',
        item: 'Damp Rock',
        ability: 'Drizzle',
        evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        nature: 'Bold',
        level: 100,
        moves: ['Hurricane', 'U-turn'],
      },
    ],
    import_source: 'manual',
    locked: false,
    is_draft_team: false,
    draft_pool_id: null,
    library_published_at: null,
    library_title: null,
    library_description: null,
    library_tags: null,
    forked_from_team_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
  return Object.assign(team, { ...PRIVATE_TEAM_SENTINELS });
}

/** Assert that `payload` (any JSON-serializable value) holds no share column, by key or value. */
export function expectNoPrivateTeamData(payload: unknown): void {
  const json = JSON.stringify(payload);
  for (const key of PRIVATE_TEAM_KEYS) {
    expect(json, `payload must not carry the "${key}" key`).not.toContain(`"${key}"`);
  }
  for (const [key, value] of Object.entries(PRIVATE_TEAM_SENTINELS)) {
    expect(json, `payload must not carry the ${key} value`).not.toContain(value);
  }
}
