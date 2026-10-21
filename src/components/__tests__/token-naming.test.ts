/**
 * Token-naming guard (draft-frontend §8.3, critique F11).
 *
 * The spec names are Draft Kill Token, Comeback Token and Cosmo Token; the
 * bare "Kill Token", "Killtoken", "Cosmo-Punkte"/"Cosmo Points" and the "CP:"
 * label of the old merged-KO surfaces must not come back. Allowed: "Draft Kill
 * Token" and "Draft-Kill-Token".
 *
 * Scope: `src/components/**` (.ts and .tsx) and the league-facing message
 * namespaces (draft, glossary, league-admin, world, world-themes, league-hub).
 * Test files are skipped (they assert the absence of these words).
 *
 * Code identifiers are exempt, never text: import/re-export lines, and a
 * `KillToken`/`KillTokens` written as an identifier (a type or component name,
 * a JSX tag, a call, a member access). Route segments are lowercase
 * (`kill-tokens`) and never match.
 *
 * Created skipped by DF6 while the legacy surfaces (DL-UI-1, DL-UI-2, T19) were
 * rewritten; enabled by the sweep S (i18n-core §12.2 #3).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

// §8.3's pattern, widened to the plural ("Kill Tokens").
const FORBIDDEN = /\bKill ?Tokens?\b(?<!Draft Kill Tokens?)|Killtoken|Cosmo-Punkte|Cosmo Points|\bCP:/;

const SCOPES: { dir: string; ext: readonly string[] }[] = [
  { dir: 'src/components', ext: ['.ts', '.tsx'] },
  ...['draft', 'glossary', 'league-admin', 'world', 'world-themes', 'league-hub'].map((ns) => ({
    dir: `src/i18n/messages/${ns}`,
    ext: ['.ts'],
  })),
];

function walk(dir: string, ext: readonly string[], out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return; // a namespace that does not exist (yet)
  }
  for (const name of names) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') walk(path, ext, out);
    } else if (ext.some((e) => name.endsWith(e)) && !/\.test\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
}

/** An import or re-export line: module specifiers and bindings, never shown text. */
const IMPORT_LINE = /^\s*(?:import\b|export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\b)/;
/**
 * `KillToken`/`KillTokens` used as a code identifier: declared (`type`,
 * `interface`, `class`, `function`, `const`/`let`), a JSX tag (`<KillToken`,
 * `</KillToken`), a member (`.KillToken`), or called/instantiated/indexed
 * (`KillToken(`, `KillToken<`, `KillToken.`, `KillToken[`).
 */
const IDENTIFIER_USE =
  /(?:\b(?:type|interface|class|function|const|let|var|new)\s+|<\/?|\.)KillTokens?\b|\bKillTokens?(?=[(<.[])/g;

/** The line with code-identifier uses of the retired name masked out. */
function maskIdentifiers(line: string): string {
  if (IMPORT_LINE.test(line)) return '';
  return line.replace(IDENTIFIER_USE, ' ');
}

/** `file:line: text` for every forbidden token name in the scanned files. */
function findTokenNamingViolations(root: string = ROOT): string[] {
  const files: string[] = [];
  for (const scope of SCOPES) walk(join(root, scope.dir), scope.ext, files);
  const hits: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      if (FORBIDDEN.test(maskIdentifiers(text))) hits.push(`${relative(root, file).split(sep).join('/')}:${i + 1}: ${text.trim()}`);
    });
  }
  return hits;
}

// Walks the source tree: under a loaded full suite or a cold clone the walk can pass the
// 5 s default (engine-r3-contract.test.ts uses the same bound).
const FILE_WALK_TIMEOUT_MS = 30_000;

describe('token naming pattern', () => {
  it('flags the retired names and allows the spec names', () => {
    for (const bad of ['Kill Token', '2 Kill Tokens', 'KillToken', 'Killtoken', 'Cosmo-Punkte', 'Cosmo Points', 'CP: 4']) {
      expect(FORBIDDEN.test(bad), bad).toBe(true);
    }
    for (const ok of ['Draft Kill Token', 'Draft Kill Tokens', 'Draft-Kill-Token', 'Comeback Token', 'Cosmo Token', 'EPB: 4']) {
      expect(FORBIDDEN.test(ok), ok).toBe(false);
    }
  });
});

// Enabled by the sweep S (critique F11, i18n-core §12.2 #3).
describe('code identifier exemption', () => {
  it('masks identifiers and import lines but never text', () => {
    for (const code of [
      "import { KillToken } from '@/types/draft';",
      "export { KillTokens } from './x';",
      'type KillToken = { id: string };',
      'const x = <KillToken id={id} />;',
      'const n = KillTokens(data);',
      'const t = api.KillToken;',
    ]) {
      expect(FORBIDDEN.test(maskIdentifiers(code)), code).toBe(false);
    }
    for (const text of ["label: 'Kill Token',", "title: 'KillToken'", '<p>Kill Tokens</p>', ' * Kill Tokens: the pool']) {
      expect(FORBIDDEN.test(maskIdentifiers(text)), text).toBe(true);
    }
  });
});

describe('token naming guard', { timeout: FILE_WALK_TIMEOUT_MS }, () => {
  it('no component or league message uses a retired token name', () => {
    expect(findTokenNamingViolations()).toEqual([]);
  });
});
