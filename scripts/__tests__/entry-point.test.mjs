/**
 * lib/entry-point.mjs: a script runs only when node started it directly, and a realpath failure
 * other than "argv[1] does not exist" throws instead of turning the run into a silent exit 0.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { isEntryPoint } from '../lib/entry-point.mjs';

const SELF_URL = import.meta.url;
const SELF = fileURLToPath(SELF_URL);
const identity = (p) => p;

/** @type {string[]} */
const dirs = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(/** @type {string} */ (dirs.pop()), { recursive: true, force: true });
});

function errno(code) {
  return Object.assign(new Error(`${code}: realpath`), { code });
}

describe('isEntryPoint', () => {
  it('is false without argv[1] and for another file', () => {
    expect(isEntryPoint(SELF_URL, undefined)).toBe(false);
    expect(isEntryPoint(SELF_URL, '')).toBe(false);
    expect(isEntryPoint(SELF_URL, join(SELF, '..', 'db-types.test.mjs'))).toBe(false);
  });

  it('is true for this file, and on Windows case-insensitively', () => {
    expect(isEntryPoint(SELF_URL, SELF)).toBe(true);
    expect(isEntryPoint(SELF_URL, SELF.toUpperCase(), { realpath: identity, platform: 'win32' })).toBe(true);
    expect(isEntryPoint(SELF_URL, SELF.toUpperCase(), { realpath: identity, platform: 'linux' })).toBe(SELF === SELF.toUpperCase());
  });

  it('is false when argv[1] does not exist (ENOENT)', () => {
    expect(isEntryPoint(SELF_URL, join(SELF, '..', 'no-such-script.mjs'))).toBe(false);
  });

  it('throws any other realpath failure instead of reporting "not the entry point"', () => {
    const realpath = (p) => {
      if (p === SELF) return p;
      throw errno('EACCES');
    };
    expect(() => isEntryPoint(SELF_URL, 'elsewhere.mjs', { realpath })).toThrow('EACCES');
    expect(() =>
      isEntryPoint(SELF_URL, SELF, {
        realpath: () => {
          throw errno('EIO');
        },
      })
    ).toThrow('EIO');
  });

  it('a module using it runs its main only when node starts it directly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'entry-point-'));
    dirs.push(dir);
    const lib = pathToFileURL(join(SELF, '..', '..', 'lib', 'entry-point.mjs')).href;
    const script = join(dir, 'tool.mjs');
    writeFileSync(script, `import { isEntryPoint } from ${JSON.stringify(lib)};\nif (isEntryPoint(import.meta.url, process.argv[1])) console.log('ran');\n`);
    expect(execFileSync(process.execPath, [script], { encoding: 'utf8', windowsHide: true }).trim()).toBe('ran');
    const importer = `await import(${JSON.stringify(pathToFileURL(script).href)}); console.log('imported');`;
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', importer], { encoding: 'utf8', windowsHide: true }).trim()).toBe('imported');
  });
});
