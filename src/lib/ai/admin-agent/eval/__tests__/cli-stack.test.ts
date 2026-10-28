import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { main, parseArgs, UsageError, type StackHarness } from '../cli';
import { buildWorld } from '../world';
import type { RunRecord, StackObservation } from '../types';
import type { RunOutcome } from '../runner';

/**
 * The `--stage` flag of the command line: `plan` is unchanged, and `exec` and `e2e` run only with the local-stack harness that the
 * entry script injects. Nothing here touches a database or a model; the harness is a fake.
 */
let dir: string;
let out: string[];
let err: string[];
const io = { log: (line: string) => void out.push(line), error: (line: string) => void err.push(line) };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'admin-agent-eval-stack-'));
  out = [];
  err = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (argv: string[], extra: Partial<Parameters<typeof main>[0]> = {}) => main({ argv, env: {}, io, tempDir: dir, ...extra });

const emptyObservation = (): StackObservation => ({ counts: {}, rows: [], recorder: { beforeApprove: [], afterApprove: [] }, ledger: [], proposals: [], clicks: [] });

/** A fake local stack: every case "runs" and reports a record carrying an empty observation. */
function fakeStack() {
  const state = { ran: [] as string[], prepared: 0, closed: 0 };
  const stack: StackHarness = {
    async prepare() {
      state.prepared += 1;
    },
    async runCase(testCase, options): Promise<RunOutcome> {
      state.ran.push(`${testCase.id}#${options.repeat ?? 1}`);
      const record: RunRecord = {
        caseId: testCase.id,
        repeat: options.repeat ?? 1,
        model: 'm',
        effort: 'medium',
        status: 'ok',
        failure: null,
        durationMs: 1,
        turns: [{ say: 'x', answer: '', events: [], done: 'completed', resumable: false, steps: 1, costUsdMicro: 0 }],
        toolCalls: [],
        effects: [],
        plan: null,
        proposals: [],
        approvals: [],
        usage: { modelRequests: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, warmInputTokens: 0, warmCacheReadTokens: 0, warmCacheWriteTokens: 0 },
        droppedThinking: 0,
        visible: [],
        stack: emptyObservation(),
      };
      const world = buildWorld(testCase.fixture, testCase.actor);
      world.dynamic = { runTag: 'test1', seeded: {} };
      return { record, world, steps: [] };
    },
    async close() {
      state.closed += 1;
    },
  };
  return { stack, state };
}

