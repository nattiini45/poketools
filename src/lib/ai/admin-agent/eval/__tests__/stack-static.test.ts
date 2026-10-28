import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structure rules of the local-stack stages (plan 7.2): the code that touches the local database, the routes and the executor lives in
 * `scripts/admin-agent-eval/` (the harness under `src/` stays a leaf with no client of its own), reads no env file, names no hosted
 * project, and the tsconfig the run uses maps every outward sender to a recorder. They read the source, so a later edit that breaks
 * a rule fails here.
 */
const REPO = path.resolve(__dirname, '../../../../../..');
const SCRIPTS = path.join(REPO, 'scripts/admin-agent-eval');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const files = readdirSync(SCRIPTS).filter((name) => name.endsWith('.ts')).map((name) => path.join(SCRIPTS, name));
const read = (file: string): string => readFileSync(file, 'utf8');

describe('scripts/admin-agent-eval', () => {
  it('holds the stack harness files', () => {
    expect(files.map((f) => path.basename(f)).sort()).toEqual(['baseline.ts', 'faults.ts', 'routes.ts', 'stack-env.ts', 'stack.ts']);
  });

  it('reads no env file and no process environment except to set the stage\'s own variable', () => {
    for (const file of files) {
      const code = strip(read(file));
      expect(code, path.basename(file)).not.toMatch(/dotenv|readFileSync|\.env(\.local)?['"`]|loadEnvFile/);
    }
    const envReaders = files.filter((file) => /process\.env/.test(strip(read(file)))).map((file) => path.basename(file));
    // Only `stack.ts` touches it, to set the phase cap per case; `stack-env.ts` is handed the environment by the entry.
    expect(envReaders).toEqual(['stack.ts']);
    expect(strip(read(path.join(SCRIPTS, 'stack.ts'))).match(/process\.env[^;]*/g)).toEqual(["process.env.ADMIN_AGENT_MAX_PHASE = String(testCase.phase)"]);
  });

  it('names no hosted project and no deployment', () => {
    for (const file of files) {
      const text = read(file);
      expect(text, path.basename(file)).not.toMatch(/[a-z0-9]{20}\.supabase\.co|vercel|evoliga|\.internal\/|format-packs\/private|@format-pack/i);
    }
  });

  it('runs a fixed shell command and no user input reaches a shell', () => {
    const code = strip(read(path.join(SCRIPTS, 'stack-env.ts')));
    expect(code).toMatch(/spawnSync\(STATUS_COMMAND, \{ shell: true/);
    expect(code).toContain("const STATUS_COMMAND = 'npx supabase status -o json';");
    for (const file of files.filter((f) => path.basename(f) !== 'stack-env.ts')) expect(strip(read(file)), path.basename(file)).not.toMatch(/child_process|\bspawn|\bexecSync|\bexecFile/);
  });

  it('goes to the database only through the service-role client of the app and never builds its own', () => {
    for (const file of files) {
      const code = strip(read(file));
      expect(code, path.basename(file)).not.toMatch(/createClient|@supabase\/supabase-js|\bfetch\s*\(/);
    }
  });
});

describe('the run tsconfig', () => {
  const tsconfig = JSON.parse(read(path.join(REPO, 'scripts/tsconfig.admin-agent-eval.json'))) as { compilerOptions: { paths: Record<string, string[]> } };
  const paths = tsconfig.compilerOptions.paths;

  it('maps the Discord sender, the social sender and next/cache to recorders that exist', () => {
    for (const alias of ['@/lib/discord/notify', '@/lib/social/notify', 'next/cache', '@/auth']) {
      expect(paths[alias], alias).toHaveLength(1);
      expect(paths[alias][0], alias).toMatch(/src\/lib\/ai\/admin-agent\/eval\/stubs\//);
      expect(existsSync(path.join(REPO, 'scripts', paths[alias][0])), alias).toBe(true);
    }
  });

  it('lists each specific alias before the wildcard that would swallow it', () => {
    const order = Object.keys(paths);
    for (const alias of ['@/auth', '@/lib/discord/notify', '@/lib/social/notify']) expect(order.indexOf(alias), alias).toBeLessThan(order.indexOf('@/*'));
  });
});

describe('the entry', () => {
  const entry = strip(read(path.join(REPO, 'scripts/admin-agent-eval.ts')));

  it('prepares the stack environment, then the generic one, before the CLI is imported, and imports the stack harness after', () => {
    const stackEnv = entry.indexOf('prepareStackEnv(process.env)');
    const generic = entry.indexOf('prepareEvalEnv(process.env)');
    const cli = entry.indexOf("import('../src/lib/ai/admin-agent/eval/cli')");
    const harness = entry.indexOf("import('./admin-agent-eval/stack')");
    expect(stackEnv).toBeGreaterThan(0);
    expect(stackEnv).toBeLessThan(generic);
    expect(generic).toBeLessThan(cli);
    expect(cli).toBeLessThan(harness);
  });

  it('skips the stack for --help and --list, and for the plan stage', () => {
    expect(entry).toMatch(/const needsStack = onStack && !argv\.includes\('--help'\) && !argv\.includes\('-h'\) && !argv\.includes\('--list'\);/);
    expect(entry).toMatch(/const onStack = stage === 'exec' \|\| stage === 'e2e';/);
  });
});
