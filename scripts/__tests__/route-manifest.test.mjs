/**
 * Route manifest (plan 3.9 tests 1 and 2): the committed scripts/data/route-manifest.json must match what the
 * scanner reads from the tracked route files today, the parser must understand the shapes real routes use, and
 * the declared-guard comparison the assistant registry will call must catch a mismatch.
 *
 * The drift check at the bottom runs the same code as `node scripts/route-manifest.mjs --check`, so a change to
 * a bound route's guards, schemas, buckets, audit/emit/expire calls or import names fails `npm run test` until
 * the manifest is regenerated (`node scripts/route-manifest.mjs --write`) and the change is reviewed.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BINDINGS_PATH,
  MANIFEST_PATH,
  REPO_ROOT,
  checkManifest,
  compareDeclaredGuards as exportedCompare,
  generateManifest,
  listTrackedFiles,
  loadOverlay,
  loadPathAliases,
  main,
} from '../route-manifest.mjs';
import {
  GUARD_HELPERS,
  ManifestError,
  buildManifest,
  buildManifestReport,
  compareDeclaredGuards,
  diffManifests,
  formatManifest,
  parseBindings,
  routePathOf,
  skipOverlay,
} from '../lib/route-manifest-scan.mjs';

const ALIASES = [{ pattern: '@/*', targets: ['src/*'] }];

/** Builds a manifest from in-memory files (repo-relative path -> source). */
function scan(files, bindings, extra = {}) {
  return buildManifest({
    files: Object.keys(files),
    readFile: (file) => files[file],
    bindings,
    pathAliases: ALIASES,
    ...extra,
  });
}

const post = (path) => ({ method: 'POST', path });
const entry = (manifest, key) => manifest.routes[key];

// ── Parser: what a route does ────────────────────────────────────────────────────────────────────

