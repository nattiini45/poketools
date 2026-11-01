import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, E2E_PORT, localStack } from './e2e/support/stack';

// Throws before the app server starts when the environment names anything but the local stack.
localStack();

/**
 * Chromium smoke suite over the LOCAL Supabase stack and a production build of the app (`npm run build:e2e`).
 * The server is started behind `.claude/local-db.cjs`: local URL and keys, the local asset mirrors (no Storage
 * bucket), the in-process rate limiter. Discord is unset, so sign-in is email and password.
 * Setup: CONTRIBUTING.md, "End-to-end tests".
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  // The specs share one seeded league and sign users in and out; run in order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node --require ./.claude/local-db.cjs node_modules/next/dist/bin/next start --port ${E2E_PORT}`,
    url: `${BASE_URL}/auth/signin`,
    // A server already on the port may point anywhere: always start our own.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      LOCAL_DB_DEV_PORT: String(E2E_PORT),
      FORMAT_PACK: 'example',
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'e2e-secret-for-the-local-stack-only',
      NEXT_PUBLIC_WORLD_ASSETS_URL: '/models/world',
      NEXT_PUBLIC_SPRITES_URL: '/sprites',
      RATE_LIMIT_STORE: 'memory',
      DISCORD_CLIENT_ID: '',
      DISCORD_CLIENT_SECRET: '',
      SUPERADMIN_DISCORD_ID: '',
      SUPERADMIN_EMAIL: '',
      // A developer's `.env.local` may hold provider keys: a result report triggers AI analysis, which must stay off.
      ANTHROPIC_API_KEY: '',
      NANOGPT_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      XIAOMI_API_KEY: '',
      MINIMAX_API_KEY: '',
      REPLICATE_API_TOKEN: '',
      MESHY_API_KEY: '',
      BRAINTRUST_API_KEY: '',
    },
  },
});
