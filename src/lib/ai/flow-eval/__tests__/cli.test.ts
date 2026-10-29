import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installEgressGuard, main, parseArgs, priorRows, readAllowedKeys, resumeMismatch, UsageError, type CliOptions } from '../cli';
import { OutputCapError, RefusalError } from '../../errors';
import type { createDexLookup } from '../graders';
import type { CallRequest, ModelCaller, ModelResponse, RunRow } from '../types';

const ROOT = path.resolve(__dirname, '../../../../..');

const SECRET = 'sk-test-0123456789-not-a-real-key';

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'ai-flow-eval-'));
}

/** An answer that looks right for the surface it is asked on. */
function respond(request: CallRequest, over: Partial<ModelResponse> = {}): ModelResponse {
  let content = 'A short, plain sentence about the round that ends cleanly.';
  if (request.surface === 'match-analysis') {
    const players = /## MATCH: (.+?) vs (.+)/.exec(request.user)!;
    const games = [...request.user.matchAll(/## GAME (\d+)\nWinner: (.+)/g)];
    const species = /- ([A-Za-z-]+) @/.exec(request.user)?.[1] ?? 'Garchomp';
    content = JSON.stringify({
      summary: 'A tight set between two patient players.',
      turning_point: 'A late switch decided it.',
      mvp: { pokemon: species, player: players[1], reasoning: 'It carried.' },
      game_breakdowns: games.map((g) => ({ game_number: Number(g[1]), winner: g[2], narrative: 'n', key_plays: ['k'] })),
      meta_observations: 'm',
      what_if: 'w',
      ...(request.user.includes('## LEAGUE CONTEXT') ? { league_constraint_analysis: 'l' } : {}),
    });
  } else if (request.surface === 'match-prep-analysis') {
    content = '{"not": "the schema"}';
  } else if (request.user.includes('matchup preview') || request.system.includes('"storyline"')) {
    content = '{"storyline":"s","edge":"e","key_pokemon":"k"}';
  } else if (request.surface !== 'kale') {
    content = `${'- A point about the set that is long enough to count as a bullet.\n'.repeat(8)}\nOverall rating: A.`;
  }
  return {
    content,
    model: 'claude-sonnet-5-5',
    promptTokens: 1000,
    completionTokens: 400,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    stopReason: 'end_turn',
    stopCategory: null,
    fallbackUsed: false,
    ...over,
  };
}

interface Harness {
  options: CliOptions;
  out: string[];
  err: string[];
  calls: CallRequest[];
  env: Record<string, string | undefined>;
}

function harness(argv: string[], opts: { caller?: ModelCaller; env?: Record<string, string | undefined>; envFile?: string | null } = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const calls: CallRequest[] = [];
  const env = opts.env ?? {};
  const caller: ModelCaller = opts.caller ?? (async (request) => respond(request));
  const options: CliOptions = {
    argv,
    env,
    io: { log: (l) => void out.push(l), error: (l) => void err.push(l) },
    root: ROOT,
    now: () => new Date('2026-10-29T12:00:00Z'),
    readEnvFile: () => (opts.envFile === undefined ? `ANTHROPIC_API_KEY=${SECRET}\nSUPABASE_SERVICE_ROLE_KEY=never-read\n` : opts.envFile),
    createCaller: async () => async (request, settings) => {
      calls.push(request);
      return caller(request, settings);
    },
    createLookup: async () => ({ exists: () => true, types: () => ['Fire'] }) as Awaited<ReturnType<typeof createDexLookup>>,
  };
  return { options, out, err, calls, env };
}

const rowsOf = (dir: string): RunRow[] =>
  readFileSync(path.join(dir, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RunRow);

describe('parseArgs', () => {
  it('has safe defaults: every flow, one repeat, synthetic fixtures, cap $5', () => {
    const p = parseArgs([]);
    expect(p.flows).toHaveLength(7);
    expect(p).toMatchObject({ repeat: 1, maxCostUsd: 5, fixtures: 'synthetic', dryRun: false, concurrency: 3 });
  });

  it('parses every flag', () => {
    const p = parseArgs(['--flow', 'scouting,kale-recap', '--cases', 'sc-gym', '--per-flow', '2', '--repeat', '3', '--model', 'claude-haiku-5-5', '--effort', 'low', '--max-cost-usd', '1.5', '--fixtures', 'both', '--concurrency', '2', '--out', 'x', '--env-file', 'e', '--dry-run', '--json']);
    expect(p).toMatchObject({ flows: ['kale-recap', 'scouting'], cases: ['sc-gym'], perFlow: 2, repeat: 3, model: 'claude-haiku-5-5', effort: 'low', maxCostUsd: 1.5, fixtures: 'both', concurrency: 2, out: 'x', envFile: 'e', dryRun: true, json: true });
  });

  it.each([
    [['--nope'], /unknown argument/],
    [['--repeat', '0'], /--repeat/],
    [['--repeat', '9'], /--repeat/],
    [['--effort', 'max'], /--effort/],
    [['--max-cost-usd', '-1'], /--max-cost-usd/],
    [['--flow', 'chat'], /unknown flow/],
    [['--fixtures', 'real'], /--fixtures/],
    [['--model', 'gpt'], /--model/],
    [['--out', 'a', '--resume', 'b'], /exclusive/],
    [['--repeat'], /needs a value/],
    [['--out', '-h'], /needs a value/],
    [['--cases', '-x'], /needs a value/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(UsageError);
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe('readAllowedKeys', () => {
  it('returns only the allow-listed keys', () => {
    const text = '# c\nSUPABASE_SERVICE_ROLE_KEY=abc\nANTHROPIC_API_KEY="k1"\nBRAINTRUST_API_KEY=b\nCLAUDE_API_KEY=\n';
    expect(readAllowedKeys(text, ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'])).toEqual({ ANTHROPIC_API_KEY: 'k1' });
  });
});

describe('main: dry run', () => {
  it('renders prompts and estimates without a key, a caller or a network call', async () => {
    const dir = tmp();
    const h = harness(['--dry-run', '--out', dir], { envFile: null });
    const created = vi.fn();
    h.options.createCaller = async () => {
      created();
      throw new Error('must not be created');
    };
    const code = await main(h.options);
    expect(code).toBe(0);
    expect(created).not.toHaveBeenCalled();
    const text = h.out.join('\n');
    expect(text).toMatch(/dry run: claude-sonnet-5-5 at effort medium/);
    expect(text).toMatch(/estimated cost \$/);
    expect(existsSync(path.join(dir, 'prompts', 'match-analysis', 'ma-gym-bo3-replays', 'main.txt'))).toBe(true);
    expect(readdirSync(path.join(dir, 'prompts', 'kale-recap')).length).toBeGreaterThan(0);
    expect(existsSync(path.join(dir, 'results.jsonl'))).toBe(false);
  });

  it('warns when the estimate is over the cap, and reports JSON on request', async () => {
    const h = harness(['--dry-run', '--max-cost-usd', '0.05']);
    expect(await main(h.options)).toBe(0);
    expect(h.out.join('\n')).toMatch(/WARNING: the estimate is over the cap/);
    const j = harness(['--dry-run', '--json']);
    await main(j.options);
    expect(JSON.parse(j.out.join('\n')).estimate.totalUsd).toBeGreaterThan(0);
  });

  it('--per-flow and --flow shrink the plan', async () => {
    const h = harness(['--dry-run', '--json', '--flow', 'match-analysis,recap', '--per-flow', '2']);
    await main(h.options);
    const est = JSON.parse(h.out.join('\n')).estimate.perFlow as { flow: string; cases: number }[];
    expect(est.map((f) => [f.flow, f.cases])).toEqual([['match-analysis', 2], ['recap', 2]]);
  });

  it('--list prints the cases', async () => {
    const h = harness(['--list', '--flow', 'scouting']);
    expect(await main(h.options)).toBe(0);
    expect(h.out).toHaveLength(8);
  });
});

describe('main: usage and environment problems send nothing', () => {
  it('exits 2 without a key', async () => {
    const h = harness(['--flow', 'recap', '--per-flow', '1', '--out', tmp()], { envFile: null });
    expect(await main(h.options)).toBe(2);
    expect(h.err.join('\n')).toMatch(/no API key/);
    expect(h.calls).toHaveLength(0);
  });

  it('exits 2 for a model it cannot price, and for no selected cases', async () => {
    const m = harness(['--model', 'claude-opus-9-9', '--dry-run']);
    expect(await main(m.options)).toBe(2);
    expect(m.err.join('\n')).toMatch(/no price for model/);
    const c = harness(['--cases', 'does-not-exist', '--dry-run']);
    expect(await main(c.options)).toBe(2);
  });

  it('exits 2 on a bad flag', async () => {
    const h = harness(['--repeat', '99']);
    expect(await main(h.options)).toBe(2);
    expect(h.err.join('\n')).toMatch(/--repeat/);
  });
});

describe('main: a live run with a fake model', () => {
  it('never prints or writes the key, sets the model environment and drops tracing', async () => {
    const dir = tmp();
    const h = harness(['--flow', 'recap', '--per-flow', '2', '--out', dir], { env: { BRAINTRUST_API_KEY: 'bt-secret' } });
    await main(h.options);
    expect(h.env.CLAUDE_API_KEY).toBe(SECRET);
    expect(h.env.CLAUDE_MODEL).toBe('claude-sonnet-5-5');
    expect(h.env.CLAUDE_API_EFFORT).toBe('medium');
    expect(h.env.BRAINTRUST_API_KEY).toBeUndefined();
    const everything = [...h.out, ...h.err, ...readdirSync(dir).map((f) => readFileSync(path.join(dir, f), 'utf8'))].join('\n');
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('never-read');
  });

  it('writes results, a report and a summary, with the cost of every call', async () => {
    const dir = tmp();
    const h = harness(['--flow', 'match-analysis,team-coach', '--per-flow', '2', '--repeat', '2', '--out', dir]);
    await main(h.options);
    const rows = rowsOf(dir);
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.key)).toContain('match-analysis/ma-gym-bo3-replays/r2');
    // 1000 prompt tokens at $2/M + 400 output tokens at $10/M
    expect(rows[0].calls[0].costUsd).toBeCloseTo(0.002 + 0.004, 8);
    const report = readFileSync(path.join(dir, 'report.md'), 'utf8');
    expect(report).toMatch(/\| match-analysis \|/);
    expect(report).toMatch(/wrong_score/);
    const summary = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
    expect(summary.meta.spentUsd).toBeCloseTo(8 * 0.006, 8);
    expect(summary.summaries.find((s: { flow: string }) => s.flow === 'match-analysis').parseOk).toBe(4);
  });

  it('runs repeat 1 of every case before repeat 2 of any', async () => {
    const dir = tmp();
    const h = harness(['--flow', 'slot-coach', '--per-flow', '3', '--repeat', '2', '--out', dir, '--concurrency', '1']);
    await main(h.options);
    expect(rowsOf(dir).map((r) => `${r.caseId}#${r.repeat}`)).toEqual(['slot-coach-1#1', 'slot-coach-2#1', 'slot-coach-3#1', 'slot-coach-1#2', 'slot-coach-2#2', 'slot-coach-3#2']);
  });

  it('covers every flow once before any flow twice, so a stopped run still has a full first pass', async () => {
    const dir = tmp();
    const h = harness(['--flow', 'slot-coach,recap', '--per-flow', '2', '--repeat', '2', '--out', dir, '--concurrency', '1']);
    await main(h.options);
    expect(rowsOf(dir).map((r) => `${r.flow}#${r.repeat}`)).toEqual(['slot-coach#1', 'slot-coach#1', 'recap#1', 'recap#1', 'slot-coach#2', 'slot-coach#2', 'recap#2', 'recap#2']);

    // each call really costs $0.10; a $0.5 cap stops inside the second pass, after both flows ran once
    const capped = tmp();
    const g = harness(['--flow', 'slot-coach,recap', '--per-flow', '2', '--repeat', '2', '--max-cost-usd', '0.5', '--out', capped, '--concurrency', '1'], {
      caller: async (request) => respond(request, { completionTokens: 10000 }),
    });
    await main(g.options);
    const done = rowsOf(capped).filter((r) => !r.incomplete);
    expect(done.filter((r) => r.repeat === 1)).toHaveLength(4);
    expect(done.filter((r) => r.repeat === 2).length).toBeLessThan(4);
    expect(JSON.parse(readFileSync(path.join(capped, 'summary.json'), 'utf8')).meta.stoppedByCap).toBe(true);
  });
  it('runs Kale stage by stage and hands the one-liners to the narrative', async () => {
    const dir = tmp();
    const order: string[] = [];
    const h = harness(['--flow', 'kale-recap', '--per-flow', '1', '--out', dir], {
      caller: async (request) => {
        order.push(request.user.includes('Match summaries (written by you in the previous step') ? 'narrative+oneliners' : request.system.includes('single engaging sentence') ? 'one-liner' : 'other');
        return respond(request, { content: 'Ada beat Bram in a close match.' });
      },
    });
    await main(h.options);
    expect(order.at(-1)).toBe('narrative+oneliners');
    const firstOther = order.indexOf('other');
    expect(order.lastIndexOf('one-liner')).toBeLessThan(order.length - 1);
    expect(firstOther).toBeGreaterThan(-1);
    expect(order.filter((o) => o === 'narrative+oneliners')).toHaveLength(1);
    const row = rowsOf(dir)[0];
    expect(Object.keys(row.outputs)).toContain('narrative');
    expect(row.calls.length).toBeGreaterThanOrEqual(6);
  });

  it('records truncation, refusal and a fallback model per call', async () => {
    const dir = tmp();
    let n = 0;
    const h = harness(['--flow', 'slot-coach', '--per-flow', '4', '--out', dir, '--concurrency', '1'], {
      caller: async (request) => {
        n += 1;
        if (n === 1) return respond(request, { stopReason: 'max_tokens', completionTokens: 8000 });
        if (n === 2) return respond(request, { stopReason: 'refusal' });
        if (n === 3) return respond(request, { model: 'claude-haiku-5-5', fallbackUsed: true });
        return respond(request);
      },
    });
    await main(h.options);
    const [trunc, refused, fallback, clean] = rowsOf(dir);
    expect(trunc.calls[0]).toMatchObject({ truncated: true, outputTokens: 8000, stopReason: 'max_tokens' });
    expect(refused.calls[0].refused).toBe(true);
    expect(fallback.calls[0]).toMatchObject({ fallback: true, servedModel: 'claude-haiku-5-5' });
    // Haiku answered (1000 x $0.10/M + 400 x $0.50/M); the primary attempt that failed first is charged at its worst case
    expect(fallback.calls[0].failedAttemptUsd).toBeGreaterThan(0.08);
    expect(fallback.calls[0].costUsd).toBeCloseTo(0.0003 + fallback.calls[0].failedAttemptUsd, 8);
    expect(fallback.calls[0].costEstimated).toBe(true);
    expect(clean.pass).toBe(true);
    expect([trunc.pass, refused.pass, fallback.pass]).toEqual([false, false, true]);
    const summary = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8')).summaries[0];
    expect(summary).toMatchObject({ calls: 4, truncated: 1, refused: 1, fallback: 1 });
  });

  it('costs a typed truncation or refusal error by estimate and still counts it', async () => {
    const dir = tmp();
    let n = 0;
    const h = harness(['--flow', 'slot-coach', '--per-flow', '3', '--out', dir, '--concurrency', '1'], {
      caller: async () => {
        n += 1;
        if (n === 1) throw new OutputCapError('claude-sonnet-5-5', 8000);
        if (n === 2) throw new RefusalError('claude-sonnet-5-5', 'cyber');
        throw new Error('socket hang up');
      },
    });
    await main(h.options);
    const [cut, refused, broken] = rowsOf(dir);
    expect(cut.calls[0]).toMatchObject({ truncated: true, error: 'truncated', costEstimated: true, outputTokens: 8000 });
    expect(cut.calls[0].costUsd).toBeGreaterThan(0.08); // a full 8000 tokens of output at $10/M
    expect(refused.calls[0]).toMatchObject({ refused: true, error: 'refused' });
    expect(refused.calls[0].costUsd).toBeLessThan(cut.calls[0].costUsd);
    expect(broken.calls[0]).toMatchObject({ error: 'other', costUsd: 0 });
    expect([cut.pass, refused.pass, broken.pass]).toEqual([false, false, false]);
  });
});

describe('main: the cost cap', () => {
  it('stops before a call that could pass the cap and never spends above it', async () => {
    const dir = tmp();
    // Each call really costs ~$0.15 (15000 output tokens) and could cost up to ~$0.08 more: a $0.2 cap fits one.
    const h = harness(['--flow', 'slot-coach', '--per-flow', '8', '--max-cost-usd', '0.2', '--out', dir, '--concurrency', '1'], { caller: async (request) => respond(request, { completionTokens: 15000 }) });
    const code = await main(h.options);
    const summary = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
    expect(code).toBe(1);
    expect(summary.meta.stoppedByCap).toBe(true);
    expect(summary.meta.spentUsd).toBeLessThanOrEqual(0.2);
    expect(summary.meta.notRun).toBeGreaterThan(0);
    expect(h.calls).toHaveLength(1);
  });

  it('never starts a call when even one could pass the cap', async () => {
    const h = harness(['--flow', 'team-coach', '--per-flow', '1', '--max-cost-usd', '0.0001', '--out', tmp()]);
    expect(await main(h.options)).toBe(1);
    expect(h.calls).toHaveLength(0);
  });

  it('holds the cap for parallel Kale tasks too', async () => {
    const dir = tmp();
    const h = harness(['--flow', 'kale-recap', '--max-cost-usd', '0.08', '--out', dir]);
    await main(h.options);
    const summary = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
    expect(summary.meta.spentUsd).toBeLessThanOrEqual(0.08);
  });

  it('--resume skips what finished, counts the earlier spend toward the cap and continues', async () => {
    const dir = tmp();
    const first = harness(['--flow', 'slot-coach', '--per-flow', '6', '--max-cost-usd', '0.2', '--out', dir, '--concurrency', '1'], { caller: async (request) => respond(request, { completionTokens: 15000 }) });
    await main(first.options);
    const done = rowsOf(dir).filter((r) => !r.incomplete).length;
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(6);
    const spentBefore = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8')).meta.spentUsd as number;

    const second = harness(['--flow', 'slot-coach', '--per-flow', '6', '--max-cost-usd', '5', '--resume', dir, '--concurrency', '1']);
    expect(await main(second.options)).toBe(0);
    expect(second.calls).toHaveLength(6 - done);
    const rows = rowsOf(dir);
    expect(new Set(rows.map((r) => r.key)).size).toBe(6);
    const meta = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8')).meta;
    expect(meta.resumed).toBe(done);
    expect(meta.spentUsd).toBeCloseTo(spentBefore + (6 - done) * 0.006, 6);
  });

  it('priorRows keeps the last row of a key, drops a torn line and sums every row paid for', () => {
    const dir = tmp();
    const row = (key: string, cost: number, incomplete = false): string =>
      JSON.stringify({ key, calls: [{ costUsd: cost }], checks: [], incomplete });
    writeFileSync(path.join(dir, 'results.jsonl'), `${row('a/x/r1', 0.5, true)}\n${row('a/x/r1', 0.25)}\n{"key":"torn`);
    const prior = priorRows(dir);
    expect(prior.rows).toHaveLength(1);
    expect(prior.rows[0].incomplete).toBe(false);
    expect(prior.spentUsd).toBeCloseTo(0.75);
  });
});

describe('main: the cost cap holds for the primary and the fallback attempt', () => {
  const sonnetWorst = (promptTokens: number, maxTokens: number): number => (promptTokens * 2 + maxTokens * 10) / 1_000_000;

  it('reserves the worst case of both attempts, so a cap that fits only one attempt starts nothing', async () => {
    // the dry run prints the primary-only worst case of the call; the fallback attempt adds about 5% on top
    const dry = harness(['--dry-run', '--json', '--flow', 'slot-coach', '--per-flow', '1']);
    await main(dry.options);
    const primaryOnly = JSON.parse(dry.out.join('\n')).worstCaseUsd as number;
    const h = harness(['--flow', 'slot-coach', '--per-flow', '1', '--max-cost-usd', String(primaryOnly * 1.01), '--out', tmp()]);
    expect(await main(h.options)).toBe(1);
    expect(h.calls).toHaveLength(0);
    const ok = harness(['--flow', 'slot-coach', '--per-flow', '1', '--max-cost-usd', String(primaryOnly * 1.2), '--out', tmp()]);
    await main(ok.options);
    expect(ok.calls).toHaveLength(1);
  });
  it('charges a double transient failure at the worst case of both attempts, to the cap, results and resume', async () => {
    const dir = tmp();
    const h = harness(['--flow', 'slot-coach', '--per-flow', '2', '--max-cost-usd', '1', '--out', dir, '--concurrency', '1'], {
      caller: async () => {
        throw new Error('Connection error.');
      },
    });
    await main(h.options);
    const rows = rowsOf(dir);
    for (const r of rows) {
      expect(r.calls[0]).toMatchObject({ error: 'transient', costEstimated: true });
      expect(r.calls[0].costUsd).toBeGreaterThan(sonnetWorst(0, 8000));
      expect(r.calls[0].failedAttemptUsd).toBe(r.calls[0].costUsd);
    }
    const summary = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
    expect(summary.meta.spentUsd).toBeCloseTo(rows.reduce((s, r) => s + r.calls[0].costUsd, 0), 8);
    expect(summary.meta.spentUsd).toBeGreaterThan(0.16);
    expect(priorRows(dir).spentUsd).toBeCloseTo(summary.meta.spentUsd, 8);
    expect(summary.summaries[0].failedAttemptCostUsd).toBeCloseTo(summary.meta.spentUsd, 8);
  });

  it('stops a run that would have passed the cap only because failed attempts were free', async () => {
    const dir = tmp();
    const h = harness(['--flow', 'slot-coach', '--per-flow', '8', '--max-cost-usd', '0.3', '--out', dir, '--concurrency', '1'], {
      caller: async () => {
        throw new Error('Connection error.');
      },
    });
    await main(h.options);
    const spent = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8')).meta.spentUsd as number;
    expect(spent).toBeLessThanOrEqual(0.3);
    expect(h.calls.length).toBeLessThan(8);
  });

  it('a typed truncation from the fallback model also charges the primary attempt that failed first', async () => {
    const dir = tmp();
    const h = harness(['--flow', 'slot-coach', '--per-flow', '1', '--out', dir], {
      caller: async () => {
        throw new OutputCapError('claude-haiku-5-5', 8000);
      },
    });
    await main(h.options);
    const call = rowsOf(dir)[0].calls[0];
    expect(call).toMatchObject({ truncated: true, fallback: true });
    expect(call.costUsd).toBeGreaterThan(0.08 + 0.003); // primary worst + Haiku's 8000 output tokens
  });
});

describe('main: JSON flows are asked as production asks them', () => {
  it('sends jsonOutput for analysis and scouting only', async () => {
    const h = harness(['--flow', 'match-analysis,scouting,team-coach,kale-recap', '--per-flow', '1', '--out', tmp()]);
    await main(h.options);
    const by = new Map(h.calls.map((c) => [c.surface, c.jsonOutput]));
    expect(by.get('match-analysis')).toBe(true);
    expect(by.get('match-prep-analysis')).toBe(true);
    expect(by.get('team-coach')).toBe(false);
    expect(by.get('kale')).toBe(false);
  });

  it('records an all-thinking truncation (OutputCapError, no text) as truncated at worst-case cost, not as an empty answer', async () => {
    const dir = tmp();
    const h = harness(['--flow', 'match-analysis', '--per-flow', '1', '--out', dir], {
      caller: async () => {
        throw new OutputCapError('claude-sonnet-5-5', 16000);
      },
    });
    await main(h.options);
    const call = rowsOf(dir)[0].calls[0];
    expect(call).toMatchObject({ error: 'truncated', truncated: true, outputTokens: 16000, costEstimated: true });
    expect(call.costUsd).toBeGreaterThan(0.16);
    expect(rowsOf(dir)[0].pass).toBe(false);
  });
});

describe('main: --resume never mixes runs', () => {
  it('refuses a different model, effort, fixtures or flow set, sends nothing, and leaves config.json untouched', async () => {
    const dir = tmp();
    await main(harness(['--flow', 'recap', '--per-flow', '1', '--out', dir]).options);
    const before = readFileSync(path.join(dir, 'config.json'), 'utf8');
    for (const args of [['--model', 'claude-haiku-5-5'], ['--effort', 'high'], ['--fixtures', 'both'], ['--flow', 'recap,slot-coach']]) {
      const h = harness([...(args[0] === '--flow' ? [] : ['--flow', 'recap']), ...args, '--per-flow', '1', '--resume', dir]);
      expect(await main(h.options)).toBe(2);
      expect(h.err.join('\n')).toMatch(/different setup/);
      expect(h.calls).toHaveLength(0);
    }
    expect(readFileSync(path.join(dir, 'config.json'), 'utf8')).toBe(before);
  });

  it('resumes with the same setup and keeps the original config.json even when other flags differ', async () => {
    const dir = tmp();
    await main(harness(['--flow', 'recap', '--per-flow', '1', '--out', dir]).options);
    const before = readFileSync(path.join(dir, 'config.json'), 'utf8');
    const h = harness(['--flow', 'recap', '--per-flow', '2', '--max-cost-usd', '3', '--resume', dir]);
    expect(await main(h.options)).toBe(0);
    expect(h.calls).toHaveLength(1);
    expect(readFileSync(path.join(dir, 'config.json'), 'utf8')).toBe(before);
  });

  it('resumeMismatch reads the stored setup', () => {
    const stored = JSON.stringify({ model: 'm', effort: 'low', fixtures: 'synthetic', flows: ['b', 'a'] });
    const now = { model: 'm', effort: 'low', fixtures: 'synthetic', flows: ['a', 'b'] };
    expect(resumeMismatch(stored, now)).toBeNull();
    expect(resumeMismatch(null, now)).toBeNull();
    expect(resumeMismatch(stored, { ...now, model: 'x' })).toMatch(/model: m -> x/);
    expect(resumeMismatch('{', now)).toMatch(/unreadable/);
  });
});
describe('installEgressGuard', () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it('lets the model API through and blocks every other host', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response('{}');
    }) as typeof fetch;
    installEgressGuard();
    await expect(fetch('https://api.anthropic.com/v1/messages')).resolves.toBeInstanceOf(Response);
    await expect(fetch('https://example.supabase.co/rest/v1/matches')).rejects.toThrow(/blocked/);
    await expect(fetch('http://127.0.0.1:54321/rest/v1/matches')).rejects.toThrow(/blocked/);
    expect(seen).toEqual(['https://api.anthropic.com/v1/messages']);
  });
});

describe('results directory', () => {
  it('creates config.json without any secret', async () => {
    const dir = tmp();
    mkdirSync(dir, { recursive: true });
    const h = harness(['--flow', 'recap', '--per-flow', '1', '--out', dir]);
    await main(h.options);
    const config = readFileSync(path.join(dir, 'config.json'), 'utf8');
    expect(JSON.parse(config)).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium', repeat: 1 });
    expect(config).not.toContain(SECRET);
  });
});