describe('scanner: per-call facts', () => {
  const files = {
    'src/app/api/things/route.ts': `
      import { NextRequest, NextResponse } from 'next/server';
      import { requireAnyAdmin as guard, isSuperadmin } from '@/lib/auth/helpers';
      import { checkRateLimit } from '@/lib/utils/rate-limit';
      import { logAuditEvent } from '@/lib/audit/log';
      import { emitDiscordEvent, emitSocialEvent } from '@/lib/notify';
      import { expireSeasonReads } from '@/lib/revalidation';
      import { revalidatePath } from 'next/cache';
      import { thingCreateSchema } from '@/lib/validation';

      const BUCKET = 'thing-create';

      export async function GET() {
        return NextResponse.json({});
      }

      export async function POST(request: NextRequest) {
        const player = await guard();
        if (isSuperadmin(player)) console.log('hi');
        await checkRateLimit(BUCKET, player.playerId, { limit: 20, windowSeconds: 3600 });
        const parsed = thingCreateSchema.safeParse(await request.json());
        expireSeasonReads('s');
        revalidatePath('/admin/things');
        const action = parsed.success ? 'thing.create' : 'thing.reject';
        logAuditEvent({ action, actor_id: player.playerId });
        const payload = { event_type: 'thing_created' as const, data: {} };
        void emitDiscordEvent(payload);
        void emitSocialEvent(payload);
        return NextResponse.json({});
      }
    `,
    'src/lib/auth/helpers.ts': 'export async function requireAnyAdmin() {}\nexport function isSuperadmin() { return false; }\n',
  };

  it('records guards (through an alias and isSuperadmin), schema, bucket, expiry, audit and emits for the handler only', () => {
    const manifest = scan(files, [post('/api/things'), { method: 'GET', path: '/api/things' }]);
    const bound = entry(manifest, 'POST /api/things');
    expect(bound.guards).toEqual(['isSuperadmin', 'requireAnyAdmin']);
    expect(bound.schemas).toEqual(['thingCreateSchema']);
    expect(bound.rateLimits).toEqual(['thing-create']);
    expect(bound.expires).toEqual(['expireSeasonReads', 'revalidatePath']);
    expect(bound.audit).toEqual(['thing.create', 'thing.reject']);
    expect(bound.emits).toEqual(['emitDiscordEvent(thing_created)', 'emitSocialEvent(thing_created)']);
    // GET is bound too and must not inherit POST's facts.
    const read = entry(manifest, 'GET /api/things');
    expect(read.guards).toEqual([]);
    expect(read.audit).toEqual([]);
  });

  it('does not credit a name that is not imported (a local helper called requireAdmin is not the guard)', () => {
    const manifest = scan(
      {
        'src/app/api/x/route.ts': `
          function requireAdmin() {}
          export async function POST() { requireAdmin(); }
        `,
      },
      [post('/api/x')],
    );
    expect(entry(manifest, 'POST /api/x').guards).toEqual([]);
  });

  it('marks a dynamic audit action, bucket and event type instead of dropping them', () => {
    const manifest = scan(
      {
        'src/app/api/x/route.ts': `
          import { logAuditEvent } from '@/lib/audit/log';
          import { checkRateLimit } from '@/lib/utils/rate-limit';
          import { emitDiscordEvent } from '@/lib/notify';
          export async function POST(req: Request, kind: string) {
            logAuditEvent({ action: computeAction(kind) });
            await checkRateLimit(\`bucket-\${kind}\`, 'id', {});
            await emitDiscordEvent(buildPayload());
          }
        `,
      },
      [post('/api/x')],
    );
    const bound = entry(manifest, 'POST /api/x');
    expect(bound.audit).toEqual(['<dynamic: computeAction(kind)>']);
    expect(bound.rateLimits).toEqual(['<dynamic: `bucket-${kind}`>']);
    expect(bound.emits).toEqual(['emitDiscordEvent(?)']);
  });

  it('reads schemas from derived receivers, factories, property chains, inline z and schema arguments', () => {
    const manifest = scan(
      {
        'src/app/api/x/route.ts': `
          import { z } from 'zod';
          import { updateSchema, makeSchema, schemas, parseWith, otherSchema } from '@/lib/validation';
          export async function POST(raw: unknown) {
            updateSchema.omit({ id: true }).safeParse(raw);
            makeSchema(1).parse(raw);
            schemas.create.safeParseAsync(raw);
            z.object({ a: z.string() }).parse(raw);
            parseWith(raw, otherSchema);
            JSON.parse('{}');
          }
        `,
      },
      [post('/api/x')],
    );
    expect(entry(manifest, 'POST /api/x').schemas).toEqual([
      '(inline)',
      'makeSchema',
      'otherSchema',
      'schemas.create',
      'updateSchema',
    ]);
  });

  it('follows same-file helpers, local consts and handlers declared as `export const POST = handle`', () => {
    const manifest = scan(
      {
        'src/app/api/x/route.ts': `
          import { requireAdmin } from '@/lib/auth/helpers';
          import { expireSeasonReads } from '@/lib/revalidation';
          async function handle() {
            await requireAdmin();
            finish();
          }
          const finish = () => expireSeasonReads('s');
          export const GET = handle;
          export const POST = handle;
          export async function DELETE() {}
        `,
      },
      [post('/api/x'), { method: 'DELETE', path: '/api/x' }],
    );
    expect(entry(manifest, 'POST /api/x').guards).toEqual(['requireAdmin']);
    expect(entry(manifest, 'POST /api/x').expires).toEqual(['expireSeasonReads']);
    expect(entry(manifest, 'DELETE /api/x').guards).toEqual([]);
  });
});

