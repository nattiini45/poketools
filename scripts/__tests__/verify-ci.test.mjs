/**
 * verify-ci.mjs drift parser: which `run:` keys count as CI commands.
 *
 * Only a step-level `run:` (on the step's dash line or at the step's key
 * indent, inside the job's `steps:` list) is a command. The empty-`run:` guard
 * (a plain multi-line scalar this script cannot reproduce) fails closed for
 * those only: the job's `defaults:` → `run:` mapping and an empty action
 * input under `with:` are not commands and must not trip it with the wrong
 * guidance. Importing the module must not run the CLI (no git, no clone).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CiDriftError, checkDrift, ciEnv, ciRunSteps } from '../verify-ci.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A workflow with the given job body (lines already indented under the job). */
function workflow(body) {
  return ['name: CI', 'jobs:', '  build-and-test:', '    runs-on: ubuntu-latest', ...body].join('\n');
}

function cmds(text) {
  return ciRunSteps(text).map((s) => s.cmd);
}

function driftMessage(fn) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CiDriftError);
    return error.message;
  }
  throw new Error('expected a CiDriftError');
}

describe('verify-ci: ciRunSteps', () => {
  it("passes the repository's own ci.yml (no drift)", () => {
    const text = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(() => checkDrift(text)).not.toThrow();
    expect(cmds(text)).toContain('npm run build');
  });

  it('reads step-level run: on the dash line, at the key indent, and after a dash-only line', () => {
    const text = workflow([
      '    steps:',
      '      - run: npm ci',
      '      - name: Lint',
      '        run: npm run lint',
      '      -',
      '        run: npm test',
    ]);
    expect(cmds(text)).toEqual(['npm ci', 'npm run lint', 'npm test']);
  });

  it('ignores a job-level defaults: run: mapping (before or after the steps)', () => {
    const before = workflow([
      '    defaults:',
      '      run:',
      '        shell: bash',
      '        working-directory: app',
      '    steps:',
      '      - run: npm ci',
    ]);
    expect(cmds(before)).toEqual(['npm ci']);

    const after = workflow([
      '    steps:',
      '      - run: npm ci',
      '    defaults:',
      '      run:',
      '        shell: bash',
    ]);
    expect(cmds(after)).toEqual(['npm ci']);
  });

  it('ignores a flow-mapping defaults: run: value', () => {
    const text = workflow(['    defaults:', '      run: { shell: bash }', '    steps:', '      - run: npm ci']);
    expect(cmds(text)).toEqual(['npm ci']);
  });

  it('ignores an empty run input under a step with:', () => {
    const text = workflow([
      '    steps:',
      '      - uses: some/action@v1',
      '        with:',
      '          run:',
      '          other: value',
      '      - run: npm ci',
    ]);
    expect(cmds(text)).toEqual(['npm ci']);
  });

  it('fails closed on an empty step-level run: (on the dash line and at the key indent)', () => {
    for (const body of [
      ['    steps:', '      - run:', '          npm ci'],
      ['    steps:', '      - name: Install', '        run:', '          npm ci'],
      ['    steps:', '      - name: Install', '        run: # continues below', '          npm ci'],
    ]) {
      expect(driftMessage(() => ciRunSteps(workflow(body)))).toMatch(/has an empty `run:`/);
    }
  });

  it('fails closed on a non-empty run: nested inside a step (an action input)', () => {
    const text = workflow([
      '    steps:',
      '      - uses: some/runner@v1',
      '        with:',
      '          run: npm run secret-step',
    ]);
    expect(driftMessage(() => ciRunSteps(text))).toMatch(/nested inside a step/);
  });

  it('fails closed on a non-empty run: outside the steps', () => {
    const text = workflow(['    defaults:', '      run: bash', '    steps:', '      - run: npm ci']);
    expect(driftMessage(() => ciRunSteps(text))).toMatch(/outside a step/);
  });

  it('keeps failing closed on block scalars and a second run: in one step', () => {
    expect(driftMessage(() => ciRunSteps(workflow(['    steps:', '      - run: |', '          npm ci'])))).toMatch(
      /block scalar/,
    );
    expect(
      driftMessage(() => ciRunSteps(workflow(['    steps:', '      - run: npm ci', '        run: npm test']))),
    ).toMatch(/second `run:`/);
  });

  it('reports an unknown step through checkDrift', () => {
    const text = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8').replace(
      '      - run: npm ci',
      '      - run: npm ci\n\n      - run: npm run surprise',
    );
    expect(driftMessage(() => checkDrift(text))).toMatch(/npm run surprise/);
  });
});

