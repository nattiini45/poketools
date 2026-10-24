/**
 * Query contract of the admin match list (`GET /api/admin/matches`) and the
 * URL state of `/admin/matches`. Pure and client-safe: the route validates
 * with `adminMatchListQuerySchema`, the page reads and writes the same keys
 * with `parseMatchListUrl` / `buildMatchListSearch`, so a deep link such as
 * `/admin/matches?league=<id>&status=disputed` and the API call it triggers
 * can never disagree about what a value means.
 */
import { z } from 'zod';
import type { Enums } from '@/types/database';
import type { MatchStatus } from '@/types/match';
import type { AdminMatchRow } from '@/lib/supabase/queries/matches';
import { resolveMatchListDateWindow, type MatchListClock } from '@/lib/admin/match-list-dates';

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

/**
 * Statuses in "needs attention first" order: a dispute waits on an admin, a
 * pending confirmation on an admin or the auto-confirm, then the matches
 * still to be played, and finished ones last.
 */
export const ADMIN_MATCH_STATUS_PRIORITY = [
  'disputed',
  'pending_confirmation',
  'in_progress',
  'scheduled',
  'completed',
] as const satisfies readonly MatchStatus[];

// Compile-time check: a status added to the enum must be ranked above.
const _allStatusesRanked: Exclude<MatchStatus, (typeof ADMIN_MATCH_STATUS_PRIORITY)[number]> extends never ? true : never = true;
void _allStatusesRanked;

/** `seasons.format_type`, the league format. */
export const ADMIN_MATCH_FORMAT_TYPES = [
  'singles',
  'doubles',
  'draft',
  'evolution_point_buy',
] as const satisfies readonly Enums<'season_format_type'>[];

// Compile-time check: a format added to the enum must be listed above.
const _allFormatsListed: Exclude<Enums<'season_format_type'>, (typeof ADMIN_MATCH_FORMAT_TYPES)[number]> extends never ? true : never = true;
void _allFormatsListed;

/** `tournaments.bracket_type`. */
export const ADMIN_MATCH_BRACKET_TYPES = [
  'single_elim',
  'double_elim',
  'round_robin',
  'swiss',
] as const satisfies readonly Enums<'bracket_type'>[];

// Compile-time check: a bracket type added to the enum must be listed above.
const _allBracketsListed: Exclude<Enums<'bracket_type'>, (typeof ADMIN_MATCH_BRACKET_TYPES)[number]> extends never ? true : never = true;
void _allBracketsListed;

/**
 * Quick filters. Each one narrows the status set (it is intersected with the
 * status tab) and adds its own predicate; the server evaluates them against
 * its own clock.
 */
export const ADMIN_MATCH_PRESETS = [
  'awaiting_confirmation',
  'auto_confirms_soon',
  'stale_in_progress',
  'overdue',
] as const;
export type AdminMatchPreset = (typeof ADMIN_MATCH_PRESETS)[number];

/**
 * A series that has been `in_progress` and untouched for this many days counts as stale. Matchdays run weekly:
 * a series idle for 3 days is stalled with the matchday half over, while 7 days would equal a whole matchday and
 * flag it only once the next one is due.
 */
export const ADMIN_MATCH_STALE_IN_PROGRESS_DAYS = 3;
/**
 * "Auto-confirms soon" window: a pending confirmation whose `auto_confirm_at` falls within this many hours (a past
 * due one included, one with no `auto_confirm_at` excluded). A day is long enough for an admin to step in before the
 * result confirms itself, short enough that the list stays a worklist.
 */
export const ADMIN_MATCH_AUTO_CONFIRM_SOON_HOURS = 24;

/** The date a date filter applies to (columns `scheduled_at`, `date_played`, `created_at`, `updated_at`). */
export const ADMIN_MATCH_DATE_FIELDS = ['scheduled', 'played', 'created', 'updated'] as const;
export type AdminMatchDateField = (typeof ADMIN_MATCH_DATE_FIELDS)[number];
export const ADMIN_MATCH_DEFAULT_DATE_FIELD: AdminMatchDateField = 'scheduled';