describe('scanner: aliased and re-exported guards, re-exported handlers', () => {
  it('resolves a namespace import (`auth.requireSuperadmin()`)', () => {
    const manifest = scan(
      {
        'src/app/api/x/route.ts': `
          import * as auth from '@/lib/auth/helpers';
          export async function POST() { await auth.requireSuperadmin(); }
        `,
      },
      [post('/api/x')],
    );
    expect(entry(manifest, 'POST /api/x').guards).toEqual(['requireSuperadmin']);
  });

  it('chases an alias re-exported by a tracked module back to the guard name', () => {
    const files = {
      'src/lib/guards.ts': `export { requireAnyAdmin as requireStaff } from './auth/helpers';`,
      'src/lib/auth/helpers.ts': 'export async function requireAnyAdmin() {}',
      'src/app/api/x/route.ts': `
        import { requireStaff } from '@/lib/guards';
        export async function POST() { await requireStaff(); }
      `,
    };
    expect(entry(scan(files, [post('/api/x')]), 'POST /api/x').guards).toEqual(['requireAnyAdmin']);
  });

  it('chases `import { a } ...; export { a as b }` chains too', () => {
    const files = {
      'src/lib/guards.ts': `import { requireDraftAdmin } from './auth/helpers';\nexport { requireDraftAdmin as gate };`,
      'src/lib/auth/helpers.ts': 'export async function requireDraftAdmin() {}',
      'src/app/api/x/route.ts': `
        import { gate } from '@/lib/guards';
        export async function POST() { await gate(); }
      `,
    };
    expect(entry(scan(files, [post('/api/x')]), 'POST /api/x').guards).toEqual(['requireDraftAdmin']);
  });

  it('does not rename a guard that a module defines itself under an alias export', () => {
    const files = {
      'src/lib/auth/helpers.ts': `
        async function guardAdmin() {}
        export { guardAdmin as requireAdmin };
      `,
      'src/app/api/x/route.ts': `
        import { requireAdmin } from '@/lib/auth/helpers';
        export async function POST() { await requireAdmin(); }
      `,
    };
    expect(entry(scan(files, [post('/api/x')]), 'POST /api/x').guards).toEqual(['requireAdmin']);
  });

  it('reads a guard imported with a dynamic import() destructure and follows that import in the fingerprint', () => {
    const files = {
      'src/lib/auth/helpers.ts': 'export async function requirePlayer() {}',
      'src/app/api/x/route.ts': `
        export async function POST() {
          const { requirePlayer } = await import('@/lib/auth/helpers');
          await requirePlayer();
        }
      `,
    };
    const bound = entry(scan(files, [post('/api/x')]), 'POST /api/x');
    expect(bound.guards).toEqual(['requirePlayer']);
    expect(bound.imports['src/lib/auth/helpers.ts'].names).toEqual(['requirePlayer']);
  });

  it('takes the handler from `export { POST } from`, `export *` and `export const { POST } = ...`', () => {
    const impl = `
      import { requireAdmin } from '@/lib/auth/helpers';
      export async function POST() { await requireAdmin(); }
    `;
    const files = {
      'src/app/api/impl/route.ts': impl,
      'src/app/api/named/route.ts': `export { POST } from '../impl/route';`,
      'src/app/api/star/route.ts': `export * from '../impl/route';`,
      'src/app/api/aliased/route.ts': `import { POST as handler } from '../impl/route';\nexport { handler as POST };`,
      'src/app/api/destructured/route.ts': `
        import { handlers } from '@/lib/nextauth';
        export const { POST } = handlers;
      `,
    };
    const manifest = scan(files, ['named', 'star', 'aliased', 'destructured'].map((name) => post(`/api/${name}`)));
    for (const name of ['named', 'star', 'aliased']) {
      const bound = entry(manifest, `POST /api/${name}`);
      expect(bound.guards, name).toEqual(['requireAdmin']);
      expect(bound.handler, name).toBe('src/app/api/impl/route.ts#POST');
      // The fingerprint belongs to the route file and reaches the implementation through the re-export.
      expect(bound.imports['src/app/api/impl/route.ts'], name).toBeDefined();
    }
    // Facts of a handler that is not in the file stay empty, never inherited from unrelated statements.
    expect(entry(manifest, 'POST /api/destructured').guards).toEqual([]);
  });

  it('maps route groups out of the URL path', () => {
    expect(routePathOf('src/app/(admin)/api/x/[id]/route.ts')).toBe('/api/x/[id]');
    expect(routePathOf('src/app/route.ts')).toBe('/');
    expect(routePathOf('src/app/api/x/page.tsx')).toBeNull();
  });
});

// ── Parser: the import-name fingerprint ──────────────────────────────────────────────────────────

