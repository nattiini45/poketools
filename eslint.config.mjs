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
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@supabase/supabase-js', '@supabase/*'],
          message: 'Do not import Supabase directly in components or pages. Use API routes or server-side query modules (src/lib/supabase/queries/*).',
        }],
      }],
    },
  },
  // Architecture: block @pkmn/dex in client components (2MB+ bundle)
  {
    files: ['src/components/**/*'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['@supabase/supabase-js', '@supabase/*'],
            message: 'Do not import Supabase directly in components. Use API routes or server-side query modules.',
          },
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
