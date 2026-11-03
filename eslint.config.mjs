import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import js from '@eslint/js';
import globals from 'globals';
import { readFileSync } from 'node:fs';

/**
 * `npm run lint` covers src/ and scripts/. ESLint's flat config does not read .gitignore, and a
 * maintainer checkout carries gitignored companion-overlay scripts (the "private companion
 * overlay" block in .gitignore) that are not part of this repository, so the root-anchored
 * .gitignore entries under scripts/ become lint ignores here. Only tracked scripts are linted.
 * Exported for scripts/__tests__/scripts-lint-scope.test.mjs.
 * @param {string} text .gitignore contents
 * @returns {string[]} ESLint ignore globs
 */
export function scriptIgnoresFromGitignore(text) {
  const globs = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    // Anchored entries only: "/scripts/x" or "scripts/x/..." (a slash before the end anchors it).
    const anchored = line.startsWith('/') ? line.slice(1) : line;
    if (!anchored.startsWith('scripts/')) continue;
    if (anchored.endsWith('/')) globs.push(`${anchored}**`);
    else globs.push(anchored, `${anchored}/**`);
  }
  return globs;
}

const SCRIPT_IGNORES = scriptIgnoresFromGitignore(readFileSync(new URL('./.gitignore', import.meta.url), 'utf8'));

/** Tracked scripts that pass callbacks to page.evaluate (browser globals in scope). */
export const SCRIPT_BROWSER_CONTEXT_FILES = [
  'scripts/__tests__/fetch-private-assets.test.mjs',
  'scripts/__tests__/quiet-probe.test.mjs',
  'scripts/capture-route.mjs',
  'scripts/capture.mjs',
  'scripts/lib/capture-evidence.mjs',
  'scripts/lib/chrome-probes.mjs',
  'scripts/lib/gauntlet-evidence.mjs',
  'scripts/lib/look-r5-evidence.mjs',
  'scripts/lib/look-r6-evidence.mjs',
  'scripts/lib/reveal-anchors.mjs',
  'scripts/lib/w1-evidence.mjs',
  'scripts/world-assets/capture-props-c107.mjs',
];

/**
 * Files under src/app/api that may import the service-role client or `@supabase/*` directly. A route
 * handler reads and writes through `src/lib/supabase/queries/*`, `src/lib/supabase/storage/*` and the
 * helpers under `src/lib/auth`; a file listed here has no such home. Each entry names its reason.
 * @type {ReadonlyArray<{ file: string, reason: string }>}
 */
export const SERVICE_ROLE_CLIENT_ALLOWLIST = [
  { file: 'src/app/api/account/identities/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/admin/avatars/thumbnails/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/admin/backfill-gamification/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/admin/dashboard/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/admin/export/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/admin/import/point-buy/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/admin/rounds/[id]/reset/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/auth/reset-password/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/avatar/gallery/[id]/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/avatar/generate/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/avatar/transform/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/bootstrap/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/broadcast/storylines/[id]/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/broadcast/storylines/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/draft-pool-entries/[id]/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/drafts/[id]/replay-events/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/matches/[id]/social-image/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/players/[id]/avatar/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
  { file: 'src/app/api/players/[id]/route.ts', reason: 'inline query not yet moved into src/lib/supabase' },
];

const SUPABASE_PACKAGE_PATTERN = {
  group: ['@supabase/supabase-js', '@supabase/*'],
  message: 'Do not import Supabase directly in components, pages or route handlers. Use server-side query modules (src/lib/supabase/queries/*) or storage modules (src/lib/supabase/storage/*).',
};

const SERVICE_ROLE_CLIENT_PATTERN = {
  group: ['@/lib/supabase/client', '**/supabase/client'],
  message: 'The service-role client stays inside src/lib. Query through src/lib/supabase/queries/* or src/lib/supabase/storage/*, or add the file to SERVICE_ROLE_CLIENT_ALLOWLIST in eslint.config.mjs with a reason.',
};

const API_SOURCE_FILES = ['src/app/api/**/*.{ts,tsx}'];
const API_TEST_FILES = ['src/app/api/**/__tests__/**', 'src/app/api/**/*.test.{ts,tsx}'];

export default [
  ...tseslint.configs.recommended,
  {
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/set-state-in-effect': 'error',
      // Security: block dangerous functions
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  // Architecture: block direct Supabase imports outside the approved wrapper
  {
    files: ['src/components/**/*', 'src/app/**/page.tsx', 'src/app/**/layout.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [SUPABASE_PACKAGE_PATTERN, SERVICE_ROLE_CLIENT_PATTERN] }],
    },
  },
  // Architecture: route handlers and their helpers never import the service-role client, and log
  // through src/lib/logger.ts (structured JSON with the request id) instead of console.
  {
    files: API_SOURCE_FILES,
    ignores: [...API_TEST_FILES],
    rules: {
      'no-restricted-imports': ['error', { patterns: [SUPABASE_PACKAGE_PATTERN, SERVICE_ROLE_CLIENT_PATTERN] }],
    },
  },
  // Documented exceptions: the file keeps the raw client, the console rule still applies.
  ...(SERVICE_ROLE_CLIENT_ALLOWLIST.length > 0
    ? [{
        // `[id]` route folders are glob character classes unless bracketed.
        files: SERVICE_ROLE_CLIENT_ALLOWLIST.map((entry) => entry.file.replace(/\[([^\]]*)\]/g, '[[]$1[]]')),
        rules: { 'no-restricted-imports': 'off' },
      }]
    : []),
  // Architecture: block @pkmn/dex in client components (2MB+ bundle)
  {
    files: ['src/components/**/*'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          SUPABASE_PACKAGE_PATTERN,
          SERVICE_ROLE_CLIENT_PATTERN,
          {
            group: ['@pkmn/dex'],
            message: 'Do not import @pkmn/dex in client components (2MB+ bundle). Use /api/pkmn/* routes instead.',
          },
        ],
      }],
    },
  },
  // Tracked node scripts: eslint:recommended (no-undef, no-regex-spaces, no-useless-escape, ...)
  // with Node globals. The TS no-unused-vars rule above (with the ^_ policy) stays in charge, so
  // the base rule is off here.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',
    },
  },
  // Scripts whose page.evaluate callbacks run in the browser reference window/document.
  {
    files: SCRIPT_BROWSER_CONTEXT_FILES,
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    ignores: ['.next/', 'node_modules/', 'out/', ...SCRIPT_IGNORES],
  },
];