describe('scanner: transitive import-name fingerprint', () => {
  const base = () => ({
    'src/app/api/x/route.ts': `
      import { NextResponse } from 'next/server';
      import { foo } from '@/lib/a';
      export async function POST() { return NextResponse.json(foo()); }
    `,
    'src/lib/a.ts': `import { bar } from './b';\nexport const foo = () => bar();\n`,
    'src/lib/b.ts': `import { z } from 'zod';\nexport const bar = () => z.string();\n`,
  });
  const fingerprint = (files) => entry(scan(files, [post('/api/x')]), 'POST /api/x');

  it('is stable for a body-only change deep in the graph and for type-only imports', () => {
    const before = fingerprint(base());
    const edited = base();
    edited['src/lib/b.ts'] = `import { z } from 'zod';\nexport const bar = () => z.number();\n// a comment\n`;
    edited['src/lib/a.ts'] = `import type { Thing } from './types';\nimport { type Other, bar } from './b';\nexport const foo = (): Thing => bar();\n`;
    const after = fingerprint(edited);
    expect(after.importFingerprint).toBe(before.importFingerprint);
    expect(after.imports).toEqual(before.imports);
  });

  it('changes when a transitive file imports a new name, a new module or a new package', () => {
    const before = fingerprint(base());
    const variants = {
      'a new name from a known module': { 'src/lib/b.ts': `import { z, ZodError } from 'zod';\nexport const bar = () => z.string();\n` },
      'a new tracked module': {
        'src/lib/b.ts': `import { z } from 'zod';\nimport { sneaky } from './c';\nexport const bar = () => sneaky(z.string());\n`,
        'src/lib/c.ts': 'export const sneaky = (x: unknown) => x;\n',
      },
      'a new package': { 'src/lib/b.ts': `import { z } from 'zod';\nimport 'left-pad';\nexport const bar = () => z.string();\n` },
    };
    for (const [label, patch] of Object.entries(variants)) {
      const after = fingerprint({ ...base(), ...patch });
      // Packages are recorded by name only: a new symbol from a package is not a change, a new package is.
      if (label === 'a new name from a known module') expect(after.importFingerprint, label).toBe(before.importFingerprint);
      else expect(after.importFingerprint, label).not.toBe(before.importFingerprint);
    }
  });

  it('changes when an imported symbol of a tracked module is renamed, and pins the change to that direct import', () => {
    const before = fingerprint(base());
    const edited = base();
    edited['src/lib/a.ts'] = `import { bar as renamed } from './b';\nimport { other } from './b';\nexport const foo = () => renamed() + other;\n`;
    edited['src/lib/b.ts'] = `import { z } from 'zod';\nexport const bar = () => z.string();\nexport const other = 1;\n`;
    const after = fingerprint(edited);
    expect(after.importFingerprint).not.toBe(before.importFingerprint);
    expect(after.imports['src/lib/a.ts'].closure).not.toBe(before.imports['src/lib/a.ts'].closure);
    expect(after.packages).toEqual(['next/server']);
  });

  it('terminates on an import cycle, follows `export ... from`, and records a non-literal import()', () => {
    const files = {
      'src/app/api/x/route.ts': `
        import { a } from '@/lib/a';
        export * from '@/lib/barrel';
        export async function POST(name: string) { await import(name); return a; }
      `,
      'src/lib/a.ts': `import { b } from './b';\nexport const a = b;\n`,
      'src/lib/b.ts': `import { a } from './a';\nexport const b = () => a;\n`,
      'src/lib/barrel.ts': `export { leaf } from './leaf';\n`,
      'src/lib/leaf.ts': 'export const leaf = 1;\n',
    };
    const bound = entry(scan(files, [post('/api/x')]), 'POST /api/x');
    expect(bound.importFiles).toBe(5);
    expect(bound.imports['src/lib/barrel.ts'].files).toBe(2);
    expect(bound.unresolved).toEqual(['<non-literal import()>']);
  });

  it('resolves tsconfig aliases to the first TRACKED target (an untracked private pack is never followed)', () => {
    const files = {
      'src/app/api/x/route.ts': `import { pack } from '@format-pack';\nexport async function POST() { return pack; }\n`,
      'src/format-packs/example/index.ts': `export const pack = 'example';\n`,
    };
    const aliases = [
      ...ALIASES,
      { pattern: '@format-pack', targets: ['src/format-packs/private', 'src/format-packs/example'] },
    ];
    const bound = entry(scan(files, [post('/api/x')], { pathAliases: aliases }), 'POST /api/x');
    expect(Object.keys(bound.imports)).toEqual(['src/format-packs/example/index.ts']);
  });

  it('reports an import that leads to an untracked file (recorded as unresolved, never followed), and the manifest changes once it is tracked', () => {
    const files = {
      'src/app/api/x/route.ts': `import { helper } from '@/lib/helper';
export async function POST() { return helper(); }
`,
      'src/lib/helper.ts': `import { extra } from './extra';
export const helper = () => extra;
`,
      'src/lib/extra.ts': `export const extra = 1;
`,
    };
    const tracked = { ...files };
    delete tracked['src/lib/extra.ts'];
    const before = buildManifestReport({
      files: Object.keys(tracked),
      untracked: ['src/lib/extra.ts', 'src/lib/unrelated.ts'],
      readFile: (file) => files[file],
      bindings: [post('/api/x')],
      pathAliases: ALIASES,
    });
    expect(before.untrackedImports).toEqual(['src/lib/extra.ts']);
    expect(before.manifest).toEqual(scan(tracked, [post('/api/x')]));
    const after = scan(files, [post('/api/x')]);
    expect(entry(after, 'POST /api/x').importFingerprint).not.toBe(entry(before.manifest, 'POST /api/x').importFingerprint);
    expect(entry(after, 'POST /api/x').importFiles).toBe(entry(before.manifest, 'POST /api/x').importFiles + 1);
  });

  it('ignores untracked files under the overlay roots and files no scanned import reaches', () => {
    const files = {
      'src/app/api/x/route.ts': `import { pack } from '@/lib/private-pack/index';
export async function POST() { return pack; }
`,
      'src/lib/private-pack/index.ts': `export const pack = 1;
`,
    };
    const report = buildManifestReport({
      files: ['src/app/api/x/route.ts'],
      untracked: ['src/lib/private-pack/index.ts'],
      overlay: { roots: ['src/lib/private-pack'], files: {} },
      readFile: (file) => files[file],
      bindings: [post('/api/x')],
      pathAliases: ALIASES,
    });
    expect(report.untrackedImports).toEqual([]);
  });
});

