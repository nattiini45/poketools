/**
 * The match components render their chrome in the viewer's language and
 * Pokémon / move names in the viewer's Pokémon-name language, while the
 * values behind them stay the English @pkmn names (i18n-core §9, T07).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { GameSummary } from '@/types/match';
import type { BattleStat } from '@/types/game';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import GameList from '../GameList';
import GameDetailCard from '../GameDetailCard';
import MovesOverflowList from '../MovesOverflowList';

const GAMES: GameSummary[] = [
  { id: 'g1', game_number: 1, winner_id: 'p1', replay_url: '', source: 'ps_replay', stats_locked: false },
  { id: 'g2', game_number: 2, winner_id: null, replay_url: '', source: 'manual', stats_locked: false },
];

function stat(over: Partial<BattleStat>): BattleStat {
  return {
    id: 'bs-1',
    game_id: 'g1',
    player_id: 'p1',
    pokemon_name: 'Charizard',
    kos_dealt: 2,
    was_koed: true,
    was_lead: true,
    was_brought: true,
    moves_used: ['Flamethrower'],
    turns_active: 1,
    ...over,
  } as BattleStat;
}

describe('GameList', () => {
  const ui = <GameList games={GAMES} player1Name="Mara" player2Name="Cilan" player1Id="p1" player2Id="p2" />;

  it('keeps the English wording and labels the game source', () => {
    const html = renderWithI18n(ui);
    expect(html).toContain('Mara wins');
    expect(html).toContain('>Pending<');
    expect(html).toContain('>Showdown replay<');
    expect(html).toContain('>G1<');
  });

  it('renders German under a German provider', () => {
    const html = renderWithI18n(ui, { locale: 'de' });
    expect(html).toContain('Mara gewinnt');
    expect(html).toContain('>Ausstehend<');
    expect(html).toContain('>Partien<');
  });

  it('says no games were played in German', () => {
    const html = renderWithI18n(
      <GameList games={[]} player1Name="Mara" player2Name="Cilan" player1Id="p1" player2Id="p2" />,
      { locale: 'de' },
    );
    expect(html).toContain('Noch keine Partien gespielt.');
  });
});

describe('GameDetailCard', () => {
  const ui = (
    <GameDetailCard
      game={GAMES[0]}
      stats={[stat({}), stat({ id: 'bs-2', kos_dealt: 1, was_lead: false, was_koed: false, turns_active: 3 })]}
      player1Id="p1"
      player2Id="p2"
      player1Name="Mara"
      player2Name="Cilan"
    />
  );

  it('keeps the English labels and KO plurals', () => {
    const html = renderWithI18n(ui);
    expect(html).toContain('Game 1');
    expect(html).toContain('>2 KOs<');
    expect(html).toContain('>1 KO<');
    expect(html).toContain('1 turn active');
    expect(html).toContain('3 turns active');
    expect(html).toContain('Charizard');
  });

  it('shows German chrome and German species names', () => {
    const html = renderWithI18n(ui, { locale: 'de' });
    expect(html).toContain('Partie 1');
    expect(html).toContain('Sieger:');
    expect(html).toContain('Glurak');
    expect(html).toContain('3 Runden aktiv');
  });

  it('keeps English species names with "Keep Pokémon terms in English"', () => {
    const html = renderWithI18n(ui, { locale: 'de', dataLocale: 'en' });
    expect(html).toContain('Partie 1');
    expect(html).toContain('Charizard');
    expect(html).not.toContain('Glurak');
  });
});

describe('MovesOverflowList', () => {
  it('shows move names in the Pokémon-name language', () => {
    expect(renderWithI18n(<MovesOverflowList moves={['Thunderbolt']} />)).toContain('Thunderbolt');
    expect(renderWithI18n(<MovesOverflowList moves={['Thunderbolt']} />, { locale: 'de' })).toContain('Donnerblitz');
  });
});
