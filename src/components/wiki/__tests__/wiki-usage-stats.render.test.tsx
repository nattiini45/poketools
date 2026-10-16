/**
 * The wiki usage widget renders the appearance summary with plural forms and
 * labels an unresolved player (`player_name: null`) in the viewer's language.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('@/components/shared/ScopeSelector', () => ({ default: () => null }));

const seed = vi.hoisted(() => ({ stats: null as unknown, nullCalls: 0 }));

// Seeds one server render: the first null initial is `stats`, later ones
// (`filters`) stay null; `loading` (the only `true` initial) is false.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const value = typeof initial === 'function' ? (initial as () => T)() : initial;
      if (value === true) return [false, () => undefined];
      if (value === null) return [seed.nullCalls++ === 0 ? seed.stats : null, () => undefined];
      return [value, () => undefined];
    },
  };
});

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

function render(s: PokemonDetailStats, locale: 'en' | 'de' = 'en'): string {
  seed.stats = s;
  seed.nullCalls = 0;
  return renderWithI18n(<WikiUsageStats pokemonName="Garchomp" />, { locale });
}

describe('WikiUsageStats render', () => {
  beforeEach(() => {
    seed.stats = null;
    seed.nullCalls = 0;
  });

  it('pluralizes the appearance summary', () => {
    expect(render(stats(1, 1))).toContain('1 appearance across 1 game');
    expect(render(stats(3, 12))).toContain('3 appearances across 12 games');
    expect(render(stats(1, 1), 'de')).toContain('1 Einsatz in 1 Partie');
    expect(render(stats(3, 12), 'de')).toContain('3 Einsätze in 12 Partien');
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
