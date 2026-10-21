import { TABLE_HEAD } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { commonMessages } from '@/i18n/messages/common';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import type { Standing } from '@/lib/tournament/types';

/**
 * `default` is the section surface; `glass` is the ZA register the docked
 * Focus panel uses — rank / team / W-L / points on rounded rows, leader on the
 * white selected row (`04-za-requests-ui.png`).
 */
export type StandingsTableVariant = 'default' | 'glass';

interface StandingsTableProps {
  standings: Standing[];
  /** Compact variant for the Focus panel: fewer columns, tighter rows. */
  compact?: boolean;
  variant?: StandingsTableVariant;
  locale: Locale;
}

/**
 * Season-wide standings (format-aware tiebreakers come from the query).
 * Shared by #schedule and the Board Focus panel so both read the same table.
 * Server component; renders from page-loaded data only, in the viewer's language.
 */
export default function StandingsTable({
  standings,
  compact = false,
  variant = 'default',
  locale,
}: StandingsTableProps) {
  const t = createTranslator(worldEvoligaMessages, locale);
  const common = createTranslator(commonMessages, locale);
  const hasResults = standings.some((s) => s.wins + s.losses + s.draws > 0);
  if (!hasResults) {
    return <p className="mt-2 text-sm text-arena-ink-secondary">{t('noCompleted')}</p>;
  }

  if (variant === 'glass') {
    return (
      <table className="mt-2 w-full border-separate border-spacing-y-1 text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-arena-ink-secondary">
            <th scope="col" className="px-2 pb-1 font-semibold">
              #
            </th>
            <th scope="col" className="px-2 pb-1 font-semibold">
              {t('standings.player')}
            </th>
            <th scope="col" className="px-2 pb-1 text-right font-semibold">
              {t('standings.winLoss')}
            </th>
            <th scope="col" className="px-2 pb-1 text-right font-semibold">
              {t('standings.points')}
            </th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row, index) => {
            const leader = index === 0;
            return (
              <tr
                key={row.player_id}
                className={leader ? 'bg-white text-teal-950' : 'bg-arena-elevated text-arena-ink'}
              >
                <td className="rounded-l-lg px-2 py-1.5 tabular-nums">{index + 1}</td>
                <td className="max-w-[10rem] truncate px-2 py-1.5 font-medium">{row.player_name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {row.wins}-{row.losses}
                </td>
                <td className="rounded-r-lg px-2 py-1.5 text-right font-semibold tabular-nums">
                  {row.points}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  const cell = compact ? 'px-2 py-1.5' : 'px-3 py-2';

  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-arena-border">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className={TABLE_HEAD}>
            <th className={cell}>#</th>
            <th className={cell}>{t('standings.player')}</th>
            <th className={`${cell} text-center`}>{common('record.winShort')}</th>
            <th className={`${cell} text-center`}>{common('record.lossShort')}</th>
            <th className={`${cell} text-center`}>{common('record.drawShort')}</th>
            <th className={`${cell} text-center`}>{t('standings.pointsLong')}</th>
            {!compact && <th className={`${cell} text-center`}>{t('standings.killDiff')}</th>}
          </tr>
        </thead>
        <tbody>
          {standings.map((row, index) => (
            <tr
              key={row.player_id}
              className="border-b border-arena-border transition-colors duration-150 last:border-b-0 hover:bg-arena-elevated motion-reduce:transition-none"
            >
              <td className={`${cell} text-arena-ink-secondary`}>{index + 1}</td>
              <td className={`${cell} text-arena-ink`}>{row.player_name}</td>
              <td className={`${cell} text-center text-arena-ink-secondary`}>{row.wins}</td>
              <td className={`${cell} text-center text-arena-ink-secondary`}>{row.losses}</td>
              <td className={`${cell} text-center text-arena-ink-secondary`}>{row.draws}</td>
              <td className={`${cell} text-center font-semibold text-arena-ink`}>{row.points}</td>
              {!compact && (
                <td className={`${cell} text-center text-arena-ink-secondary`}>
                  {row.kill_differential > 0 ? `+${row.kill_differential}` : row.kill_differential}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
