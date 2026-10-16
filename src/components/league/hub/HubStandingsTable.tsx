import Link from 'next/link';
import GymTypedName from '@/components/shared/GymTypedName';
import { FOCUS_RING, TABLE_HEAD } from '@/components/world/panel';
import type { Standing } from '@/lib/tournament/types';
import type { LeagueHubCopy } from '@/lib/league-hub/copy';

/** Optional columns; rank, trainer, W, L, D and points are always shown. */
export interface HubStandingsColumns {
  /** Rank movement against the previous matchday (season table). */
  movement?: boolean;
  games?: boolean;
  killDiff?: boolean;
  /** Evolution points (EPB). */
  evolution?: boolean;
  /**
   * The EPB decision-match tie marker. Only for tables computed with battle
   * stats: without them kill difference cannot split a tie, so the flag would
   * mark ties the phase page resolves.
   */
  decisionTie?: boolean;
  buchholz?: boolean;
}

interface HubStandingsTableProps {
  rows: readonly Standing[];
  copy: LeagueHubCopy;
  columns?: HubStandingsColumns;
  /** The top rows inside the advancement zone; a divider follows the last one. */
  advanceCount?: number | null;
  /** Gym bands for rows computed without them (the season table). */
  gymTypes?: Readonly<Record<string, string | null>>;
  /** Accessible table caption. */
  caption: string;
}

function rankChange(row: Standing): number | null {
  return 'rank_change' in row && typeof row.rank_change === 'number' ? row.rank_change : null;
}

function evolution(row: Standing): { points: number; tie: boolean } | null {
  if (!('evolution_points' in row) || typeof row.evolution_points !== 'number') return null;
  const tie = 'needs_decision_match' in row && row.needs_decision_match === true;
  return { points: row.evolution_points, tie };
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * A standings table in the world's palette. Server component: plain table
 * markup, no client sorting, so it renders inside any world section.
 * Rows link to the player's profile.
 */
export default function HubStandingsTable({
  rows,
  copy,
  columns = {},
  advanceCount = null,
  gymTypes,
  caption,
}: HubStandingsTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-arena-ink-secondary">{copy.noResults}</p>;
  }
  const cut = advanceCount !== null && advanceCount > 0 && advanceCount < rows.length ? advanceCount : null;
  const cell = 'px-2 py-2 text-right tabular-nums';

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className={TABLE_HEAD}>
          <tr>
            <th scope="col" className="w-10 px-3 py-2 text-left">
              {copy.table.rank}
            </th>
            <th scope="col" className="px-3 py-2 text-left">
              {copy.table.trainer}
            </th>
            {columns.movement && (
              <th scope="col" className="w-12 whitespace-nowrap px-2 py-2 text-right">
                {copy.table.movement}
              </th>
            )}
            {columns.games && (
              <th scope="col" className="w-12 whitespace-nowrap px-2 py-2 text-right">
                {copy.table.games}
              </th>
            )}
            <th scope="col" className="w-12 whitespace-nowrap px-2 py-2 text-right">
              {copy.table.wins}
            </th>
            <th scope="col" className="w-12 whitespace-nowrap px-2 py-2 text-right">
              {copy.table.losses}
            </th>
            <th scope="col" className="w-12 whitespace-nowrap px-2 py-2 text-right">
              {copy.table.draws}
            </th>
            {columns.evolution && (
              <th scope="col" className="w-12 whitespace-nowrap px-2 py-2 text-right">
                {copy.table.evolutionPoints}
              </th>
            )}
            {columns.killDiff && (
              <th scope="col" className="w-12 whitespace-nowrap px-2 py-2 text-right">
                {copy.table.killDiff}
              </th>
            )}
            {columns.buchholz && (
              <th scope="col" className="w-12 whitespace-nowrap px-2 py-2 text-right">
                {copy.table.buchholz}
              </th>
            )}
            <th scope="col" className="w-12 whitespace-nowrap px-2 py-2 text-right">
              {copy.table.points}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const inZone = cut !== null && index < cut;
            const lastInZone = cut !== null && index === cut - 1;
            const change = columns.movement ? rankChange(row) : null;
            const evo = columns.evolution || columns.decisionTie ? evolution(row) : null;
            return (
              <tr
                key={row.player_id}
                data-advancing={inZone ? 'true' : undefined}
                className={`border-b ${
                  lastInZone ? 'border-dashed border-arena-accent' : 'border-arena-border'
                } last:border-b-0`}
              >
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    title={inZone ? copy.table.advancementZone : undefined}
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      inZone ? 'bg-arena-accent text-arena-surface' : 'text-arena-ink-secondary'
                    }`}
                  >
                    {index + 1}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Link
                    href={`/players/${row.player_id}`}
                    className={`font-semibold text-arena-ink underline-offset-2 hover:underline ${FOCUS_RING}`}
                  >
                    <GymTypedName
                      name={row.player_name}
                      gymType={row.gym_type ?? gymTypes?.[row.player_id] ?? null}
                    />
                  </Link>
                  {columns.decisionTie && evo?.tie && (
                    <span className="ml-2 rounded border border-arena-accent-strong px-1 text-xs font-semibold text-arena-accent-strong">
                      {copy.table.tie}
                    </span>
                  )}
                </td>
                {columns.movement && (
                  <td className={`${cell} text-xs font-bold`}>
                    {change !== null && change !== 0 ? (
                      <span className={change > 0 ? 'text-arena-live' : 'text-arena-accent-strong'}>
                        {change > 0 ? `▲${change}` : `▼${-change}`}
                      </span>
                    ) : (
                      <span className="text-arena-ink-secondary" aria-hidden="true">
                        –
                      </span>
                    )}
                  </td>
                )}
                {columns.games && <td className={`${cell} text-arena-ink-secondary`}>{row.games_played}</td>}
                <td className={`${cell} text-arena-ink`}>{row.wins}</td>
                <td className={`${cell} text-arena-ink`}>{row.losses}</td>
                <td className={`${cell} text-arena-ink-secondary`}>{row.draws}</td>
                {columns.evolution && (
                  <td className={`${cell} text-arena-ink-secondary`}>{evo?.points ?? 0}</td>
                )}
                {columns.killDiff && (
                  <td className={`${cell} text-arena-ink-secondary`}>{signed(row.kill_differential)}</td>
                )}
                {columns.buchholz && <td className={`${cell} text-arena-ink-secondary`}>{row.buchholz}</td>}
                <td className={`${cell} font-heading font-bold text-arena-ink`}>{row.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