/** Relative date ranges; `none` = the field is NULL and only makes sense for `scheduled` and `played`. */
export const ADMIN_MATCH_DATE_RANGES = ['today', 'next7', 'last7', 'none'] as const;
export type AdminMatchDateRange = (typeof ADMIN_MATCH_DATE_RANGES)[number];

export const ADMIN_MATCH_SORTS = [
  'created_desc',
  'status_priority',
  'scheduled_asc',
  'scheduled_desc',
  'deadline_asc',
  'deadline_desc',
  'updated_desc',
  'updated_asc',
] as const;
export type AdminMatchSort = (typeof ADMIN_MATCH_SORTS)[number];
export const ADMIN_MATCH_DEFAULT_SORT: AdminMatchSort = 'created_desc';

export const ADMIN_MATCH_REPLAY_FILTERS = ['has', 'none'] as const;
/** The best-of values the UI offers; the API accepts 1..15. */
export const ADMIN_MATCH_BEST_OF_CHOICES = [1, 3, 5] as const;
const ADMIN_MATCH_BEST_OF_MAX = 15;

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

const optionalUuid = z.preprocess(emptyAsAbsent, z.string().uuid().optional());
const optionalFlag = z.preprocess(emptyAsAbsent, z.literal('true').optional());
const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(emptyAsAbsent, z.enum(values).optional());
/** An ISO instant with an explicit offset (`Z` or `+02:00`). */
const optionalInstant = z.preprocess(emptyAsAbsent, z.iso.datetime({ offset: true }).optional());

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
    season_id: optionalUuid,
    tournament_id: optionalUuid,
    /** Only matches of standalone tournaments (no league). */
    standalone: optionalFlag,
    /** One round; needs `tournament_id` so the tournament scope check applies. */
    round_id: optionalUuid,
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
    format_type: optionalEnum(ADMIN_MATCH_FORMAT_TYPES),
    bracket_type: optionalEnum(ADMIN_MATCH_BRACKET_TYPES),
    best_of: z.preprocess(emptyAsAbsent, z.coerce.number().int().min(1).max(ADMIN_MATCH_BEST_OF_MAX).optional()),
    ruleset_id: optionalUuid,
    /** Which date `date_from` / `date_to` / `date_none` apply to (default `scheduled`). */
    date_field: optionalEnum(ADMIN_MATCH_DATE_FIELDS),
    /** Inclusive lower bound. */
    date_from: optionalInstant,
    /** Exclusive upper bound. */
    date_to: optionalInstant,
    /** The date field is not set. */
    date_none: optionalFlag,
    player_id: optionalUuid,
    /** Head-to-head: the opponent of `player_id`, in either seat. */
    player2_id: optionalUuid,
    replay: optionalEnum(ADMIN_MATCH_REPLAY_FILTERS),
    hand_edited: optionalFlag,
    has_notes: optionalFlag,
    no_games: optionalFlag,
    preset: optionalEnum(ADMIN_MATCH_PRESETS),
    /** Show the matches of test leagues (hidden by default). */
    include_test: optionalFlag,
    /** Show the matches of archived leagues and tournaments (hidden by default). */
    include_archived: optionalFlag,
    sort: optionalEnum(ADMIN_MATCH_SORTS),
  })
  .refine((query) => !(query.standalone && query.season_id), {
    message: 'standalone cannot be combined with season_id',
    path: ['standalone'],
  })
  .refine((query) => !query.round_id || Boolean(query.tournament_id), {
    message: 'round_id requires tournament_id',
    path: ['round_id'],
  })
  .refine((query) => !query.player2_id || (Boolean(query.player_id) && query.player2_id !== query.player_id), {
    message: 'player2_id requires a different player_id',
    path: ['player2_id'],
  })
  .refine((query) => !(query.date_from && query.date_to) || Date.parse(query.date_from) < Date.parse(query.date_to), {
    message: 'date_from must be before date_to',
    path: ['date_from'],
  })
  .refine((query) => !(query.date_none && (query.date_from || query.date_to)), {
    message: 'date_none cannot be combined with date_from or date_to',
    path: ['date_none'],
  })
  .refine((query) => !query.date_field || query.date_from || query.date_to || query.date_none, {
    message: 'date_field requires date_from, date_to or date_none',
    path: ['date_field'],
  })
  .refine(
    (query) =>
      !query.date_none ||
      (query.date_field ?? ADMIN_MATCH_DEFAULT_DATE_FIELD) === 'scheduled' ||
      query.date_field === 'played',
    { message: 'date_none only applies to the scheduled and played dates', path: ['date_none'] },
  )
  .refine((query) => !(query.no_games && (query.replay === 'has' || query.hand_edited)), {
    message: 'no_games cannot be combined with replay=has or hand_edited',
    path: ['no_games'],
  })
  // Both conditions read the same game row ("has a replay", "hand-edited"); "no replay" is the absence of a game
  // with one, so a hand-edited game without a replay cannot be told apart from it in one query.
  .refine((query) => !(query.replay === 'none' && query.hand_edited), {
    message: 'replay=none cannot be combined with hand_edited',
    path: ['replay'],
  })
  .refine((query) => !(query.format_type && query.standalone), {
    message: 'format_type cannot be combined with standalone',
    path: ['format_type'],
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
  /** Names of `player_id` / `player2_id` that resolve (a player the caller may not see is absent). */
  players: { id: string; name: string }[];
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
  /** A round id, or ''. Needs a phase: dropped by the parser without one. */
  round: string;
  preset: AdminMatchPreset | '';
  /** The date the range / from / to apply to. */
  dateField: AdminMatchDateField;
  range: AdminMatchDateRange | '';
  /** Local `YYYY-MM-DD` or ''; dropped when `range` is set. */
  from: string;
  to: string;
  format: (typeof ADMIN_MATCH_FORMAT_TYPES)[number] | '';
  bracket: (typeof ADMIN_MATCH_BRACKET_TYPES)[number] | '';
  /** 1..15, or null. */
  bestOf: number | null;
  /** A ruleset id, or ''. */
  ruleset: string;
  player: string;
  /** Head-to-head opponent; dropped without `player` or when equal to it. */
  player2: string;
  replay: (typeof ADMIN_MATCH_REPLAY_FILTERS)[number] | '';
  edited: boolean;
  notes: boolean;
  noGames: boolean;
  showTest: boolean;
  showArchived: boolean;
  sort: AdminMatchSort;
}

/** Every filter off, default sort, page 1. Callers and tests spread it. */
export const EMPTY_MATCH_LIST_STATE: MatchListUrlState = {
  status: '',
  league: '',
  phase: '',
  q: '',
  page: 1,
  round: '',
  preset: '',
  dateField: ADMIN_MATCH_DEFAULT_DATE_FIELD,
  range: '',
  from: '',
  to: '',
  format: '',
  bracket: '',
  bestOf: null,
  ruleset: '',
  player: '',
  player2: '',
  replay: '',
  edited: false,
  notes: false,
  noGames: false,
  showTest: false,
  showArchived: false,
  sort: ADMIN_MATCH_DEFAULT_SORT,
};

const UUID = z.string().uuid();
const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(values: readonly T[], value: string): T | '' {
  return (values as readonly string[]).includes(value) ? (value as T) : '';
}

function uuidOrEmpty(value: string): string {
  return UUID.safeParse(value).success ? value : '';
}

/** `YYYY-MM-DD` that is a real calendar day, else ''. */
function localDayOrEmpty(value: string): string {
  if (!LOCAL_DAY.test(value)) return '';
  const [y, m, d] = value.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? value : '';
}

function bestOfOrNull(value: string): number | null {
  if (!/^\d{1,2}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= ADMIN_MATCH_BEST_OF_MAX ? n : null;
}

/**
 * Reads the page state from a query string. A hand-edited or stale URL
 * degrades to "no filter" for the bad key instead of failing the page, and the
 * dependencies between filters are enforced here so the API never sees a
 * combination it refuses: a round needs its phase, a second player needs the
 * first (and differs), `to` before `from` is dropped, a relative range wins
 * over `from` / `to`, "no date set" only exists for scheduled and played, the
 * league format does not apply to standalone tournaments, and a content
 * filter that contradicts another is dropped (`noGames` yields to replay and
 * hand-edited; `replay=none` yields to hand-edited).
 */
export function parseMatchListUrl(params: { get(name: string): string | null }): MatchListUrlState {
  const get = (name: string) => params.get(name) ?? '';
  const page = Number.parseInt(params.get('page') ?? '1', 10);

  const league = get('league');
  const phase = uuidOrEmpty(get('phase'));
  const player = uuidOrEmpty(get('player'));
  const player2 = uuidOrEmpty(get('player2'));

  const dateField = oneOf(ADMIN_MATCH_DATE_FIELDS, get('date')) || ADMIN_MATCH_DEFAULT_DATE_FIELD;
  let range = oneOf(ADMIN_MATCH_DATE_RANGES, get('range'));
  if (range === 'none' && dateField !== 'scheduled' && dateField !== 'played') range = '';
  const from = range ? '' : localDayOrEmpty(get('from'));
  let to = range ? '' : localDayOrEmpty(get('to'));
  if (from && to && to < from) to = '';

  const edited = get('edited') === '1';
  let replay = oneOf(ADMIN_MATCH_REPLAY_FILTERS, get('replay'));
  if (replay === 'none' && edited) replay = '';
  const noGames = get('nogames') === '1' && replay !== 'has' && !edited;

  return {
    status: oneOf(ADMIN_MATCH_STATUSES, get('status')),
    league: league === STANDALONE_LEAGUE || UUID.safeParse(league).success ? league : '',
    phase,
    q: get('q').slice(0, ADMIN_MATCH_SEARCH_MAX_LENGTH),
    page: Number.isFinite(page) && page >= 1 && page <= ADMIN_MATCH_MAX_PAGE ? page : 1,
    round: phase ? uuidOrEmpty(get('round')) : '',
    preset: oneOf(ADMIN_MATCH_PRESETS, get('preset')),
    dateField: range || from || to ? dateField : ADMIN_MATCH_DEFAULT_DATE_FIELD,
    range,
    from,
    to,
    format: league === STANDALONE_LEAGUE ? '' : oneOf(ADMIN_MATCH_FORMAT_TYPES, get('format')),
    bracket: oneOf(ADMIN_MATCH_BRACKET_TYPES, get('bracket')),
    bestOf: bestOfOrNull(get('bo')),
    ruleset: uuidOrEmpty(get('ruleset')),
    player,
    player2: player && player2 !== player ? player2 : '',
    replay,
    edited,
    notes: get('notes') === '1',
    noGames,
    showTest: get('test') === '1',
    showArchived: get('archived') === '1',
    sort: oneOf(ADMIN_MATCH_SORTS, get('sort')) || ADMIN_MATCH_DEFAULT_SORT,
  };
}

/** The query string (without `?`) for a page state; defaults are omitted, the key order is fixed. */
export function buildMatchListSearch(state: MatchListUrlState): string {
  const params = new URLSearchParams();
  if (state.status) params.set('status', state.status);
  if (state.league) params.set('league', state.league);
  if (state.phase) params.set('phase', state.phase);
  if (state.phase && state.round) params.set('round', state.round);
  if (state.q.trim()) params.set('q', state.q);
  if (state.page > 1) params.set('page', String(state.page));
  if (state.preset) params.set('preset', state.preset);
  const hasDate = Boolean(state.range || state.from || state.to);
  if (hasDate && state.dateField !== ADMIN_MATCH_DEFAULT_DATE_FIELD) params.set('date', state.dateField);
  if (state.range) {
    params.set('range', state.range);
  } else {
    if (state.from) params.set('from', state.from);
    if (state.to) params.set('to', state.to);
  }
  if (state.format) params.set('format', state.format);
  if (state.bracket) params.set('bracket', state.bracket);
  if (state.bestOf !== null) params.set('bo', String(state.bestOf));
  if (state.ruleset) params.set('ruleset', state.ruleset);
  if (state.player) params.set('player', state.player);
  if (state.player && state.player2) params.set('player2', state.player2);
  if (state.replay) params.set('replay', state.replay);
  if (state.edited) params.set('edited', '1');
  if (state.notes) params.set('notes', '1');
  if (state.noGames) params.set('nogames', '1');
  if (state.showTest) params.set('test', '1');
  if (state.showArchived) params.set('archived', '1');
  if (state.sort !== ADMIN_MATCH_DEFAULT_SORT) params.set('sort', state.sort);
  return params.toString();
}

/**
 * The `GET /api/admin/matches` query string for a page state. Relative and
 * local-day dates are resolved against `clock` (the viewer's zone and "now",
 * only consulted when a date selection exists); the page size is never sent.
 */
export function buildMatchListApiQuery(state: MatchListUrlState, clock?: MatchListClock): string {
  const params = new URLSearchParams();
  if (state.status) params.set('status', state.status);
  if (state.phase) {
    params.set('tournament_id', state.phase);
  } else if (state.league === STANDALONE_LEAGUE) {
    params.set('standalone', 'true');
  } else if (state.league) {
    params.set('season_id', state.league);
  }
  if (state.round) params.set('round_id', state.round);
  const q = state.q.trim();
  if (q) params.set('q', q);
  if (state.preset) params.set('preset', state.preset);

  const window =
    state.range || state.from || state.to
      ? resolveMatchListDateWindow(state, clock ?? { timeZone: 'UTC', nowMs: Date.now() })
      : null;
  if (window) {
    params.set('date_field', state.dateField);
    if (window.none) {
      params.set('date_none', 'true');
    } else {
      if (window.from) params.set('date_from', window.from);
      if (window.to) params.set('date_to', window.to);
    }
  }

  if (state.format) params.set('format_type', state.format);
  if (state.bracket) params.set('bracket_type', state.bracket);
  if (state.bestOf !== null) params.set('best_of', String(state.bestOf));
  if (state.ruleset) params.set('ruleset_id', state.ruleset);
  if (state.player) params.set('player_id', state.player);
  if (state.player2) params.set('player2_id', state.player2);
  if (state.replay) params.set('replay', state.replay);
  if (state.edited) params.set('hand_edited', 'true');
  if (state.notes) params.set('has_notes', 'true');
  if (state.noGames) params.set('no_games', 'true');
  if (state.showTest) params.set('include_test', 'true');
  if (state.showArchived) params.set('include_archived', 'true');
  if (state.sort !== ADMIN_MATCH_DEFAULT_SORT) params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  return params.toString();
}

// ── Back link (match page -> list) ──────────────────────────────────

/** Longest `back` value that is parsed; anything longer is ignored, not truncated. */
const BACK_MAX_LENGTH = 1000;

/**
 * The canonical list query string for a `?back=` value. The value is re-parsed
 * and re-serialised, so only known keys with valid values can appear in it; an
 * unknown, malformed or over-long value yields '' (the plain list).
 */
export function parseMatchListBack(raw: string | string[] | null | undefined): string {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') return '';
  const value = first.startsWith('?') ? first.slice(1) : first;
  if (value.length === 0 || value.length > BACK_MAX_LENGTH) return '';
  return buildMatchListSearch(parseMatchListUrl(new URLSearchParams(value)));
}

/**
 * `?back=<canonical query>` (or '') to append to a link between match pages, so the detours (replay import, game
 * edit) keep the list query the match page was opened from. Re-parsed like `parseMatchListBack`.
 */
export function matchPageBackSuffix(raw: string | string[] | null | undefined): string {
  const search = parseMatchListBack(raw);
  return search ? `?back=${encodeURIComponent(search)}` : '';
}

/** `/admin/matches` or `/admin/matches?<canonical query>`: always a same-origin path. */
export function matchListBackHref(raw: string | string[] | null | undefined): string {
  const search = parseMatchListBack(raw);
  return search ? `/admin/matches?${search}` : '/admin/matches';
}

// ── Active filters, chips and Clear all ─────────────────────────────

export type MatchListFilterKey =
  | 'status'
  | 'league'
  | 'phase'
  | 'round'
  | 'q'
  | 'preset'
  | 'date'
  | 'format'
  | 'bracket'
  | 'bestOf'
  | 'ruleset'
  | 'player'
  | 'player2'
  | 'replay'
  | 'edited'
  | 'notes'
  | 'noGames'
  | 'showTest'
  | 'showArchived';

const MATCH_LIST_FILTER_KEYS: readonly MatchListFilterKey[] = [
  'status',
  'league',
  'phase',
  'round',
  'q',
  'preset',
  'date',
  'format',
  'bracket',
  'bestOf',
  'ruleset',
  'player',
  'player2',
  'replay',
  'edited',
  'notes',
  'noGames',
  'showTest',
  'showArchived',
];

/** The filters that differ from the default. Neither the sort nor the page is a filter. */
export function activeMatchListFilters(state: MatchListUrlState): MatchListFilterKey[] {
  const active: Record<MatchListFilterKey, boolean> = {
    status: state.status !== '',
    league: state.league !== '',
    phase: state.phase !== '',
    round: state.round !== '',
    q: state.q.trim() !== '',
    preset: state.preset !== '',
    date: state.range !== '' || state.from !== '' || state.to !== '',
    format: state.format !== '',
    bracket: state.bracket !== '',
    bestOf: state.bestOf !== null,
    ruleset: state.ruleset !== '',
    player: state.player !== '',
    player2: state.player2 !== '',
    replay: state.replay !== '',
    edited: state.edited,
    notes: state.notes,
    noGames: state.noGames,
    showTest: state.showTest,
    showArchived: state.showArchived,
  };
  return MATCH_LIST_FILTER_KEYS.filter((key) => active[key]);
}

/**
 * A patch for `update()` that resets `keys` (default: every filter) and goes
 * back to page 1. Clearing cascades to what depends on the key: a league
 * clears its phase and round, a phase its round, a player the head-to-head
 * opponent, a date every date field. The sort is never touched.
 */
export function clearMatchListFilters(
  _state: MatchListUrlState,
  keys: readonly MatchListFilterKey[] = MATCH_LIST_FILTER_KEYS,
): Partial<MatchListUrlState> {
  const clear = new Set<MatchListFilterKey>(keys);
  if (clear.has('league')) {
    clear.add('phase');
    clear.add('round');
  }
  if (clear.has('phase')) clear.add('round');
  if (clear.has('player')) clear.add('player2');

  const empty = EMPTY_MATCH_LIST_STATE;
  const patch: Partial<MatchListUrlState> = { page: 1 };
  if (clear.has('status')) patch.status = empty.status;
  if (clear.has('league')) patch.league = empty.league;
  if (clear.has('phase')) patch.phase = empty.phase;
  if (clear.has('round')) patch.round = empty.round;
  if (clear.has('q')) patch.q = empty.q;
  if (clear.has('preset')) patch.preset = empty.preset;
  if (clear.has('date')) {
    patch.dateField = empty.dateField;
    patch.range = empty.range;
    patch.from = empty.from;
    patch.to = empty.to;
  }
  if (clear.has('format')) patch.format = empty.format;
  if (clear.has('bracket')) patch.bracket = empty.bracket;
  if (clear.has('bestOf')) patch.bestOf = empty.bestOf;
  if (clear.has('ruleset')) patch.ruleset = empty.ruleset;
  if (clear.has('player')) patch.player = empty.player;
  if (clear.has('player2')) patch.player2 = empty.player2;
  if (clear.has('replay')) patch.replay = empty.replay;
  if (clear.has('edited')) patch.edited = empty.edited;
  if (clear.has('notes')) patch.notes = empty.notes;
  if (clear.has('noGames')) patch.noGames = empty.noGames;
  if (clear.has('showTest')) patch.showTest = empty.showTest;
  if (clear.has('showArchived')) patch.showArchived = empty.showArchived;
  return patch;
}
