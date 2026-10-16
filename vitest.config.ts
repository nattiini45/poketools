import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { existsSync } from 'fs';
import path from 'path';

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy-service-role-key';

/**
 * Gauntlet integration tests that run run-queue.sh / floor.sh / swap.sh. Those scripts keep one
 * runner lock and one swap state in the checkout's gauntlet/work, so two of these files running at
 * once collide ("another runner holds …/RUNNER.lock"): they run one file at a time.
 *
 * These files belong to the private companion overlay (see the "private companion overlay" block in
 * .gitignore): a public checkout does not have them, so the list keeps only the files present on
 * disk and the `gauntlet-stateful` project exists only when at least one of them does.
 *
 * They drive the real capture queues and can run for an hour, so they are opt-in: a plain
 * `npm test` skips them (with a one-line note) and `GAUNTLET_TESTS=1 npm test` runs them.
 */
const RUN_GAUNTLET = process.env.GAUNTLET_TESTS === '1';
const GAUNTLET_STATEFUL = [
  'scripts/__tests__/d42-tools-d0.test.mjs',
  'scripts/__tests__/d42-tools-d1.test.mjs',
  'scripts/__tests__/d42-tools-eng.test.mjs',
  'scripts/__tests__/d42-tools-followups.test.mjs',
  'scripts/__tests__/d42-tools-int4.test.mjs',
  'scripts/__tests__/d42-tools-items.test.mjs',
  'scripts/__tests__/d42-tools-precheck.test.mjs',
  'scripts/__tests__/d42-tools-queues.test.mjs',
  'scripts/__tests__/d42-tools-runner.test.mjs',
  'scripts/__tests__/gauntlet-queues.test.mjs',
  'scripts/__tests__/gauntlet-swap.test.mjs',
].filter((file) => existsSync(path.resolve(__dirname, file)));

// Vitest evaluates this file once per project; the env flag keeps the note to one line.
if (GAUNTLET_STATEFUL.length > 0 && !RUN_GAUNTLET && !process.env.VITEST_GAUNTLET_NOTE) {
  process.env.VITEST_GAUNTLET_NOTE = '1';
  console.log(`[vitest] skipping ${GAUNTLET_STATEFUL.length} gauntlet-stateful harness files; set GAUNTLET_TESTS=1 to run them`);
}

/**
 * Format packs (docs/format-packs.md). `@format-pack` is resolved per project: the public `app`
 * project ALWAYS runs against the example pack, so public tests never depend on the companion.
 * The `private-pack` project exists only when the private pack (companion overlay, see the
 * "private companion overlay" block in .gitignore) is on disk and FORMAT_PACK is not 'example';
 * it runs the companion suite (golden parity, moved test copies) against the private pack.
 */
const PRIVATE_PACK = path.resolve(__dirname, 'src/format-packs/private/index.ts');
const EXAMPLE_PACK = path.resolve(__dirname, 'src/format-packs/example/index.ts');
/** FORMAT_PACK is trimmed and validated the same way next.config.mjs does it. */
function runPrivatePack(): boolean {
  const mode = (process.env.FORMAT_PACK ?? '').trim();
  if (mode !== '' && mode !== 'example' && mode !== 'private') {
    throw new Error(`[format-pack] FORMAT_PACK must be unset, 'example' or 'private' (got '${mode}')`);
  }
  const hasPrivate = existsSync(PRIVATE_PACK);
  if (mode === 'private' && !hasPrivate) {
    throw new Error('[format-pack] FORMAT_PACK=private but src/format-packs/private/index.ts is missing');
  }
  return hasPrivate && mode !== 'example';
}
const RUN_PRIVATE_PACK = runPrivatePack();

/** Script tests spawn CLIs (node, bash, git) per case; 5 s is too tight on a cold or loaded runner. */
const SCRIPT_TEST_TIMEOUT_MS = 60_000;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/app/api/**/route.ts'],
      exclude: ['src/**/__tests__/**', 'src/types/**'],
    },
    projects: [
      {
        extends: true,
        resolve: { alias: { '@format-pack': EXAMPLE_PACK } },
        test: {
          name: 'app',
          include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
          exclude: ['src/format-packs/private/**', ...configDefaults.exclude],
        },
      },
      {
        extends: true,
        test: {
          name: 'scripts',
          include: ['scripts/**/__tests__/**/*.test.mjs'],
          exclude: GAUNTLET_STATEFUL,
          testTimeout: SCRIPT_TEST_TIMEOUT_MS,
        },
      },
      ...(RUN_GAUNTLET && GAUNTLET_STATEFUL.length > 0
        ? [
            {
              extends: true as const,
              test: {
                name: 'gauntlet-stateful',
                include: GAUNTLET_STATEFUL,
                fileParallelism: false,
                testTimeout: SCRIPT_TEST_TIMEOUT_MS,
              },
            },
          ]
        : []),
      ...(RUN_PRIVATE_PACK
        ? [
            {
              extends: true as const,
              resolve: { alias: { '@format-pack': PRIVATE_PACK } },
              test: {
                name: 'private-pack',
                include: ['src/format-packs/private/__tests__/**/*.test.{ts,tsx}'],
              },
            },
          ]
        : []),
    ],
  },
  resolve: {
    alias: {
      // Before '@' (Vite's string alias matches '@' only as '@' or '@/…', so no collision; kept explicit).
      // Each project overrides it (see PRIVATE_PACK above); the root entry is the example pack.
      '@format-pack': EXAMPLE_PACK,
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/test/server-only-stub.ts'),
    },
  },
});
