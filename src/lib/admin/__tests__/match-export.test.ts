import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/utils/csv';
import type { AdminMatchRow } from '@/lib/supabase/queries/matches';
import {
  ADMIN_MATCH_EXPORT_CAP,
  MATCH_EXPORT_BOM,
  MATCH_EXPORT_COLUMNS,
  matchExportFileName,
  matchExportRecord,
  matchesToCsv,
} from '../match-export';

const HEADER =
  '"match_id","league","phase","round","round_number","player_1","player_2","status","winner","games_p1","games_p2","best_of","scheduled_at","date_played"';

function row(over: Partial<AdminMatchRow> = {}): AdminMatchRow {
  return {
    id: 'm-1',
    round_id: 'r-1',
    tournament_id: 't-1',
    player_1_id: 'p1',
    player_2_id: 'p2',
    winner_id: 'p1',
    status: 'completed',
    submitter_id: 'p1',
    date_played: '2026-10-25T10:00:00+00:00',
    scheduled_at: '2026-10-24T18:30:00+02:00',
    auto_confirm_at: null,
    confirmed_at: null,
    notes: 'private note',
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    player_1_name: 'Alice',
    player_2_name: 'Bob',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: 'Alice',
    round_status: 'active',
    games: [
      { id: 'g1', game_number: 1, winner_id: 'p1', replay_url: '', source: 'manual', stats_locked: false },
      { id: 'g2', game_number: 2, winner_id: 'p2', replay_url: '', source: 'manual', stats_locked: false },
      { id: 'g3', game_number: 3, winner_id: 'p1', replay_url: '', source: 'manual', stats_locked: false },
    ],
    tournament_name: 'Group stage',
    season_id: 's-1',
    season_name: 'Summer League',
    season_is_test: false,
    archived: false,
    round_name: 'Round 2',
    round_number: 2,
    best_of: 3,
    round_deadline: null,
    ...over,
  };
}

/** The data lines of a CSV (header excluded), as parsed cells keyed by column. */
const parsed = (csv: string) => parseCsv(csv).rows;

