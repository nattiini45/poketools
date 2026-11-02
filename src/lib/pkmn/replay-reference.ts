import { UserFacingError } from '@/lib/api/user-facing-error';

/** The longest replay id Showdown issues is far below this; it bounds the pattern match. */
const REPLAY_ID_MAX_LENGTH = 200;

/**
 * `<format>-<number>` (`gen9ou-2255712345`, `smogtours-gen9ou-812345`), with the
 * `-<token>pw` suffix of a private replay.
 */
const REPLAY_ID_PATTERN = /^(?:[a-z0-9]+-)+\d+(?:-[a-z0-9]+pw)?$/i;

const REPLAY_URL_PREFIX = /^(?:https?:\/\/)?replay\.pokemonshowdown\.com\//i;

/**
 * Normalizes a Showdown replay URL or bare ID for fetching.
 * Strips fragments, query strings, host prefix, trailing slashes, and `.json`.
 */
export function normalizeReplayUrlOrId(urlOrId: string): string {
  const withoutFragmentOrQuery = urlOrId.split('#')[0].split('?')[0];
  return withoutFragmentOrQuery
    .trim()
    .replace(REPLAY_URL_PREFIX, '')
    .replace(/\.json$/, '')
    .replace(/\/$/, '');
}

/** The input is neither a Showdown replay link nor a replay id. HTTP 400. */
export class ReplayUrlInvalidError extends UserFacingError<'replay_url_invalid'> {
  constructor() {
    super('Invalid replay URL or ID', { code: 'replay_url_invalid', status: 400 });
    this.name = 'ReplayUrlInvalidError';
  }
}

/** Showdown has no replay under this id. HTTP 404. */
export class ReplayNotFoundError extends UserFacingError<'replay_not_found'> {
  constructor(status: number, statusText: string) {
    super(`Failed to fetch replay: ${status} ${statusText}`, { code: 'replay_not_found', status: 404 });
    this.name = 'ReplayNotFoundError';
  }
}

/** Showdown could not be reached or answered with an error status. HTTP 502. */
export class ReplayFetchFailedError extends UserFacingError<'replay_fetch_failed'> {
  constructor(status?: number, statusText?: string) {
    super(
      status === undefined ? 'Failed to fetch replay' : `Failed to fetch replay: ${status} ${statusText ?? ''}`.trim(),
      { code: 'replay_fetch_failed', status: 502 },
    );
    this.name = 'ReplayFetchFailedError';
  }
}

/** Showdown did not answer within the deadline. HTTP 504. */
export class ReplayFetchTimeoutError extends UserFacingError<'replay_fetch_timeout'> {
  constructor() {
    super('Fetching the replay timed out', { code: 'replay_fetch_timeout', status: 504 });
    this.name = 'ReplayFetchTimeoutError';
  }
}

/** The payload or the battle log is not a replay the parser can read. HTTP 422. */
export class ReplayUnparseableError extends UserFacingError<'replay_unparseable'> {
  constructor(message = 'Invalid replay format') {
    super(message, { code: 'replay_unparseable', status: 422 });
    this.name = 'ReplayUnparseableError';
  }
}

/**
 * The replay id a submitted URL or id names. Throws `ReplayUrlInvalidError` for anything that is
 * not a replay.pokemonshowdown.com link or a bare replay id, so a foreign URL or free text never
 * reaches the fetch. Pure: no I/O.
 */
export function parseReplayReference(urlOrId: string): string {
  const id = normalizeReplayUrlOrId(urlOrId);
  if (id.length > REPLAY_ID_MAX_LENGTH || !REPLAY_ID_PATTERN.test(id)) throw new ReplayUrlInvalidError();
  return id;
}