// ── Bindings, overlay, errors ────────────────────────────────────────────────────────────────────

describe('scanner: bindings and the overlay skip list', () => {
  it('fails loudly for a binding with no route file, no such handler, or two route files', () => {
    const files = {
      'src/app/api/x/route.ts': 'export async function GET() {}',
      'src/app/(a)/api/dup/route.ts': 'export async function POST() {}',
      'src/app/(b)/api/dup/route.ts': 'export async function POST() {}',
    };
    let error;
    try {
      scan(files, [post('/api/missing'), post('/api/x'), post('/api/dup')]);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ManifestError);
    expect(error.problems).toEqual([
      'POST /api/missing: no tracked route file serves /api/missing',
      'POST /api/x: src/app/api/x/route.ts exports no POST handler',
      expect.stringContaining('POST /api/dup: 2 route files serve /api/dup'),
    ]);
  });

  it('validates the bindings file shape', () => {
    expect(() => parseBindings({})).toThrow(ManifestError);
    expect(() => parseBindings({ bindings: [{ method: 'FETCH', path: '/api/x' }] })).toThrow(/method must be one of/);
    expect(() => parseBindings({ bindings: [{ method: 'POST', path: 'api/x' }] })).toThrow(/starting with "\/"/);
    expect(() => parseBindings({ bindings: [post('/api/x'), post('/api/x')] })).toThrow(/duplicate binding POST \/api\/x/);
    expect(parseBindings({ bindings: [{ ...post('/api/x'), class: 'B' }] })).toHaveLength(1);
  });

  it('skips overlay roots and overlay files, so an overlay route can neither be listed nor bound', () => {
    const files = {
      'src/app/api/public/route.ts': 'export async function POST() {}',
      'src/app/api/overlay-root/route.ts': 'export async function POST() {}',
      'src/app/api/single/route.ts': 'export async function POST() {}',
      'src/app/api/overlay-root-sibling/route.ts': 'export async function POST() {}',
    };
    const overlay = { roots: ['src/app/api/overlay-root'], files: { 'src/app/api/single/route.ts': {} } };
    expect(skipOverlay(Object.keys(files), overlay)).toEqual([
      'src/app/api/public/route.ts',
      'src/app/api/overlay-root-sibling/route.ts',
    ]);
    const manifest = scan(files, [post('/api/public'), post('/api/overlay-root-sibling')], { overlay });
    expect(Object.keys(manifest.routes)).toEqual(['POST /api/overlay-root-sibling', 'POST /api/public']);
    expect(() => scan(files, [post('/api/overlay-root')], { overlay })).toThrow(/no tracked route file serves \/api\/overlay-root/);
    expect(() => scan(files, [post('/api/single')], { overlay })).toThrow(/no tracked route file serves/);
  });

  it('gives the same manifest with and without an overlay that only covers untracked files', () => {
    const files = { 'src/app/api/x/route.ts': 'export async function POST() {}' };
    const withOverlay = scan(files, [post('/api/x')], { overlay: { roots: ['src/app/api/elsewhere'], files: {} } });
    expect(withOverlay).toEqual(scan(files, [post('/api/x')]));
  });
});

