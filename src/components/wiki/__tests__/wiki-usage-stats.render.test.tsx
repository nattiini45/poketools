/**
 * The wiki usage widget renders the appearance summary with plural forms and
 * labels an unresolved player (`player_name: null`) in the viewer's language.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { PokemonDetailStats, PokemonPlayerRow } from '@/types/game';

// Renders every cell so the player column's output is in the markup.
vi.mock('@/components/ui/Table', () => ({
  default: ({
    columns,
    data,
  }: {
    columns: Array<{ key: string; render: (row: PokemonPlayerRow) => ReactNode }>;
    data: PokemonPlayerRow[];
  }) => (
    <table>
      <tbody>
        {data.map((row) => (
          <tr key={row.player_id}>
            {columns.map((c) => (
              <td key={c.key}>{c.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

import WikiUsageStats from '../WikiUsageStats';
import { renderWithI18n } from '@/test/i18n';

function player(id: string, name: string | null): PokemonPlayerRow {
  return {
    player_id: id,
    player_name: name,
    games: 1,
    kos_dealt: 0,
    koed_rate: 0,
    bring_rate: null,
    lead_rate: null,
    win_rate: null,
  };
}

function stats(appearances: number, games: number): PokemonDetailStats {
  return {
    pokemon_name: 'Garchomp',
    total_appearances: appearances,
    total_games_in_scope: games,
    usage_percent: 50,
    kos_dealt: 0,
    koed_rate: 0,
    bring_rate: null,
    lead_rate: null,
    win_rate: null,
    moves: [],
    items: [],
    players: [player('p1', 'Ash'), player('p2', null)],
  };
}

function render(s: PokemonDetailStats, locale: 'en' | 'de' = 'en', props: { loading?: boolean; playerId?: string } = {}): string {
  return renderWithI18n(<WikiUsageStats stats={s} loading={props.loading ?? false} playerId={props.playerId ?? ''} onSelectPlayer={() => undefined} />, { locale });
}

describe('WikiUsageStats render', () => {
  it('has no scope picker, stat tiles or move usage of its own: those belong to the stats section above', () => {
    const html = render({ ...stats(3, 12), moves: [{ name: 'Earthquake', count: 3, usage_percent: 100 }] });
    expect(html).not.toContain('Scope');
    expect(html).not.toContain('Move Usage');
    expect(html).not.toContain('Usage%');
    expect(html).toContain('Player Breakdown');
  });

  it('shows the item usage and hides the breakdown once a player is picked', () => {
    const s = { ...stats(3, 12), items: [{ name: 'Choice Scarf', count: 2, usage_percent: 66 }] };
    expect(render(s)).toContain('Item Usage');
    expect(render(s, 'en', { playerId: 'p1' })).not.toContain('Player Breakdown');
  });

  it('renders nothing while the stats load', () => {
    expect(render(stats(3, 12), 'en', { loading: true })).not.toContain('Player Breakdown');
  });

  it('labels an unresolved player in the viewer language', () => {
    const en = render(stats(3, 12));
    expect(en).toContain('Ash');
    expect(en).toContain('Unknown player');
    const de = render(stats(3, 12), 'de');
    expect(de).toContain('Unbekannter Spieler');
    expect(de).not.toContain('Unknown');
  });
});
