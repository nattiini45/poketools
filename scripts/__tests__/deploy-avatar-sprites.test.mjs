/**
 * deploy-avatar-sprites.mjs: the source is scanned and validated before anything is deleted,
 * so a wrong AVATAR_SPRITES_SRC (missing, a file, empty, no gender folder, or overlapping the
 * destination) leaves the destination and the manifest untouched. Temp dirs only: the real
 * public/avatar/ and src/lib/avatar/manifest-data.json are never touched. Importing the
 * module must not run the CLI.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeployRefused, deploySprites, scanSprites, validateDeployPaths } from '../deploy-avatar-sprites.mjs';

let dirs = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'avatar-deploy-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function put(path, content = 'PNG') {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

/** A sandbox: source with sprites, an existing destination file and an existing manifest. */
function sandbox() {
  const base = tmp();
  const src = join(base, 'src');
  const dest = join(base, 'dest');
  const manifestPath = join(base, 'manifest-data.json');
  put(join(src, 'trainer front female', 'base', 'base light.png'));
  put(join(src, 'trainer front male', 'tops', 'hoodie', 'hoodie blue.png'));
  put(join(dest, 'keep.png'), 'OLD');
  writeFileSync(manifestPath, '{"old":true}');
  return { base, src, dest, manifestPath };
}

function untouched({ dest, manifestPath }) {
  expect(readFileSync(join(dest, 'keep.png'), 'utf8')).toBe('OLD');
  expect(readFileSync(manifestPath, 'utf8')).toBe('{"old":true}');
}

describe('deploySprites', () => {
  it('copies sprites and writes the manifest for a valid source', async () => {
    const box = sandbox();
    const result = await deploySprites({ srcDir: box.src, destDir: box.dest, manifestPath: box.manifestPath });
    expect(result.totalCopied).toBe(2);
    expect(existsSync(join(box.dest, 'keep.png'))).toBe(false);
    expect(existsSync(join(box.dest, 'female', 'base', 'default-light.png'))).toBe(true);
    expect(existsSync(join(box.dest, 'male', 'tops', 'hoodie-blue.png'))).toBe(true);
    const manifest = JSON.parse(readFileSync(box.manifestPath, 'utf8'));
    expect(manifest.male.tops.hoodie[0]).toMatchObject({ color: 'blue', optionId: 'male-tops-hoodie-blue' });
  });

  it('refuses a missing source without touching anything', async () => {
    const box = sandbox();
    await expect(deploySprites({ srcDir: join(box.base, 'nope'), destDir: box.dest, manifestPath: box.manifestPath })).rejects.toBeInstanceOf(DeployRefused);
    untouched(box);
  });

  it('refuses a file as the source', async () => {
    const box = sandbox();
    const file = join(box.base, 'file.png');
    writeFileSync(file, 'x');
    await expect(deploySprites({ srcDir: file, destDir: box.dest, manifestPath: box.manifestPath })).rejects.toBeInstanceOf(DeployRefused);
    untouched(box);
  });

  it('refuses a source with no gender folder', async () => {
    const box = sandbox();
    const other = join(box.base, 'other');
    put(join(other, 'misc', 'a.png'));
    await expect(deploySprites({ srcDir: other, destDir: box.dest, manifestPath: box.manifestPath })).rejects.toThrow(/gender folder/);
    untouched(box);
  });

  it('refuses a source whose gender folders hold no sprites', async () => {
    const box = sandbox();
    const empty = join(box.base, 'empty');
    mkdirSync(join(empty, 'trainer front female'), { recursive: true });
    await expect(deploySprites({ srcDir: empty, destDir: box.dest, manifestPath: box.manifestPath })).rejects.toThrow(/No PNG sprites/);
    untouched(box);
  });

  it('refuses a source equal to, inside, or containing the destination', async () => {
    const box = sandbox();
    put(join(box.dest, 'trainer front female', 'base', 'base dark.png'));
    for (const srcDir of [box.dest, join(box.dest, 'trainer front female'), box.base]) {
      await expect(deploySprites({ srcDir, destDir: box.dest, manifestPath: box.manifestPath }), srcDir).rejects.toThrow(/overlap/);
    }
    untouched(box);
  });
});

describe('validateDeployPaths / scanSprites', () => {
  it('allows separate folders and rejects overlaps', () => {
    expect(() => validateDeployPaths('/a/src', '/a/dest')).not.toThrow();
    expect(() => validateDeployPaths('/a/dest', '/a/dest')).toThrow(DeployRefused);
    expect(() => validateDeployPaths('/a/dest/x', '/a/dest')).toThrow(DeployRefused);
    expect(() => validateDeployPaths('/a', '/a/dest')).toThrow(DeployRefused);
    expect(() => validateDeployPaths('/a/destination', '/a/dest')).not.toThrow();
  });

  it.runIf(process.platform === 'win32')('compares case-insensitively on win32', () => {
    expect(() => validateDeployPaths('C:\\A\\Dest', 'c:\\a\\dest')).toThrow(DeployRefused);
  });

  it('refuses a junction or symlink source that points at the destination', async (ctx) => {
    const box = sandbox();
    put(join(box.dest, 'trainer front female', 'base', 'base dark.png'));
    const link = join(box.base, 'linked-src');
    try {
      symlinkSync(box.dest, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      ctx.skip();
      return;
    }
    expect(() => validateDeployPaths(link, box.dest)).toThrow(DeployRefused);
    expect(() => validateDeployPaths(join(link, 'trainer front female'), box.dest)).toThrow(DeployRefused);
    await expect(deploySprites({ srcDir: link, destDir: box.dest, manifestPath: box.manifestPath })).rejects.toThrow(/overlap/);
    untouched(box);
  });

  it.runIf(process.platform === 'win32' || process.platform === 'darwin')('refuses a letter-case variant of the destination (win32, darwin)', () => {
    const box = sandbox();
    expect(() => validateDeployPaths(join(box.base, 'DEST'), box.dest)).toThrow(DeployRefused);
    expect(() => validateDeployPaths(join(box.base, 'Dest', 'x'), box.dest)).toThrow(DeployRefused);
    untouched(box);
  });

  it('builds the plan without writing anything', async () => {
    const box = sandbox();
    const plan = await scanSprites(box.src);
    expect(plan.copies).toHaveLength(2);
    expect(plan.counts).toEqual({ female: 1, male: 1 });
    untouched(box);
  });
});