describe('verify-ci: build step env', () => {
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const HEAP = 'NODE_OPTIONS: --max-old-space-size=4096';

  it('reports a changed value, not only a missing key', () => {
    expect(ci).toContain(HEAP);
    const bumped = ci.replace(HEAP, 'NODE_OPTIONS: --max-old-space-size=8192');
    expect(driftMessage(() => checkDrift(bumped))).toMatch(/NODE_OPTIONS=--max-old-space-size=8192/);
  });

  it('reports a key ci.yml sets that BUILD_ENV does not', () => {
    const extra = ci.replace(HEAP, `${HEAP}\n          NEXT_TELEMETRY_DISABLED: '1'`);
    expect(driftMessage(() => checkDrift(extra))).toMatch(/NEXT_TELEMETRY_DISABLED=1/);
  });

  it('reports a removed key', () => {
    expect(driftMessage(() => checkDrift(ci.replace(`${HEAP}\n`, '')))).toMatch(/no longer sets NODE_OPTIONS/);
  });

  it('accepts a quoted value and a trailing comment', () => {
    const quoted = ci.replace(HEAP, "NODE_OPTIONS: '--max-old-space-size=4096' # heap for the type check");
    expect(() => checkDrift(quoted)).not.toThrow();
  });

  it('keeps a # inside a quoted value (it is data, not a comment)', () => {
    const hashed = ci.replace(HEAP, "NODE_OPTIONS: '--max-old-space-size=4096 # b'");
    expect(driftMessage(() => checkDrift(hashed))).toMatch(/NODE_OPTIONS=--max-old-space-size=4096 # b/);
  });

  it('ignores trailing whitespace after a value', () => {
    expect(() => checkDrift(ci.replace(HEAP, `${HEAP}   `))).not.toThrow();
    expect(() => checkDrift(ci.replace(HEAP, `"NODE_OPTIONS": "--max-old-space-size=4096"  `))).not.toThrow();
  });

  it('reports a __proto__ key as drift instead of losing it to the prototype setter', () => {
    for (const key of ['__proto__', "'__proto__'"]) {
      const proto = ci.replace(HEAP, `${HEAP}\n          ${key}: polluted`);
      expect(driftMessage(() => checkDrift(proto))).toMatch(/sets __proto__=polluted/);
    }
  });

  it('accepts a quoted key', () => {
    expect(() => checkDrift(ci.replace(HEAP, "'NODE_OPTIONS': --max-old-space-size=4096"))).not.toThrow();
    const bumped = ci.replace(HEAP, '"NODE_OPTIONS": --max-old-space-size=8192');
    expect(driftMessage(() => checkDrift(bumped))).toMatch(/NODE_OPTIONS=--max-old-space-size=8192/);
  });

  it('fails closed on an env line it cannot parse, naming the line', () => {
    for (const bad of ['NODE_OPTIONS=--max-old-space-size=4096', "NODE_OPTIONS: '--max-old-space-size=4096"]) {
      expect(driftMessage(() => checkDrift(ci.replace(HEAP, bad)))).toMatch(
        new RegExp(`cannot parse this line.*${bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      );
    }
  });
});

describe('ciEnv: what a step inherits', () => {
  it('passes only the allow-list, fixes CI and TZ, and lets the step env win', () => {
    const env = ciEnv(
      { DISCORD_CLIENT_ID: 'placeholder' },
      {
        Path: 'C:/bin',
        HOME: '/home/dev',
        https_proxy: 'http://proxy',
        TZ: 'Europe/Berlin',
        FORMAT_PACK: 'private',
        RATE_LIMIT_STORE: 'memory',
        NEXT_PUBLIC_WORLD_ASSETS_URL: 'https://example.invalid',
        NODE_OPTIONS: '--max-old-space-size=1',
        GAUNTLET_TESTS: '1',
        CI: 'false',
      },
    );
    expect(env).toEqual({ Path: 'C:/bin', HOME: '/home/dev', https_proxy: 'http://proxy', CI: 'true', TZ: 'UTC', DISCORD_CLIENT_ID: 'placeholder' });
  });

  it('skips an unset value, and lets the step env win over CI, TZ and variables the shell may not pass', () => {
    const env = ciEnv({ NODE_OPTIONS: '--max-old-space-size=4096', TZ: 'US/Eastern' }, { HOME: '/home/dev', PATH: undefined });
    expect(env).toEqual({ HOME: '/home/dev', CI: 'true', TZ: 'US/Eastern', NODE_OPTIONS: '--max-old-space-size=4096' });
    expect('PATH' in env).toBe(false);
  });
});
