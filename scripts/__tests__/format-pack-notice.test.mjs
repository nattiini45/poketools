/**
 * The example-pack production warning (scripts/format-pack-notice.mjs) and its wiring in
 * next.config.mjs. The wiring cases load a copy of next.config.mjs in a scratch folder that holds
 * only the example pack's entry files, so they behave the same on a public checkout and on a
 * maintainer checkout that carries the private pack.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { examplePackProductionWarning } from '../format-pack-notice.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('examplePackProductionWarning', () => {
  it('warns for a production build that fell back to the example pack', () => {
    const text = examplePackProductionWarning({ pack: 'example', formatPackEnv: undefined, nodeEnv: 'production' });
    expect(text).toContain('[format-pack] WARNING');
    expect(text).toContain('FORMAT_PACK=private');
    expect(text).toContain('FORMAT_PACK=example');
    expect(text).toContain('docs/format-packs.md');
    // Every line carries the tag, so a log filter on "[format-pack]" keeps the whole warning.
    for (const line of text.split('\n')) expect(line.startsWith('[format-pack] ')).toBe(true);
  });

  it('treats an empty or blank FORMAT_PACK as unset', () => {
    for (const formatPackEnv of ['', '   ']) {
      expect(examplePackProductionWarning({ pack: 'example', formatPackEnv, nodeEnv: 'production' })).not.toBeNull();
    }
  });

  it('stays quiet when FORMAT_PACK=example acknowledges the example pack (CI)', () => {
    expect(examplePackProductionWarning({ pack: 'example', formatPackEnv: 'example', nodeEnv: 'production' })).toBeNull();
    expect(examplePackProductionWarning({ pack: 'example', formatPackEnv: ' example ', nodeEnv: 'production' })).toBeNull();
  });

  it('stays quiet outside production (next dev, tests)', () => {
    for (const nodeEnv of ['development', 'test', undefined]) {
      expect(examplePackProductionWarning({ pack: 'example', formatPackEnv: undefined, nodeEnv })).toBeNull();
    }
  });

  it('stays quiet when the private pack is active', () => {
    expect(examplePackProductionWarning({ pack: 'private', formatPackEnv: undefined, nodeEnv: 'production' })).toBeNull();
    expect(examplePackProductionWarning({ pack: 'private', formatPackEnv: 'private', nodeEnv: 'production' })).toBeNull();
  });
});

describe('next.config.mjs prints the warning', () => {
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'format-pack-notice-'));
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(join(REPO_ROOT, 'next.config.mjs'), join(dir, 'next.config.mjs'));
    copyFileSync(join(REPO_ROOT, 'scripts', 'format-pack-notice.mjs'), join(dir, 'scripts', 'format-pack-notice.mjs'));
    // next.config.mjs only checks that the entry files exist; their content is never loaded here.
    mkdirSync(join(dir, 'src', 'format-packs', 'example', 'extensions'), { recursive: true });
    writeFileSync(join(dir, 'src', 'format-packs', 'example', 'index.ts'), 'export default {};\n');
    writeFileSync(join(dir, 'src', 'format-packs', 'example', 'extensions', 'index.ts'), 'export default {};\n');
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** Loads the copied config in a fresh node process with exactly the given env additions. */
  function loadConfig(env) {
    const base = { ...process.env };
    delete base.FORMAT_PACK;
    delete base.NODE_ENV;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./next.config.mjs');"], {
      cwd: dir,
      env: { ...base, ...env },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    return result;
  }

  it('warns on a production build without a private pack and without FORMAT_PACK', () => {
    const { stdout, stderr } = loadConfig({ NODE_ENV: 'production' });
    expect(stdout).toContain('[format-pack] using example pack');
    expect(stderr).toContain('[format-pack] WARNING: this production build uses the example format pack');
  });

  it('does not warn when FORMAT_PACK=example is set', () => {
    const { stdout, stderr } = loadConfig({ NODE_ENV: 'production', FORMAT_PACK: 'example' });
    expect(stdout).toContain('[format-pack] using example pack');
    expect(stderr).not.toContain('WARNING');
  });

  it('does not warn under next dev', () => {
    const { stderr } = loadConfig({ NODE_ENV: 'development' });
    expect(stderr).not.toContain('WARNING');
  });

  it('still fails a FORMAT_PACK=private build without the private pack, before any warning', () => {
    const base = { ...process.env };
    delete base.NODE_ENV;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./next.config.mjs');"], {
      cwd: dir,
      env: { ...base, NODE_ENV: 'production', FORMAT_PACK: 'private' },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('FORMAT_PACK=private but src/format-packs/private/index.ts is missing');
    expect(result.stderr).not.toContain('WARNING');
  });
});
