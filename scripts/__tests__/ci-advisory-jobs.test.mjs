/**
 * The `database` and `e2e` jobs start a local Supabase stack on the runner. They are advisory (never a required
 * check, never in the ruleset), hold no secrets and reach no hosted project. `build-and-test` stays the only gate.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');

/** The text of one top-level job: from its `  name:` line to the next job (or the end of the file). */
function job(name) {
  const start = ci.search(new RegExp(`^  ${name}:\\n`, 'm'));
  expect(start, `job ${name} exists`).toBeGreaterThanOrEqual(0);
  const rest = ci.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\n/m);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe('advisory local-stack CI jobs', () => {
  it.each(['database', 'e2e'])('%s is advisory, secretless and loopback-only', (name) => {
    const body = job(name);
    expect(body).toMatch(/^ {4}continue-on-error: true$/m);
    expect(body).not.toMatch(/secrets\./);
    expect(body).not.toMatch(/supabase\.co/);
    expect(body).toMatch(/npx supabase start/);
  });

  it('each advisory job is documented as such above its definition', () => {
    for (const name of ['database', 'e2e']) {
      const above = ci.slice(0, ci.search(new RegExp(`^  ${name}:\\n`, 'm')));
      expect(above.trimEnd().split('\n').slice(-6).join('\n')).toMatch(/ADVISORY: not a required check/);
    }
  });

  it('the gate job is not advisory', () => {
    expect(job('build-and-test')).not.toMatch(/^ {4}continue-on-error:/m);
  });

  it('e2e installs only Chromium and uploads the report and traces when the suite fails', () => {
    const body = job('e2e');
    expect(body).toMatch(/npx playwright install --with-deps chromium$/m);
    expect(body).toMatch(/^ {8}if: failure\(\)$/m);
    expect(body).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40}/);
    expect(body).toMatch(/playwright-report\//);
    expect(body).toMatch(/test-results\//);
    expect(body).toMatch(/run: npm run test:e2e/);
  });
});
