/**
 * The docs that describe CI name every gate the workflow runs, including the ones that are not visible
 * as workflow steps (the repo-wide guards inside the Vitest run), and the local pre-flight is the same
 * set. The wiki page lists the workflow's `build-and-test` commands one for one.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ciRunSteps } from '../verify-ci.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const remediation = read('docs/review-remediation.md');
const i18nDoc = read('docs/i18n.md');
const wiki = read('openwiki/operations/testing-and-ci.md');
const ci = read('.github/workflows/ci.yml');

const I18N_CHECK = 'ENFORCE=1 node scripts/check-i18n-strings.mjs --all';

/** The fenced code block that follows the heading "4. Implement and validate". */
function preFlightBlock() {
  const section = remediation.slice(remediation.indexOf('## 4. Implement and validate'));
  const match = /```bash\n([\s\S]*?)```/.exec(section);
  if (!match) throw new Error('no pre-flight block under "4. Implement and validate"');
  return match[1];
}

describe('docs/review-remediation.md', () => {
  it('points at ci.yml for the step list and at verify:ci for the local mirror', () => {
    expect(remediation).toContain('.github/workflows/ci.yml');
    expect(remediation).toContain('npm run verify:ci');
  });

  it('names the guards that are not visible as workflow steps', () => {
    for (const name of [
      'source-line-endings',
      'check-i18n-strings',
      'typecheck:example',
      'check-safe-error-response',
      'check-mojibake',
      'npm audit',
    ]) {
      expect(remediation, name).toContain(name);
    }
    expect(remediation).toMatch(/NUL/);
  });

  it('runs the same enforcing commands CI runs in its local pre-flight', () => {
    const block = preFlightBlock();
    for (const command of [
      'npm run lint',
      'npm run typecheck:example',
      'npm run build',
      'npm test',
      'ENFORCE=1 node scripts/check-safe-error-response.mjs',
      'ENFORCE=1 node scripts/check-mojibake.mjs',
      I18N_CHECK,
    ]) {
      expect(block, command).toContain(command);
    }
  });

  it('does not freeze a step list that a new CI job would make stale', () => {
    expect(remediation).not.toMatch(/\bruns:\s*`npm audit/);
    expect(remediation).not.toMatch(/\bcoverage - a red step/);
  });
});

describe('docs/i18n.md', () => {
  it('says CI enforces the hard-coded string check and how to reproduce a failure', () => {
    expect(i18nDoc).toContain(I18N_CHECK);
    expect(i18nDoc).not.toMatch(/report-only/i);
    expect(i18nDoc).not.toMatch(/sweep flips/);
  });
});

describe('openwiki/operations/testing-and-ci.md', () => {
  it("lists every command of ci.yml's build-and-test job", () => {
    for (const { cmd } of ciRunSteps(ci)) expect(wiki, cmd).toContain(cmd);
  });

  it('describes the single Vitest run, the timeout and the in-suite guard', () => {
    expect(wiki).not.toMatch(/\*\*Tests\*\* — `npm test`/);
    expect(wiki).toContain('source-line-endings');
    expect(wiki).toMatch(/timeout/i);
    expect(wiki).toContain('CI_SKIP_BUILD_TYPECHECK');
  });
});
