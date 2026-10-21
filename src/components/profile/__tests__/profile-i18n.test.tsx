import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement('a', { href, ...props }, children),
}));

import ProfileHeader from '../ProfileHeader';
import ProfileMatchList from '../ProfileMatchList';
import ProfileParticipations from '../ProfileParticipations';
import ProfilePokemonSpotlight from '../ProfilePokemonSpotlight';
import { ordinalSuffix } from '../ordinal';
import type { PublicPlayer } from '@/types/player';
import type { ProfileHeadlineStats, ProfileMatch, ProfileParticipation } from '@/types/profile';

const PLAYER = {
  id: 'p1',
  name: 'Mara',
  avatar_url: null,
  ps_username: 'mara_ps',
  champions_username: null,
  joined_date: '2026-03-15T10:00:00Z',
} as unknown as PublicPlayer;

const HEADLINE: ProfileHeadlineStats = {
  total_matches: 10,
  total_wins: 7,
  total_losses: 3,
  win_rate: 70,
  total_kos_dealt: 1234,
  unique_pokemon_used: 18,
  tournaments_entered: 3,
  tournaments_won: 1,
};

const MATCH: ProfileMatch = {
  id: 'm1',
  tournament_id: 't1',
  tournament_name: 'Summer Cup',
  opponent_id: 'p2',
  opponent_name: 'Bob',
  opponent_avatar_url: null,
  status: 'completed',
  winner_id: 'p1',
  date_played: '2026-10-09T16:30:00Z',
  game_score: '2-1',
};

const PARTICIPATION: ProfileParticipation = {
  id: 't1',
  name: 'Summer Cup',
  type: 'tournament',
  status: 'active',
  bracket_type: 'single_elim',
  standing: { rank: 2, total: 8, wins: 5, losses: 2 },
  best_pokemon: null,
} as ProfileParticipation;

describe('ordinalSuffix', () => {
  it('follows English ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinalSuffix)).toEqual([
      'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'st', 'nd', 'rd', 'st', 'th',
    ]);
  });
});

describe('profile components in both languages', () => {
  it('ProfileHeader renders English labels unwrapped and German with the provider', () => {
    const en = renderToStaticMarkup(<ProfileHeader player={PLAYER} headline={HEADLINE} recentForm={['W', 'L']} />);
    expect(en).toContain('Member since March 2026');
    expect(en).toContain('Record');
    expect(en).toContain('7-3');
    expect(en).toContain('70%');
    expect(en).toContain('title="Win"');

    const de = renderWithI18n(<ProfileHeader player={PLAYER} headline={HEADLINE} recentForm={['W', 'L']} />, {
      locale: 'de',
    });
    expect(de).toContain('Mitglied seit März 2026');
    expect(de).toContain('Bilanz');
    expect(de).toContain('1.234');
    expect(de).toContain('title="Sieg"');
    expect(de).toContain('title="Niederlage"');
  });

  it('ProfileMatchList localizes the result letter, aria-label and date', () => {
    const de = renderWithI18n(<ProfileMatchList title="x" matches={[MATCH]} playerId="p1" />, { locale: 'de' });
    expect(de).toContain('aria-label="Spiel gegen Bob ansehen"');
    expect(de).toContain('>S<');
    expect(de).toContain('9. Okt. 2026');
    expect(renderWithI18n(<ProfileMatchList title="x" matches={[]} playerId="p1" />)).toContain('No matches');
  });

  it('ProfileParticipations renders ordinals, enum labels and records per locale', () => {
    const en = renderWithI18n(<ProfileParticipations current={[PARTICIPATION]} past={[]} />);
    expect(en).toContain('Current (1)');
    expect(en).toContain('2nd / 8 · 5W-2L');
    expect(en).toContain('Single elimination');

    const de = renderWithI18n(<ProfileParticipations current={[PARTICIPATION]} past={[]} />, { locale: 'de' });
    expect(de).toContain('Aktuell (1)');
    expect(de).toContain('2. / 8 · 5S-2N');
  });

  it('ProfilePokemonSpotlight localizes species, plurals and the overall rank', () => {
    const props = {
      mostUsed: [
        { pokemon_name: 'Charizard', total_games: 1, total_kos_dealt: 2, total_koed: 1, kill_differential: 1, win_rate: 100 },
      ],
      bestKillers: [{ pokemon_name: 'Charizard', kos_dealt: 9, rank: 3, total_ranked: 40 }],
    };
    const en = renderWithI18n(<ProfilePokemonSpotlight {...props} />);
    expect(en).toContain('1 game · 100% WR');
    expect(en).toContain('9 KOs · <span class="text-poke-text-link font-semibold">3rd overall</span>');

    const de = renderWithI18n(<ProfilePokemonSpotlight {...props} />, { locale: 'de' });
    expect(de).toContain('Glurak');
    expect(de).toContain('1 Partie');
    expect(de).toContain('Platz 3 gesamt');
  });
});
