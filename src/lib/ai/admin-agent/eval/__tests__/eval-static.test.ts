import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structure rules of the eval harness (plan 7.2): it never opens a connection of its own, never reads the process
 * environment (the entry passes it in), never imports the service-role client or a private format pack, and runs under a
 * tsconfig that cannot resolve the private pack. They read the source, so a later edit that breaks a rule fails here.
 */
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../../../../..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') out.push(...sources(full));
    } else if (/\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const files = sources(ROOT);
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const read = (file: string) => readFileSync(file, 'utf8');
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Value imports from the app's own modules, the whole list: nothing that reaches a database or a route. */
const ALLOWED_APP_IMPORTS = new Set([
  '@/lib/pkmn/dex',
  '@/lib/pkmn/ruleset-preset-catalog',
  // Types only (erased at build): the error catalog's code type.
  '@/i18n/messages/errors',
]);

describe('eval/ structure', () => {
  it('finds the harness files', () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
    expect(files.map(rel)).toEqual(expect.arrayContaining(['runner.ts', 'grader.ts', 'host-guard.ts', 'cli.ts', 'fixture-tools.ts', 'world.ts', 'stubs/auth.ts']));
  });

  it('opens no connection of its own: no fetch call, no http or socket module, no websocket', () => {
    for (const file of files) {
      const text = code(file);
      expect(text.replace(/target\.fetch|holder\.fetch|globalThis\.fetch|\(\s*\{\s*fetch\s*:/g, ''), rel(file)).not.toMatch(/\bfetch\s*\(/);
      expect(text, rel(file)).not.toMatch(/from 'node:(?:http|https|net|tls|dgram|http2)'|from '(?:http|https|net|tls)'|XMLHttpRequest|new WebSocket/);
    }
  });

  it('wraps fetch in host-guard.ts alone', () => {
    const wrappers = files.filter((file) => /\.fetch\s*=/.test(code(file))).map(rel);
    expect(wrappers).toEqual(['host-guard.ts']);
  });

  it('reads no process environment: the entry injects it', () => {
    expect(files.filter((file) => /process\.env/.test(code(file))).map(rel)).toEqual([]);
  });

  it('imports no database client, no Supabase SDK, no route, no executor and no private pack', () => {
    for (const file of files) {
      const text = code(file);
      // Import specifiers only: a message may say "executor" without importing one.
      const specifiers = [...text.matchAll(/(?:from|import\()\s*'([^']+)'/g)].map((m) => m[1]);
      for (const specifier of specifiers) {
        expect(specifier, `${rel(file)}: ${specifier}`).not.toMatch(/@\/lib\/supabase|@supabase\/|@\/app\/|_ops|executor|format-packs\/private|@format-pack|@pack-extensions|session-override/);
      }
      expect(text, rel(file)).not.toMatch(/admin_agent_|\.from\(\s*['"`]|\.rpc\(/);
      expect(text, rel(file)).not.toMatch(/runAsVerifiedSession/);
    }
  });

  it('imports from the app only the pure modules on the list', () => {
    const imported = new Set<string>();
    for (const file of files) {
      for (const match of read(file).matchAll(/^import (?!type)[^;]*?from '(@\/[^']+)'/gm)) imported.add(match[1]);
    }
    expect([...imported].filter((specifier) => !ALLOWED_APP_IMPORTS.has(specifier))).toEqual([]);
  });

  it('keeps the model-facing registry out of the harness except through its public entry', () => {
    for (const file of files) {
      for (const match of read(file).matchAll(/from '(\.\.\/(?:registry|readers|previews|proposals|dispatch|store|loop|plans)[^']*)'/g)) {
        const specifier = match[1];
        // The harness may use the public pieces; it may not reach into a module's internals that execute or persist.
        expect(specifier, `${rel(file)}: ${specifier}`).not.toMatch(/\/(?:invoke|executor|index\.bound)$|store\/index$|proposals\//);
      }
    }
  });

  it('uses no `any`', () => {
    for (const file of files) expect(code(file), rel(file)).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
  });

  it('names no deployment fact, private pack or real person in code or comments (public-repo hygiene)', () => {
    // A hosted project reference looks like 20 lowercase letters before .supabase.co; the guards name the domain, never a project.
    const banned = [/evoliga/i, /plc/i, /vercel/i, /[a-z0-9]{20}\.supabase\.co/i, /format-packs\/private/i, /\.internal\//i, /poketools\.(app|dev|com)/i];
    for (const file of files) {
      const text = read(file);
      for (const pattern of banned) expect(text, `${rel(file)} ${String(pattern)}`).not.toMatch(pattern);
    }
  });
});

describe('the eval entry and its tsconfig', () => {
  const tsconfig = JSON.parse(readFileSync(path.join(REPO, 'scripts/tsconfig.admin-agent-eval.json'), 'utf8')) as {
    extends: string;
    compilerOptions: { paths: Record<string, string[]> };
    include: string[];
  };
  const paths = tsconfig.compilerOptions.paths;

  it('pins both pack aliases to the public example pack and lists no private path anywhere', () => {
    expect(paths['@format-pack']).toEqual(['../src/format-packs/example']);
    expect(paths['@pack-extensions']).toEqual(['../src/format-packs/example/extensions']);
    expect(JSON.stringify({ paths, include: tsconfig.include, extends: tsconfig.extends })).not.toMatch(/private/);
    expect(existsSync(path.join(REPO, 'scripts', paths['@format-pack'][0]))).toBe(true);
  });

  it('maps server-only, next/cache and the auth module to stubs that exist', () => {
    for (const alias of ['server-only', 'next/cache', '@/auth']) {
      expect(paths[alias], alias).toHaveLength(1);
      expect(existsSync(path.join(REPO, 'scripts', paths[alias][0])), `${alias} -> ${paths[alias][0]}`).toBe(true);
    }
    // The specific alias must come before the wildcard that would otherwise swallow it.
    const order = Object.keys(paths);
    expect(order.indexOf('@/auth')).toBeLessThan(order.indexOf('@/*'));
  });

  it('extends the root config and compiles only the entry', () => {
    expect(tsconfig.extends).toBe('../tsconfig.json');
    expect(tsconfig.include).toEqual(['./admin-agent-eval.ts']);
  });

  it('has a script entry that sets the environment before anything that builds a client is imported', () => {
    const entry = read(path.join(REPO, 'scripts/admin-agent-eval.ts'));
    expect(entry.indexOf('prepareEvalEnv(process.env)')).toBeGreaterThan(0);
    expect(entry.indexOf('prepareEvalEnv(process.env)')).toBeLessThan(entry.indexOf("import('../src/lib/ai/admin-agent/eval/cli')"));
    const entryCode = entry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(entryCode).not.toMatch(/^import /m);
    expect(entryCode).not.toMatch(/dotenv|readFileSync|\.env\.local|'\.env'/);
  });
});
