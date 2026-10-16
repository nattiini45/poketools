/**
 * The Pokémon detail page renders the appearance summary with plural forms and
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

import PokemonDetailClient from '../PokemonDetailClient';
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

describe('PokemonDetailClient render', () => {
  it('pluralizes the appearance summary in English', () => {
    expect(renderWithI18n(<PokemonDetailClient pokemonName="Garchomp" initialStats={stats(1, 1)} />)).toContain(
      '1 appearance across 1 game',
    );
    expect(renderWithI18n(<PokemonDetailClient pokemonName="Garchomp" initialStats={stats(3, 12)} />)).toContain(
      '3 appearances across 12 games',
    );
  });

  it('pluralizes the appearance summary in German', () => {
    const one = renderWithI18n(<PokemonDetailClient pokemonName="Garchomp" initialStats={stats(1, 1)} />, {
      locale: 'de',
    });
    expect(one).toContain('1 Einsatz in 1 Partie');
    const many = renderWithI18n(<PokemonDetailClient pokemonName="Garchomp" initialStats={stats(3, 12)} />, {
      locale: 'de',
    });
    expect(many).toContain('3 Einsätze in 12 Partien');
  });

  it('labels an unresolved player in the viewer language', () => {
    const en = renderWithI18n(<PokemonDetailClient pokemonName="Garchomp" initialStats={stats(3, 12)} />);
    expect(en).toContain('Ash');
    expect(en).toContain('Unknown player');
    const de = renderWithI18n(<PokemonDetailClient pokemonName="Garchomp" initialStats={stats(3, 12)} />, {
      locale: 'de',
    });
    expect(de).toContain('Unbekannter Spieler');
    expect(de).not.toContain('Unknown');
  });
});
