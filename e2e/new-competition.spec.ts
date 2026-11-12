import { DEV_SEED_ADMIN } from '../src/lib/dev-seed/constants';
import { signIn } from './support/auth';
import { expect, test } from './support/fixtures';

test.describe('new-competition wizard', () => {
  test('an admin creates a league from an example format in one flow and lands on its overview', async ({ page }) => {
    await signIn(page, DEV_SEED_ADMIN.email, DEV_SEED_ADMIN.password);

    // The format gallery opens the wizard with the example picked.
    await page.goto('/admin/formats');
    await page.getByRole('tab', { name: /Examples/ }).click();
    await page.getByRole('link', { name: 'Create a league from Wichtelcup' }).click();
    await expect(page).toHaveURL(/\/admin\/leagues\/new\?preset=wichtelcup$/);
    // The admin's page transition keeps the leaving page beside the arriving one for its exit tween: wait it out.
    const title = page.getByRole('heading', { level: 1, name: 'New competition' });
    await expect(title).toHaveCount(1);
    await expect(title).toBeVisible();
    await expect(page.getByRole('radio', { name: /Wichtelcup/ })).toBeChecked();
    const rail = page.getByRole('complementary', { name: 'What gets created' });
    await expect(rail.getByText('Wichtelcup, your private copy')).toBeVisible();

    // Details refuses an empty name at the field, then takes one.
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Give the league a name.')).toBeVisible();
    const name = `e2e Wichtelcup ${Date.now()}`;
    await page.getByLabel('League Name').fill(name);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Review names the choices; one request creates the league, its format and its stage.
    await expect(page.getByRole('heading', { level: 2, name: 'Review and create' })).toBeVisible();
    await expect(page.getByText(name).first()).toBeVisible();
    await page.getByRole('button', { name: 'Create league' }).click();

    await expect(page).toHaveURL(/\/admin\/leagues\/[0-9a-f-]{36}$/);
    const leagueTitle = page.getByRole('heading', { level: 1, name });
    await expect(leagueTitle).toHaveCount(1);
    await expect(leagueTitle).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ready to start?' })).toBeVisible();
  });

  test('League and Tournament are two pages with one header', async ({ page }) => {
    await signIn(page, DEV_SEED_ADMIN.email, DEV_SEED_ADMIN.password);
    await page.goto('/admin/leagues/new');
    const kinds = page.getByRole('navigation', { name: 'Kind of competition' });
    await expect(kinds.getByRole('link', { name: 'League' })).toHaveAttribute('aria-current', 'page');
    await kinds.getByRole('link', { name: 'Tournament' }).click();
    await expect(page).toHaveURL(/\/admin\/tournaments\/new$/);
    const title = page.getByRole('heading', { level: 1, name: 'New competition' });
    await expect(title).toHaveCount(1);
    await expect(title).toBeVisible();
    await expect(kinds.getByRole('link', { name: 'Tournament' })).toHaveAttribute('aria-current', 'page');
  });
});
