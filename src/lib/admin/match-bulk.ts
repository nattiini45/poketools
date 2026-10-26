/**
 * Contract of the matches list bulk actions (`POST /api/admin/matches/batch`):
 * the request schema, the per-item result and its classes, the eligibility
 * checks the dialog previews and the server re-runs on fresh data, the
 * selection helpers of the list and the note helpers. Pure and client-safe
 * (the query layer is imported as a type only), so the preview, the route and
 * the processor can never disagree about what a value means.
 */
import { z } from 'zod';
import type { ApiErrorCode } from '@/i18n/messages/errors';
import { zonedWallTimeToUtc } from '@/lib/draft/time';
import type { MatchStatus } from '@/types/match';

/** Most matches one bulk request may name (a page holds at most 100). */
export const ADMIN_MATCH_BULK_MAX = 100;

export const ADMIN_MATCH_BULK_ACTIONS = ['confirm', 'schedule', 'note'] as const;
export type AdminMatchBulkAction = (typeof ADMIN_MATCH_BULK_ACTIONS)[number];

/**
 * Longest note one request appends (`FIELD_LIMITS.MEDIUM_TEXT`; a test pins the two together). Not imported
 * from the validation schemas: that module pulls the format pack, which must stay out of client bundles.
 */
export const ADMIN_MATCH_NOTE_MAX_LENGTH = 2000;
/** Cap on the stored notes of one match after an append. */
export const ADMIN_MATCH_NOTES_TOTAL_MAX = 10_000;

const SCHEDULE_MIN_YEAR = 2000;
const SCHEDULE_MAX_YEAR = 2100;

// ── Request ─────────────────────────────────────────────────────────

/** 1..100 uuids, lower-cased, then required to be unique: a repeated id is a bad request, never silently merged. */
const matchIds = z
  .array(z.string().uuid().transform((id) => id.toLowerCase()))
  .min(1)
  .max(ADMIN_MATCH_BULK_MAX)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'match_ids must be unique' });

/** An ISO instant with an explicit offset, in a plausible calendar range; the past is allowed. */
const scheduledAt = z.iso.datetime({ offset: true }).refine(
  (value) => {
    const year = new Date(value).getUTCFullYear();
    return year >= SCHEDULE_MIN_YEAR && year <= SCHEDULE_MAX_YEAR;
  },
  { message: `scheduled_at must be between the years ${SCHEDULE_MIN_YEAR} and ${SCHEDULE_MAX_YEAR}` },
);

/** Status a previewed bulk confirm expects every match to still have. */
export const BULK_CONFIRM_EXPECTED_STATUS = 'pending_confirmation' as const;

/** A uuid, lower-cased like `match_ids`, so the two can be compared. */
const lowerUuid = z.string().uuid().transform((id) => id.toLowerCase());

/**
 * What the admin saw in the confirm dialog for one match: it awaited confirmation and `winner_id` was the reported
 * winner. The server refuses the item when the fresh row differs, so a result that was corrected after the preview is
 * never finalized for a winner the admin did not see.
 */
const expectedConfirm = z.strictObject({
  match_id: lowerUuid,
  winner_id: lowerUuid,
  status: z.literal(BULK_CONFIRM_EXPECTED_STATUS),
});

/**
 * Body of `POST /api/admin/matches/batch`. Strict at every level: an unknown key is a 400, not silently ignored.
 * `confirm` carries exactly one `params.expected` entry per match id (the previewed winner and status).
 */
export const adminMatchBatchSchema = z.discriminatedUnion('action', [
  z
    .strictObject({
      action: z.literal('confirm'),
      match_ids: matchIds,
      params: z.strictObject({ expected: z.array(expectedConfirm).min(1).max(ADMIN_MATCH_BULK_MAX) }),
    })
    .refine(
      ({ match_ids, params }) => {
        const expectedIds = new Set(params.expected.map((entry) => entry.match_id));
        return expectedIds.size === params.expected.length && expectedIds.size === match_ids.length && match_ids.every((id) => expectedIds.has(id));
      },
      { message: 'params.expected must hold exactly one entry for each match id', path: ['params', 'expected'] },
    ),
  z.strictObject({
    action: z.literal('schedule'),
    match_ids: matchIds,
    params: z.strictObject({ scheduled_at: scheduledAt }),
  }),
  z.strictObject({
    action: z.literal('note'),
    match_ids: matchIds,
    params: z.strictObject({ note: z.string().trim().min(1).max(ADMIN_MATCH_NOTE_MAX_LENGTH) }),
  }),
]);

