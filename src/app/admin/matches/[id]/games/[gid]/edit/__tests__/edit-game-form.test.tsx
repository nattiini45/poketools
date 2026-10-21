/**
 * `EditGameForm` translates its chrome (`admin-core.editGame`) and, in a
 * German data locale, shows the display name of the typed English species
 * and moves as a hint. The inputs keep the stored English @pkmn names
 * (pkmn-l10n §5.2 rule 2).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { BattleStat } from '@/types/game';
import EditGameForm from '../EditGameForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const P1 = { id: 'p1', name: 'Ash' };
const P2 = { id: 'p2', name: 'Gary' };

const STAT: BattleStat = {
  id: 's1',
  game_id: 'g1',
  player_id: 'p1',
  pokemon_name: 'Charizard',
  was_brought: true,
  was_lead: true,
  kos_dealt: 2,
  was_koed: false,
  moves_used: ['Flamethrower', 'Roost'],
  turns_active: 5,
  match_won: true,
  created_at: '2026-10-01T18:00:00.000Z',
};

function ui() {
  return (
    <EditGameForm
      gameId="g1"
      matchId="m1"
      gameUpdatedAt="2026-10-19T08:00:00.123456+00:00"
      currentWinnerId="p1"
      player1={P1}
      player2={P2}
      battleStats={[STAT]}
      isSiteAdmin
    />
  );
}

describe('EditGameForm i18n', () => {
  it('English: verbatim labels, no display-name hint', () => {
    const html = renderWithI18n(ui());
    expect(html).toContain('Moves (comma sep.)');
    expect(html).toContain('Save Changes');
    expect(html).toContain('+ Add Pokémon');
    expect(html).toContain('value="Charizard"');
    expect(html).not.toContain('Shown as');
  });

  it('German: translated labels and the German names as hints; values stay English', () => {
    const html = renderWithI18n(ui(), { locale: 'de' });
    expect(html).toContain('Änderungen speichern');
    expect(html).toContain('Attacken (englisch, kommagetrennt)');
    expect(html).toContain('Angezeigt als Glurak');
    expect(html).toContain('Angezeigt als Flammenwurf, Ruheort');
    expect(html).toContain('value="Charizard"');
    expect(html).toContain('value="Flamethrower, Roost"');
  });

  it('German UI with English Pokémon terms: no hint', () => {
    const html = renderWithI18n(ui(), { locale: 'de', dataLocale: 'en' });
    expect(html).toContain('Änderungen speichern');
    expect(html).not.toContain('Angezeigt als');
  });
});
