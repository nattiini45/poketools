import { PANEL } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { enumLabel } from '@/i18n/content/enum-label';
import { LocalTime } from '@/i18n/LocalTime';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';
import { paintT } from '@/lib/route-world/paint-copy';
import { boardFixtureStatus } from './route/plaza/board/board-content';

/**
 * `default` is the section surface (a divided list inside a panel); `glass` is
 * the ZA register the docked Focus panel uses — rounded rows, values right,
 * running match on white (`04-za-requests-ui.png`).
 */
export type FixtureListVariant = 'default' | 'glass';

interface FixtureListProps {
  fixtures: LeagueFixture[];
  variant?: FixtureListVariant;
  locale: Locale;
}

export function formatScore(fixture: LeagueFixture): string | null {
  if (fixture.match.status !== 'completed') return null;
  const p1 = fixture.match.games.filter((g) => g.winner_id === fixture.match.player_1_id).length;
  const p2 = fixture.match.games.filter((g) => g.winner_id === fixture.match.player_2_id).length;
  return `${p1}:${p2}`;
}

/**
 * One stage's fixture rows: pairing, score when played, status, date.
 * Shared by #schedule and the Board Focus panel. Server component.
 *
 * The section rows label their status with the shared `enums.matchStatus`
 * words; the glass rows letter the SCHEDULE board's own pill words (the
 * neutral `boardFixtureStatus` key → `paint.board.status`), so a docked panel
 * read next to the board in the same frame says the same thing in either
 * language — `disputed` keeps its own word (`fixtures.disputed`), the
 * exception the board collapses. Dates are the viewer's
 * (`<LocalTime>`, never formatted on the server).
 */
export default function FixtureList({ fixtures, variant = 'default', locale }: FixtureListProps) {
  const t = createTranslator(worldEvoligaMessages, locale);
  const common = createTranslator(commonMessages, locale);
  const enums = createTranslator(enumMessages, locale);
  const board = paintT(locale);

  if (fixtures.length === 0) {
    return <p className="mt-2 text-sm text-arena-ink-secondary">{t('fixtures.none')}</p>;
  }

  if (variant === 'glass') {
    return (
      <ul className="mt-2 space-y-1">
        {fixtures.map((fixture) => {
          const score = formatScore(fixture);
          const live = fixture.match.status === 'in_progress';
          return (
            <li
              key={fixture.match.id}
              data-fixture={fixture.match.id}
              className={`rounded-lg px-3 py-2 text-sm ${
                live ? 'bg-white text-teal-950' : 'bg-arena-elevated text-arena-ink'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium">
                  {fixture.match.player_1_name}
                  <span className={live ? 'mx-1.5 text-teal-700' : 'mx-1.5 text-arena-ink-secondary'}>
                    {common('versus')}
                  </span>
                  {fixture.match.player_2_name}
                </span>
                {score && <span className="flex-none font-semibold tabular-nums">{score}</span>}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${
                    live
                      ? 'bg-teal-600 text-white'
                      : 'border border-arena-border text-arena-ink-secondary'
                  }`}
                >
                  {fixture.match.status === 'disputed'
                    ? t('fixtures.disputed')
                    : board(`board.status.${boardFixtureStatus(fixture.match.status)}`)}
                </span>
                {fixture.match.scheduled_at && (
                  <span className={live ? 'text-teal-800' : 'text-arena-ink-secondary'}>
                    <LocalTime value={fixture.match.scheduled_at} preset="date" />
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className={`mt-2 divide-y divide-arena-border ${PANEL}`}>
      {fixtures.map((fixture) => {
        const score = formatScore(fixture);
        const live = fixture.match.status === 'in_progress';
        return (
          <li
            key={fixture.match.id}
            data-fixture={fixture.match.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
          >
            <span className="text-arena-ink">
              {fixture.match.player_1_name}
              <span className="mx-2 text-arena-ink-secondary">{common('versus')}</span>
              {fixture.match.player_2_name}
            </span>
            <span className="flex items-center gap-3 text-xs text-arena-ink-secondary">
              {score && <span className="font-semibold text-arena-ink">{score}</span>}
              <span className={live ? 'font-semibold text-arena-live' : undefined}>
                {enumLabel(enums, 'matchStatus', fixture.match.status)}
              </span>
              {fixture.match.scheduled_at && (
                <span>
                  <LocalTime value={fixture.match.scheduled_at} preset="date" />
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
