import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Issue #56: a signed-out visitor must reach the custom sign-in page with the page they wanted as the return path.
 * These spellings each lost it (the `/login` route does not exist; `/api/auth/signin` is an extra Auth.js hop with no
 * `callbackUrl`), so none may come back. Tests that assert their absence are skipped.
 */
const FORBIDDEN: Array<{ name: string; pattern: RegExp }> = [
  { name: "redirect('/login')", pattern: /redirect\(\s*['"`]\/login['"`]\s*\)/ },
  { name: "redirect('/api/auth/signin')", pattern: /redirect\(\s*['"`]\/api\/auth\/signin['"`]/ },
  { name: 'href to /api/auth/signin', pattern: /href\s*=\s*\{?\s*['"`]\/api\/auth\/signin/ },
  { name: "redirect('/auth/signin') without a return path", pattern: /redirect\(\s*['"`]\/auth\/signin['"`]\s*\)/ },
];

const SRC = join(process.cwd(), 'src');
const SOURCE = /\.(?:ts|tsx)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (SOURCE.test(entry) && !/\.test\.[tj]sx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('sign-in redirects keep the return path (#56)', () => {
  const files = walk(SRC).map((file) => ({ file, text: readFileSync(file, 'utf8') }));

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  for (const { name, pattern } of FORBIDDEN) {
    it(`has no ${name}`, () => {
      const hits = files
        .filter(({ text }) => pattern.test(text))
        .map(({ file }) => relative(process.cwd(), file).split(sep).join('/'));
      expect(hits).toEqual([]);
    });
  }
});
