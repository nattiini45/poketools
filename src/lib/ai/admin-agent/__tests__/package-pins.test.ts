import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Admin Assistant's model port runs on the AI SDK, and its prompt-cache prefix, thinking-block
 * replay and strict-tool behaviour were verified against exact versions (plan 3.4, Q19). A caret
 * range would let `npm install` move them silently, so both packages are pinned exactly. This fails
 * when `package.json` drifts to a range, when the lockfile disagrees with `package.json`, or when a
 * pin moves without this test (and the spike evidence behind it) being updated.
 */
const PINS = {
  ai: '6.0.289',
  '@ai-sdk/anthropic': '3.0.121',
} as const;

const ROOT = process.cwd();
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
interface Lockfile {
  packages: Record<string, { version?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as PackageJson;
const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as Lockfile;

describe.each(Object.entries(PINS))('%s is pinned to an exact version', (name, version) => {
  it('is declared in package.json as the exact version, not a range', () => {
    const declared = pkg.dependencies?.[name];
    expect(declared, `${name} must be a dependency`).toBeDefined();
    expect(declared).toMatch(EXACT_VERSION);
    expect(declared).toBe(version);
    expect(pkg.devDependencies?.[name]).toBeUndefined();
  });

  it('is declared the same way in package-lock.json', () => {
    expect(lock.packages[''].dependencies?.[name]).toBe(version);
  });

  it('resolves to the pinned version in package-lock.json', () => {
    expect(lock.packages[`node_modules/${name}`]?.version).toBe(version);
  });
});
