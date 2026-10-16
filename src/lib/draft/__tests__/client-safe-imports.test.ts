/**
 * The client-safe draft modules (draft-backend §7) may import only:
 * `@/types/*`, `@/i18n/{config,core}`, `@/i18n/messages/**`,
 * `@/lib/api/user-facing-error`, `@/lib/pkmn/i18n/id` (pure, dictionary-free),
 * `zod`, and each other. Everything they reach transitively must stay free of
 * `@pkmn/*`, Supabase, `next/*`, `server-only` and Node built-ins, so the
 * draft room and the finder can bundle them.
 *
 * The format-pack chain is scanned too (design spec §A.6): `src/lib/format-pack/*` and every
 * example-pack file. Packs end up in client bundles, so the same rules hold for them; `@format-pack`
 * is followed to the example pack here (the companion scans the private pack with its own copy).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../..');

const CLIENT_SAFE_DRAFT_MODULES = [
  'line-identity',
  'league-overrides',
  'special-rules-text',
  'utility-categories',
  'price-tabs',
  'budget',
  'draftability',
  'tokens',
  'progress-sources',
  'time',
  'errors',
  'redraft-order',
  'schemas',
  'points-limits',
] as const;

const FORMAT_PACK_MODULES = ['types', 'schema', 'define', 'active', 'index', 'stored-flags'] as const;
const EXAMPLE_PACK_DIR = path.join(SRC, 'format-packs', 'example');
const EXAMPLE_PACK_ENTRY = path.join(EXAMPLE_PACK_DIR, 'index.ts');

/** Every `.ts` file under `dir`, tests excluded. */
function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : sourceFilesUnder(full);
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [full] : [];
  });
}

const SCANNED_FILES = [
  ...CLIENT_SAFE_DRAFT_MODULES.map((m) => path.join(SRC, 'lib', 'draft', `${m}.ts`)),
  path.join(SRC, 'types', 'draft-queue.ts'),
  ...FORMAT_PACK_MODULES.map((m) => path.join(SRC, 'lib', 'format-pack', `${m}.ts`)),
  ...sourceFilesUnder(EXAMPLE_PACK_DIR),
];

const DRAFT_MODULE_SPECIFIERS = new Set<string>(CLIENT_SAFE_DRAFT_MODULES.map((m) => `@/lib/draft/${m}`));

const ALLOWED_DIRECT: readonly RegExp[] = [
  /^zod$/,
  /^@\/types\/[\w-]+$/,
  /^@\/i18n\/(config|core)$/,
  /^@\/i18n\/messages(\/[\w-]+)*$/,
  /^@\/lib\/api\/user-facing-error$/,
  /^@\/lib\/pkmn\/i18n\/id$/,
  // Format packs (design spec §A.3, §A.6): the contract, the alias and the example pack's own files.
  /^@\/lib\/format-pack(\/[\w-]+)?$/,
  /^@format-pack$/,
  /^@\/i18n\/(define|types)$/,
  /^@\/format-packs\/example(\/[\w-]+)*$/,
];

