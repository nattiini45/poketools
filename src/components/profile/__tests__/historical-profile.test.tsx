import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import ProfileHistoricalHonors from '../ProfileHistoricalHonors';
import ProfilePokemonSpotlight from '../ProfilePokemonSpotlight';

describe('historical profile display', () => {
  it('shows shared archive honors with source links in both languages', () => {
    const honors = [{ eventKey: 'fable', kind: 'champion' as const, playerIds: ['trainer-orbit'], shared: true, liveScopeIds: [], preferLive: false,
      competition: { id: 'fable-cup', name: 'Fable Cup', href: '/archive/fable-cup', kind: 'cup' as const, year: 2021, parentId: null, seasonLabel: null }, pokemonName: null, count: null }];
    const en = renderWithI18n(<ProfileHistoricalHonors honors={honors} />);
    expect(en).toContain('Shared honor');
    expect(en).toContain('href="/archive/fable-cup"');
    expect(en).toContain('Historical record');
    const de = renderWithI18n(<ProfileHistoricalHonors honors={honors} />, { locale: 'de' });
    expect(de).toContain('Geteilte Auszeichnung');
    expect(de).toContain('Historischer Eintrag');
  });

  it('does not render unknown win rates or combined global ranks as zero', () => {
    const html = renderWithI18n(<ProfilePokemonSpotlight
      mostUsed={[{ pokemon_name: 'Mew', total_games: 12, total_kos_dealt: 20, total_koed: null, kill_differential: null, win_rate: null }]}
      bestKillers={[{ pokemon_name: 'Mew', kos_dealt: 20, rank: null, total_ranked: null }]}
    />);
    expect(html).toContain('12 known games');
    expect(html).toContain('20 known KOs · overall rank unavailable');
    expect(html).not.toContain('0%');
    expect(html).not.toContain('0th');
  });
});
