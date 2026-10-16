import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

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
  {
    ignores: ['.next/', 'node_modules/', 'out/'],
  },
];