// ── Test 2: declared guard == scanned guard ──────────────────────────────────────────────────────

describe('compareDeclaredGuards (plan 3.9 test 2, called by the assistant registry later)', () => {
  const manifest = {
    routes: {
      'POST /api/a': { guards: ['requireAnyAdmin'] },
      'POST /api/b': { guards: ['isSuperadmin', 'requireAdmin'] },
      'GET /api/c': { guards: [] },
    },
  };

  it('accepts equal guard sets (a string or an array, in any order)', () => {
    expect(
      compareDeclaredGuards(
        [
          { method: 'POST', path: '/api/a', guards: 'requireAnyAdmin' },
          { method: 'POST', path: '/api/b', guards: ['requireAdmin', 'isSuperadmin'] },
          { method: 'GET', path: '/api/c', guards: [] },
        ],
        manifest,
      ),
    ).toEqual([]);
  });

  it('reports a different, missing or extra guard, a route outside the manifest, and an unknown guard name', () => {
    const problems = compareDeclaredGuards(
      [
        { method: 'POST', path: '/api/a', guards: 'requireAdmin' },
        { method: 'POST', path: '/api/b', guards: 'requireAdmin' },
        { method: 'GET', path: '/api/c', guards: 'requireAuth' },
        { method: 'POST', path: '/api/nope', guards: 'requireAdmin' },
        { method: 'POST', path: '/api/a', guards: 'requireEverybody' },
      ],
      manifest,
    );
    expect(problems.map((p) => [p.key, p.kind])).toEqual([
      ['POST /api/a', 'guard_mismatch'],
      ['POST /api/b', 'guard_mismatch'],
      ['GET /api/c', 'guard_mismatch'],
      ['POST /api/nope', 'not_in_manifest'],
      ['POST /api/a', 'unknown_guard'],
    ]);
    expect(problems[0]).toMatchObject({ declared: ['requireAdmin'], scanned: ['requireAnyAdmin'] });
  });

  it('is exported from the CLI module as well, and the vocabulary matches plan 3.9', () => {
    expect(exportedCompare).toBe(compareDeclaredGuards);
    expect(GUARD_HELPERS).toEqual(
      expect.arrayContaining([
        'requireAuth',
        'requirePlayer',
        'requireAdmin',
        'requireSuperadmin',
        'requireAnyAdmin',
        'requireResourceAdmin',
        'requireDraftAdmin',
        'requireFormatOwner',
        'requireFormatViewer',
        'requireRulesetOwner',
        'requireRulesetViewer',
        'isSuperadmin',
      ]),
    );
  });
});

// ── Output ───────────────────────────────────────────────────────────────────────────────────────

describe('manifest text and diff', () => {
  const manifest = scan(
    {
      'src/app/api/x/route.ts': `
        import { requireAdmin } from '@/lib/auth/helpers';
        export async function POST() { await requireAdmin(); }
      `,
      'src/lib/auth/helpers.ts': 'export async function requireAdmin() {}',
    },
    [post('/api/x')],
  );

  it('formats deterministically and round-trips through JSON', () => {
    const text = formatManifest(manifest);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('\r');
    expect(JSON.parse(text)).toEqual(manifest);
    expect(formatManifest(JSON.parse(text))).toBe(text);
  });

  it('describes what changed per route, field and set member', () => {
    const changed = JSON.parse(JSON.stringify(manifest));
    changed.routes['POST /api/x'].guards = ['requireAnyAdmin'];
    changed.routes['POST /api/x'].audit = ['x.create'];
    changed.routes['POST /api/y'] = changed.routes['POST /api/x'];
    expect(diffManifests(changed, manifest)).toEqual([
      '~ POST /api/x',
      '    audit: - x.create',
      '    guards: - requireAnyAdmin  + requireAdmin',
      '- POST /api/y   (in the committed manifest, no longer bound)',
    ]);
    expect(diffManifests(manifest, changed)).toContain('+ POST /api/y   (bound route missing from the committed manifest)');
    expect(diffManifests(manifest, JSON.parse(JSON.stringify(manifest)))).toEqual([]);
  });
});

