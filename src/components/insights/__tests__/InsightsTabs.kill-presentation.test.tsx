/** @vitest-environment jsdom */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InsightsTabs from '../InsightsTabs';
import { SpriteStyleProvider } from '@/components/shared/SpriteStyleProvider';
import { withI18n } from '@/test/i18n';
import type { CombinedPokemonUsageRow } from '@/lib/stats/combined-statistics';
import { resolveSpriteStyle, spriteResolver, type SpriteStylePreference } from '@/lib/pkmn/sprite-styles';

const species = ['Pikachu', 'Bulbasaur', 'Ivysaur', 'Venusaur', 'Charmander', 'Charmeleon', 'Charizard', 'Squirtle', 'Wartortle', 'Blastoise', 'Caterpie', 'Metapod', 'Butterfree', 'Weedle', 'Kakuna', 'Beedrill', 'Pidgey', 'Pidgeotto', 'Pidgeot', 'Rattata', 'Raticate', 'Spearow', 'Fearow', 'Ekans', 'Arbok', 'Raichu'];
const rows: CombinedPokemonUsageRow[] = species.map((pokemon_name, i) => ({
  pokemon_name, usage_percent: null, total_appearances: null, total_games: null,
  kos_dealt: 100 - Math.floor(i / 2), koed_rate: null, efficiency: null,
  bring_rate: null, lead_rate: null, win_rate: null,
  sourceCounts: { liveAppearances: 0, historicalAppearances: null, liveKos: 5, historicalKos: 95 - Math.floor(i / 2) },
}));
const props: Parameters<typeof InsightsTabs>[0] = {
  activeTab: 'kills', scope: { type: 'global' }, history: { state: 'ready', coverage: [] },
  usageRows: rows, isDoubles: false, standings: [], killRanking: [], participants: [],
  tournamentId: null, aggregateScopeType: 'all_time', aggregateScopeId: null, ratingRows: [], streakEntries: [],
};

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterAll(() => vi.unstubAllGlobals());

function show(overrides: Partial<typeof props> = {}, preference: SpriteStylePreference = 'pixel') {
  return render(withI18n(<SpriteStyleProvider initialPreference={preference}><InsightsTabs {...props} {...overrides} /></SpriteStyleProvider>));
}

function bodyRows() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1);
}

function positions() {
  return bodyRows().map(row => within(row).getAllByRole('cell')[0].textContent);
}

describe('combined KO ranking species presentation', () => {
  it.each([
    ['global', 'ready'], ['global', 'excluded'], ['archive', 'ready'], ['archive', 'excluded'],
  ] as const)('preserves sprites and ordinal positions in %s with history %s', (scope, state) => {
    const usageRows = state === 'excluded'
      ? rows.map(row => ({ ...row, kos_dealt: 5, sourceCounts: { liveAppearances: 0, historicalAppearances: null, liveKos: 5, historicalKos: 0 } }))
      : rows;
    show({ scope: scope === 'global' ? { type: 'global' } : { type: 'archive', id: 'cloud-cup' }, history: { state, coverage: [] }, usageRows });
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: '#' })).toBeTruthy();
    const visible = bodyRows();
    expect(positions()).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)));
    for (const [i, row] of visible.entries()) {
      const image = within(row).getByRole('img', { name: species[i] });
      expect(image.getAttribute('src')).toContain(`/gen5/${species[i].toLowerCase()}.png`);
      expect(image.getAttribute('width')).toBe('24');
      expect(image.closest('a')?.getAttribute('href')).toBe(`/pokemon/${species[i]}`);
    }
    const breakdown = state === 'excluded' ? 'Live 5 · Historical 0' : 'Live 5 · Historical 95';
    expect(visible[0].textContent).toContain(breakdown);
    expect(visible[1].textContent).toContain(breakdown);
  });

  it.each(['pixel', 'home', 'animated', 'broadcast', 'site'] as const)('uses the existing resolver for the %s preference', preference => {
    show({}, preference);
    const image = within(bodyRows()[0]).getByRole('img', { name: 'Pikachu' });
    expect(image.getAttribute('src')).toBe(spriteResolver.candidates('Pikachu', resolveSpriteStyle(preference), { variant: 'thumb' })[0]);
  });

  it('uses the table page offset rather than restarting positions at one', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
    expect(positions()).toEqual(['21', '22', '23', '24', '25', '26']);
    expect(within(bodyRows()[0]).getByRole('img', { name: 'Raticate' })).toBeTruthy();
  });

  it('keeps stable tied rows and follows alternate sorting and pagination', async () => {
    const user = userEvent.setup();
    show();
    expect(within(bodyRows()[0]).getByRole('img', { name: 'Pikachu' })).toBeTruthy();
    expect(within(bodyRows()[1]).getByRole('img', { name: 'Bulbasaur' })).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
    await user.click(screen.getByRole('button', { name: 'Pokemon' }));
    expect(positions()).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)));
    expect(within(bodyRows()[0]).getByRole('img', { name: 'Arbok' })).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
    expect(positions()).toEqual(['21', '22', '23', '24', '25', '26']);
    expect(within(bodyRows()[0]).getByRole('img', { name: 'Rattata' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'KOs' }));
    expect(positions()[0]).toBe('1');
    expect(within(bodyRows()[0]).getByRole('img', { name: 'Arbok' })).toBeTruthy();
  });
});