const FORBIDDEN_ANYWHERE: readonly RegExp[] = [
  /^@pkmn\//,
  /^@supabase\//,
  /^next(\/|$)/,
  /^next-auth(\/|$)/,
  /^server-only$/,
  /^node:/,
  /^(fs|path|crypto|os|child_process)$/,
  /^@\/lib\/supabase(\/|$)/,
  /^@\/lib\/auth(\/|$)/,
  /^@\/lib\/pkmn\/(?!i18n\/id$)/,
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Every module specifier of static imports/re-exports, side-effect imports, dynamic imports and require(). */
function specifiersOf(file: string): string[] {
  const code = stripComments(readFileSync(file, 'utf8'));
  const out: string[] = [];
  const patterns = [
    /\b(?:import|export)\s[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) out.push(m[1]);
  return out;
}

function resolveLocal(fromFile: string, spec: string): string | null {
  let base: string;
  // The public scan follows the alias to the example pack (vitest.config.ts does the same for `app`).
  if (spec === '@format-pack') return EXAMPLE_PACK_ENTRY;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate;
  }
  return null;
}

/** Normalises a relative specifier of a draft module to its `@/lib/draft/...` form. */
function canonical(fromFile: string, spec: string): string {
  if (!spec.startsWith('.')) return spec;
  const resolved = resolveLocal(fromFile, spec);
  if (!resolved) return spec;
  return `@/${path.relative(SRC, resolved).replace(/\\/g, '/').replace(/\.tsx?$/, '').replace(/\/index$/, '')}`;
}

describe('client-safe draft modules', () => {
  it.each(SCANNED_FILES.map((f) => [path.relative(SRC, f).replace(/\\/g, '/'), f]))('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(SCANNED_FILES.map((f) => [path.relative(SRC, f).replace(/\\/g, '/'), f]))(
    '%s imports only allowed modules',
    (_name, file) => {
      const offending = specifiersOf(file)
        .map((spec) => canonical(file, spec))
        .filter((spec) => !DRAFT_MODULE_SPECIFIERS.has(spec) && !ALLOWED_DIRECT.some((re) => re.test(spec)));
      expect(offending).toEqual([]);
    },
  );

  it('nothing reachable from them imports server-only, Supabase, next/*, @pkmn/* or Node built-ins', () => {
    const seen = new Set<string>();
    const queue = [...SCANNED_FILES];
    const violations: string[] = [];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of specifiersOf(file)) {
        if (FORBIDDEN_ANYWHERE.some((re) => re.test(spec))) {
          violations.push(`${path.relative(SRC, file).replace(/\\/g, '/')} → ${spec}`);
          continue;
        }
        const local = resolveLocal(file, spec);
        if (local) queue.push(local);
      }
    }
    expect(violations).toEqual([]);
    // Sanity: the walk really followed the graph (draft-queue → line-identity → pkmn id, errors → i18n).
    expect(seen.size).toBeGreaterThan(SCANNED_FILES.length);
  });

  it('example-pack files import only the pack allowlist (design spec §A.3)', () => {
    const PACK_ALLOWED: readonly RegExp[] = [
      /^@\/types\/[\w-]+$/,
      /^@\/i18n\/(define|types)$/,
      /^@\/lib\/format-pack\/(types|define)$/,
      /^@\/format-packs\/example(\/[\w-]+)*$/,
    ];
    const offending = sourceFilesUnder(EXAMPLE_PACK_DIR).flatMap((file) =>
      specifiersOf(file)
        .map((spec) => canonical(file, spec))
        .filter((spec) => !PACK_ALLOWED.some((re) => re.test(spec)))
        .map((spec) => `${path.relative(SRC, file).replace(/\\/g, '/')} → ${spec}`),
    );
    expect(offending).toEqual([]);
  });

  it('scans the format-pack chain and follows @format-pack to the example pack', () => {
    expect(SCANNED_FILES).toEqual(
      expect.arrayContaining([path.join(SRC, 'lib', 'format-pack', 'active.ts'), EXAMPLE_PACK_ENTRY]),
    );
    const active = path.join(SRC, 'lib', 'format-pack', 'active.ts');
    expect(specifiersOf(active)).toContain('@format-pack');
    expect(resolveLocal(active, '@format-pack')).toBe(EXAMPLE_PACK_ENTRY);
  });

  it('the scanner finds the imports of known files', () => {
    const fixture = path.join(SRC, 'lib', 'draft', 'budget.ts');
    expect(specifiersOf(fixture)).toEqual([]);
    expect(specifiersOf(path.join(SRC, 'lib', 'draft', 'schemas.ts'))).toEqual(
      expect.arrayContaining(['zod', '@/lib/draft/line-identity', '@/types/draft-queue']),
    );
  });
});