describe('matchesToCsv', () => {
  it('writes the exact header row', () => {
    expect(MATCH_EXPORT_COLUMNS.join(',')).toBe(
      'match_id,league,phase,round,round_number,player_1,player_2,status,winner,games_p1,games_p2,best_of,scheduled_at,date_played',
    );
    expect(matchesToCsv([row()]).split('\n')[0]).toBe(HEADER);
  });

  it('returns the header line alone for zero rows, the same line a non-empty export starts with', () => {
    expect(matchesToCsv([])).toBe(HEADER);
    expect(matchesToCsv([row()]).split('\n')[0]).toBe(matchesToCsv([]));
  });

  it('writes one line per match after the header', () => {
    const csv = matchesToCsv([row({ id: 'a' }), row({ id: 'b' })]);
    expect(csv.split('\n')).toHaveLength(3);
    expect(parsed(csv).map((r) => r.match_id)).toEqual(['a', 'b']);
  });

  it('maps a row to raw English values and ISO UTC dates', () => {
    const [record] = parsed(matchesToCsv([row()]));
    expect(record).toEqual({
      match_id: 'm-1',
      league: 'Summer League',
      phase: 'Group stage',
      round: 'Round 2',
      round_number: '2',
      player_1: 'Alice',
      player_2: 'Bob',
      status: 'completed',
      winner: 'Alice',
      games_p1: '2',
      games_p2: '1',
      best_of: '3',
      scheduled_at: '2026-10-24T16:30:00.000Z',
      date_played: '2026-10-25T10:00:00.000Z',
    });
  });

  it('leaves numeric columns unprefixed, so a number stays a number', () => {
    const line = matchesToCsv([row()]).split('\n')[1];
    expect(line).toContain(',"Round 2","2","Alice","Bob",');
    expect(line).toContain(',"Alice","2","1","3",');
    expect(line).not.toContain("'");
  });

  it('turns null values into empty cells', () => {
    const [record] = parsed(
      matchesToCsv([row({ season_name: null, winner_name: null, winner_id: null, scheduled_at: null, date_played: null, status: 'scheduled', games: [] })]),
    );
    expect(record.league).toBe('');
    expect(record.winner).toBe('');
    expect(record.scheduled_at).toBe('');
    expect(record.date_played).toBe('');
  });

  it('leaves both games columns empty when the match has no games, and fills them with zeros once a game is recorded', () => {
    const [none] = parsed(matchesToCsv([row({ games: [] })]));
    expect(none.games_p1).toBe('');
    expect(none.games_p2).toBe('');
    const [drawn] = parsed(
      matchesToCsv([
        row({ games: [{ id: 'g', game_number: 1, winner_id: null, replay_url: '', source: 'manual', stats_locked: false }] }),
      ]),
    );
    expect(drawn.games_p1).toBe('0');
    expect(drawn.games_p2).toBe('0');
  });

  it('exports no notes and no other private column', () => {
    const csv = matchesToCsv([row()]);
    expect(csv).not.toContain('private note');
    expect(Object.keys(matchExportRecord(row()))).toEqual([...MATCH_EXPORT_COLUMNS]);
  });

  it('keeps a date that does not parse as stored', () => {
    expect(matchExportRecord(row({ scheduled_at: 'soon' })).scheduled_at).toBe('soon');
  });

  it('escapes quotes, commas and newlines inside a cell', () => {
    const csv = matchesToCsv([row({ player_1_name: 'Say "hi", Bob\nsecond line' })]);
    expect(csv).toContain('"Say ""hi"", Bob\nsecond line"');
    expect(parsed(csv)[0].player_1).toBe('Say "hi", Bob\nsecond line');
  });

  describe('formula safety', () => {
    it.each([
      ['=', '=HYPERLINK("http://x","y")'],
      ['+', '+1+1'],
      ['-', '-2+3'],
      ['@', '@SUM(A1)'],
      ['a tab', '\t=1+1'],
      ['a leading space and =', ' =1+1'],
    ])('prefixes a quote to a player name starting with %s', (_label, name) => {
      const [record] = parsed(matchesToCsv([row({ player_1_name: name })]));
      expect(record.player_1).toBe(`'${name}`);
    });

    it.each([
      ['=', '=cmd|calc'],
      ['+', '+cmd'],
      ['-', '-cmd'],
      ['@', '@cmd'],
      ['a tab', '\tcmd'],
      ['a leading space and =', ' =cmd'],
    ])('prefixes a quote to a league name starting with %s', (_label, name) => {
      const [record] = parsed(matchesToCsv([row({ season_name: name, tournament_name: name })]));
      expect(record.league).toBe(`'${name}`);
      expect(record.phase).toBe(`'${name}`);
    });

    it('leaves an ordinary name unprefixed', () => {
      expect(parsed(matchesToCsv([row({ player_1_name: 'O\'Brien' })]))[0].player_1).toBe("O'Brien");
    });
  });
});

describe('export constants', () => {
  it('uses a 5,000-row cap and a UTF-8 byte order mark', () => {
    expect(ADMIN_MATCH_EXPORT_CAP).toBe(5000);
    expect(MATCH_EXPORT_BOM).toBe('﻿');
  });
});

describe('matchExportFileName', () => {
  const now = new Date('2026-10-25T23:30:00Z');

  it('names a complete export by the UTC day', () => {
    expect(matchExportFileName(now, { exported: 312, total: 312 })).toBe('matches-2026-10-25.csv');
    expect(matchExportFileName(now, { exported: 0, total: 0 })).toBe('matches-2026-10-25.csv');
  });

  it('adds N-of-M when the export was cut', () => {
    expect(matchExportFileName(now, { exported: 2500, total: 3412 })).toBe('matches-2026-10-25-2500-of-3412.csv');
  });
});
