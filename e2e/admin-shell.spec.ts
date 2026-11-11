import { DEV_SEED_ADMIN } from '../src/lib/dev-seed/constants';
import { signIn } from './support/auth';
import { expect, test } from './support/fixtures';

test.describe('admin shell', () => {
  test('a site admin navigates by the sidebar, the breadcrumb and the command menu, without the public nav', async ({ page }) => {
    await signIn(page, DEV_SEED_ADMIN.email, DEV_SEED_ADMIN.password);
    await page.goto('/admin');
    await expect(page.locator('#site-nav')).toHaveCount(0);

    const sidebar = page.getByRole('navigation', { name: 'Admin' });
    await expect(sidebar.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'New competition' })).toHaveAttribute('href', '/admin/leagues/new');

    // Competitions is one section over the list pages; its views show once the page is inside it.
    await sidebar.getByRole('link', { name: 'Competitions' }).click();
    await expect(page).toHaveURL(/\/admin\/leagues$/);
    await expect(sidebar.getByRole('link', { name: 'Leagues', exact: true })).toHaveAttribute('aria-current', 'page');
    await sidebar.getByRole('link', { name: 'Tournaments', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/tournaments$/);
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb.getByRole('link', { name: 'Competitions' })).toBeVisible();
    await expect(breadcrumb.getByText('Tournaments')).toBeVisible();

    // The command menu reaches a page of the folded System group, which then opens around it.
    await page.keyboard.press('ControlOrMeta+k');
    const menu = page.getByRole('dialog', { name: 'Admin command menu' });
    await menu.getByRole('combobox').fill('audit');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await expect(sidebar.getByRole('link', { name: 'Audit log' })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('link', { name: 'Back to site' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('#site-nav')).toBeVisible();
  });

  test('on a phone the sidebar is a drawer that closes when its link is followed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, DEV_SEED_ADMIN.email, DEV_SEED_ADMIN.password);
    await page.goto('/admin');
    await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open admin menu' }).click();
    const sidebar = page.getByRole('navigation', { name: 'Admin' });
    await sidebar.getByRole('link', { name: 'Matches' }).click();
    await expect(page).toHaveURL(/\/admin\/matches$/);
    await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);
  });
});
