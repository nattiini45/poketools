/**
 * Query contract of the admin match list (`GET /api/admin/matches`) and the
 * URL state of `/admin/matches`. Pure and client-safe: the route validates
 * with `adminMatchListQuerySchema`, the page reads and writes the same keys
 * with `parseMatchListUrl` / `buildMatchListSearch`, so a deep link such as
 * `/admin/matches?league=<id>&status=disputed` and the API call it triggers
 * can never disagree about what a value means.
 */
import { z } from 'zod';
import type { MatchStatus } from '@/types/match';
import type { AdminMatchRow } from '@/lib/supabase/queries/matches';

/** The `match_status` enum, in tab order. */
export const ADMIN_MATCH_STATUSES = [
  'scheduled',
  'in_progress',
  'pending_confirmation',
  'completed',
  'disputed',
] as const satisfies readonly MatchStatus[];

// Compile-time check: a status added to the enum must be listed above.
const _allStatusesListed: Exclude<MatchStatus, (typeof ADMIN_MATCH_STATUSES)[number]> extends never ? true : never = true;
void _allStatusesListed;

export const ADMIN_MATCH_PAGE_SIZES = [25, 50, 100] as const;
export const ADMIN_MATCH_DEFAULT_PAGE_SIZE = 50;
export const ADMIN_MATCH_SEARCH_MAX_LENGTH = 100;
/**
 * Last page a request may ask for: at 100 rows per page that is a 100,000-row offset, far past
 * any real list. A deeper page is a bad value (API 400, URL falls back to page 1), not a scan.
 */
export const ADMIN_MATCH_MAX_PAGE = 1000;
/** The last page of a list of `total` rows: at least 1, and never past the last page the API answers. */
export function adminMatchLastPage(total: number, pageSize: number): number {
  return Math.min(ADMIN_MATCH_MAX_PAGE, Math.max(1, Math.ceil(total / pageSize)));
}
/** Players a search term expands to; a broader term is flagged as truncated, never silently cut. */
export const ADMIN_MATCH_SEARCH_PLAYER_CAP = 40;

/**
 * Most tournaments one matches request may filter by. Each id sits in the request URL, so a
 * wider scope has to be narrowed to a league or phase first.
 */
export const ADMIN_MATCH_SCOPE_CAP = 100;

/** `league=` value that selects the standalone tournaments (no league). */
export const STANDALONE_LEAGUE = 'standalone';

/** An absent param and an empty one (`?q=`) both mean "no filter". */
const emptyAsAbsent = (value: unknown) => (value === '' ? undefined : value);

const statusList = z.preprocess(
  emptyAsAbsent,
  z
    .string()
    .transform((raw) => raw.split(',').map((part) => part.trim()))
    .pipe(z.array(z.enum(ADMIN_MATCH_STATUSES)).min(1).max(ADMIN_MATCH_STATUSES.length))
    .transform((list) => [...new Set(list)])
    .optional(),
);

/**
 * Query string of `GET /api/admin/matches`. Strict: an unknown key is a 400,
 * not silently ignored.
 */
export const adminMatchListQuerySchema = z
  .strictObject({
    status: statusList,
    season_id: z.preprocess(emptyAsAbsent, z.string().uuid().optional()),
    tournament_id: z.preprocess(emptyAsAbsent, z.string().uuid().optional()),
    /** Only matches of standalone tournaments (no league). */
    standalone: z.preprocess(emptyAsAbsent, z.literal('true').optional()),
    q: z.preprocess(
      emptyAsAbsent,
      z.string().trim().min(1).max(ADMIN_MATCH_SEARCH_MAX_LENGTH).optional(),
    ),
    page: z.preprocess(emptyAsAbsent, z.coerce.number().int().min(1).max(ADMIN_MATCH_MAX_PAGE).default(1)),
    page_size: z.preprocess(
      emptyAsAbsent,
      z.coerce
        .number()
        .refine((size) => (ADMIN_MATCH_PAGE_SIZES as readonly number[]).includes(size), {
          message: 'page_size must be 25, 50 or 100',
        })
        .default(ADMIN_MATCH_DEFAULT_PAGE_SIZE),
    ),
  })
  .refine((query) => !(query.standalone && query.season_id), {
    message: 'standalone cannot be combined with season_id',
    path: ['standalone'],
  });

export type AdminMatchListQuery = z.infer<typeof adminMatchListQuerySchema>;

/** `data` of `GET /api/admin/matches`. */
export interface AdminMatchListResponse {
  rows: AdminMatchRow[];
  /** Matches that satisfy the filters, across all pages. */
  total: number;
  page: number;
  pageSize: number;
  /** The search matched more players than it can expand; the rows are a partial result. */
  searchTruncated: boolean;
}

// ── URL state of the page ───────────────────────────────────────────

export interface MatchListUrlState {
  /** One status tab, or '' for all. */
  status: MatchStatus | '';
  /** A season id, `STANDALONE_LEAGUE`, or '' for every league. */
  league: string;
  /** A tournament (phase) id, or '' for every phase of the league. */
  phase: string;
  q: string;
  /** 1-based. */
  page: number;
}

const UUID = z.string().uuid();

function isStatus(value: string): value is MatchStatus {
  return (ADMIN_MATCH_STATUSES as readonly string[]).includes(value);
}

/**
 * Reads the page state from a query string. A hand-edited or stale URL
 * degrades to "no filter" for the bad key instead of failing the page.
 */
export function parseMatchListUrl(params: { get(name: string): string | null }): MatchListUrlState {
  const status = params.get('status') ?? '';
  const league = params.get('league') ?? '';
  const phase = params.get('phase') ?? '';
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  return {
    status: isStatus(status) ? status : '',
    league: league === STANDALONE_LEAGUE || UUID.safeParse(league).success ? league : '',
    phase: UUID.safeParse(phase).success ? phase : '',
    q: (params.get('q') ?? '').slice(0, ADMIN_MATCH_SEARCH_MAX_LENGTH),
    page: Number.isFinite(page) && page >= 1 && page <= ADMIN_MATCH_MAX_PAGE ? page : 1,
  };
}

/** The query string (without `?`) for a page state; defaults are omitted. */
export function buildMatchListSearch(state: MatchListUrlState): string {
  const params = new URLSearchParams();
  if (state.status) params.set('status', state.status);
  if (state.league) params.set('league', state.league);
  if (state.phase) params.set('phase', state.phase);
  if (state.q.trim()) params.set('q', state.q);
  if (state.page > 1) params.set('page', String(state.page));
  return params.toString();
}

/** The `GET /api/admin/matches` query string for a page state. */
export function buildMatchListApiQuery(state: MatchListUrlState): string {
  const params = new URLSearchParams();
  if (state.status) params.set('status', state.status);
  if (state.phase) {
    params.set('tournament_id', state.phase);
  } else if (state.league === STANDALONE_LEAGUE) {
    params.set('standalone', 'true');
  } else if (state.league) {
    params.set('season_id', state.league);
  }
  const q = state.q.trim();
  if (q) params.set('q', q);
  if (state.page > 1) params.set('page', String(state.page));
  return params.toString();
}