export type AdminMatchBatchInput = z.infer<typeof adminMatchBatchSchema>;

// ── Result ──────────────────────────────────────────────────────────

/**
 * `code` of a match that was written without a warning. A constant, because the error-code scan
 * (`error-codes.test.ts`) reads any quoted `code:` literal as an API error code, and `ok` is none.
 */
export const BULK_OK = 'ok' as const;

/** The outcome for one match of a batch. `code` is `BULK_OK` or a catalog code the client translates. */
export interface BulkItemResult {
  id: string;
  ok: boolean;
  code: typeof BULK_OK | ApiErrorCode;
  params?: Record<string, string | number>;
}

export interface BulkSummary {
  requested: number;
  /** Matches that were written (a `warning` counts here). */
  changed: number;
  /** Matches that did not qualify; nothing was written for them. */
  skipped: number;
  /** Matches that changed while the action ran; nothing was overwritten. */
  conflicts: number;
  /** Matches the action failed for (not found, an unexpected error, out of time). */
  failed: number;
}

/** `data` of `POST /api/admin/matches/batch`. */
export interface AdminMatchBatchResponse {
  action: AdminMatchBulkAction;
  /** One per requested id, in request order. */
  results: BulkItemResult[];
  summary: BulkSummary;
}

export type BulkResultClass = 'changed' | 'warning' | 'skipped' | 'conflict' | 'failed';

/** Codes of a match that did not qualify (ok false, nothing written, nothing wrong). */
const SKIP_CODES: ReadonlySet<string> = new Set([
  'match_bulk_not_pending',
  'match_complete_no_winner',
  'match_winner_not_participant',
  'match_bulk_schedule_completed',
  'match_bulk_notes_full',
]);

/**
 * `warning`: written, but a follow-up step of the completion failed. Every other ok result is `changed`;
 * a not-ok result is a skip, a conflict, or a failure (anything that is neither of the first two).
 */
export function classifyBulkResult(result: Pick<BulkItemResult, 'ok' | 'code'>): BulkResultClass {
  if (result.ok) return result.code === 'match_finalize_incomplete' ? 'warning' : 'changed';
  if (result.code === 'match_bulk_conflict') return 'conflict';
  return SKIP_CODES.has(result.code) ? 'skipped' : 'failed';
}

export function summarizeBulkResults(results: readonly Pick<BulkItemResult, 'ok' | 'code'>[]): BulkSummary {
  const summary: BulkSummary = { requested: results.length, changed: 0, skipped: 0, conflicts: 0, failed: 0 };
  for (const result of results) {
    switch (classifyBulkResult(result)) {
      case 'changed':
      case 'warning':
        summary.changed += 1;
        break;
      case 'skipped':
        summary.skipped += 1;
        break;
      case 'conflict':
        summary.conflicts += 1;
        break;
      case 'failed':
        summary.failed += 1;
        break;
    }
  }
  return summary;
}

// ── Eligibility ─────────────────────────────────────────────────────

export interface BulkConfirmInput {
  status: MatchStatus;
  winner_id: string | null;
  player_1_id: string;
  player_2_id: string;
}

export type BulkConfirmCheck =
  | { eligible: true; winnerId: string }
  | { eligible: false; code: 'match_bulk_not_pending' | 'match_complete_no_winner' | 'match_winner_not_participant' };

/** Whether a match can be confirmed as reported: it awaits confirmation and its reported winner is one of the two players. */
export function bulkConfirmCheck(match: BulkConfirmInput): BulkConfirmCheck {
  if (match.status !== 'pending_confirmation') return { eligible: false, code: 'match_bulk_not_pending' };
  if (!match.winner_id) return { eligible: false, code: 'match_complete_no_winner' };
  if (match.winner_id !== match.player_1_id && match.winner_id !== match.player_2_id) {
    return { eligible: false, code: 'match_winner_not_participant' };
  }
  return { eligible: true, winnerId: match.winner_id };
}

