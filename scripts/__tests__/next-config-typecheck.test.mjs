/**
 * next.config.mjs skips the build's own type-check only for the explicit CI_SKIP_BUILD_TYPECHECK=1
 * (set on the CI build step, which type-checks once through `typecheck:example`). It must never
 * key off `CI`: Vercel sets `CI` too, and a production build there has to keep its type gate.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `typescript.ignoreBuildErrors` of the config evaluated in a fresh node process with exactly this env. */
function ignoreBuildErrors(env) {
  const base = { ...process.env, FORMAT_PACK: 'example' };
  delete base.CI;
  delete base.CI_SKIP_BUILD_TYPECHECK;
  const script =
    "const { default: config } = await import('./next.config.mjs');" +
    "process.stdout.write('RESULT=' + JSON.stringify(config.typescript?.ignoreBuildErrors ?? null));";
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: REPO_ROOT,
    env: { ...base, ...env },
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(/RESULT=(.*)$/m.exec(result.stdout)[1]);
}

describe('next.config.mjs typescript.ignoreBuildErrors', () => {
  it('is false by default', () => {
    expect(ignoreBuildErrors({})).toBe(false);
  });

  it('stays false when only CI is set (Vercel sets it too)', () => {
    expect(ignoreBuildErrors({ CI: 'true' })).toBe(false);
    expect(ignoreBuildErrors({ CI: '1' })).toBe(false);
  });

  it('is true only for CI_SKIP_BUILD_TYPECHECK=1', () => {
    expect(ignoreBuildErrors({ CI_SKIP_BUILD_TYPECHECK: '1' })).toBe(true);
    expect(ignoreBuildErrors({ CI_SKIP_BUILD_TYPECHECK: 'true' })).toBe(false);
    expect(ignoreBuildErrors({ CI_SKIP_BUILD_TYPECHECK: '0' })).toBe(false);
    expect(ignoreBuildErrors({ CI: 'true', CI_SKIP_BUILD_TYPECHECK: '' })).toBe(false);
  });
});
