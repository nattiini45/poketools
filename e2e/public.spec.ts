import { expect, test } from './support/fixtures';
import { E2E_LEAGUE_NAME, seededLeague } from './support/seed';

test.describe('anonymous visitor: public pages', () => {
  test('home page lists the seeded league', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'PokéTools' })).toBeVisible();
    await expect(page.getByRole('link', { name: E2E_LEAGUE_NAME }).first()).toBeVisible();
  });

  test('league page shows the league', async ({ page }) => {
    const { seasonId } = await seededLeague();
    await page.goto(`/leagues/${seasonId}?tier=lite`);
    await expect(page.getByRole('heading', { level: 1, name: E2E_LEAGUE_NAME })).toBeVisible();
  });

  test('tournament page ranks the seeded players', async ({ page }) => {
    const { tournamentId } = await seededLeague();
    await page.goto(`/tournaments/${tournamentId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(E2E_LEAGUE_NAME);
    const standings = page.getByRole('table').first();
    await expect(standings.getByRole('row', { name: /Seed Player 1\b/ })).toBeVisible();
    await expect(standings.getByRole('row')).toHaveCount(9);
  });

  test('wiki index links to the Pokémon list, and a Pokémon page renders', async ({ page }) => {
    await page.goto('/wiki');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /Pokemon/ }).first()).toBeVisible();
    await page.goto('/pokemon/pikachu');
    await expect(page.getByRole('heading', { level: 1, name: 'Pikachu' })).toBeVisible();
  });
});
