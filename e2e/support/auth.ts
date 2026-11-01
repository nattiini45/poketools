import { expect, type Page } from '@playwright/test';

/** Signs in through the email form of `/auth/signin` (the only form when Discord is not configured). */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/auth\/signin/);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
}
