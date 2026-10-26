/**
 * The one parser of the restore warnings, shared by the server-only queries (RPC result) and the client (route body).
 */
import { describe, expect, it } from 'vitest';
import { parseRestoreWarnings } from '../restore-warnings';

describe('parseRestoreWarnings', () => {
  it('reads the three known warnings', () => {
    expect(
      parseRestoreWarnings([
        { code: 'parent_missing_nulled', rel: 'draft_picks', column: 'line_entry_id', count: 2 },
        { code: 'replay_hash_released', count: 1 },
        { code: 'columns_ignored', rel: 'games', columns: ['legacy_flag', 7] },
      ]),
    ).toEqual([
      { code: 'parent_missing_nulled', rel: 'draft_picks', column: 'line_entry_id', count: 2 },
      { code: 'replay_hash_released', count: 1 },
      { code: 'columns_ignored', rel: 'games', columns: ['legacy_flag'] },
    ]);
  });

  it('drops unknown codes and entries with a missing or mistyped field', () => {
    expect(
      parseRestoreWarnings([
        null,
        'text',
        { code: 'something_new', count: 1 },
        { code: 'parent_missing_nulled', rel: 'draft_picks', count: 2 },
        { code: 'replay_hash_released', count: '1' },
        { code: 'columns_ignored', columns: ['a'] },
      ]),
    ).toEqual([]);
  });

  it('is empty for anything that is not an array', () => {
    expect(parseRestoreWarnings(undefined)).toEqual([]);
    expect(parseRestoreWarnings({ code: 'replay_hash_released', count: 1 })).toEqual([]);
  });
});
