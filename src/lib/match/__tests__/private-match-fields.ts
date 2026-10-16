/**
 * Test-only helpers for the admin-only match fields (not a test file itself:
 * no `.test.` suffix). Route, cache and mapper tests build FULL match rows
 * whose private columns carry recognisable sentinel values, then assert that
 * a serialized payload carries none of those columns, by key and by value.
 */
import { expect } from 'vitest';
import type { MatchWithPlayers } from '@/types/match';
import { PRIVATE_MATCH_FIELDS } from '../public-match';

/** Columns only admins, resource admins and the match's participants may receive. */
export const PRIVATE_MATCH_KEYS = PRIVATE_MATCH_FIELDS;

/** Values no public field ever holds; finding one means a private column leaked. */
export const PRIVATE_MATCH_SENTINELS = {
  notes: 'MATCH-SECRET admin dispute note',
  submitter_id: 'submitter-MATCH-SECRET',
  auto_confirm_at: '2099-11-11T11:11:11.111Z',
  confirmed_at: '2099-12-12T12:12:12.121Z',
} as const satisfies Record<(typeof PRIVATE_MATCH_KEYS)[number], string>;

/** A full `MatchWithPlayers` row with every private column set to a sentinel. */
export function fullMatchRow(overrides: Partial<MatchWithPlayers> = {}): MatchWithPlayers {
  return {
    id: 'match-1',
    round_id: 'round-1',
    tournament_id: 'tournament-1',
    player_1_id: 'player-1',
    player_2_id: 'player-2',
    winner_id: 'player-1',
    status: 'completed',
    submitter_id: PRIVATE_MATCH_SENTINELS.submitter_id,
    date_played: '2026-03-01T18:00:00.000Z',
    scheduled_at: '2026-03-01T17:00:00.000Z',
    auto_confirm_at: PRIVATE_MATCH_SENTINELS.auto_confirm_at,
    confirmed_at: PRIVATE_MATCH_SENTINELS.confirmed_at,
    notes: PRIVATE_MATCH_SENTINELS.notes,
    social_image_url: 'https://cdn.example.test/social/match-1.png',
    bracket_side: 'winners',
    bracket_pos: 2,
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-03-01T18:05:00.000Z',
    player_1_name: 'Mara Feldkamp',
    player_2_name: 'Jonas Reed',
    player_1_avatar_url: 'https://cdn.example.test/mara.thumb.webp',
    player_2_avatar_url: null,
    winner_name: 'Mara Feldkamp',
    round_status: 'completed',
    games: [
      {
        id: 'game-1',
        game_number: 1,
        winner_id: 'player-1',
        replay_url: 'https://replay.example.test/game-1',
        source: 'manual',
        stats_locked: true,
      },
      {
        id: 'game-2',
        game_number: 2,
        winner_id: 'player-1',
        replay_url: 'https://replay.example.test/game-2',
        source: 'manual',
        stats_locked: false,
      },
    ],
    ...overrides,
  };
}

/**
 * Asserts `JSON.stringify(body)` contains no private match key (as a JSON
 * key) and no sentinel value.
 */
export function expectNoPrivateMatchData(body: unknown): void {
  const json = JSON.stringify(body);
  for (const key of PRIVATE_MATCH_KEYS) {
    expect(json, `private match key "${key}" in ${json}`).not.toContain(`"${key}"`);
  }
  for (const value of Object.values(PRIVATE_MATCH_SENTINELS)) {
    expect(json, `private match value "${value}" in ${json}`).not.toContain(value);
  }
  expect(json).not.toContain('MATCH-SECRET');
}