export type BulkScheduleCheck = { eligible: true } | { eligible: false; code: 'match_bulk_schedule_completed' };

/** Only a completed match keeps its time; every other status, a disputed one included, can be (re)scheduled. */
export function bulkScheduleCheck(match: { status: MatchStatus }): BulkScheduleCheck {
  return match.status === 'completed'
    ? { eligible: false, code: 'match_bulk_schedule_completed' }
    : { eligible: true };
}

// ── Selection ───────────────────────────────────────────────────────

/** Adds or removes `id`. Adding at the cap is a no-op (the same set comes back). */
export function toggleMatchSelection(selected: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (selected.has(id)) {
    const next = new Set(selected);
    next.delete(id);
    return next;
  }
  if (selected.size >= ADMIN_MATCH_BULK_MAX) return selected;
  return new Set(selected).add(id);
}

/** How much of the page is selected: `none` also covers an empty page. */
export function pageSelectionState(
  pageIds: readonly string[],
  selected: ReadonlySet<string>,
): 'none' | 'some' | 'all' {
  let count = 0;
  for (const id of pageIds) if (selected.has(id)) count += 1;
  if (count === 0) return 'none';
  return count === pageIds.length ? 'all' : 'some';
}

/** The whole page selected: remove its ids. Otherwise add them in page order until the cap is reached. */
export function togglePageSelection(selected: ReadonlySet<string>, pageIds: readonly string[]): ReadonlySet<string> {
  const next = new Set(selected);
  if (pageSelectionState(pageIds, selected) === 'all') {
    for (const id of pageIds) next.delete(id);
    return next;
  }
  for (const id of pageIds) {
    if (next.size >= ADMIN_MATCH_BULK_MAX) break;
    next.add(id);
  }
  return next;
}

/** The selected ids that are on the page, in page order: the prune after a reload. */
export function effectiveSelection(selected: ReadonlySet<string>, pageIds: readonly string[]): string[] {
  return pageIds.filter((id) => selected.has(id));
}

// ── Time input ──────────────────────────────────────────────────────

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * The ISO instant a `datetime-local` value (`YYYY-MM-DDTHH:mm`) means in `timeZone`, or null for an empty or invalid
 * value. Resolved with `zonedWallTimeToUtc`, like `useTimeZone()` and `LocalTime` read instants back, so the time the
 * admin types is the time every viewer sees; a wall time inside a spring-forward gap moves forward by the gap.
 */
export function localInputToIsoInZone(value: string, timeZone: string): string | null {
  const match = LOCAL_INPUT.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  if (hour > 23 || minute > 59) return null;
  try {
    const instant = zonedWallTimeToUtc({ year, month, day, hour, minute, second: 0 }, timeZone);
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
  } catch {
    // An unknown time zone name makes Intl throw.
    return null;
  }
}

// ── Notes ───────────────────────────────────────────────────────────

/** Two-digit zero padding. */
const pad = (n: number) => String(n).padStart(2, '0');

/** One stamped note line: `[YYYY-MM-DD HH:mm UTC, Name] text`. */
export function formatBulkNoteLine(now: Date, actorName: string, text: string): string {
  const stamp = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
  const name = actorName.replace(/\s+/g, ' ').trim();
  return `[${stamp} UTC, ${name}] ${text}`;
}

/**
 * `existing` notes plus `line` on a new line (the cron auto-confirm appends the same way), or `match_bulk_notes_full`
 * when the result would exceed `ADMIN_MATCH_NOTES_TOTAL_MAX`.
 */
export function appendMatchNote(
  existing: string,
  line: string,
): { ok: true; notes: string } | { ok: false; code: 'match_bulk_notes_full' } {
  const notes = existing.length > 0 ? `${existing}${existing.endsWith('\n') ? '' : '\n'}${line}` : line;
  if (notes.length > ADMIN_MATCH_NOTES_TOTAL_MAX) return { ok: false, code: 'match_bulk_notes_full' };
  return { ok: true, notes };
}
