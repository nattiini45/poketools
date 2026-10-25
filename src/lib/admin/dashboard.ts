/**
 * Contract of the admin dashboard (`GET /api/admin/dashboard`) shared by the
 * route and the page. Pure and client-safe: no server-only imports, so the UI
 * can import the types and the link helpers without pulling in the database.
 */
import { buildMatchListSearch, EMPTY_MATCH_LIST_STATE } from '@/lib/admin/match-list';

/** Match statuses that need an admin's attention. */
export const ATTENTION_STATUSES = ['disputed', 'pending_confirmation'] as const;
export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];

/** Rows the attention list shows; the rest is reachable through the per-status See all links. */
export const DASHBOARD_ATTENTION_LIMIT = 20;

/** Longest dispute note the list carries, so a long admin remark cannot bloat the response. */
export const ATTENTION_NOTE_MAX_LENGTH = 200;

export interface AuditLogEntry {
  id: string;
  actor_name: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  created_at: string;
}

export interface AttentionMatch {
  id: string;
  tournament_id: string;
  /** Null when the tournament could not be joined; the UI shows a translated placeholder. */
  tournament_name: string | null;
  /** The league the tournament is a phase of; null for a standalone tournament. */
  season_name: string | null;
  player_1_name: string | null;
  player_2_name: string | null;
  status: AttentionStatus;
  created_at: string;
  /** Last change of the match: the closest stored proxy for how long it has been waiting. */
  updated_at: string;
  /** The match note of a disputed row (trimmed, at most ATTENTION_NOTE_MAX_LENGTH characters); null otherwise. */
  note: string | null;
}

/**
 * `null` means "not available for your role": a resource admin gets no
 * site-wide player and game totals. Test leagues, archived competitions and
 * test accounts are not counted.
 */
export interface DashboardCounts {
  players: number | null;
  /** Standalone tournaments only (the /admin/tournaments list); league phases are counted with their league. */
  tournaments: number;
  active_matches: number;
  leagues: number;
  games: number | null;
}

export interface DashboardData {
  counts: DashboardCounts;
  /** At most DASHBOARD_ATTENTION_LIMIT rows, the ones waiting longest (oldest `updated_at`) first. */
  attention_required: AttentionMatch[];
  /** Every match needing attention (disputed plus awaiting confirmation), so the UI can show "N of M". */
  attention_total: number;
  /** The per-status parts of `attention_total`. */
  attention_by_status: Record<AttentionStatus, number>;
  /** Site-wide audit trail; null for a resource admin (not available for your role). */
  recent_activity: AuditLogEntry[] | null;
}

/** The Matches list filtered to one status. Built with the list's own URL builder so the two cannot drift. */
export function attentionListHref(status: AttentionStatus): string {
  const search = buildMatchListSearch({ ...EMPTY_MATCH_LIST_STATE, status });
  return `/admin/matches?${search}`;
}

/** The list each counter card opens; the games total has no list. */
export const DASHBOARD_STAT_HREFS = {
  players: '/admin/players',
  tournaments: '/admin/tournaments',
  activeMatches: '/admin/matches',
  leagues: '/admin/leagues',
} as const;
