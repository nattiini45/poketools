/**
 * The supported Node range is declared once (`engines.node`), enforced by npm (`engine-strict`), and
 * every other place that names a Node version agrees with it. The range is the intersection of the
 * locked dev tooling's engines (jsdom 30 needs ^22.22.2 || ^24.15.0 || >=26).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(read('package.json'));

const RANGE = '^22.22.2 || ^24.15.0';

/** Only the shape used here: `^X.Y.Z` alternatives joined by `||`. */
function satisfies(version, range) {
  const [major, minor, patch] = version.split('.').map(Number);
  return range.split('||').some((part) => {
    const m = /^\s*\^(\d+)\.(\d+)\.(\d+)\s*$/.exec(part);
    if (!m) throw new Error(`unsupported range part: ${part}`);
    const [, rMajor, rMinor, rPatch] = m.map(Number);
    if (major !== rMajor) return false;
    return minor > rMinor || (minor === rMinor && patch >= rPatch);
  });
}

describe('satisfies (the helper of this test)', () => {
  it('accepts the supported lines and rejects the unsupported ones', () => {
    for (const ok of ['22.22.2', '22.22.3', '24.15.0', '24.22.1']) expect(satisfies(ok, RANGE), ok).toBe(true);
    for (const bad of ['22.21.0', '23.5.0', '24.13.1', '25.0.0', '26.0.0', '20.19.0']) expect(satisfies(bad, RANGE), bad).toBe(false);
  });
});

describe('Node range', () => {
  it('is declared in package.json engines and enforced by engine-strict', () => {
    expect(pkg.engines?.node).toBe(RANGE);
    expect(read('.npmrc')).toMatch(/^engine-strict=true$/m);
  });

  it('has an .nvmrc inside the range, a full version', () => {
    const nvmrc = read('.nvmrc').trim();
    expect(nvmrc).toMatch(/^\d+\.\d+\.\d+$/);
    expect(satisfies(nvmrc, pkg.engines.node)).toBe(true);
  });

  it('types Node on a major the range allows', () => {
    const major = Number(/(\d+)/.exec(pkg.devDependencies['@types/node'])[1]);
    expect([22, 24]).toContain(major);
  });

  it('is the same range in every doc that names one, and no doc says "22+"', () => {
    for (const file of ['README.md', 'CONTRIBUTING.md', 'docs/dependencies.md', 'openwiki/quickstart.md']) {
      const text = read(file);
      expect(text, file).toContain(RANGE);
      expect(text, file).not.toMatch(/Node(?:\.js)?\s+22\+/);
      expect(text, file).not.toMatch(/harmless/i);
    }
  });
});
