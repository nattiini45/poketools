import type { SeasonFormatEngine } from '@/lib/format-studio/library-types';
import type { Season, SeasonFormatType } from '@/types/season';

/**
 * Which engine runs a league: the legacy code of its league type, or the format kit.
 *
 * Every legacy league type (`singles`, `doubles`, `draft`, `evolution_point_buy`) always resolves to its
 * `legacy:<type>` code path; a league with an attached format stays on it until the kit drives pairing and
 * standings. Only a `custom` league whose attached format (`season_formats.engine`) is `kit` resolves to `'kit'`:
 * a custom league without an attached format, or with the engine `legacy` or `shadow`, is `legacy:custom`.
 *
 * Pure and client-safe: callers pass the attached row they already hold (no read happens here).
 */
export type SeasonEngine = `legacy:${SeasonFormatType}` | 'kit';

export function resolveSeasonEngine(
  season: Pick<Season, 'format_type'>,
  attached?: { engine: SeasonFormatEngine } | null,
): SeasonEngine {
  if (season.format_type === 'custom' && attached?.engine === 'kit') return 'kit';
  return `legacy:${season.format_type}`;
}
