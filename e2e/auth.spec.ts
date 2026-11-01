import { DEV_SEED_PASSWORD } from '../src/lib/dev-seed/constants';
import { signIn, signOut } from './support/auth';
import { expect, test } from './support/fixtures';
import { autoconfirmsSignups, confirmationPath, waitForMail } from './support/stack';

test.describe('email accounts without Discord', () => {
  test('the sign-in page offers the email form only', async ({ page }) => {
    await page.goto('/auth/signin');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /Discord/ })).toHaveCount(0);
  });

  test('sign up, confirm the email from Mailpit, sign in and sign out', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-${stamp}@poketools.test`;

    await page.goto('/auth/signup');
    await page.getByLabel('Display name').fill(`E2E User ${stamp}`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(DEV_SEED_PASSWORD);
    await page.getByLabel('Confirm password').fill(DEV_SEED_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

    // A stack started before `enable_confirmations = true` signs users up already confirmed and sends no mail.
    if (await autoconfirmsSignups()) {
      test.info().annotations.push({ type: 'note', description: 'local Auth autoconfirms sign-ups: no confirmation mail expected' });
    } else {
      await page.goto('/auth/signin');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(DEV_SEED_PASSWORD);
      await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByText('Please verify your email before signing in.')).toBeVisible();

      await page.goto(confirmationPath(await waitForMail(email)));
      await page.getByRole('button', { name: 'Confirm my email' }).click();
      await expect(page.getByText('Email confirmed! Your account is ready.')).toBeVisible();
    }

    await signIn(page, email, DEV_SEED_PASSWORD);
    await signOut(page);
  });
});
