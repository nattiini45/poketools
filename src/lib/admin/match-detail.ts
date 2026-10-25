/**
 * Shared contract of the admin match page (`/admin/matches/[id]`) and the API
 * routes behind it: constants, response shapes and the pure helpers both sides
 * use. Client-safe: no server imports (type-only imports erase), so client
 * components can import it for limits and shapes.
 */
import type { AuditLogRecord } from '@/lib/audit/queries';
import type { MatchStatus } from '@/types/match';
import type { RoundStatus } from '@/types/round';

/** Longest reason an admin or a player can attach to an action on a match. */
export const MATCH_REASON_MAX_LENGTH = 500;
/** Entries the History panel shows per page. */
export const MATCH_HISTORY_PAGE_SIZE = 20;
/** Largest page the History route serves. */
export const MATCH_HISTORY_MAX_PAGE_SIZE = 50;
/** Deepest offset the History route serves (the audit table is not indexed by match). */
export const MATCH_HISTORY_MAX_OFFSET = 1000;

/** One audit event of a match or of one of its games, safe for the client (no ip address). */
export interface MatchHistoryEntry {
  id: string;
  action: string;
  actor_id: string | null;
  actor_name: string;
  created_at: string;
  /** `metadata.reason` when it is a non-empty string. */
  reason: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
}

export interface MatchHistoryPage {
  entries: MatchHistoryEntry[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Identity of a first history page: it changes when an event is added, so the
 * History panel (which keeps its own copy of the entries) remounts on new
 * server data after a refresh instead of showing the old list.
 */
export function historyPanelKey(page: MatchHistoryPage, loadFailed = false): string {
  return `${page.total}:${page.entries[0]?.id ?? ''}:${loadFailed ? 'failed' : 'ok'}`;
}

/** Who disputed a match, when, and why (from the newest `match.dispute` event). */
export interface MatchDisputeInfo {
  actor_id: string | null;
  actor_name: string;
  disputed_at: string;
  reason: string | null;
  by_admin: boolean;
}

/** Where the match sits: league, phase, round and the people around it. */
export interface AdminMatchContext {
  league_id: string | null;
  league_name: string | null;
  phase_id: string;
  phase_name: string;
  round_id: string;
  round_name: string;
  round_number: number;
  round_status: RoundStatus;
  best_of: number;
  round_deadline: string | null;
  submitter_name: string | null;
}

export interface MatchResetPreviewMatch {
  id: string;
  player_1_name: string;
  player_2_name: string;
  status: MatchStatus;
  round_name: string;
}

/** What a match reset would touch (read-only preview). */
export interface MatchResetPreview {
  games_to_delete: number;
  was_completed: boolean;
  /** Played later bracket matches a cascading reset also resets, deepest first. */
  downstream: MatchResetPreviewMatch[];
}

export interface ScheduleResult {
  scheduled_at: string | null;
  previous_scheduled_at: string | null;
  proposals_cancelled: number;
  /** The time was saved but cancelling the pending proposals failed; they may still be open. */
  proposals_cancel_failed: boolean;
  unchanged: boolean;
}

/** Post-commit steps of a reopen; a failed one is reported, not rolled back. */
export type ReopenStep = 'round' | 'bracket' | 'cleanup' | 'ratings' | 'evolution';

export interface ReopenMatchResult {
  from_status: MatchStatus;
  ratings_rebuilt_players: number;
  bracket_matches_removed: number;
  failed_steps: ReopenStep[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `changes` passes through only as a plain object whose every value is a
 * `{ before, after }` entry; anything else (a legacy shape, an array) is null.
 */
function toHistoryChanges(changes: unknown): MatchHistoryEntry['changes'] {
  if (!isPlainObject(changes)) return null;
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!isPlainObject(value) || !('before' in value) || !('after' in value)) continue;
    out[key] = { before: value.before, after: value.after };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The audit row as the client sees it: `ip_address` and raw metadata never leave the server. */
export function toMatchHistoryEntry(row: AuditLogRecord): MatchHistoryEntry {
  const metadata = isPlainObject(row.metadata) ? row.metadata : null;
  const reason = metadata && typeof metadata.reason === 'string' && metadata.reason.trim() !== ''
    ? metadata.reason
    : null;
  return {
    id: row.id,
    action: row.action,
    actor_id: row.actor_id,
    actor_name: row.actor_name,
    created_at: row.created_at,
    reason,
    changes: toHistoryChanges(row.changes),
  };
}

/** A round deadline in the past on a match that is not completed. */
export function isOverdue(deadlineIso: string | null, nowMs: number, status: MatchStatus): boolean {
  if (!deadlineIso || status === 'completed') return false;
  const deadlineMs = Date.parse(deadlineIso);
  return Number.isFinite(deadlineMs) && deadlineMs < nowMs;
}
