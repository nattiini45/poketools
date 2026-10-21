// Local reproduction of .github/workflows/ci.yml (job `build-and-test`).
//
// WHY THIS EXISTS: a green `npm test` in the working tree proves nothing about
// CI. CI checks out ONLY tracked files, so anything a test reads from local-only
// state — the `public/models/world/` asset mirror, `board/`, `.env`, a stale
// node_modules — passes here and ENOENTs there. On 2026-09-23 that gap shipped a
// red PR: `model-manifest.test.ts` read an untracked manifest, and a scripts test
// read an untracked `board/` transcript. Both were green locally, and the second
// CI step (`npm run test:coverage`) failed for the same reason.
//
// So: clone HEAD into a temp dir (tracked files only), `npm ci` from the
// lockfile, then run every CI step in order, each logged to its own file.
//
// Usage:
//   npm run verify:ci              # clone, install, run every step
//   npm run verify:ci -- --keep    # keep the clone for inspection (path printed)
//
// Exit code is 1 if any step fails, if TRACKED files are uncommitted (a clone
// cannot see them, so they would not be verified), or if ci.yml gained a step or
// build-env key this script does not reproduce. Untracked paths only warn: they
// are absent from the clone either way, which is exactly what CI sees.
//
// Drift protection is deliberately narrow — it catches a new scalar `run:`
// step, a renamed job, and a renamed build env key (scoped to the build
// step's `env:` block). It fails closed on a `run: |` (or `run: >`) block
// scalar: the STEPS table reproduces single commands only, so a multi-command
// step must be split into one-line `run:` entries, and on an empty step-level
// `run:` (a plain multi-line scalar). Only a step's own `run:` key counts as a
// command: the job's `defaults:` → `run:` mapping and an empty action input
// under `with:` are skipped, and a non-empty `run:` nested in a step fails
// closed. It does NOT catch a reordered step list or a changed `uses:` action.
// If you restructure ci.yml, update STEPS here in the same commit. The parser
// (`ciRunSteps`, `checkDrift`) is exported for scripts/__tests__/verify-ci.test.mjs;
// importing the module does not run the CLI.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CI_YAML = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const JOB = 'build-and-test';

/** npm is a .cmd shim on Windows, which Node refuses to spawn without a shell. */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
/** Only ever used with the static literals in STEPS — never with derived input. */
const NEEDS_SHELL = process.platform === 'win32';

/** The placeholder env ci.yml hands the build step. Keep in step with ci.yml. */
const BUILD_ENV = {
  FORMAT_PACK: 'example',
  NODE_OPTIONS: '--max-old-space-size=4096',
  NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
  NEXTAUTH_SECRET: 'ci-secret',
  NEXTAUTH_URL: 'http://localhost:3000',
  DISCORD_CLIENT_ID: 'placeholder',
  DISCORD_CLIENT_SECRET: 'placeholder',
};

/**
 * Project env prefixes stripped before every step. A developer's shell (or a
 * `.env` loaded by some other tool) must not be able to change a result here —
 * `NEXT_PUBLIC_WORLD_ASSETS_URL` in particular flips `getWorldAssetBase()` and
 * would make the manifest test pass locally while failing in CI, the exact
 * inversion this script exists to prevent.
 */
const STRIPPED_PREFIXES = [
  'NEXT_PUBLIC_',
  'SUPABASE_',
  'NEXTAUTH_',
  'DISCORD_',
  'BOOTSTRAP_',
  'CRON_',
  'KALE_',
  'AZURE_',
  'CLAUDE_',
  'DEEPSEEK_',
  'MINIMAX_',
  'MESHY_',
  'NANOGPT_',
];

function ciEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (STRIPPED_PREFIXES.some((prefix) => key.startsWith(prefix))) delete env[key];
  }
  return { ...env, ...extra };
}

/** The CI steps, in ci.yml order. `shellText` is the literal `run:` value.
 *  `reportOnly` mirrors a ci.yml `continue-on-error: true` step: it runs and is
 *  logged, but a failure is reported as WARN and neither stops nor fails the run. */
