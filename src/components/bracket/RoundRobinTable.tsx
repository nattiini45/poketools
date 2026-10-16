'use client';

import { useMessages } from '@/i18n/client';
import { getMessages } from '@/i18n/core';
import { bracketMessages } from '@/i18n/messages/bracket';
import type { PublicMatch } from '@/lib/match/public-match';

/** The grid's words. The defaults come from the `bracket` namespace in the viewer's language. */
export interface RoundRobinTableLabels {
  player: string;
  win: string;
  loss: string;
  draw: string;
}

/** The English words: the grid's fallback outside a language context. */
export const DEFAULT_ROUND_ROBIN_LABELS: RoundRobinTableLabels = getMessages(bracketMessages, 'en').roundRobin;

interface RoundRobinTableProps {
  participants: { id: string; name: string }[];
  matches: PublicMatch[];
  /** Header and result letters as an override; the viewer's language by default. */
  labels?: RoundRobinTableLabels;
}

type CellResult = 'self' | 'win' | 'loss' | 'draw' | 'none';

/**
 * A grid/matrix showing all-vs-all results.
 * Rows and columns are players. Cells show result (W/L/D/-).
 */
export default function RoundRobinTable({
  participants,
  matches,
  labels: labelsOverride,
}: RoundRobinTableProps) {
  const words = useMessages(bracketMessages).roundRobin;
  const labels = labelsOverride ?? words;
  const resultMap = new Map<string, string | null>();
  for (const match of matches) {
    if (match.status === 'completed') {
      resultMap.set(`${match.player_1_id}::${match.player_2_id}`, match.winner_id);
      resultMap.set(`${match.player_2_id}::${match.player_1_id}`, match.winner_id);
    }
  }

  function getResult(rowPlayerId: string, colPlayerId: string): CellResult {
    if (rowPlayerId === colPlayerId) return 'self';
    const key = `${rowPlayerId}::${colPlayerId}`;
    const winnerId = resultMap.get(key);
    if (winnerId === undefined) return 'none';
    if (winnerId === null) return 'draw';
    return winnerId === rowPlayerId ? 'win' : 'loss';
  }

  function cellText(result: CellResult): string {
    if (result === 'self') return '—';
    if (result === 'win') return labels.win;
    if (result === 'loss') return labels.loss;
    if (result === 'draw') return labels.draw;
    return '';
  }

  function getCellStyle(result: CellResult): string {
    if (result === 'win') return 'bg-poke-green-light text-poke-green font-medium';
    if (result === 'loss') return 'bg-poke-danger-light text-poke-danger font-medium';
    if (result === 'draw') return 'bg-poke-yellow-light text-poke-yellow-ink font-medium';
    return 'text-poke-text-muted';
  }

  return (
    <div className="overflow-x-auto rounded-poke-lg border border-poke-border bg-poke-surface shadow-poke-card">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="px-4 py-3 text-left font-heading text-xs font-semibold uppercase tracking-wide text-poke-text-secondary">
              {labels.player}
            </th>
            {participants.map((p) => (
              <th
                key={p.id}
                className="py-1 px-2 text-center text-poke-text-secondary max-w-[4rem] truncate"
                title={p.name}
              >
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {participants.map((row) => (
            <tr key={row.id} className="border-t border-poke-border/50">
              <td className="py-1 px-2 font-heading font-semibold text-poke-text-primary whitespace-nowrap">
                {row.name}
              </td>
              {participants.map((col) => {
                const result = getResult(row.id, col.id);
                return (
                  <td
                    key={col.id}
                    className={`py-1 px-2 text-center ${getCellStyle(result)}`}
                  >
                    {cellText(result)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
