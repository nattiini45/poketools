/**
 * The stats tables in both languages (i18n T11): labels from the `stats`
 * namespace, Pokémon/move/type names from the pkmn layer, numbers in the
 * viewer's locale, a `labels` prop still overriding. Rendered through
 * react-dom/server (vitest 'node' env, no DOM).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PokemonUsageTable from '../PokemonUsageTable';
import KillRankingTable, { DEFAULT_KILL_RANKING_LABELS } from '../KillRankingTable';
import MoveUsageTable, { filterMoveUsageRows } from '../MoveUsageTable';
import StandingsTable from '../StandingsTable';
import { renderWithI18n } from '@/test/i18n';
import type { KillRankingRow, MoveUsageRow, PokemonUsageRow, StandingsRow } from '@/types/game';

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;| | /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const USAGE: PokemonUsageRow[] = [
  {
    pokemon_name: 'Charizard',
    usage_percent: 50,
    total_appearances: 4,
    total_games: 8,
    efficiency: 1.5,
    kos_dealt: 6,
    koed_rate: 12.5,
    bring_rate: 75,
    lead_rate: 25,
    win_rate: 62.5,
  },
];

const KILLS: KillRankingRow[] = [
  {
    pokemon_name: 'Charizard',
    kos_dealt: 6,
    times_koed: 2,
    kill_differential: 4,
    times_in_team: 4,
    participations: 3,
    efficiency: 1.5,
  },
];

const STANDINGS: StandingsRow[] = [
  {
    player_id: 'p1',
    player_name: 'Alice',
    player_avatar_url: null,
    gym_type: null,
    wins: 2,
    losses: 1,
    game_wins: 4,
    game_losses: 2,
  },
];

describe('PokemonUsageTable', () => {
  it('keeps the English headers, names and numbers without a provider', () => {
    const text = textOf(renderToStaticMarkup(<PokemonUsageTable data={USAGE} isDoubles />));
    for (const s of ['Usage%', "KO'd%", 'Bring%', 'Lead%', 'Win%', 'Charizard', '50.0%', '12.5%', '1.50']) {
      expect(text).toContain(s);
    }
  });

  it('renders German headers, the German species name and German numbers', () => {
    const text = textOf(renderWithI18n(<PokemonUsageTable data={USAGE} isDoubles />, { locale: 'de' }));
    for (const s of ['Nutzung %', 'Besiegt %', 'Eingesetzt %', 'Siege %', 'Glurak', '50,0 %', '12,5 %', '1,50']) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain('Charizard');
  });

  it('keeps English Pokémon names under "Keep Pokémon terms in English"', () => {
    const text = textOf(renderWithI18n(<PokemonUsageTable data={USAGE} />, { locale: 'de', dataLocale: 'en' }));
    expect(text).toContain('Charizard');
    expect(text).toContain('Nutzung %');
  });

  it('shows the German empty state', () => {
    const text = textOf(renderWithI18n(<PokemonUsageTable data={[]} />, { locale: 'de' }));
    expect(text).toContain('Noch keine Nutzungsdaten.');
  });
});

describe('KillRankingTable', () => {
  it('renders German headers and names', () => {
    const text = textOf(renderWithI18n(<KillRankingTable data={KILLS} />, { locale: 'de' }));
    for (const s of ['Besiegt', 'Diff.', 'Im Team', 'Eingesetzt', 'Eff.', 'Glurak', '1,50']) {
      expect(text).toContain(s);
    }
  });

  it('lets a labels prop override the viewer language', () => {
    const text = textOf(
      renderWithI18n(<KillRankingTable data={KILLS} labels={DEFAULT_KILL_RANKING_LABELS} />, { locale: 'de' }),
    );
    expect(text).toContain('Brought');
    expect(text).not.toContain('Eingesetzt');
  });
});

describe('MoveUsageTable', () => {
  it('shows the loading state in the viewer language', () => {
    expect(textOf(renderToStaticMarkup(<MoveUsageTable scopeType="global" scopeId={null} />))).toContain(
      'Loading move data...',
    );
    expect(
      textOf(renderWithI18n(<MoveUsageTable scopeType="global" scopeId={null} />, { locale: 'de' })),
    ).toContain('Attacken werden geladen …');
  });
});

describe('filterMoveUsageRows', () => {
  const rows: MoveUsageRow[] = [
    { pokemon_name: 'Charizard', move_name: 'Flamethrower', move_type: 'Fire', move_category: 'Special', count: 3 },
    { pokemon_name: 'Garchomp', move_name: 'Earthquake', move_type: 'Ground', move_category: 'Physical', count: 2 },
  ];
  const none = { pokemonQuery: '', moveQuery: '', activeTypes: new Set<string>() };

  it('matches Pokémon and moves by their English or German name', () => {
    expect(filterMoveUsageRows(rows, { ...none, pokemonQuery: 'glurak' }).map((r) => r.pokemon_name)).toEqual([
      'Charizard',
    ]);
    expect(filterMoveUsageRows(rows, { ...none, pokemonQuery: 'chari' }).map((r) => r.pokemon_name)).toEqual([
      'Charizard',
    ]);
    expect(filterMoveUsageRows(rows, { ...none, moveQuery: 'Flammenwurf' }).map((r) => r.move_name)).toEqual([
      'Flamethrower',
    ]);
    expect(filterMoveUsageRows(rows, { ...none, moveQuery: 'quake' }).map((r) => r.move_name)).toEqual([
      'Earthquake',
    ]);
  });

  it('filters by English type keys and keeps everything without filters', () => {
    expect(filterMoveUsageRows(rows, { ...none, activeTypes: new Set(['Ground']) }).map((r) => r.move_name)).toEqual([
      'Earthquake',
    ]);
    expect(filterMoveUsageRows(rows, none)).toHaveLength(2);
    expect(filterMoveUsageRows(rows, { ...none, pokemonQuery: 'zzz' })).toHaveLength(0);
  });
});

describe('StandingsTable', () => {
  it('keeps the English headers and translates them to German', () => {
    const en = textOf(renderToStaticMarkup(<StandingsTable standings={STANDINGS} />));
    for (const s of ['Player', 'Game W', 'Game L', 'Diff']) expect(en).toContain(s);

    const de = textOf(renderWithI18n(<StandingsTable standings={STANDINGS} />, { locale: 'de' }));
    for (const s of ['Spieler', 'Partien S', 'Partien N', 'Diff.']) expect(de).toContain(s);
    expect(textOf(renderWithI18n(<StandingsTable standings={[]} />, { locale: 'de' }))).toContain(
      'Noch keine abgeschlossenen Spiele',
    );
  });
});
