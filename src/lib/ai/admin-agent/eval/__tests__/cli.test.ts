import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { main, parseArgs, readAllowedKeys, recordingOf, UsageError } from '../cli';
import { loadCases, loadRecordings } from '../data';
import { replayPorts, runCase } from '../runner';
import { recordingSchema } from '../types';

/**
 * The command line, run in process with injected output and a temp folder. Nothing here reaches a model, a network or a
 * database; a live run with no key must stop before any request, with a clear message.
 */
let dir: string;
let out: string[];
let err: string[];
const io = { log: (line: string) => void out.push(line), error: (line: string) => void err.push(line) };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'admin-agent-eval-test-'));
  out = [];
  err = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const lines = (file: string): unknown[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const run = (argv: string[], env: Record<string, string | undefined> = {}, extra: Partial<Parameters<typeof main>[0]> = {}) => main({ argv, env, io, tempDir: dir, ...extra });

describe('parseArgs', () => {
  it('defaults to a live plan-stage run of every case once', () => {
    expect(parseArgs([])).toMatchObject({ stage: 'plan', port: 'live', cases: [], repeat: 1, retries: 0, maxCostUsd: 5, help: false, list: false, json: false });
  });

  it('reads every flag', () => {
    const parsed = parseArgs(['--port', 'replay', '--cases', 'RO1, SF', '--repeat', '3', '--model', 'claude-sonnet-5-5', '--effort', 'high', '--out', 'x', '--record', 'y', '--timeout-sec', '12.5', '--retries', '2', '--max-cost-usd', '1.5', '--json', '--list']);
    expect(parsed).toMatchObject({ port: 'replay', cases: ['RO1', 'SF'], repeat: 3, model: 'claude-sonnet-5-5', effort: 'high', out: 'x', record: 'y', timeoutSec: 12.5, retries: 2, maxCostUsd: 1.5, json: true, list: true });
    expect(parseArgs(['--selftest']).port).toBe('replay');
  });

  it.each([
    [['--nope'], /unknown argument/],
    [['--cases'], /needs a value/],
    [['--cases', '--json'], /needs a value/],
    [['--repeat', '0'], /1 to 5/],
    [['--repeat', '6'], /1 to 5/],
    [['--repeat', 'two'], /1 to 5/],
    [['--effort', 'xhigh'], /low, medium or high/],
    [['--effort', 'max'], /low, medium or high/],
    [['--model', 'gpt-5'], /Anthropic model id/],
    [['--port', 'both'], /live or replay/],
    [['--timeout-sec', '0'], /positive/],
    [['--retries', '9'], /0 to 5/],
    [['--max-cost-usd', '-1'], /positive/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(UsageError);
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe('readAllowedKeys', () => {
  it('returns the allow-listed keys and nothing else', () => {
    const text = ['# comment', 'SUPABASE_SERVICE_ROLE_KEY=never-read', 'CLAUDE_API_KEY="sk-test-123"', '', 'OTHER=1', "NEXT_PUBLIC_SUPABASE_URL='https://x.supabase.co'", 'CLAUDE_API_KEY_EXTRA=nope'].join('\n');
    expect(readAllowedKeys(text, ['CLAUDE_API_KEY'])).toEqual({ CLAUDE_API_KEY: 'sk-test-123' });
    expect(readAllowedKeys(text, [])).toEqual({});
    expect(readAllowedKeys('CLAUDE_API_KEY=\r\nCLAUDE_API_KEY=  \n', ['CLAUDE_API_KEY'])).toEqual({});
    expect(readAllowedKeys('CLAUDE_API_KEY=a=b', ['CLAUDE_API_KEY'])).toEqual({ CLAUDE_API_KEY: 'a=b' });
    // The live run allow-lists the key and its deprecated alias, nothing else.
    expect(readAllowedKeys('ANTHROPIC_API_KEY=sk-a\nCLAUDE_API_KEY=sk-b\nANTHROPIC_BASE_URL=x', ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'])).toEqual({ ANTHROPIC_API_KEY: 'sk-a', CLAUDE_API_KEY: 'sk-b' });
  });
});

describe('main: refusals', () => {
  it('prints the usage and exits 0 for --help, and lists the cases for --list', async () => {
    expect(await run(['--help'])).toBe(0);
    expect(out.join('\n')).toContain('--port live|replay');
    out = [];
    expect(await run(['--list', '--cases', 'RO1'])).toBe(0);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^RO1\s+en\s+site_admin/);
  });

  it('exits 2 on a bad argument, an unbuilt stage and an unknown case', async () => {
    expect(await run(['--repeat', '9'])).toBe(2);
    expect(err.join('\n')).toContain('1 to 5');
    expect(await run(['--stage', 'e2e'])).toBe(2);
    expect(err.join('\n')).toMatch(/not built yet/);
    expect(await run(['--cases', 'ZZ9'])).toBe(2);
    expect(err.join('\n')).toMatch(/no case matches ZZ9/);
  });

  it('refuses a hosted database before it loads or runs anything', async () => {
    const code = await run(['--port', 'replay'], { NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghij.supabase.co' });
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(err.join('\n')).not.toContain('abcdefghij');
    expect(out).toEqual([]);
    expect(existsSync(path.join(dir, 'poketools-admin-agent-eval'))).toBe(false);
  });

  it('exits 2 with a clear message when a live run has no key, before any request or folder', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const reads: string[] = [];
    const code = await run(['--cases', 'RO2'], {}, { readEnvFile: (file) => (reads.push(file), 'SUPABASE_SERVICE_ROLE_KEY=zzz\nCLAUDE_API_KEY=\n') });
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('needs ANTHROPIC_API_KEY');
    expect(err.join('\n')).toContain('--port replay');
    expect(err.join('\n')).toContain('No request was made');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reads).toHaveLength(1);
    expect(existsSync(path.join(dir, 'poketools-admin-agent-eval'))).toBe(false);
    fetchSpy.mockRestore();
  });

  it('reads no env file for the offline run', async () => {
    const reads: string[] = [];
    expect(await run(['--port', 'replay', '--cases', 'RO2'], {}, { readEnvFile: (file) => (reads.push(file), null) })).toBe(0);
    expect(reads).toEqual([]);
  });
});

describe('main: the offline run', () => {
  it('replays every case, writes results, keeps server logs out of the terminal and passes the gates', async () => {
    const realFetch = globalThis.fetch;
    const realError = console.error;
    const target = path.join(dir, 'run');
    const code = await run(['--selftest', '--out', target]);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('result: PASS');
    expect(out.join('\n')).toContain('simulated');
    // The loop's server log lines (the raw fault messages) went to the file, and nowhere else.
    expect(err).toEqual([]);
    const serverLog = readFileSync(path.join(target, 'server.log'), 'utf8');
    expect(serverLog).toContain('password authentication failed');
    expect(readFileSync(path.join(target, 'results.jsonl'), 'utf8')).not.toContain('password authentication failed');
    expect(lines(path.join(target, 'results.jsonl'))).toHaveLength(loadCases().length);
    expect(existsSync(path.join(target, 'errors.jsonl'))).toBe(false);
    // Restored.
    expect(globalThis.fetch).toBe(realFetch);
    expect(console.error).toBe(realError);
  });

  it('prints the summary as JSON on request and honours --repeat', async () => {
    expect(await run(['--port', 'replay', '--cases', 'RO12', '--repeat', '2', '--json', '--out', path.join(dir, 'r')])).toBe(0);
    const summary = JSON.parse(out.filter((line) => line.startsWith('{')).join('\n'));
    expect(summary).toMatchObject({ cases: 1, runs: 2, ok: true, passPowK: { RO12: true } });
  });

  it('resumes: scored cases are skipped and the summary covers old and new runs', async () => {
    const target = path.join(dir, 'resume');
    expect(await run(['--port', 'replay', '--cases', 'RO2', '--out', target])).toBe(0);
    out = [];
    expect(await run(['--port', 'replay', '--cases', 'RO2,RO12', '--resume', target])).toBe(0);
    expect(lines(path.join(target, 'results.jsonl')).map((row) => (row as { caseId: string }).caseId)).toEqual(['RO2', 'RO12']);
    expect(out.filter((line) => /^(PASS|FAIL) /.test(line))).toHaveLength(1);
    expect(out.join('\n')).toContain('cases 2 (2 runs)');
  });

  it('survives a torn last line in the results of an interrupted run', async () => {
    const target = path.join(dir, 'torn');
    expect(await run(['--port', 'replay', '--cases', 'RO2', '--out', target])).toBe(0);
    const file = path.join(target, 'results.jsonl');
    const { appendFileSync } = await import('node:fs');
    appendFileSync(file, '{"caseId":"RO12","repe');
    out = [];
    expect(await run(['--port', 'replay', '--cases', 'RO2,RO12', '--resume', target])).toBe(0);
    expect(out.filter((line) => /^PASS /.test(line))).toEqual([expect.stringContaining('RO12#1')]);
  });
});

describe('recordingOf', () => {
  it('turns a finished run into a recording that replays to the same verdict', async () => {
    const cases = loadCases();
    const testCase = cases.find((c) => c.id === 'RO10')!;
    const first = await runCase(testCase, { makePort: replayPorts(loadRecordings()) });
    const recorded = recordingOf(first);
    expect(() => recordingSchema.parse(recorded)).not.toThrow();
    expect(recorded.turns.map((steps) => steps.length)).toEqual(first.record.turns.map((turn) => turn.steps));
    const second = await runCase(testCase, { makePort: replayPorts({ RO10: recorded }) });
    expect(second.record.status).toBe('ok');
    expect(second.record.proposals.map((p) => p.status)).toEqual(['superseded', 'staged']);
    expect(second.record.plan).toEqual(first.record.plan);
    expect(second.record.turns.map((t) => t.answer)).toEqual(first.record.turns.map((t) => t.answer));
  });
});
