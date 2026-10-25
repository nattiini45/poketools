import { describe, expect, it } from 'vitest';
import { FIELD_LIMITS } from '@/lib/validation/schemas';
import {
  ADMIN_MATCH_BULK_MAX,
  BULK_OK,
  ADMIN_MATCH_NOTES_TOTAL_MAX,
  ADMIN_MATCH_NOTE_MAX_LENGTH,
  adminMatchBatchSchema,
  appendMatchNote,
  bulkConfirmCheck,
  bulkScheduleCheck,
  classifyBulkResult,
  effectiveSelection,
  formatBulkNoteLine,
  localInputToIsoInZone,
  pageSelectionState,
  summarizeBulkResults,
  toggleMatchSelection,
  togglePageSelection,
  type BulkItemResult,
} from '../match-bulk';
import type { MatchStatus } from '@/types/match';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = (count: number) => Array.from({ length: count }, (_, i) => uuid(i + 1));
const WINNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** The `params` of a confirm that expects `WINNER` on every id. */
const expectation = (matchIds: string[], winner = WINNER) => ({
  expected: matchIds.map((match_id) => ({ match_id, winner_id: winner, status: 'pending_confirmation' })),
});
const confirmBody = (matchIds: string[], extra: Record<string, unknown> = {}) => ({
  action: 'confirm',
  match_ids: matchIds,
  params: expectation(matchIds),
  ...extra,
});

describe('constants', () => {
  it('keeps the note limit in step with the shared text limit', () => {
    expect(ADMIN_MATCH_NOTE_MAX_LENGTH).toBe(FIELD_LIMITS.MEDIUM_TEXT);
    expect(ADMIN_MATCH_BULK_MAX).toBe(100);
    expect(ADMIN_MATCH_NOTES_TOTAL_MAX).toBe(10_000);
  });
});

