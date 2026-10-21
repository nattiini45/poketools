/**
 * The public match shape is the boundary between full match rows (admin
 * notes, submitter, confirmation timestamps) and anything a public page, a
 * public read-cache entry or a public API response carries. These tests feed
 * the mapper FULL rows with recognisable private values and prove that only
 * the public field list survives — by key and by value.
 */
import { describe, expect, it } from 'vitest';
import type { MatchWithPlayers } from '@/types/match';
import {
  PRIVATE_MATCH_FIELDS,
  PUBLIC_GAME_FIELDS,
  PUBLIC_MATCH_FIELDS,
  toPublicMatch,
  toPublicMatches,
} from '../public-match';
import {
  expectNoPrivateMatchData,
  fullMatchRow,
  PRIVATE_MATCH_SENTINELS,
} from './private-match-fields';

describe('public match field lists', () => {
  it('the public and private lists partition every MatchWithPlayers key', () => {
    const row = fullMatchRow();
    const all = [...PUBLIC_MATCH_FIELDS, ...PRIVATE_MATCH_FIELDS].sort();

    expect(all).toEqual(Object.keys(row).sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it('the private list is exactly the admin-only columns', () => {
    expect([...PRIVATE_MATCH_FIELDS].sort()).toEqual(
      ['auto_confirm_at', 'confirmed_at', 'notes', 'submitter_id'].sort(),
    );
  });

  it('keeps social_image_url public (it is the public social card)', () => {
    expect(PUBLIC_MATCH_FIELDS).toContain('social_image_url');
  });
});

describe('toPublicMatch', () => {
  it('returns exactly the public fields, in list order, with the values unchanged', () => {
    const row = fullMatchRow();
    const result = toPublicMatch(row);

    expect(Object.keys(result)).toEqual([...PUBLIC_MATCH_FIELDS]);
    for (const key of PUBLIC_MATCH_FIELDS) {
      expect(result[key], key).toEqual(row[key]);
    }
  });

  it('drops every private column, by key and by value', () => {
    const result = toPublicMatch(fullMatchRow());

    for (const key of PRIVATE_MATCH_FIELDS) expect(result).not.toHaveProperty(key);
    expectNoPrivateMatchData(result);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_MATCH_SENTINELS.notes);
  });

  it('copies each game field by field (new objects, exactly the GameSummary fields)', () => {
    const row = fullMatchRow();
    const result = toPublicMatch(row);

    expect(result.games).toEqual(row.games);
    expect(result.games).not.toBe(row.games);
    result.games.forEach((game, index) => {
      expect(game).not.toBe(row.games[index]);
      expect(Object.keys(game)).toEqual([...PUBLIC_GAME_FIELDS]);
    });
  });

  it('drops keys it does not know, on the match and on its games (a new column cannot leak)', () => {
    const row = fullMatchRow();
    const widened = {
      ...row,
      future_private_column: 'MATCH-SECRET future column',
      games: row.games.map((game) => ({ ...game, game_secret: 'MATCH-SECRET game column' })),
    } as MatchWithPlayers;

    const result = toPublicMatch(widened);

    expect(Object.keys(result)).toEqual([...PUBLIC_MATCH_FIELDS]);
    for (const game of result.games) expect(Object.keys(game)).toEqual([...PUBLIC_GAME_FIELDS]);
    expectNoPrivateMatchData(result);
  });

  it('passes nulls and missing values through as they are (no normalisation)', () => {
    const row = fullMatchRow({
      winner_id: null,
      winner_name: null,
      date_played: null,
      social_image_url: null,
      bracket_side: null,
      bracket_pos: null,
      games: [],
    });
    const partial = { ...row } as Partial<MatchWithPlayers>;
    delete partial.player_2_avatar_url;

    const result = toPublicMatch(partial as MatchWithPlayers);

    expect(result.winner_id).toBeNull();
    expect(result.winner_name).toBeNull();
    expect(result.social_image_url).toBeNull();
    expect(result.bracket_pos).toBeNull();
    expect(result.games).toEqual([]);
    expect(result.player_2_avatar_url).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('player_2_avatar_url');
  });

  it('accepts its own output (mapping twice is a no-op)', () => {
    const once = toPublicMatch(fullMatchRow());
    expect(toPublicMatch(once)).toEqual(once);
  });
});

describe('toPublicMatches', () => {
  it('maps every row', () => {
    const rows = [fullMatchRow(), fullMatchRow({ id: 'match-2', notes: 'MATCH-SECRET second note' })];
    const result = toPublicMatches(rows);

    expect(result.map((m) => m.id)).toEqual(['match-1', 'match-2']);
    for (const match of result) expect(Object.keys(match)).toEqual([...PUBLIC_MATCH_FIELDS]);
    expectNoPrivateMatchData(result);
  });

  it('returns an empty array for no rows', () => {
    expect(toPublicMatches([])).toEqual([]);
  });
});
