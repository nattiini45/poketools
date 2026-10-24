import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Season, SeasonFormatType } from '@/types/season';

// Re-export capability system for consumers that import from format-utils
export { getFormatCapabilities } from './format-capabilities';
export type { FormatCapabilities } from './format-capabilities';

/**
 * Check if a format type uses draft mechanics.
 * Both 'draft' and 'evolution_point_buy' use the draft pool system.
 */
export function isDraftLike(format: SeasonFormatType | string): boolean {
  return format === 'draft' || format === 'evolution_point_buy';
}

/**
 * Check if a format is the Evolution Point Buy format.
 * Used to gate format-specific features (tokens, participation tokens, redraft, etc.)
 */
export function isEvolutionPointBuy(format: SeasonFormatType | string): boolean {
  return format === 'evolution_point_buy';
}

/**
 * The league's draft page for its format, or null when the format has none.
 * Mirrors the pages' own gates: `/draft-room` (the arena) serves Evolution
 * Point Buy only, `/draft` serves the plain draft format (and EPB, which
 * prefers the arena), and singles/doubles have no draft page at all. A draft
 * pool row alone is not enough to link one: pool creation does not check the
 * format, so a singles league can carry a pool.
 */
export function leagueDraftHref(leagueId: string, format: SeasonFormatType | string): string | null {
  if (isEvolutionPointBuy(format)) return `/leagues/${leagueId}/draft-room`;
  if (format === 'draft') return `/leagues/${leagueId}/draft`;
  return null;
}

/**
 * Whether a league's matches are doubles. The classic league types carry it on the type itself (`doubles`); a
 * custom league (Format Studio) mixes stages, so it is doubles only when it has stages and every one of them is.
 * Callers pass the stages they already hold: no read happens here.
 */
export function isLeagueDoubles(
  format: SeasonFormatType | string,
  stages: ReadonlyArray<{ is_doubles: boolean }>,
): boolean {
  if (format === 'custom') return stages.length > 0 && stages.every((stage) => stage.is_doubles);
  return format === 'doubles';
}

/**
 * Format gate for EPB-only API routes. Throws a UserFacingError (passed
 * through by safeErrorResponse) when the season is missing or does not use
 * the evolution_point_buy format — EPB services must never touch other
 * formats (legacy trackers would be corrupted by the total_kos recompute).
 */
export function assertEpbSeason(
  season: Pick<Season, 'format_type'> | null | undefined
): void {
  if (!season) {
    throw new UserFacingError('Season not found', {
      code: 'season_not_found',
      status: 404,
    });
  }
  if (!isEvolutionPointBuy(season.format_type)) {
    throw new UserFacingError(
      'This season does not use the Evolution Point Buy format',
      { code: 'format_mismatch', status: 400 }
    );
  }
}
