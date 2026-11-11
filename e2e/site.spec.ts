import { expect, test } from './support/fixtures';
import { seededLeague } from './support/seed';

test.describe('site chrome', () => {
  test('a broadcast overlay renders without the navigation bar', async ({ page }) => {
    const { seasonId } = await seededLeague();
    await page.goto(`/broadcast/league/${seasonId}/standings`);
    await expect(page.getByText(/Seed Player 1\b/).first()).toBeVisible();
    await expect(page.locator('#site-nav')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test('the language switch changes the site to German and keeps it after a reload', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('#site-nav');
    await expect(nav.getByRole('link', { name: 'Tournaments' })).toBeVisible();

    await nav.getByRole('button', { name: 'Appearance and language' }).click();
    await nav.getByRole('button', { name: 'Language', exact: true }).click();
    // The radio input is visually hidden behind its label.
    await page.getByText('Deutsch', { exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Deutsch' })).toBeChecked();
    await expect(nav.getByRole('link', { name: 'Turniere' })).toBeVisible();

    await page.reload();
    await expect(nav.getByRole('link', { name: 'Turniere' })).toBeVisible();
  });
});