// ── CLI on a scratch git repository ──────────────────────────────────────────────────────────────

describe('CLI: --write / --check', () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  function project(files) {
    const root = mkdtempSync(join(tmpdir(), 'route-manifest-'));
    dirs.push(root);
    const put = (rel, content) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), content);
    };
    for (const [rel, content] of Object.entries(files)) put(rel, content);
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
    execFileSync('git', ['add', '-A', '--', '.'], { cwd: root });
    return { root, put };
  }
  const logger = () => {
    const out = [];
    return { out, log: (line) => out.push(line), error: (line) => out.push(line) };
  };

  const route = (guard) => `
    import { ${guard} } from '@/lib/auth/helpers';
    export async function POST() { await ${guard}(); }
  `;
  const helpers = 'export const requireAdmin = async () => {};\nexport const requireAnyAdmin = async () => {};\n';
  const files = () => ({
    'tsconfig.json': '{ /* comments are allowed */ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }',
    'scripts/data/route-manifest-bindings.json': JSON.stringify({ version: 1, bindings: [post('/api/x')] }),
    'src/app/api/x/route.ts': route('requireAdmin'),
    'src/lib/auth/helpers.ts': helpers,
    'src/app/api/overlay-only/route.ts': route('requireAdmin'),
  });

  it('writes, then checks clean; a changed guard makes --check exit 1 with the difference, --write fixes it', () => {
    const { root, put } = project(files());
    let io = logger();
    expect(main(['--check'], root, io)).toBe(1);
    expect(io.out.join('\n')).toContain('does not exist');

    io = logger();
    expect(main(['--write'], root, io)).toBe(0);
    io = logger();
    expect(main(['--check'], root, io)).toBe(0);

    put('src/app/api/x/route.ts', route('requireAnyAdmin'));
    io = logger();
    expect(main(['--check'], root, io)).toBe(1);
    const text = io.out.join('\n');
    expect(text).toContain('~ POST /api/x');
    expect(text).toContain('guards: - requireAdmin  + requireAnyAdmin');
    expect(text).toContain('route-manifest.mjs --write');

    expect(main(['--write'], root, logger())).toBe(0);
    expect(main(['--check'], root, logger())).toBe(0);
  });

  it('visits tracked files only: an untracked route file is neither scanned nor bound', () => {
    const { root, put } = project(files());
    put('src/app/api/untracked/route.ts', route('requireAdmin'));
    put('scripts/data/route-manifest-bindings.json', JSON.stringify({ version: 1, bindings: [post('/api/untracked')] }));
    const io = logger();
    expect(main(['--write'], root, io)).toBe(1);
    expect(io.out.join('\n')).toContain('no tracked route file serves /api/untracked');
  });

  it('refuses to write while an import leads to an untracked file, warns on --check, and is clean once the file is added', () => {
    const { root, put } = project(files());
    expect(main(['--write'], root, logger())).toBe(0);
    put('src/app/api/x/route.ts', `import { fresh } from '@/lib/fresh';
${route('requireAdmin')}
void fresh;
`);
    put('src/lib/fresh.ts', 'export const fresh = 1;\n');
    execFileSync('git', ['add', 'src/app/api/x/route.ts'], { cwd: root });

    let io = logger();
    expect(main(['--write'], root, io)).toBe(1);
    expect(io.out.join('\n')).toContain('src/lib/fresh.ts');
    expect(io.out.join('\n')).toContain('git add');

    io = logger();
    expect(main(['--check'], root, io)).toBe(1); // the route's own import list changed (stale), plus the warning
    expect(io.out.join('\n')).toContain('warning');
    expect(io.out.join('\n')).toContain('src/lib/fresh.ts');

    execFileSync('git', ['add', 'src/lib/fresh.ts'], { cwd: root });
    expect(main(['--write'], root, logger())).toBe(0);
    io = logger();
    expect(main(['--check', '--strict'], root, io)).toBe(0);
    expect(io.out.join('\n')).not.toContain('warning');
  });

  it('--check passes with a warning for a matching manifest that scans an untracked import, and fails with --strict', () => {
    const { root, put } = project(files());
    put('src/lib/auth/helpers.ts', `import { fresh } from './fresh';
${helpers}export const f = fresh;
`);
    put('src/lib/auth/fresh.ts', 'export const fresh = 1;\n');
    execFileSync('git', ['add', 'src/lib/auth/helpers.ts'], { cwd: root });
    // The manifest is generated by the scanner itself (not --write, which refuses), as a stale-by-construction copy.
    writeFileSync(join(root, MANIFEST_PATH), formatManifest(generateManifest({ root })));
    let io = logger();
    expect(main(['--check'], root, io)).toBe(0);
    expect(io.out.join('\n')).toContain('warning');
    io = logger();
    expect(main(['--check', '--strict'], root, io)).toBe(1);
  });

  it('uses the same manifest with or without .overlay-manifest.json, and lists no overlay route', () => {
    const { root, put } = project(files());
    expect(main(['--write'], root, logger())).toBe(0);
    const without = readFileSync(join(root, MANIFEST_PATH), 'utf8');

    put('.overlay-manifest.json', JSON.stringify({ version: 2, roots: ['src/app/api/overlay-only'], files: {} }));
    expect(loadOverlay(root)).toEqual({ roots: ['src/app/api/overlay-only'], files: {} });
    expect(main(['--check'], root, logger())).toBe(0);
    expect(main(['--write'], root, logger())).toBe(0);
    expect(readFileSync(join(root, MANIFEST_PATH), 'utf8')).toBe(without);
    // Binding the overlay route is refused while the overlay hides it, even though git tracks the file here.
    put('scripts/data/route-manifest-bindings.json', JSON.stringify({ version: 1, bindings: [post('/api/overlay-only')] }));
    const io = logger();
    expect(main(['--write'], root, io)).toBe(1);
    expect(io.out.join('\n')).toContain('no tracked route file serves /api/overlay-only');
  });

  it('prints usage for no mode, and reads tsconfig paths with comments', () => {
    const { root } = project(files());
    const io = logger();
    expect(main([], root, io)).toBe(2);
    expect(io.out.join('\n')).toContain('usage:');
    expect(loadPathAliases(root)).toEqual([{ pattern: '@/*', targets: ['src/*'] }]);
    expect(listTrackedFiles(root)).toContain('src/app/api/x/route.ts');
  });
});