describe('adminMatchBatchSchema', () => {
  it('accepts a confirm that carries the previewed winner and status of every id', () => {
    expect(adminMatchBatchSchema.safeParse(confirmBody(ids(1))).success).toBe(true);
    expect(adminMatchBatchSchema.safeParse(confirmBody(ids(3))).success).toBe(true);
  });

  it('rejects a confirm without expectations, with empty ones, or with a malformed one', () => {
    const run = (candidate: unknown) => adminMatchBatchSchema.safeParse(candidate).success;
    expect(run({ action: 'confirm', match_ids: ids(1) })).toBe(false);
    expect(run({ action: 'confirm', match_ids: ids(1), params: {} })).toBe(false);
    expect(run({ action: 'confirm', match_ids: ids(1), params: { expected: [] } })).toBe(false);
    const entry = { match_id: ids(1)[0], winner_id: WINNER, status: 'pending_confirmation' };
    expect(run({ ...confirmBody(ids(1)), params: { expected: [entry] } })).toBe(true);
    expect(run({ ...confirmBody(ids(1)), params: { expected: [{ ...entry, winner_id: 'nope' }] } })).toBe(false);
    expect(run({ ...confirmBody(ids(1)), params: { expected: [{ ...entry, winner_id: null }] } })).toBe(false);
    expect(run({ ...confirmBody(ids(1)), params: { expected: [{ ...entry, status: 'completed' }] } })).toBe(false);
    expect(run({ ...confirmBody(ids(1)), params: { expected: [{ match_id: entry.match_id, winner_id: WINNER }] } })).toBe(false);
    expect(run({ ...confirmBody(ids(1)), params: { expected: [{ ...entry, extra: 1 }] } })).toBe(false);
  });

  it('needs exactly one expectation per match id', () => {
    const run = (candidate: unknown) => adminMatchBatchSchema.safeParse(candidate).success;
    const [a, b] = ids(2);
    // An id without an expectation, an expectation for an id that is not in the request, and a repeated expectation.
    expect(run({ action: 'confirm', match_ids: [a, b], params: expectation([a]) })).toBe(false);
    expect(run({ action: 'confirm', match_ids: [a], params: expectation([b]) })).toBe(false);
    expect(run({ action: 'confirm', match_ids: [a], params: expectation([a, a]) })).toBe(false);
    expect(run({ action: 'confirm', match_ids: [a, b], params: expectation([b, a]) })).toBe(true);
  });

  it('lower-cases the expected ids, so they match the lower-cased match_ids', () => {
    const upperId = ids(1)[0].toUpperCase();
    const result = adminMatchBatchSchema.safeParse({
      action: 'confirm',
      match_ids: [upperId],
      params: { expected: [{ match_id: upperId, winner_id: WINNER.toUpperCase(), status: 'pending_confirmation' }] },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.action === 'confirm') {
      expect(result.data.params.expected).toEqual([{ match_id: ids(1)[0], winner_id: WINNER, status: 'pending_confirmation' }]);
    }
  });

  it('bounds the expectations to 100', () => {
    expect(adminMatchBatchSchema.safeParse(confirmBody(ids(100))).success).toBe(true);
    expect(adminMatchBatchSchema.safeParse(confirmBody(ids(101))).success).toBe(false);
  });

  it('accepts a schedule with an offset time, past dates included', () => {
    const past = adminMatchBatchSchema.safeParse({
      action: 'schedule',
      match_ids: ids(2),
      params: { scheduled_at: '2020-05-01T18:00:00+02:00' },
    });
    expect(past.success).toBe(true);
    expect(
      adminMatchBatchSchema.safeParse({
        action: 'schedule',
        match_ids: ids(1),
        params: { scheduled_at: '2026-10-25T10:00:00Z' },
      }).success,
    ).toBe(true);
  });

  it('accepts a note and trims it, keeping newlines inside', () => {
    const result = adminMatchBatchSchema.safeParse({
      action: 'note',
      match_ids: ids(1),
      params: { note: '  first line\nsecond line  \n' },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.action === 'note') {
      expect(result.data.params.note).toBe('first line\nsecond line');
    }
  });

  it('accepts 1 and 100 ids and rejects 0 and 101', () => {
    expect(adminMatchBatchSchema.safeParse(confirmBody(ids(100))).success).toBe(true);
    expect(adminMatchBatchSchema.safeParse(confirmBody([])).success).toBe(false);
    expect(adminMatchBatchSchema.safeParse(confirmBody(ids(101))).success).toBe(false);
  });

  it('rejects a duplicate id, also one that differs only by case', () => {
    const id = uuid(1);
    expect(adminMatchBatchSchema.safeParse(confirmBody([id, id])).success).toBe(false);
    const upper = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    expect(adminMatchBatchSchema.safeParse(confirmBody([upper, upper.toLowerCase()])).success).toBe(false);
  });

  it('lower-cases the ids', () => {
    const result = adminMatchBatchSchema.safeParse(confirmBody(['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA']));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.match_ids).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
  });

  it('rejects a non-uuid id and an unknown action', () => {
    expect(adminMatchBatchSchema.safeParse(confirmBody(['not-a-uuid'])).success).toBe(false);
    expect(adminMatchBatchSchema.safeParse({ action: 'delete', match_ids: ids(1) }).success).toBe(false);
    expect(adminMatchBatchSchema.safeParse({ match_ids: ids(1) }).success).toBe(false);
  });

  it('rejects unknown keys at the top level and in params', () => {
    expect(adminMatchBatchSchema.safeParse(confirmBody(ids(1), { extra: 1 })).success).toBe(false);
    expect(
      adminMatchBatchSchema.safeParse(confirmBody(ids(1), { params: { ...expectation(ids(1)), x: 1 } })).success,
    ).toBe(false);
    expect(
      adminMatchBatchSchema.safeParse({
        action: 'schedule',
        match_ids: ids(1),
        params: { scheduled_at: '2026-10-25T10:00:00Z', extra: true },
      }).success,
    ).toBe(false);
    expect(
      adminMatchBatchSchema.safeParse({ action: 'note', match_ids: ids(1), params: { note: 'x', extra: true } }).success,
    ).toBe(false);
  });

  it('needs an offset time for a schedule: a naive time, a bare date, a year past 2100 or before 2000 fail', () => {
    const run = (scheduled_at: unknown) =>
      adminMatchBatchSchema.safeParse({ action: 'schedule', match_ids: ids(1), params: { scheduled_at } }).success;
    expect(run('2026-10-25T10:00:00')).toBe(false);
    expect(run('2026-10-25')).toBe(false);
    expect(run('2101-01-01T00:00:00Z')).toBe(false);
    expect(run('1999-12-31T23:59:59Z')).toBe(false);
    expect(run('2100-12-31T23:59:59Z')).toBe(true);
    expect(run(undefined)).toBe(false);
    expect(adminMatchBatchSchema.safeParse({ action: 'schedule', match_ids: ids(1) }).success).toBe(false);
  });

  it('rejects an empty or too long note', () => {
    const run = (note: string) =>
      adminMatchBatchSchema.safeParse({ action: 'note', match_ids: ids(1), params: { note } }).success;
    expect(run('')).toBe(false);
    expect(run('   \n ')).toBe(false);
    expect(run('a'.repeat(2000))).toBe(true);
    expect(run('a'.repeat(2001))).toBe(false);
    expect(adminMatchBatchSchema.safeParse({ action: 'note', match_ids: ids(1) }).success).toBe(false);
  });
});

describe('bulkConfirmCheck', () => {
  const base = { winner_id: 'p1', player_1_id: 'p1', player_2_id: 'p2' };

  it('is eligible for a pending confirmation with a participant winner, for either seat', () => {
    expect(bulkConfirmCheck({ ...base, status: 'pending_confirmation' })).toEqual({ eligible: true, winnerId: 'p1' });
    expect(bulkConfirmCheck({ ...base, winner_id: 'p2', status: 'pending_confirmation' })).toEqual({
      eligible: true,
      winnerId: 'p2',
    });
  });

  it.each(['scheduled', 'in_progress', 'completed', 'disputed'] as MatchStatus[])(
    'skips a %s match as not pending, whatever its winner',
    (status) => {
      expect(bulkConfirmCheck({ ...base, status })).toEqual({ eligible: false, code: 'match_bulk_not_pending' });
      expect(bulkConfirmCheck({ ...base, winner_id: null, status })).toEqual({
        eligible: false,
        code: 'match_bulk_not_pending',
      });
    },
  );

  it('skips a pending match without a winner', () => {
    expect(bulkConfirmCheck({ ...base, winner_id: null, status: 'pending_confirmation' })).toEqual({
      eligible: false,
      code: 'match_complete_no_winner',
    });
  });

  it('skips a pending match whose winner is not a participant', () => {
    expect(bulkConfirmCheck({ ...base, winner_id: 'stranger', status: 'pending_confirmation' })).toEqual({
      eligible: false,
      code: 'match_winner_not_participant',
    });
  });
});

describe('bulkScheduleCheck', () => {
  it('skips only a completed match', () => {
    expect(bulkScheduleCheck({ status: 'completed' })).toEqual({
      eligible: false,
      code: 'match_bulk_schedule_completed',
    });
    for (const status of ['scheduled', 'in_progress', 'pending_confirmation', 'disputed'] as MatchStatus[]) {
      expect(bulkScheduleCheck({ status })).toEqual({ eligible: true });
    }
  });
});

describe('selection helpers', () => {
  it('toggles one id in and out', () => {
    const one = toggleMatchSelection(new Set(), 'a');
    expect([...one]).toEqual(['a']);
    expect([...toggleMatchSelection(one, 'b')]).toEqual(['a', 'b']);
    expect(toggleMatchSelection(one, 'a').size).toBe(0);
  });

  it('does not mutate its input', () => {
    const start = new Set(['a']);
    toggleMatchSelection(start, 'b');
    togglePageSelection(start, ['a', 'b']);
    expect([...start]).toEqual(['a']);
  });

  it('adding at the cap is a no-op, removing at the cap still works', () => {
    const full = new Set(ids(ADMIN_MATCH_BULK_MAX));
    expect(toggleMatchSelection(full, 'extra')).toBe(full);
    expect(toggleMatchSelection(full, uuid(1)).size).toBe(ADMIN_MATCH_BULK_MAX - 1);
  });

  it('reports none, some and all of a page', () => {
    const page = ['a', 'b', 'c'];
    expect(pageSelectionState(page, new Set())).toBe('none');
    expect(pageSelectionState(page, new Set(['z']))).toBe('none');
    expect(pageSelectionState(page, new Set(['a', 'z']))).toBe('some');
    expect(pageSelectionState(page, new Set(['a', 'b', 'c']))).toBe('all');
    expect(pageSelectionState([], new Set(['a']))).toBe('none');
  });

  it('toggles the page: adds the missing ids, removes them all when everything is selected', () => {
    const page = ['a', 'b', 'c'];
    expect([...togglePageSelection(new Set(['a', 'z']), page)].sort()).toEqual(['a', 'b', 'c', 'z']);
    expect([...togglePageSelection(new Set(['a', 'b', 'c', 'z']), page)]).toEqual(['z']);
    expect(togglePageSelection(new Set(), page).size).toBe(3);
  });

  it('adds a page only up to the cap, in page order', () => {
    const selected = new Set(ids(98));
    const page = ['x1', 'x2', 'x3', 'x4'];
    const next = togglePageSelection(selected, page);
    expect(next.size).toBe(ADMIN_MATCH_BULK_MAX);
    expect(next.has('x1')).toBe(true);
    expect(next.has('x2')).toBe(true);
    expect(next.has('x3')).toBe(false);
  });

  it('prunes to the ids on the page and keeps page order', () => {
    const selected = new Set(['c', 'gone', 'a']);
    expect(effectiveSelection(selected, ['a', 'b', 'c'])).toEqual(['a', 'c']);
    expect(effectiveSelection(new Set(), ['a'])).toEqual([]);
    expect(effectiveSelection(selected, [])).toEqual([]);
  });
});

describe('localInputToIsoInZone', () => {
  it('converts Berlin summer time (UTC+2)', () => {
    expect(localInputToIsoInZone('2026-07-15T20:00', 'Europe/Berlin')).toBe('2026-07-15T18:00:00.000Z');
  });

  it('converts Berlin winter time (UTC+1)', () => {
    expect(localInputToIsoInZone('2026-01-15T20:00', 'Europe/Berlin')).toBe('2026-01-15T19:00:00.000Z');
  });

  it('reads UTC as itself', () => {
    expect(localInputToIsoInZone('2026-10-25T10:30', 'UTC')).toBe('2026-10-25T10:30:00.000Z');
  });

  it('is right on both sides of a DST change day', () => {
    // 2026-03-29: Berlin moves from UTC+1 to UTC+2 at 02:00 local.
    expect(localInputToIsoInZone('2026-03-29T01:30', 'Europe/Berlin')).toBe('2026-03-29T00:30:00.000Z');
    expect(localInputToIsoInZone('2026-03-29T12:00', 'Europe/Berlin')).toBe('2026-03-29T10:00:00.000Z');
  });

  it('moves a wall time inside the spring-forward gap forward by the gap', () => {
    // 02:30 does not exist on 2026-03-29 in Berlin; the clock shows 03:30 CEST (01:30 UTC).
    expect(localInputToIsoInZone('2026-03-29T02:30', 'Europe/Berlin')).toBe('2026-03-29T01:30:00.000Z');
  });

  it('resolves a wall time that happens twice (fall-back overlap) to one of its two instants', () => {
    // 02:30 happens twice on 2026-10-25 in Berlin: 02:30 CEST (00:30 UTC) and 02:30 CET (01:30 UTC).
    expect(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']).toContain(
      localInputToIsoInZone('2026-10-25T02:30', 'Europe/Berlin'),
    );
  });

  it('returns null for empty or garbage input', () => {
    expect(localInputToIsoInZone('', 'Europe/Berlin')).toBeNull();
    expect(localInputToIsoInZone('garbage', 'Europe/Berlin')).toBeNull();
    expect(localInputToIsoInZone('2026-07-15', 'Europe/Berlin')).toBeNull();
    expect(localInputToIsoInZone('2026-07-15T25:00', 'Europe/Berlin')).toBeNull();
    expect(localInputToIsoInZone('2026-07-15T20:61', 'Europe/Berlin')).toBeNull();
    expect(localInputToIsoInZone('2026-02-30T20:00', 'Europe/Berlin')).toBeNull();
    expect(localInputToIsoInZone('2026-13-01T20:00', 'Europe/Berlin')).toBeNull();
  });

  it('returns null for an unknown time zone', () => {
    expect(localInputToIsoInZone('2026-07-15T20:00', 'Not/AZone')).toBeNull();
  });
});

describe('note helpers', () => {
  it('stamps one line with the UTC minute and the actor', () => {
    const now = new Date('2026-03-04T05:06:59.999Z');
    expect(formatBulkNoteLine(now, 'Jo Admin', 'Moved to Sunday')).toBe('[2026-03-04 05:06 UTC, Jo Admin] Moved to Sunday');
  });

  it('keeps the note text as given and flattens whitespace in the name', () => {
    const line = formatBulkNoteLine(new Date('2026-12-31T23:59:00Z'), ' Jo \n Admin ', 'a\nb');
    expect(line).toBe('[2026-12-31 23:59 UTC, Jo Admin] a\nb');
  });

  it('appends to empty notes without a leading newline', () => {
    expect(appendMatchNote('', 'line')).toEqual({ ok: true, notes: 'line' });
  });

  it('appends to existing notes after one newline', () => {
    expect(appendMatchNote('first', 'second')).toEqual({ ok: true, notes: 'first\nsecond' });
    expect(appendMatchNote('first\n', 'second')).toEqual({ ok: true, notes: 'first\nsecond' });
  });

  it('allows exactly the cap and refuses one character more', () => {
    const fits = 'x'.repeat(ADMIN_MATCH_NOTES_TOTAL_MAX - 2);
    expect(appendMatchNote(fits, 'y')).toEqual({ ok: true, notes: `${fits}\ny` });
    expect(appendMatchNote(fits, 'yy')).toEqual({ ok: false, code: 'match_bulk_notes_full' });
    expect(appendMatchNote('', 'z'.repeat(ADMIN_MATCH_NOTES_TOTAL_MAX + 1))).toEqual({
      ok: false,
      code: 'match_bulk_notes_full',
    });
  });
});

describe('bulk results', () => {
  const ok: BulkItemResult = { id: '1', ok: true, code: BULK_OK };
  const warning: BulkItemResult = { id: '2', ok: true, code: 'match_finalize_incomplete', params: { count: 1 } };
  const skipped: BulkItemResult = { id: '3', ok: false, code: 'match_bulk_not_pending' };
  const conflict: BulkItemResult = { id: '4', ok: false, code: 'match_bulk_conflict' };
  const failed: BulkItemResult = { id: '5', ok: false, code: 'match_bulk_item_failed' };

  it('classifies every result', () => {
    expect(classifyBulkResult(ok)).toBe('changed');
    expect(classifyBulkResult(warning)).toBe('warning');
    expect(classifyBulkResult(skipped)).toBe('skipped');
    expect(classifyBulkResult(conflict)).toBe('conflict');
    expect(classifyBulkResult(failed)).toBe('failed');
  });

  it('classifies each skip code as skipped and each failure code as failed', () => {
    for (const code of [
      'match_bulk_not_pending',
      'match_complete_no_winner',
      'match_winner_not_participant',
      'match_bulk_schedule_completed',
      'match_bulk_notes_full',
    ] as const) {
      expect(classifyBulkResult({ ok: false, code })).toBe('skipped');
    }
    for (const code of ['match_not_found', 'match_bulk_item_failed', 'match_bulk_not_processed'] as const) {
      expect(classifyBulkResult({ ok: false, code })).toBe('failed');
    }
  });

  it('counts a warning as changed in the summary', () => {
    expect(summarizeBulkResults([ok, warning, skipped, skipped, conflict, failed])).toEqual({
      requested: 6,
      changed: 2,
      skipped: 2,
      conflicts: 1,
      failed: 1,
    });
  });

  it('summarizes nothing as zeros', () => {
    expect(summarizeBulkResults([])).toEqual({ requested: 0, changed: 0, skipped: 0, conflicts: 0, failed: 0 });
  });
});