/** The one results folder the run made under the temp directory. */
function resultsOf(root: string): Array<{ caseId: string; stage?: string; pass: boolean; port: string; checks: Array<{ name: string; pass: boolean }> }> {
  const base = path.join(root, 'poketools-admin-agent-eval');
  const names = readdirSync(base);
  expect(names).toHaveLength(1);
  return readFileSync(path.join(base, names[0], 'results.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('parseArgs: --stage and --phase', () => {
  it('reads the three stages and a phase', () => {
    for (const stage of ['plan', 'exec', 'e2e']) expect(parseArgs(['--stage', stage]).stage).toBe(stage);
    expect(parseArgs(['--phase', '1']).phase).toBe(1);
    expect(parseArgs([]).phase).toBeUndefined();
    expect(parseArgs([]).portExplicit).toBe(false);
    expect(parseArgs(['--port', 'live']).portExplicit).toBe(true);
    expect(parseArgs(['--selftest']).portExplicit).toBe(true);
  });

  it.each([
    [['--stage', 'exec2'], /plan, exec or e2e/],
    [['--phase', '6'], /0 to 5/],
    [['--phase', 'one'], /0 to 5/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(UsageError);
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe('main: the stack stages', () => {
  it('refuses exec and e2e without the harness the entry script injects, before any request', async () => {
    expect(await run(['--stage', 'exec'])).toBe(2);
    expect(err.join('\n')).toMatch(/not built yet in this entry/);
    err = [];
    expect(await run(['--stage', 'e2e', '--cases', 'TN1'])).toBe(2);
    expect(err.join('\n')).toMatch(/scripts\/admin-agent-eval\.ts/);
  });

  it('runs the exec cases with the replayed model, prepares the stack once and closes it, and scores the observation', async () => {
    const { stack, state } = fakeStack();
    expect(await run(['--stage', 'exec', '--json'], { stack })).toBe(1);
    expect(state.prepared).toBe(1);
    expect(state.closed).toBe(1);
    expect([...state.ran].sort()).toEqual(['LG10#1', 'LG9#1', 'UN1#1']);
    const scores = resultsOf(dir);
    expect(scores.map((s) => s.stage)).toEqual(['exec', 'exec', 'exec']);
    expect(scores.every((s) => s.port === 'replay')).toBe(true);
    // The fake observed no click, so the click expectation fails: what is graded is the stack's observation.
    expect(scores.every((s) => !s.pass && s.checks.some((c) => !c.pass && /a click answers/.test(c.name)))).toBe(true);
  });

  it('never calls the real model for exec, and says so', async () => {
    expect(await run(['--stage', 'exec', '--port', 'live'], { stack: fakeStack().stack })).toBe(2);
    expect(err.join('\n')).toMatch(/replays a recorded model/);
  });

  it('runs an e2e case from its recording with --port replay, and refuses a case that has none', async () => {
    const { stack, state } = fakeStack();
    await run(['--stage', 'e2e', '--port', 'replay', '--cases', 'TN1'], { stack });
    expect(state.ran).toEqual(['TN1#1']);
    err = [];
    expect(await run(['--stage', 'e2e', '--port', 'replay', '--cases', 'RS3'], { stack: fakeStack().stack })).toBe(2);
    expect(err.join('\n')).toMatch(/needs a recording; none for RS3/);
  });

  it('wants the live key for e2e and stops before any request without it', async () => {
    const { stack, state } = fakeStack();
    expect(await run(['--stage', 'e2e', '--cases', 'TN1'], { stack, readEnvFile: () => null })).toBe(2);
    expect(err.join('\n')).toMatch(/needs ANTHROPIC_API_KEY/);
    expect(state.prepared).toBe(0);
  });

  it('selects by stage: a case of another stage is named, not silently run', async () => {
    expect(await run(['--stage', 'exec', '--cases', 'TN1'], { stack: fakeStack().stack })).toBe(2);
    expect(err.join('\n')).toMatch(/TN1 is a e2e case; run it with --stage e2e/);
    err = [];
    expect(await run(['--cases', 'LG9', '--port', 'replay'])).toBe(2);
    expect(err.join('\n')).toMatch(/LG9 is a exec case/);
  });

  it('keeps the default plan run at the phase 0 suite and adds the P1 plan cases with --phase 1', async () => {
    expect(await run(['--port', 'replay', '--list'])).toBe(0);
    const phase0 = out.map((line) => line.split(' ')[0]);
    expect(phase0).toContain('RO1');
    expect(phase0).not.toContain('LG1');
    out = [];
    expect(await run(['--port', 'replay', '--phase', '1', '--list'])).toBe(0);
    expect(out.map((line) => line.split(' ')[0])).toEqual(expect.arrayContaining(['RO1', 'LG1', 'LG4']));
  });

  it('runs the P1 plan cases offline through the plan runner', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await run(['--stage', 'plan', '--port', 'replay', '--cases', 'LG1,LG4'])).toBe(0);
    expect(out.filter((line) => /^PASS /.test(line))).toHaveLength(2);
  });

  it('lists a blocked case with its reason, and runs it when it is named', async () => {
    expect(await run(['--stage', 'e2e', '--list'], { stack: fakeStack().stack })).toBe(0);
    expect(out.join('\n')).not.toContain('TN2 ');
    out = [];
    expect(await run(['--stage', 'e2e', '--cases', 'TN2', '--list'], { stack: fakeStack().stack })).toBe(0);
    expect(out.join('\n')).toMatch(/TN2 .*\[blocked: .*startup_checklist/);
  });
});
