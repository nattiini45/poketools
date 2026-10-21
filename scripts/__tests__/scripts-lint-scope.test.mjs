/**
 * `npm run lint` covers the tracked scripts (M14): the lint script names scripts/, and the ESLint
 * config ignores exactly the gitignored companion-overlay scripts, never a tracked one, and applies
 * eslint:recommended with Node globals (browser globals only where page.evaluate code lives).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { SCRIPT_BROWSER_CONTEXT_FILES, scriptIgnoresFromGitignore } from '../../eslint.config.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('scripts lint scope', () => {
  it('npm run lint lints src/ and scripts/', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.lint.split(/\s+/)).toEqual(['eslint', 'src/', 'scripts/']);
  });

  it('turns anchored scripts/ entries of .gitignore into ignores and skips everything else', () => {
    const text = [
      '# comment',
      '/scripts/gauntlet/',
      '/scripts/board-card.mjs',
      'scripts/world-assets/.cache/',
      '/scripts/__tests__/d42-tools-*.test.mjs',
      '!/scripts/keep.mjs',
      '/src/format-packs/private/',
      '__pycache__/',
      '',
    ].join('\r\n');
    expect(scriptIgnoresFromGitignore(text)).toEqual([
      'scripts/gauntlet/**',
      'scripts/board-card.mjs',
      'scripts/board-card.mjs/**',
      'scripts/world-assets/.cache/**',
      'scripts/__tests__/d42-tools-*.test.mjs',
      'scripts/__tests__/d42-tools-*.test.mjs/**',
    ]);
  });

  it('ignores gitignored overlay scripts and lints every tracked script', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    for (const rel of ['scripts/gauntlet/run.mjs', 'scripts/board-card.mjs', 'scripts/__tests__/d42-tools-zz.test.mjs']) {
      expect(await eslint.isPathIgnored(join(REPO_ROOT, rel)), rel).toBe(true);
    }
    const tracked = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z', '--', 'scripts'], { encoding: 'utf8' })
      .split('\0')
      .filter((f) => /\.(mjs|cjs|js|ts|mts)$/.test(f));
    expect(tracked.length).toBeGreaterThan(50);
    const ignored = [];
    for (const rel of tracked) {
      if (await eslint.isPathIgnored(join(REPO_ROOT, rel))) ignored.push(rel);
    }
    expect(ignored).toEqual([]);
  });

  it('applies eslint:recommended with Node globals to scripts, and browser globals only to page-context files', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const nodeOnly = await eslint.calculateConfigForFile(join(REPO_ROOT, 'scripts/db-types.mjs'));
    for (const rule of ['no-undef', 'no-regex-spaces', 'no-useless-escape', 'no-new-func']) {
      expect(nodeOnly.rules[rule]?.[0], rule).toBe(2);
    }
    expect(nodeOnly.rules['no-unused-vars']?.[0]).toBe(0);
    expect(nodeOnly.rules['@typescript-eslint/no-unused-vars']?.[0]).toBe(1);
    expect(nodeOnly.languageOptions.globals.process).toBeDefined();
    expect(nodeOnly.languageOptions.globals.document).toBeUndefined();
    for (const rel of SCRIPT_BROWSER_CONTEXT_FILES) {
      const cfg = await eslint.calculateConfigForFile(join(REPO_ROOT, rel));
      expect(cfg.languageOptions.globals.document, rel).toBeDefined();
      expect(cfg.languageOptions.globals.process, rel).toBeDefined();
    }
  });

  it('reports an undefined global and a useless escape in a script (the rules are live)', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const [result] = await eslint.lintText('console.log(documnt, /[a\\-]/);\n', { filePath: join(REPO_ROOT, 'scripts/probe-lint.mjs') });
    expect(result.messages.map((m) => m.ruleId).sort()).toEqual(['no-undef', 'no-useless-escape']);
  });
});
