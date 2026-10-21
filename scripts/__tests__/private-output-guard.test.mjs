/**
 * private-output-guard.mjs: the private workbook dumps may write outside the repository or
 * into a git-ignored folder, never over a tracked file — whatever the working directory,
 * letter case or Windows trailing-dot spelling. Uses the real repository and git.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, checkPrivateOutput } from '../lib/private-output-guard.mjs';

const EPB = 'src/lib/draft/__tests__/fixtures/example-list.json';
const PREVIEW = 'src/app/(public)/draft-preview/fixture-lines.example.json';
// .gitignore: scripts/world-assets/.cache/ and "EvoLiga Point Buy/"
const IGNORED = 'scripts/world-assets/.cache/private-output-guard-test.json';
const isWin = process.platform === 'win32';

describe('checkPrivateOutput', () => {
  it('allows a target outside the repository', () => {
    const result = checkPrivateOutput(join(tmpdir(), 'epb-private.json'), { cwd: REPO_ROOT });
    expect(result.ok).toBe(true);
  });

  it('allows a git-ignored path inside the repository', () => {
    expect(checkPrivateOutput(IGNORED, { cwd: REPO_ROOT }).ok).toBe(true);
    expect(checkPrivateOutput('EvoLiga Point Buy/dump.json', { cwd: REPO_ROOT }).ok).toBe(true);
  });

  it('refuses both tracked fixtures and other tracked files', () => {
    for (const target of [EPB, PREVIEW, 'package.json', 'src/app/layout.tsx']) {
      const result = checkPrivateOutput(target, { cwd: REPO_ROOT });
      expect(result.ok, target).toBe(false);
    }
  });

  it('refuses an untracked, non-ignored path inside the repository and the root itself', () => {
    expect(checkPrivateOutput('scripts/draft/private-dump.json', { cwd: REPO_ROOT }).ok).toBe(false);
    expect(checkPrivateOutput('.', { cwd: REPO_ROOT }).ok).toBe(false);
  });

  it('refuses a tracked fixture given relative to a different working directory', () => {
    expect(checkPrivateOutput(`../${PREVIEW}`, { cwd: join(REPO_ROOT, 'scripts') }).ok).toBe(false);
    expect(checkPrivateOutput('lib/draft/__tests__/fixtures/example-list.json', { cwd: join(REPO_ROOT, 'src') }).ok).toBe(false);
    expect(checkPrivateOutput(join(REPO_ROOT, EPB), { cwd: tmpdir() }).ok).toBe(false);
  });

  it('refuses ignored paths that are web-served or used for configuration', () => {
    for (const target of ['public/avatar/dump.json', '.env', '.env.local', '.next/static/x.json']) {
      const result = checkPrivateOutput(target, { cwd: REPO_ROOT, isIgnored: () => true });
      expect(result.ok, target).toBe(false);
      // and with the real git answer, which reports each of these as ignored
      expect(checkPrivateOutput(target, { cwd: REPO_ROOT }).ok, target).toBe(false);
    }
  });

  it('still allows an ignored folder that is neither served nor configuration', () => {
    expect(checkPrivateOutput(IGNORED, { cwd: REPO_ROOT, isIgnored: () => true }).ok).toBe(true);
  });

  it.runIf(isWin || process.platform === 'darwin')('refuses letter-case variants of served paths (win32, darwin)', () => {
    for (const target of ['Public/avatar/dump.json', '.NEXT/static/x.json', '.ENV.local']) {
      expect(checkPrivateOutput(target, { cwd: REPO_ROOT, isIgnored: () => true }).ok, target).toBe(false);
    }
  });

  it('refuses when git cannot answer', () => {
    expect(checkPrivateOutput(IGNORED, { cwd: REPO_ROOT, isIgnored: () => null }).ok).toBe(false);
  });

  it.runIf(isWin)('refuses a letter-case variant of a tracked fixture (win32)', () => {
    expect(checkPrivateOutput('src/lib/draft/__tests__/fixtures/EPB-List-v1.json', { cwd: REPO_ROOT }).ok).toBe(false);
    expect(checkPrivateOutput(join(REPO_ROOT.toUpperCase(), EPB), { cwd: tmpdir() }).ok).toBe(false);
  });

  it.runIf(isWin)('refuses trailing-dot, trailing-space and data-stream spellings (win32)', () => {
    for (const target of [`${EPB}.`, `${EPB}. .`, `${EPB} `, `src/lib/draft./__tests__/fixtures/example-list.json`, `${EPB}::$DATA`]) {
      expect(checkPrivateOutput(target, { cwd: REPO_ROOT }).ok, target).toBe(false);
    }
  });

  it.runIf(isWin)('refuses UNC and device spellings of a tracked fixture (win32)', () => {
    const drive = REPO_ROOT.slice(0, 1);
    const rest = join(REPO_ROOT.slice(3), EPB);
    for (const target of [
      `\\\\localhost\\${drive}$\\${rest}`,
      `\\\\?\\UNC\\localhost\\${drive}$\\${rest}`,
      `\\\\?\\${join(REPO_ROOT, EPB)}`,
      `\\\\.\\${join(REPO_ROOT, EPB)}`,
    ]) {
      expect(checkPrivateOutput(target, { cwd: tmpdir() }).ok, target).toBe(false);
    }
  });
});
