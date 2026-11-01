import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { assertLoopbackUrl } from '../src/test/local-stack';
import { localStack } from './support/stack';

const ROOT = path.resolve(__dirname, '..');

/** Runs once before the suite: local stack only, a build to serve, and the seeded league the specs read. */
export default async function globalSetup(): Promise<void> {
  const { url, anonKey } = localStack();
  assertLoopbackUrl(url, 'NEXT_PUBLIC_SUPABASE_URL');

  if (!existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
    throw new Error('[e2e] no production build found. Run `npm run build:e2e` first (CONTRIBUTING.md, "End-to-end tests").');
  }

  const health = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey } }).catch(() => null);
  if (!health?.ok) {
    throw new Error(`[e2e] the local Supabase stack does not answer at ${url}. Run \`npx supabase start\` first.`);
  }

  // Idempotent: a seeded stack is left as it is. The seed refuses anything but the loopback interface itself.
  const seed = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'dev-seed.mjs')], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  if (seed.status !== 0) {
    throw new Error(`[e2e] npm run dev:seed failed:\n${seed.stdout}\n${seed.stderr}`);
  }
}