const STEPS = [
  { name: '1-install', shellText: 'npm ci', cmd: NPM, args: ['ci'] },
  { name: '2-audit', shellText: 'npm audit --omit=dev --audit-level=high', cmd: NPM, args: ['audit', '--omit=dev', '--audit-level=high'] },
  { name: '2b-audit-all', shellText: 'npm audit --audit-level=high', cmd: NPM, args: ['audit', '--audit-level=high'], reportOnly: true },
  { name: '3-lint', shellText: 'npm run lint', cmd: NPM, args: ['run', 'lint'] },
  {
    name: '4-safe-error',
    shellText: 'ENFORCE=1 node scripts/check-safe-error-response.mjs',
    cmd: process.execPath,
    args: ['scripts/check-safe-error-response.mjs'],
    env: { ENFORCE: '1' },
  },
  {
    name: '5-mojibake',
    shellText: 'ENFORCE=1 node scripts/check-mojibake.mjs',
    cmd: process.execPath,
    args: ['scripts/check-mojibake.mjs'],
    env: { ENFORCE: '1' },
  },
  {
    name: '5b-i18n-strings',
    shellText: 'ENFORCE=1 node scripts/check-i18n-strings.mjs --all',
    cmd: process.execPath,
    args: ['scripts/check-i18n-strings.mjs', '--all'],
    env: { ENFORCE: '1' },
  },
  { name: '5c-typecheck-example', shellText: 'npm run typecheck:example', cmd: NPM, args: ['run', 'typecheck:example'] },
  { name: '6-build', shellText: 'npm run build', cmd: NPM, args: ['run', 'build'], env: BUILD_ENV },
  { name: '7-test', shellText: 'npm test', cmd: NPM, args: ['test'] },
  { name: '8-coverage', shellText: 'npm run test:coverage', cmd: NPM, args: ['run', 'test:coverage'] },
];

function fail(message) {
  console.error(`[verify-ci] ${message}`);
  process.exit(1);
}

/**
 * A ci.yml shape this script cannot mirror. The parsers throw it (so tests can
 * drive them on fixture text); the CLI prints the message and exits 1.
 */
export class CiDriftError extends Error {}

function drift(message) {
  throw new CiDriftError(message);
}

function git(args) {
  const res = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (res.status !== 0) {
    // A spawn failure (git missing from PATH) leaves status/stderr/stdout
    // null — fall through to the spawn error rather than a bare TypeError.
    const detail = (res.stderr || res.stdout || res.error?.message || 'spawn failed').trim();
    fail(`git ${args.join(' ')} failed: ${detail}`);
  }
  return (res.stdout || '').trim();
}

/**
 * Every step-level `run:` value in the job, with whether its step sets `continue-on-error: true`,
 * so a new CI step (or a changed blocking/report-only status) cannot slip past this script.
 *
 * Only a `run:` that is a key of a step (on the step's dash line, or at the step's key indent,
 * inside the job's `steps:` list) is a command. Any other `run:` key is not: the job's
 * `defaults:` → `run:` mapping (shell / working-directory) or an action input under a step's
 * `with:`. Those never trip the empty-`run:` guard; a non-empty one fails closed (it cannot be
 * mirrored and must not be dropped silently).
 */