// ── The repository itself (plan 3.9 test 1) ──────────────────────────────────────────────────────

describe('committed route manifest', () => {
  it('matches the tracked route files (regenerate with `node scripts/route-manifest.mjs --write` and review the diff)', () => {
    const result = checkManifest();
    expect(result.diff.join('\n')).toBe('');
    expect(result.ok).toBe(true);
  });

  it('lists every binding, each backed by a tracked route file and a guard', () => {
    const bindings = parseBindings(JSON.parse(readFileSync(join(REPO_ROOT, BINDINGS_PATH), 'utf8')));
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST_PATH), 'utf8'));
    const tracked = new Set(listTrackedFiles());
    expect(Object.keys(manifest.routes).sort()).toEqual(bindings.map((b) => `${b.method} ${b.path}`).sort());
    for (const [key, route] of Object.entries(manifest.routes)) {
      expect(tracked.has(route.file), `${key}: ${route.file} is not tracked`).toBe(true);
      expect(route.guards.length, `${key} is bound but scans no guard helper`).toBeGreaterThan(0);
    }
  });

  it('names no route under an overlay root (the overlay manifest is gitignored; CI has none)', () => {
    const overlay = loadOverlay();
    if (!overlay) return;
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST_PATH), 'utf8'));
    for (const route of Object.values(manifest.routes)) {
      const reachable = [route.file, ...Object.keys(route.imports)];
      for (const file of reachable) {
        expect(overlay.roots.some((root) => file === root || file.startsWith(`${root}/`)), file).toBe(false);
      }
    }
  });
});
