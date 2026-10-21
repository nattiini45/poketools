/**
 * Drift guards for the public documentation.
 *
 * The spec (docs/poketools-spec.md) is canonical, so its route map, table index and env list must
 * name things that exist. The checks run forward only (doc -> code): a doc may leave things out,
 * but what it names must be real. Files are enumerated through git (tracked plus untracked files
 * that are not ignored), so the gitignored companion overlay and its mirrored outputs never count:
 * a path that only a private overlay provides is not part of the public app.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

/** Tracked files plus untracked, non-ignored ones (the public view of the working tree). */
function publicFiles(...pathspecs) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...pathspecs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return out.split('\0').filter((f) => f !== '' && existsSync(join(REPO_ROOT, f)));
}

/**
 * A doc section: from its heading line to the next heading of the same or a higher level. Lines
 * inside fenced code blocks are never headings (a `# comment` in a bash block is not one).
 */
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`heading not found: ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  let fenced = false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('```')) fenced = !fenced;
    const m = fenced ? null : lines[i].match(/^(#+) /);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

// ── Route resolution ─────────────────────────────────────────────────────────────────────────────

const isDynamic = (seg) => /^\[.*\]$/.test(seg);

/** App Router route entries: URL segments (route groups dropped) of every page.tsx / route.ts. */
export function appRoutes(files) {
  return files
    .filter((f) => /^src\/app\/.*\/(page\.tsx|route\.ts)$/.test(f) || /^src\/app\/(page\.tsx|route\.ts)$/.test(f))
    .map((f) => {
      const parts = f.replace(/^src\/app\//, '').split('/');
      const file = parts.pop();
      return {
        kind: file === 'route.ts' ? 'route' : 'page',
        segments: parts.filter((p) => !/^\(.*\)$/.test(p)),
        file: f,
      };
    });
}

/**
 * Does a documented path match a route entry? A literal segment matches only the same literal
 * folder; a dynamic doc segment (`[id]`) matches only a dynamic folder, whatever its name. So
 * `/teams/library` never falls through to `/teams/[id]`.
 */
export function pathMatches(docPath, route) {
  const segs = docPath.split('/').filter(Boolean);
  if (segs.length !== route.segments.length) return false;
  return segs.every((s, i) => (isDynamic(s) ? isDynamic(route.segments[i]) : s === route.segments[i]));
}

const resolves = (docPath, routes, kinds) => routes.some((r) => kinds.includes(r.kind) && pathMatches(docPath, r));

/** Literal `/api/...` paths in a text; shorthand (`…`, `...`), globs and query strings are skipped. */
export function apiPaths(text) {
  const found = new Set();
  for (const m of text.matchAll(/(?<![\w/.])(\/api\/[A-Za-z0-9_\-/[\]]+)/g)) {
    const after = text.slice(m.index + m[1].length, m.index + m[1].length + 3);
    // A glob (`/api/cron/*`) or shorthand (`/api/x/…`, `/api/x/...`) names no single route.
    if (after.startsWith('*') || after.startsWith('…') || after.startsWith('...')) continue;
    found.add(m[1].replace(/\/+$/, ''));
  }
  return [...found];
}

/** Page paths at the start of a line inside the section's code blocks (`/leagues/[id]   …`). */
export function pagePaths(text) {
  const found = new Set();
  for (const block of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    for (const m of block[1].matchAll(/^(\/[A-Za-z0-9_\-/[\]]*)(?=\s|$)/gm)) {
      if (!m[1].startsWith('/api/')) found.add(m[1]);
    }
  }
  return [...found];
}

describe('route matcher', () => {
  const routes = appRoutes([
    'src/app/(player)/teambuilder/[tid]/page.tsx',
    'src/app/(public)/teams/library/page.tsx',
    'src/app/api/teams/share/route.ts',
    'src/app/api/teams/shared/[token]/route.ts',
  ]);

  it('never lets a literal segment fall through to a dynamic folder', () => {
    expect(resolves('/teambuilder/library', routes, ['page'])).toBe(false);
    expect(resolves('/teambuilder/[x]', routes, ['page'])).toBe(true);
    expect(resolves('/teams/library', routes, ['page'])).toBe(true);
  });

  it('matches dynamic segments by position, not by name, and drops route groups', () => {
    expect(resolves('/api/teams/shared/[t]', routes, ['route'])).toBe(true);
    expect(resolves('/api/teams/share/[token]', routes, ['route'])).toBe(false);
    expect(resolves('/api/teams/[id]/share', routes, ['route'])).toBe(false);
  });

  it('extracts literal api paths and skips shorthand and globs', () => {
    const text = 'GET /api/a/[id] x; POST …/b; `/api/cron/*` and /api/c/… and POST /api/d/route.';
    expect(apiPaths(text).sort()).toEqual(['/api/a/[id]', '/api/d/route']);
  });
});

// ── The spec ─────────────────────────────────────────────────────────────────────────────────────

const SPEC = read('docs/poketools-spec.md');
const ROUTES = appRoutes(publicFiles('src/app'));

describe('docs/poketools-spec.md section 5 (route map)', () => {
  const s5 = section(SPEC, '## 5. Route Map');

  it('every literal /api path in the spec resolves to a route.ts', () => {
    const missing = apiPaths(SPEC).filter((p) => !resolves(p, ROUTES, ['route']));
    expect(missing).toEqual([]);
  });

  it('every page path in the section 5 code blocks resolves to a page.tsx or route.ts', () => {
    const pages = pagePaths(s5);
    expect(pages.length).toBeGreaterThan(30);
    const missing = pages.filter((p) => !resolves(p, ROUTES, ['page', 'route']));
    expect(missing).toEqual([]);
  });

  it('lists every vercel.json cron, and every cron route checks CRON_SECRET', () => {
    const { crons } = JSON.parse(read('vercel.json'));
    expect(crons.length).toBeGreaterThan(0);
    for (const { path } of crons) {
      expect(s5).toContain(path);
      expect(read(`src/app${path}/route.ts`)).toContain('CRON_SECRET');
    }
  });

  it('documents no co-pilot route (struck: never built)', () => {
    expect(SPEC).not.toMatch(/\/api\/teams\/co-pilot/);
    expect(SPEC).not.toMatch(/AI_SLOT_COACH_DAILY_LIMIT|TEAM_LIBRARY_ENABLED/);
  });
});

describe('docs/poketools-spec.md section 4 (schema)', () => {
  const index = section(SPEC, '### 4.13 Table index');
  const types = read('src/types/database.ts');
  const publicStart = types.indexOf('public: {');
  const tablesStart = types.indexOf('Tables: {', publicStart);
  const tablesEnd = types.indexOf('Views: {', tablesStart);
  const tables = [...types.slice(tablesStart, tablesEnd).matchAll(/^ {6}([a-z_0-9]+): \{$/gm)].map((m) => m[1]);
  const indexed = [...index.matchAll(/^\| `([a-z_0-9]+)` \|/gm)].map((m) => m[1]);

  it('reads the table list from src/types/database.ts', () => {
    expect(tables.length).toBeGreaterThan(50);
    expect(tables).toContain('players');
  });

  it('section 4.13 names every table exactly once', () => {
    expect(tables.filter((t) => !indexed.includes(t))).toEqual([]);
    expect(indexed.filter((t, i) => indexed.indexOf(t) !== i)).toEqual([]);
  });

  it('section 4.13 names no table that does not exist', () => {
    expect(indexed.filter((t) => !tables.includes(t))).toEqual([]);
  });

  it('carries no stale "Phase 2" label on shipped draft tables', () => {
    expect(section(SPEC, '## 4. Database Schema (Supabase / Postgres)')).not.toMatch(/Phase 2/);
  });
});

describe('docs/poketools-spec.md section 13 (environment)', () => {
  const s13 = section(SPEC, '## 13. Environment Variables');
  const example = read('.env.example');
  const exampleKeys = new Set([...example.matchAll(/^(?:#\s*)?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const block = s13.match(/```bash\n([\s\S]*?)```/);

  it('has a variable block', () => {
    expect(block).not.toBeNull();
  });

  it('every variable it names is an .env.example key', () => {
    const vars = [...block[1].matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    expect(vars.length).toBeGreaterThan(8);
    expect(vars.filter((v) => !exampleKeys.has(v))).toEqual([]);
  });

  it('includes the variables the code requires to run its core flows', () => {
    for (const v of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'CRON_SECRET', 'BOOTSTRAP_SECRET', 'FORMAT_PACK']) {
      expect(block[1]).toMatch(new RegExp(`^${v}=`, 'm'));
    }
  });
});

// ── Setup docs ───────────────────────────────────────────────────────────────────────────────────

describe('setup docs', () => {
  const readme = read('README.md');
  const quickstart = read('openwiki/quickstart.md');

  it('the wiki quick start includes the database steps the README has', () => {
    for (const doc of [readme, quickstart]) {
      expect(doc).toContain('npx supabase start');
      expect(doc).toContain('npx supabase db reset');
    }
    expect(quickstart).toContain('../README.md');
  });

  it('every variable the README marks Required is an .env.example key', () => {
    const required = readme.slice(readme.indexOf('\nRequired:\n'), readme.indexOf('\nRecommended:\n'));
    const names = [...required.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1]);
    const example = read('.env.example');
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) expect(example).toMatch(new RegExp(`^(#\\s*)?${n}=`, 'm'));
  });

  it('the README explains the example format pack and links the pack guide', () => {
    expect(readme).toContain('FORMAT_PACK');
    expect(readme).toContain('docs/format-packs.md#writing-your-own-pack');
    expect(read('docs/format-packs.md')).toMatch(/^## Writing Your Own Pack$/m);
  });

  it('the README links the backup guide, which exists', () => {
    expect(readme).toContain('docs/operations-backup.md');
    expect(existsSync(join(REPO_ROOT, 'docs/operations-backup.md'))).toBe(true);
  });
});

describe('docs/operations-backup.md', () => {
  const doc = read('docs/operations-backup.md');

  it('every migration it cites exists', () => {
    const cited = [...doc.matchAll(/(\d{14}_[a-z0-9_]+\.sql)/g)].map((m) => m[1]);
    expect(cited.length).toBeGreaterThan(0);
    for (const f of cited) expect(existsSync(join(REPO_ROOT, 'supabase/migrations', f))).toBe(true);
  });

  it('every table it names in backticks is a real table', () => {
    const types = read('src/types/database.ts');
    const named = [...doc.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1]).filter((n) => !n.includes('session_replication'));
    const tableLike = named.filter((n) => types.includes(`      ${n}: {`) || /(_log|_stats|_history|aggregates)$/.test(n));
    for (const t of tableLike) expect(types).toContain(`      ${t}: {`);
  });

  it('documents CONCURRENTLY and a lock timeout for migrations', () => {
    expect(doc).toContain('CREATE INDEX CONCURRENTLY');
    expect(doc).toContain('lock_timeout');
  });

  it('cites the Supabase pages its plan table and restore command come from', () => {
    expect(doc).toContain('https://supabase.com/docs/guides/platform/backups');
    expect(doc).toContain('https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore');
  });
});

describe('AGENTS.md hard rules', () => {
  it('names no exception to the no-masking rule', () => {
    const agents = read('AGENTS.md');
    expect(agents).not.toMatch(/known exceptions?/i);
    expect(agents).not.toMatch(/log the error and return `null`/);
  });
});

// ── Naming and ownership ─────────────────────────────────────────────────────────────────────────

describe('product name and glossary', () => {
  it('docs/challonge-mapping.md does not name the community', () => {
    expect(read('docs/challonge-mapping.md')).not.toMatch(/\bPLC\b/);
  });

  it('PRODUCT.md names the product PokéTools, never the community', () => {
    const product = read('PRODUCT.md');
    expect(product).not.toMatch(/\bPLC\b/);
    expect(product).toMatch(/^PokéTools — /m);
  });

  it('CONTEXT.md is the route-world glossary and its Colossal threshold matches the code', () => {
    const context = read('CONTEXT.md');
    expect(context.split('\n')[0]).toBe('# Route World Glossary');
    const doc = context.match(/\*\*Colossal rule\*\*[^\n]*\n[^\n]*taller than (\d+(?:\.\d+)?) m/);
    const code = read('src/lib/route-world/teams-formation.ts').match(/export const TEAMS_COLOSSAL_M = (\d+(?:\.\d+)?);/);
    expect(doc).not.toBeNull();
    expect(code).not.toBeNull();
    expect(Number(doc[1])).toBe(Number(code[1]));
  });

  it("CONTEXT.md's Focus panel names every focus URL parameter of the plaza theme", () => {
    const focus = read('CONTEXT.md').match(/\*\*Focus panel\*\*:\n([^\n]*)/)[1];
    const params = read('src/components/world/themes/plaza/theme.ts').match(/panelParams: \[([^\]]*)\]/)[1];
    const names = [...params.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(focus).toContain(`?${n}=`);
  });
});

describe('public docs (owner rulings)', () => {
  const docs = publicFiles(':(glob)*.md', 'docs', 'openwiki').filter(
    (f) => f.endsWith('.md') && !f.startsWith('docs/format-pack-private/') && !f.startsWith('docs/superpowers/')
  );

  it('scans the public markdown', () => {
    expect(docs).toContain('README.md');
    expect(docs).toContain('docs/poketools-spec.md');
  });

  it('never point at the removed co-pilot doc (only the deprecation record names it)', () => {
    const hits = docs.filter((f) => f !== 'docs/deprecations.md' && read(f).includes('teambuilder-ai-copilot.md'));
    expect(hits).toEqual([]);
  });

  it('carry no stale query-module count', () => {
    const hits = docs.filter((f) => /~\s?29 (query |table)?[a-z/-]*\s?modules/i.test(read(f)));
    expect(hits).toEqual([]);
  });

  it('carry no internal review or decision IDs', () => {
    const hits = docs.filter((f) => /code review [A-Z]\d|owner decision D\d/i.test(read(f)));
    expect(hits).toEqual([]);
  });

  it('relative links resolve', () => {
    const broken = [];
    for (const f of docs) {
      for (const m of read(f).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1].split('#')[0];
        if (target === '' || /^[a-z]+:/i.test(target)) continue;
        const rel = posix.normalize(posix.join(posix.dirname(f), target));
        if (!existsSync(join(REPO_ROOT, rel))) broken.push(`${f} -> ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
