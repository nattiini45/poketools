/**
 * Query behind the seat handover of a substitution (`format_substitute_seat`, 20261106090000_format_challenges.sql).
 * Server only.
 *
 * The runtime rows of a custom league are keyed by player. A substitution moves the enrollment, the group slot, the scheduled
 * matches and the roster row in `src/lib/season/substitute.ts`; this function moves the format rows in ONE transaction, so the
 * incoming player can act and be given to. A row of the incoming player that would collide refuses the call with a typed
 * `FormatSubstituteError` (409, one code per kind of collision) and changes nothing. A preview (`dryRun`) runs the same
 * statements and rolls them back, so it reports exactly what the apply would move and refuses the same collisions.
 */
import 'server-only';

import { supabase } from '../client';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { parseDbError } from '@/lib/studio-core/db-errors';
import { mapFormatRuntimeDbError } from './format-runtime';

export const FORMAT_SUBSTITUTE_ERROR_CODES = [
  'format_substitute_links_collide',
  'format_substitute_items_collide',
  'format_substitute_submissions_collide',
  'format_substitute_attrs_collide',
  'format_substitute_tracks_collide',
  'format_substitute_challenges_collide',
] as const;
export type FormatSubstituteErrorCode = (typeof FORMAT_SUBSTITUTE_ERROR_CODES)[number];

/** A collision refuses the call; the admin resolves it (the incoming player must be new to the league's format). */
export class FormatSubstituteError<C extends FormatSubstituteErrorCode = FormatSubstituteErrorCode> extends UserFacingError<C> {
  constructor(code: C) {
    super(errorsSeasons.en[code], { code, status: 409 });
    this.name = 'FormatSubstituteError';
  }
}

const SUBSTITUTE_SIGNALS: ReadonlySet<string> = new Set(FORMAT_SUBSTITUTE_ERROR_CODES);

function isSubstituteCode(message: string): message is FormatSubstituteErrorCode {
  return SUBSTITUTE_SIGNALS.has(message);
}

/** Maps a PostgREST error of the function to a typed error; anything else is returned as `mapFormatRuntimeDbError` does. */
export function mapFormatSubstituteDbError(error: unknown): unknown {
  const signal = parseDbError(error);
  if (signal?.code === 'P0001' && signal.message !== undefined && isSubstituteCode(signal.message)) {
    return new FormatSubstituteError(signal.message);
  }
  return mapFormatRuntimeDbError(error);
}

/** Rows moved (or to move, in a preview) per table. */
export interface FormatSeatRows {
  relation_links: number;
  resource_items: number;
  action_submissions: number;
  player_attrs: number;
  track_progress: number;
  challenges: number;
}

export interface FormatSeatMove {
  /** False: the league has no attached format, so there is nothing to move. */
  attached: boolean;
  /** True: the incoming player holds the seat's format data afterwards (`total` rows moved, possibly none). */
  moved: boolean;
  /**
   * Phase scope only: the phases that are not completed and still enroll the outgoing player. While there are any, nothing
   * moves (`moved` is false): the data stays with the player who still plays there.
   */
  kept_phase_ids: string[];
  rows: FormatSeatRows;
  total: number;
}

export interface MoveFormatSeatInput {
  seasonId: string;
  outPlayerId: string;
  inPlayerId: string;
  /** The substitution also moves the roster row. */
  leagueScope: boolean;
  /** The phases whose enrollment the substitution hands over (their open challenges move with the seat). */
  phaseIds: readonly string[];
  /** Report what would move and roll it back. */
  dryRun: boolean;
}

const EMPTY_ROWS: FormatSeatRows = {
  relation_links: 0,
  resource_items: 0,
  action_submissions: 0,
  player_attrs: 0,
  track_progress: 0,
  challenges: 0,
};

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** The function's jsonb answer, read defensively (the database is the contract; a missing member counts as zero). */
export function parseFormatSeatMove(data: unknown): FormatSeatMove {
  const record = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const rows = typeof record.rows === 'object' && record.rows !== null ? (record.rows as Record<string, unknown>) : {};
  return {
    attached: record.attached === true,
    moved: record.moved === true,
    kept_phase_ids: Array.isArray(record.kept_phase_ids) ? record.kept_phase_ids.filter((id): id is string => typeof id === 'string') : [],
    rows: {
      relation_links: count(rows.relation_links),
      resource_items: count(rows.resource_items),
      action_submissions: count(rows.action_submissions),
      player_attrs: count(rows.player_attrs),
      track_progress: count(rows.track_progress),
      challenges: count(rows.challenges),
    },
    total: count(record.total),
  };
}

/** What a league without a format answers: nothing to move. */
export function noFormatSeatMove(): FormatSeatMove {
  return { attached: false, moved: false, kept_phase_ids: [], rows: { ...EMPTY_ROWS }, total: 0 };
}

/**
 * Hands the outgoing player's format rows of the league to the incoming player in one transaction (or, with `dryRun`,
 * reports the same and rolls it back). Raises `FormatSubstituteError` when the incoming player holds a row that would
 * collide; nothing is changed then.
 */
export async function moveFormatSeat(input: MoveFormatSeatInput): Promise<FormatSeatMove> {
  const { data, error } = await supabase.rpc('format_substitute_seat', {
    p_season_id: input.seasonId,
    p_out: input.outPlayerId,
    p_in: input.inPlayerId,
    p_league_scope: input.leagueScope,
    p_phase_ids: [...input.phaseIds],
    p_dry_run: input.dryRun,
  });
  if (error) throw mapFormatSubstituteDbError(error);
  return parseFormatSeatMove(data);
}
