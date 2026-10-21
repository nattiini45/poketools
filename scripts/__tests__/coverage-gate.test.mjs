/**
 * Coverage gate (M12/M13): the CI coverage step fails when the gated code (src/lib and the API
 * route handlers) drops below its floor, while components and app pages are measured
 * report-only. Guards the config and the CI wiring against silent removal.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATED = '{src/lib/**,src/app/api/**/route.ts}';
const METRICS = ['lines', 'functions', 'branches', 'statements'];

const coverage = /** @type {Record<string, any>} */ (config.test?.coverage ?? {});

describe('coverage gate', () => {
  it('measures library code and route handlers (gated) plus components and app pages (report-only)', () => {
    expect(coverage.provider).toBe('v8');
    expect(coverage.include).toEqual(
      expect.arrayContaining(['src/lib/**/*.ts', 'src/app/api/**/route.ts', 'src/components/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'])
    );
    expect(coverage.exclude).toEqual(expect.arrayContaining(['src/**/__tests__/**', 'src/types/**']));
  });

  it('sets a numeric floor for every metric on the gated glob only', () => {
    const thresholds = coverage.thresholds;
    expect(thresholds).toBeDefined();
    expect(Object.keys(thresholds)).toEqual([GATED]);
    for (const metric of METRICS) {
      const floor = thresholds[GATED][metric];
      expect(typeof floor, metric).toBe('number');
      expect(floor, metric).toBeGreaterThan(0);
      expect(floor, metric).toBeLessThanOrEqual(100);
    }
  });

  it('keeps components and pages report-only (no global floor, no perFile, no autoUpdate)', () => {
    const thresholds = coverage.thresholds;
    for (const metric of [...METRICS, 'perFile', 'autoUpdate', '100']) {
      expect(thresholds[metric], metric).toBeUndefined();
    }
  });

  it('writes a json-summary so per-area numbers can be read', () => {
    expect(coverage.reporter).toEqual(expect.arrayContaining(['text', 'json-summary']));
  });

  it('CI runs the coverage command as a blocking step', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
    const ci = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');
    const step = /\n( *)- name: Test coverage\n((?:\1 {2}.*\n?)*)/.exec(ci);
    expect(step, 'ci.yml has a "Test coverage" step').not.toBeNull();
    expect(step?.[2]).toMatch(/run: npm run test:coverage/);
    expect(step?.[2]).not.toMatch(/continue-on-error/);
  });
});
