import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n, withI18n } from '@/test/i18n';
import type { BroadcastMoment, EnrichedPokemonState, OverlayConfig } from '@/types/broadcast';
import type { PlayerStreaks } from '@/types/streak';

// OverlayShell -> overlay-locale -> content-locale (a DB read); never reached here.
vi.mock('@/i18n/content-locale', () => ({ resolveContentLocale: vi.fn() }));

import OverlayShell from '../OverlayShell';
import OverlayMomentBanner from '../OverlayMomentBanner';
import OverlayPokemonStatCard from '../OverlayPokemonStatCard';
import OverlayScoreDisplay from '../OverlayScoreDisplay';
import OverlayStreakBadge from '../OverlayStreakBadge';
import OverlayRatingBadge from '../OverlayRatingBadge';

const config: OverlayConfig = {
  theme: 'dark',
  accent: '#EF4444',
  accent2: '#3B82F6',
  anim: 'smooth',
  poll: 5000,
  w: 1920,
  h: 1080,
  brand: '',
  brandpos: 'br',
  preset: null,
  lang: null,
};

const moment: BroadcastMoment = {
  id: 'm1',
  game_id: null,
  match_id: 'match-1',
  moment_type: 'turning_point',
  pokemon_name: null,
  description: null,
  turn_number: 3,
  timestamp: '2026-10-09T12:00:00Z',
  created_by: 'caster-1',
};

const pokemon = (over: Partial<EnrichedPokemonState> = {}): EnrichedPokemonState => ({
  pokemon_name: 'Charizard',
  was_brought: true,
  was_lead: true,
  was_koed: false,
  kos_dealt: 2,
  types: [],
  sprite_url: '',
  moves_used: ['Flamethrower', 'Air Slash', 'Roost'],
  turns_active: 4,
  is_mvp: false,
  item: null,
  ability: null,
  ...over,
});

const streaks: PlayerStreaks = {
  id: 's1',
  player_id: 'p1',
  current_win_streak: 3,
  best_win_streak: 3,
  current_loss_streak: 0,
  best_loss_streak: 1,
  current_ko_streak: 0,
  best_ko_streak: 2,
  current_flawless_streak: 0,
  best_flawless_streak: 1,
  last_match_id: null,
};

describe('OverlayShell nested provider (i18n-core §6.5)', () => {
  it('overrides the viewer language with the overlay language and marks lang', () => {
    // Outer provider = the viewer cookie (English); the overlay is German.
    const html = renderToStaticMarkup(
      withI18n(
        <OverlayShell config={config} locale="de">
          <OverlayMomentBanner moment={moment} />
        </OverlayShell>,
        { locale: 'en' },
      ),
    );
    expect(html).toContain('lang="de"');
    expect(html).toContain('Wendepunkt');
    expect(html).toContain('Zug 3');
    expect(html).not.toContain('Turning Point');
  });

  it('pins Pokémon terms to the overlay language even when the viewer keeps English terms', () => {
    const html = renderToStaticMarkup(
      withI18n(
        <OverlayShell config={config} locale="de">
          <OverlayPokemonStatCard pokemon={pokemon()} />
        </OverlayShell>,
        { locale: 'de', dataLocale: 'en' },
      ),
    );
    expect(html).toContain('Glurak');
    expect(html).toContain('Flammenwurf');
  });

  it('without a locale it renders as before (no lang, no nested provider)', () => {
    const html = renderToStaticMarkup(
      <OverlayShell config={config}>
        <OverlayMomentBanner moment={moment} />
      </OverlayShell>,
    );
    expect(html).not.toContain('lang=');
    expect(html).toContain('Turning Point');
    expect(html).toContain('Turn 3');
  });
});

describe('shared overlay pieces', () => {
  it('stat card: English unchanged', () => {
    const html = renderWithI18n(<OverlayPokemonStatCard pokemon={pokemon({ is_mvp: true })} />);
    expect(html).toContain('Charizard');
    expect(html).toContain('2 KOs');
    expect(html).toContain('Lead');
    expect(html).toContain('★ MVP');
    expect(html).toContain('Flamethrower, Air Slash');
    expect(html).toContain('4t');
  });

  it('stat card: German names, moves and labels', () => {
    const html = renderWithI18n(<OverlayPokemonStatCard pokemon={pokemon({ kos_dealt: 1, was_koed: true })} />, {
      locale: 'de',
    });
    expect(html).toContain('Glurak');
    expect(html).toContain('Flammenwurf');
    expect(html).toContain('1 KO<');
    expect(html).toContain('4 Z.');
  });

  it('stat card: benched Pokémon', () => {
    const benched = pokemon({ was_brought: false });
    expect(renderWithI18n(<OverlayPokemonStatCard pokemon={benched} />)).toContain('Not used');
    expect(renderWithI18n(<OverlayPokemonStatCard pokemon={benched} />, { locale: 'de' })).toContain(
      'Nicht eingesetzt',
    );
  });

  it('series score in both languages', () => {
    const ui = <OverlayScoreDisplay pokemonScore={{ p1: 3, p2: 0 }} seriesScore={{ player1: 2, player2: 1 }} />;
    expect(renderWithI18n(ui)).toContain('Series 2-1');
    expect(renderWithI18n(ui, { locale: 'de' })).toContain('Serie 2–1');
  });

  it('streak badge plural in both languages', () => {
    expect(renderWithI18n(<OverlayStreakBadge streaks={streaks} />)).toContain('3 Win Streak');
    expect(renderWithI18n(<OverlayStreakBadge streaks={streaks} />, { locale: 'de' })).toContain('3 Siege in Folge');
  });

  it('rating badge: tier ball name and peak label', () => {
    const rating = { rating: 1950, rd: 40, peak: 2100 };
    const en = renderWithI18n(<OverlayRatingBadge rating={rating} />);
    expect(en).toContain('title="Master Ball"');
    expect(en).toContain('(Peak: 2100)');
    const de = renderWithI18n(<OverlayRatingBadge rating={rating} />, { locale: 'de' });
    expect(de).toContain('title="Meisterball"');
    expect(de).toContain('(Bestwert: 2100)');
  });
});