export function ciRunSteps(text, job = JOB) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().startsWith(`${job}:`));
  if (start === -1) drift(`job "${job}" not found in ${CI_YAML}`);
  const jobIndent = /^\s*/.exec(lines[start])[0].length;
  const steps = [];
  let jobKeyIndent = null; // the indent of the job's own keys (runs-on, defaults, steps)
  let stepsIndent = null; // the indent of the job's `steps:` key while inside its list
  let step = null;
  let stepIndent = null; // the dash indent of the steps list (its first item)
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0 || line.trim().startsWith('#')) continue;
    // Another key at the job's own indent (or shallower) ends this job's block.
    const indent = /^\s*/.exec(line)[0].length;
    if (indent <= jobIndent) break;
    if (jobKeyIndent === null) jobKeyIndent = indent;
    if (indent === jobKeyIndent && /^\s*steps:\s*(?:#.*)?$/.test(line)) {
      stepsIndent = indent;
      step = null;
      stepIndent = null;
      continue;
    }
    // A `-` item at the steps list's indent opens a step, whether a key follows the dash or the
    // step's keys start on the next line. Deeper dashes are lists inside a step (`with:` values).
    const item = /^(\s*)-(?:\s|$)/.exec(line);
    const opensStep =
      item !== null &&
      stepsIndent !== null &&
      item[1].length >= stepsIndent &&
      (stepIndent === null || item[1].length === stepIndent);
    if (opensStep) {
      stepIndent = item[1].length;
      const key = /^(\s*-\s+)\S/.exec(line);
      step = { cmd: null, continueOnError: false, indent: stepIndent, keyIndent: key ? key[1].length : null };
      steps.push(step);
    } else if (stepsIndent !== null && indent <= stepsIndent) {
      // A job key back at the `steps:` indent ends the list: what follows is job-level.
      stepsIndent = null;
      step = null;
    } else if (step !== null && step.keyIndent === null) {
      step.keyIndent = indent; // a dash-only line: the step's keys start on this line
    }
    const coe = /^(\s*)(?:-\s*)?continue-on-error:\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (coe) {
      // Only a literal true/false on a step can be mirrored as reportOnly. An expression, a quoted
      // value or a job-level flag fails closed instead of being misread as either.
      const inStep = step !== null && (item !== null || coe[1].length > step.indent);
      if (!inStep || (coe[2] !== 'true' && coe[2] !== 'false')) {
        drift(
          `ci.yml line ${i + 1}: \`continue-on-error: ${coe[2]}\` ${inStep ? 'is not a literal true/false' : 'is not on a step'} — ` +
            'this script mirrors only a step-level literal as reportOnly. Use a literal on the step, or extend scripts/verify-ci.mjs.',
        );
      }
      step.continueOnError = coe[2] === 'true';
    }
    const run = /^\s*(?:-\s*)?run:(.*)$/.exec(line);
    if (!run) continue;
    const empty = /^\s*(?:#.*)?$/.test(run[1]);
    const stepLevel = step !== null && (opensStep || indent === step.keyIndent);
    if (!stepLevel) {
      // Not a command of this job. An empty one (`defaults:` → `run:` opening its mapping, or an
      // empty action input) and a flow mapping outside the steps (`run: { shell: bash }`) are
      // skipped; anything else fails closed rather than being dropped or misread as a step.
      if (empty) continue;
      if (step === null && /^\s*\{.*\}\s*(?:#.*)?$/.test(run[1])) continue;
      drift(
        step === null
          ? `ci.yml line ${i + 1}: a \`run:\` outside a step — this script cannot attribute it.`
          : `ci.yml line ${i + 1}: a \`run:\` nested inside a step (an action input under \`with:\`?) — this script ` +
              'reproduces step-level `run:` commands only. Make it a step-level `run:` and add it to STEPS, or extend scripts/verify-ci.mjs.',
      );
    }
    // An empty step-level `run:` scalar carries its command on the following lines (a plain
    // multi-line scalar), which this script cannot reproduce: fail closed instead of dropping it.
    if (empty) {
      drift(
        `ci.yml line ${i + 1} has an empty \`run:\` (its command continues on the next lines) — this script ` +
          'reproduces single-line `run:` commands only. Put the command on the `run:` line and add it to STEPS.',
      );
    }
    const cmd = run[1].trim();
    // The STEPS table reproduces single commands only (literal cmd + args,
    // no shell on Linux), so a block scalar cannot be represented — fail
    // closed with guidance that can actually clear it, instead of letting
    // `|` surface as an un-reproducible unknown step.
    if (cmd === '|' || cmd === '>') {
      drift(
        `ci.yml line ${i + 1} uses a \`run: ${cmd}\` block scalar — this script reproduces ` +
          'single-command steps only. Split the step into one-line `run:` entries and add ' +
          'each to STEPS in the same commit.',
      );
    }
    // A second step-level run: in one step cannot be attributed to exactly one command.
    if (step.cmd !== null) {
      drift(`ci.yml line ${i + 1}: a second \`run:\` in a step — this script cannot attribute it.`);
    }
    step.cmd = cmd;
  }
  return steps.filter((s) => s.cmd !== null);
}

/**
 * The `env:` block lines of the build step, so the BUILD_ENV check cannot be
 * satisfied by a key appearing anywhere else in ci.yml — a comment, another
 * job, or another step's env (PR #63 review).
 */
function buildStepEnvLines(text) {
  const lines = text.split(/\r?\n/);
  const build = STEPS.find((s) => s.name === '6-build');
  const runRe = new RegExp(`^\\s*(?:-\\s*)?run:\\s*${build.shellText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const runIdx = lines.findIndex((l) => runRe.test(l));
  if (runIdx === -1) drift(`build step "run: ${build.shellText}" not found in ${CI_YAML}`);
  const runIndent = /^\s*/.exec(lines[runIdx])[0].length;
  let envIdx = -1;
  for (let i = runIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    const indent = /^\s*/.exec(line)[0].length;
    if (indent < runIndent) break; // the build step ended — no env block
    if (indent === runIndent && /^\s*env:\s*$/.test(line)) {
      envIdx = i;
      break;
    }
  }
  if (envIdx === -1) drift(`the build step has no \`env:\` block — BUILD_ENV has drifted from ci.yml.`);
  const envIndent = /^\s*/.exec(lines[envIdx])[0].length;
  const block = [];
  for (let i = envIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (/^\s*/.exec(line)[0].length <= envIndent) break;
    block.push(line.trimStart());
  }
  return block;
}

/**
 * The build step's env as `{ KEY: value }`. Comment lines are skipped; a key may
 * be bare or quoted; a quoted value is taken whole (a `#` inside it is data) and
 * may be followed by ` # comment`; an unquoted value loses a trailing ` #…`
 * comment; both are trimmed. Any other line fails closed: a line this parser
 * cannot read must not be dropped and let a changed value through. The map has
 * no prototype, so a `__proto__:` key is stored as data and reaches the drift
 * check instead of silently setting the object's prototype.
 */
function buildStepEnv(text) {
  const env = Object.create(null);
  for (const line of buildStepEnvLines(text)) {
    if (line.startsWith('#')) continue;
    const match = /^(?:([A-Za-z_][A-Za-z0-9_]*)|'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"):(?:\s+(.*))?$/.exec(line);
    const rest = match ? (match[4] ?? '').trim() : null;
    const quoted = rest === null ? null : /^(['"])(.*?)\1(?:\s+#.*)?$/.exec(rest);
    if (!match || (/^['"]/.test(rest) && !quoted)) {
      drift(`cannot parse this line in ci.yml's build step env: "${line.trim()}". Use KEY: value.`);
    }
    env[match[1] ?? match[2] ?? match[3]] = quoted ? quoted[2] : rest.replace(/(?:^|\s+)#.*$/, '').trim();
  }
  return env;
}

/** Throws CiDriftError when ci.yml has a step, a status or a build env that STEPS does not mirror. */
export function checkDrift(text) {
  const known = new Set(STEPS.map((s) => s.shellText));
  const ciSteps = ciRunSteps(text);
  const unknown = ciSteps.map((s) => s.cmd).filter((c) => !known.has(c));
  if (unknown.length > 0) {
    drift(
      `ci.yml has ${unknown.length} step(s) this script does not reproduce: ${unknown.join(' | ')}. ` +
        'Add them to STEPS in scripts/verify-ci.mjs.',
    );
  }
  // reportOnly mirrors continue-on-error: drift either way would show green here while CI is red, or the reverse.
  const mismatched = STEPS.filter((s) => {
    const ci = ciSteps.find((c) => c.cmd === s.shellText);
    return ci && ci.continueOnError !== Boolean(s.reportOnly);
  });
  if (mismatched.length > 0) {
    drift(
      `ci.yml's continue-on-error disagrees with reportOnly for: ${mismatched.map((s) => s.shellText).join(' | ')}. ` +
        "Keep reportOnly in scripts/verify-ci.mjs equal to that step's continue-on-error.",
    );
  }
  const stepEnv = buildStepEnv(text);
  const missingEnv = Object.keys(BUILD_ENV).filter((key) => !(key in stepEnv));
  if (missingEnv.length > 0) {
    drift(
      `ci.yml's build step no longer sets ${missingEnv.join(', ')} — BUILD_ENV in ` +
        'scripts/verify-ci.mjs has drifted from the build step.',
    );
  }
  // Values count too: NODE_OPTIONS' heap size is build behaviour, not a placeholder (PR #73 review).
  const changedEnv = Object.keys(stepEnv).filter((key) => stepEnv[key] !== BUILD_ENV[key]);
  if (changedEnv.length > 0) {
    drift(
      `ci.yml's build step sets ${changedEnv.map((key) => `${key}=${stepEnv[key]}`).join(', ')}, which ` +
        'BUILD_ENV in scripts/verify-ci.mjs does not mirror. Keep both equal.',
    );
  }
}

/** CI pins a Node major; a local divergence is worth saying out loud. */
function checkNodeVersion(text) {
  const wanted = /node-version:\s*'?(\d+)/.exec(text)?.[1];
  const actual = process.versions.node.split('.')[0];
  if (wanted && wanted !== actual) {
    console.warn(`[verify-ci] note: ci.yml pins Node ${wanted}, this shell is ${process.versions.node}.`);
  }
}

/**
 * Runs only as the CLI (`npm run verify:ci`): importing this module (the
 * parser tests do) must not touch git, clone or spawn anything.
 */
function isCli() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const invoked = resolve(process.argv[1]);
  return process.platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
}

function main() {
  const keep = process.argv.slice(2).includes('--keep');

  const status = git(['status', '--porcelain']).split('\n').filter(Boolean);
  const tracked = status.filter((l) => !l.startsWith('??'));
  const untracked = status.filter((l) => l.startsWith('??'));
  if (untracked.length > 0) {
    console.warn(`[verify-ci] note: ${untracked.length} untracked path(s) will not be in the clone:`);
    console.warn(untracked.slice(0, 8).map((l) => `  ${l.slice(3)}`).join('\n'));
  }
  if (tracked.length > 0) {
    console.error('[verify-ci] uncommitted changes to TRACKED files — a clone only sees commits:');
    console.error(tracked.slice(0, 10).map((l) => `  ${l}`).join('\n'));
    fail('commit (or stash) first; otherwise this run does not verify your changes.');
  }

  const ciText = readFileSync(CI_YAML, 'utf8');
  try {
    checkDrift(ciText);
  } catch (error) {
    if (error instanceof CiDriftError) fail(error.message);
    throw error;
  }
  checkNodeVersion(ciText);

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'HEAD') fail('detached HEAD — check out a branch first.');
  const head = git(['rev-parse', '--short', 'HEAD']);

  // mkdtemp creates a fresh, unpredictably named, owner-only directory; git clones into an empty one.
  const dest = mkdtempSync(join(tmpdir(), 'poketools-verify-ci-'));
  // The cleanup at the end is a recursive delete; never let it point into the repo.
  if (dest.startsWith(REPO_ROOT)) fail(`refusing to use ${dest} — it is inside the repository.`);

  console.log(`[verify-ci] branch=${branch} head=${head}`);
  console.log(`[verify-ci] clone -> ${dest}`);
  const clone = spawnSync('git', ['clone', '-q', '--branch', branch, '--single-branch', REPO_ROOT, dest], {
    encoding: 'utf8',
  });
  if (clone.status !== 0) {
    rmSync(dest, { recursive: true, force: true });
    fail(`clone failed: ${(clone.stderr || clone.stdout).trim()}`);
  }
  // Created AFTER the clone: git refuses to clone into a non-empty directory.
  const logDir = join(dest, 'ci-logs');
  mkdirSync(logDir, { recursive: true });

  const results = [];
  /** Generous per-step cap: CI's slowest step (build) runs ~7 min, and a hung
   *  spawn (network-stalled `npm ci`) must fail diagnosably, not block the
   *  pre-push gate forever — partial output is still logged below. */
  const STEP_TIMEOUT_MS = 20 * 60_000;
  for (const step of STEPS) {
    const logFile = join(logDir, `${step.name}.log`);
    process.stdout.write(`[verify-ci] ${step.name}: ${step.shellText} ... `);
    const started = Date.now();
    // `shell` is on for exactly one case: Windows, where npm is a `.cmd` shim
    // that Node >= 20 refuses to spawn without a shell (EINVAL; the
    // CVE-2024-27980 hardening). No injection surface exists — `cmd` is either
    // that literal or `process.execPath`, and `args` are literal arrays from the
    // STEPS table above, so nothing external reaches either. This is a local
    // pre-push verifier: no workflow invokes it, and CI runs Linux, where the
    // shell stays off.
    const out = spawnSync(step.cmd, step.args, { // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true
      cwd: dest,
      env: ciEnv(step.env),
      encoding: 'utf8',
      shell: step.cmd === NPM && NEEDS_SHELL,
      maxBuffer: 64 * 1024 * 1024,
      timeout: STEP_TIMEOUT_MS,
    });
    // A spawn-level error (EINVAL, ENOBUFS, ENOENT) leaves status null and no output.
    const spawnError = out.error ? `spawn error: ${out.error.message}` : null;
    const timeoutNote = out.signal ? `killed by ${out.signal} after the ${STEP_TIMEOUT_MS / 60_000} min step timeout` : null;
    const body = `${out.stdout ?? ''}${out.stderr ?? ''}${spawnError ? `\n${spawnError}\n` : ''}${timeoutNote ? `\n${timeoutNote}\n` : ''}`;
    writeFileSync(logFile, body, 'utf8');
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const ok = out.status === 0 && !out.error && !out.signal;
    const code = out.status ?? out.error?.code ?? out.signal;
    if (!ok && step.reportOnly) {
      results.push({ name: step.name, status: `WARN(${code})`, secs });
      console.log(`WARN (${secs}s) — report-only step, as continue-on-error in ci.yml; log: ${logFile}`);
      continue;
    }
    results.push({ name: step.name, status: ok ? 'pass' : `FAIL(${code})`, secs });
    console.log(`${ok ? 'pass' : 'FAIL'} (${secs}s)`);
    if (!ok) {
      if (spawnError) console.error(`    ${spawnError}`);
      if (timeoutNote) console.error(`    ${timeoutNote}`);
      const tail = body.split('\n').filter(Boolean).slice(-25);
      console.log(tail.map((l) => `    ${l}`).join('\n'));
      console.log(`[verify-ci] full log: ${logFile}`);
      // Actions fail fast, so so does this: later steps would run against a
      // tree CI never would have reached.
      break;
    }
  }

  console.log('\n[verify-ci] summary');
  for (const r of results) {
    console.log(`  ${r.status.padEnd(14)} ${r.name}${r.secs ? ` (${r.secs}s)` : ''}`);
  }
  const failures = results.filter((r) => r.status.startsWith('FAIL'));
  const ranAll = results.length === STEPS.length && failures.length === 0;
  if (keep || !ranAll) {
    console.log(`[verify-ci] clone and per-step logs kept at ${logDir}`);
  } else {
    rmSync(dest, { recursive: true, force: true });
  }
  if (failures.length > 0 || !ranAll) {
    fail(`CI reproduction did not complete green (${results.length}/${STEPS.length} steps ran) — do not push.`);
  }
  console.log('[verify-ci] every CI step green on a fresh checkout.');
}

if (isCli()) main();
