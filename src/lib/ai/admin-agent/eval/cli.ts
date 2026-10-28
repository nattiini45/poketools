/**
 * The command line of the Admin Assistant eval (plan 7.1 to 7.6). `scripts/admin-agent-eval.ts` is the thin entry; this
 * module holds the logic so a test can run it with injected input and output.
 *
 *   npx tsx --tsconfig scripts/tsconfig.admin-agent-eval.json scripts/admin-agent-eval.ts [flags]
 *
 *   --stage plan|exec|e2e   `plan` (default): the real loop against the fixture world, no domain writes. `exec`: the real loop with a
 *                           RECORDED model and the real staged tools, approved through the real routes and executor on the LOCAL
 *                           Supabase stack (no model call). `e2e`: the same with the real model. `exec` and `e2e` read the stack's
 *                           address and keys from `npx supabase status -o json` (never from an env file) and refuse any host but
 *                           127.0.0.1 / localhost. Run `npx supabase db reset --local` before a full run: the run never resets the
 *                           stack itself; its fixture loader (`baseline`: 24 Eval Players, a site admin, a league admin of L1, a tournament
 *                           admin of T1, the standard rulesets with a published version, the ready league L1, the tournament T1) is idempotent and loads once per run.
 *   --phase N              with no --cases, run the cases of the stage up to delivery phase N (default 0 for plan, 1 for exec and e2e)
 *   --port live|replay      `live` (default) calls the real model and needs ANTHROPIC_API_KEY; `replay` plays the recordings
 *                           offline and needs nothing (`--selftest` is the same). `live` with no key exits 2 before any request.
 *                           `exec` is always replay; an `e2e` case without a recording cannot run with `--port replay`.
 *   --cases RO1,SF         case ids, or an area prefix (`RO`), or an id with its German twin (`RO1` selects RO1 and RO1-DE)
 *   --repeat N             runs per case (1 to 5); a case passes only if every run passed (pass^k)
 *   --model ID --effort E  the live model and effort (default: the read-only model of the ADMIN_AGENT_* config)
 *   --out DIR              where results.jsonl and errors.jsonl go (default: a folder in the system temp directory)
 *   --resume DIR           continue a run: cases already scored in DIR/results.jsonl are skipped
 *   --record DIR           live only: write each sound transcript as a recording to DIR (replayable offline)
 *   --transcripts DIR      write every run's transcript and checks to DIR, passed or failed (for diagnosing failures)
 *   --judge                opt-in semantic fallback for answer groups (`grader.ts`, `judge.ts`), for --port live only: when no phrase of a
 *                          `mustMention` group that carries an `intent` matched, Haiku 5.5 (low effort) is asked whether the answer still
 *                          conveys that intent and may turn that one check into a pass if it quotes a sentence that is in the answer.
 *                          Off unless asked, so a live run stays comparable with the deterministic baseline; a few cents per run when on,
 *                          included in the cost, and the summary counts rescued passes apart from substring passes. A rescued run is never
 *                          written by --record (recordings replay offline without a judge). `--judge` with replay is a usage error.
 *   --timeout-sec N        wall-clock ceiling per case (default 180 live, 30 replay)
 *   --retries N            re-runs of a case whose model call failed (jittered backoff)
 *   --max-cost-usd X       live only: stop the suite once the cases scored so far cost more than X (default 5)
 *   --list                 print the cases and exit
 *   --json                 print the final summary as JSON
 *
 * Safety (plan 7.2, AGENTS.md "Automation never spends the Supabase quota"): a database variable that is not local stops
 * the run with exit code 2 before anything is imported; `fetch` is wrapped so nothing but local hosts (and the model API
 * on a live run) can be reached; the only environment variables read from an env file are the API key (ANTHROPIC_API_KEY, or the deprecated CLAUDE_API_KEY), and only on a live
 * run. Exit codes: 0 gates passed, 1 gates failed, 2 usage or environment problem.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { casesForStage, loadAllCases, loadAllRecordings, selectCases } from './data';
import { assertLocalSupabaseEnv, EvalHostError, installEgressGuard } from './host-guard';
import { createPortJudge, JUDGE_EFFORT, JUDGE_MODEL, type MentionJudge } from './judge';
import { formatSummary, summarize } from './report';
import { replayPorts, resultKey, runSuite, type RunCaseOptions, type RunOutcome } from './runner';
import { EVAL_STAGES, type EvalCase, type EvalStage } from './types';
import { stepFromResult } from './ports';
import type { AdminModelPort } from '../loop/types';
import type { CaseScore, Recording } from './types';

/**
 * The local-stack side of the `exec` and `e2e` stages, injected by the entry script (`scripts/admin-agent-eval/`) so this module
 * imports no database client, route or executor. `prepare` loads the baseline once; `runCase` runs one case and answers the same
 * outcome the plan stage does, with the stack's observation on its record.
 */
export interface StackHarness {
  prepare(): Promise<void>;
  runCase: NonNullable<RunSuiteRun>;
  close?(): Promise<void>;
}
type RunSuiteRun = Parameters<typeof runSuite>[0]['run'];

export interface CliIo {
  log(line: string): void;
  error(line: string): void;
}

export interface CliOptions {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  io: CliIo;
  /** Where the default output folder goes. */
  tempDir?: string;
  /** Reads an env file for the model key (live runs only). Defaults to the file system; absent file means no key. */
  readEnvFile?: (file: string) => string | null;
  now?: () => Date;
  /** Makes the live model port (default: the AI SDK port). Tests pass a fake; it also serves the judge's calls. */
  createPort?: (apiKey: string) => AdminModelPort | Promise<AdminModelPort>;
  /** The local-stack harness for `--stage exec|e2e`; the entry script builds it after the environment is prepared. */
  stack?: StackHarness;
}

interface Parsed {
  help: boolean;
  list: boolean;
  json: boolean;
  stage: string;
  /** `--phase`, or undefined when the stage's default applies. */
  phase?: number;
  /** `--port` was typed. */
  portExplicit: boolean;
  port: 'live' | 'replay';
  cases: string[];
  repeat: number;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  out?: string;
  resume?: string;
  record?: string;
  transcripts?: string;
  /** `--judge` was typed: the opt-in semantic fallback for answer groups. */
  judge?: boolean;
  timeoutSec?: number;
  retries: number;
  maxCostUsd: number;
}

export class UsageError extends Error {}

/** The names read from an env file on a live run: the key and its deprecated alias (see `src/lib/ai/api-key.ts`). */
const API_KEY_NAMES = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'] as const;
const VALUE_FLAGS = new Set(['--stage', '--phase', '--port', '--cases', '--repeat', '--model', '--effort', '--out', '--resume', '--record', '--transcripts', '--timeout-sec', '--retries', '--max-cost-usd']);

export function parseArgs(argv: readonly string[]): Parsed {
  const parsed: Parsed = { help: false, list: false, json: false, stage: 'plan', portExplicit: false, port: 'live', cases: [], repeat: 1, retries: 0, maxCostUsd: 5 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') parsed.help = true;
    else if (flag === '--list') parsed.list = true;
    else if (flag === '--json') parsed.json = true;
    else if (flag === '--selftest') {
      parsed.port = 'replay';
      parsed.portExplicit = true;
    }
    else if (flag === '--judge') parsed.judge = true;
    else if (VALUE_FLAGS.has(flag)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
      i += 1;
      switch (flag) {
        case '--stage':
          if (!(EVAL_STAGES as readonly string[]).includes(value)) throw new UsageError('--stage is plan, exec or e2e');
          parsed.stage = value;
          break;
        case '--phase':
          parsed.phase = Number(value);
          if (!Number.isInteger(parsed.phase) || parsed.phase < 0 || parsed.phase > 5) throw new UsageError('--phase is a whole number from 0 to 5');
          break;
        case '--port':
          if (value !== 'live' && value !== 'replay') throw new UsageError('--port is live or replay');
          parsed.port = value;
          parsed.portExplicit = true;
          break;
        case '--cases':
          parsed.cases = value.split(',').map((v) => v.trim()).filter(Boolean);
          break;
        case '--repeat':
          parsed.repeat = Number(value);
          if (!Number.isInteger(parsed.repeat) || parsed.repeat < 1 || parsed.repeat > 5) throw new UsageError('--repeat is a whole number from 1 to 5');
          break;
        case '--model':
          if (!/^claude-[a-z0-9][a-z0-9.-]{0,63}$/.test(value)) throw new UsageError("--model is an Anthropic model id such as 'claude-…'");
          parsed.model = value;
          break;
        case '--effort':
          if (value !== 'low' && value !== 'medium' && value !== 'high') throw new UsageError('--effort is low, medium or high (the plan sets high as the ceiling)');
          parsed.effort = value;
          break;
        case '--out':
          parsed.out = value;
          break;
        case '--resume':
          parsed.resume = value;
          break;
        case '--record':
          parsed.record = value;
          break;
        case '--transcripts':
          parsed.transcripts = value;
          break;
        case '--timeout-sec':
          parsed.timeoutSec = Number(value);
          if (!Number.isFinite(parsed.timeoutSec) || parsed.timeoutSec <= 0) throw new UsageError('--timeout-sec is a positive number');
          break;
        case '--retries':
          parsed.retries = Number(value);
          if (!Number.isInteger(parsed.retries) || parsed.retries < 0 || parsed.retries > 5) throw new UsageError('--retries is a whole number from 0 to 5');
          break;
        case '--max-cost-usd':
          parsed.maxCostUsd = Number(value);
          if (!Number.isFinite(parsed.maxCostUsd) || parsed.maxCostUsd <= 0) throw new UsageError('--max-cost-usd is a positive number');
          break;
      }
    } else {
      throw new UsageError(`unknown argument ${flag}`);
    }
  }
  return parsed;
}

/**
 * The value of each allow-listed key in the text of an env file, and nothing else: the eval never loads a whole env file
 * (the player agent's runner does, and would hand the service-role key to a harness that must not have it).
 */
export function readAllowedKeys(text: string, allowed: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!allowed.includes(key)) continue;
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (value !== '') out[key] = value;
  }
  return out;
}

const USAGE = `admin-agent eval. Flags: --stage plan|exec|e2e, --phase N, --port live|replay (--selftest), --cases IDS, --repeat N, --model ID, --effort low|medium|high, --out DIR, --resume DIR, --record DIR, --transcripts DIR, --judge, --timeout-sec N, --retries N, --max-cost-usd X, --list, --json, --help. See the header of src/lib/ai/admin-agent/eval/cli.ts.`;

function readIfPresent(file: string): string | null {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

/** The scores already in `dir/results.jsonl`, for `--resume` (a torn last line from an interrupted run is dropped). */
function priorScores(dir: string): CaseScore[] {
  const out: CaseScore[] = [];
  const text = readIfPresent(path.join(dir, 'results.jsonl'));
  for (const line of (text ?? '').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line) as CaseScore;
      if (typeof row.caseId === 'string' && typeof row.repeat === 'number' && Array.isArray(row.checks)) out.push(row);
    } catch {
      // That case runs again.
    }
  }
  return out;
}

/** A transcript of a finished live case as a recording: one list of steps per turn. */
export function recordingOf(outcome: RunOutcome): Recording {
  const steps = outcome.steps.map(stepFromResult);
  let at = 0;
  const turns = outcome.record.turns.map((turn) => {
    const slice = steps.slice(at, at + turn.steps);
    at += turn.steps;
    return slice;
  });
  return { turns: turns.map((t) => (t.length > 0 ? t : [{ text: '' }])) };
}

/**
 * The loop and the tools log the cause of a failure under `[admin-agent]` (and the routes under `[API]`) on the server console, as production does (the
 * model never sees it). A run would bury its own output under those lines, so they go to `server.log` next to the results.
 */
function captureServerLog(file: string): () => void {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && /^\[(?:admin-agent|API)\]/.test(args[0])) {
      appendFileSync(file, `${args.map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message) : String(arg))).join(' ')}\n`);
      return;
    }
    original(...args);
  };
  return () => {
    console.error = original;
  };
}

/** The live port of a real run: the AI SDK port with the key the run resolved. */
async function defaultLivePort(apiKey: string): Promise<AdminModelPort> {
  const { createAiSdkModelPort } = await import('../loop/ai-sdk-port');
  return createAiSdkModelPort({ apiKey });
}

export async function main(options: CliOptions): Promise<number> {
  const { io, env } = options;
  let parsed: Parsed;
  try {
    parsed = parseArgs(options.argv);
  } catch (error) {
    io.error(`admin-agent eval: ${error instanceof UsageError ? error.message : 'bad arguments'}\n${USAGE}`);
    return 2;
  }
  if (parsed.help) {
    io.log(USAGE);
    return 0;
  }
  const stage = parsed.stage as EvalStage;
  const stack = options.stack;
  if (stage !== 'plan' && stack === undefined) {
    io.error(`admin-agent eval: stage '${stage}' is not built yet in this entry: it runs on the local Supabase stack, and only scripts/admin-agent-eval.ts prepares that and hands it over (npx tsx --tsconfig scripts/tsconfig.admin-agent-eval.json scripts/admin-agent-eval.ts --stage ${stage}).`);
    return 2;
  }
  if (stage === 'exec' && parsed.portExplicit && parsed.port === 'live') {
    io.error('admin-agent eval: --stage exec replays a recorded model and never calls the real one. Drop --port live, or use --stage e2e.');
    return 2;
  }
  if (stage === 'exec') parsed.port = 'replay';

  if (parsed.judge === true && parsed.port === 'replay') {
    io.error('admin-agent eval: --judge asks the real model, and --port replay runs offline. Use --port live, or drop --judge.');
    return 2;
  }

  // Host guard first: nothing else runs against a database that is not this machine.
  try {
    assertLocalSupabaseEnv(env);
  } catch (error) {
    if (error instanceof EvalHostError) {
      io.error(error.message);
      return 2;
    }
    throw error;
  }

  let cases: EvalCase[];
  let recordings: Record<string, Recording>;
  try {
    const all = loadAllCases();
    recordings = loadAllRecordings();
    if (parsed.cases.length === 0) {
      cases = casesForStage(all, stage, parsed.phase ?? (stage === 'plan' ? 0 : 1));
    } else {
      cases = selectCases(all, parsed.cases);
      const elsewhere = cases.filter((c) => c.stage !== stage);
      if (elsewhere.length > 0) {
        io.error(`admin-agent eval: ${elsewhere.map((c) => `${c.id} is a ${c.stage} case`).join(', ')}; run it with --stage ${elsewhere[0].stage}.`);
        return 2;
      }
    }
    if (cases.length === 0) {
      io.error(`admin-agent eval: no ${stage}-stage case is selected${parsed.phase === undefined ? '' : ` up to phase ${parsed.phase}`}.`);
      return 2;
    }
    if (parsed.port === 'replay') {
      const missing = cases.filter((c) => recordings[c.id] === undefined).map((c) => c.id);
      if (missing.length > 0) {
        io.error(`admin-agent eval: --port replay needs a recording; none for ${missing.join(', ')}.`);
        return 2;
      }
    }
  } catch (error) {
    io.error(error instanceof Error ? error.message : 'admin-agent eval: could not load the cases');
    return 2;
  }
  if (parsed.list) {
    for (const c of cases) io.log(`${c.id.padEnd(8)} ${c.locale} ${c.actor.padEnd(16)} ${c.summary}${c.blockedBy === undefined ? '' : `  [blocked: ${c.blockedBy}]`}`);
    return 0;
  }

  let makePort: RunCaseOptions['makePort'];
  let judge: MentionJudge | undefined;
  if (parsed.port === 'replay') {
    makePort = replayPorts(recordings);
  } else {
    // `ANTHROPIC_API_KEY`, or the deprecated `CLAUDE_API_KEY` (the order of `anthropicApiKey()`).
    const fromEnv = env.ANTHROPIC_API_KEY?.trim() || env.CLAUDE_API_KEY?.trim();
    const fromFile = fromEnv ? {} : readAllowedKeys((options.readEnvFile ?? readIfPresent)(path.resolve('.env.local')) ?? '', [...API_KEY_NAMES]);
    const apiKey = fromEnv || fromFile.ANTHROPIC_API_KEY || fromFile.CLAUDE_API_KEY;
    if (!apiKey) {
      io.error(
        'admin-agent eval: --port live needs ANTHROPIC_API_KEY (the plan stage calls the real model). Set it in your shell or in .env.local, or run the offline self-test with --port replay. No request was made.',
      );
      return 2;
    }
    const livePort = await (options.createPort ?? defaultLivePort)(apiKey);
    makePort = () => ({ port: livePort });
    // The judge asks the same port (same provider setup, key and guarded fetch) for its small model; it is off unless --judge.
    if (parsed.judge === true) judge = createPortJudge(livePort);
  }

  const now = options.now ?? (() => new Date());
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(parsed.resume ?? parsed.out ?? path.join(options.tempDir ?? tmpdir(), 'poketools-admin-agent-eval', `${parsed.port}-${stamp}`));
  mkdirSync(outDir, { recursive: true });
  const resultsFile = path.join(outDir, 'results.jsonl');
  const errorsFile = path.join(outDir, 'errors.jsonl');
  const prior = parsed.resume ? priorScores(outDir) : [];
  const done = new Set(prior.map((score) => resultKey(score.caseId, score.repeat)));
  if (parsed.record) mkdirSync(path.resolve(parsed.record), { recursive: true });
  if (parsed.transcripts) mkdirSync(path.resolve(parsed.transcripts), { recursive: true });

  io.log(`admin-agent eval: stage ${stage}, ${cases.length} case(s), port ${parsed.port}, repeat ${parsed.repeat}, judge ${judge ? `${JUDGE_MODEL} ${JUDGE_EFFORT}` : 'off'}, results in ${outDir}`);
  const restoreFetch = installEgressGuard(globalThis, { allowModelApi: parsed.port === 'live', onBlocked: (host) => io.error(`admin-agent eval: blocked a request to ${host}`) });
  const restoreConsole = captureServerLog(path.join(outDir, 'server.log'));
  let spent = 0;
  try {
    if (stack !== undefined) await stack.prepare();
    const scores = await runSuite({
      cases,
      ...(stack ? { run: stack.runCase } : {}),
      repeat: parsed.repeat,
      makePort,
      ...(parsed.model ? { model: parsed.model } : {}),
      ...(parsed.effort ? { effort: parsed.effort } : {}),
      timeoutMs: (parsed.timeoutSec ?? (parsed.port === 'live' ? 180 : 30)) * 1000,
      retries: parsed.retries,
      done,
      ...(judge ? { judge } : {}),
      stop: () => parsed.port === 'live' && spent / 1_000_000 > parsed.maxCostUsd,
      onScore(score, outcome) {
        spent += score.metrics.costUsdMicro;
        appendFileSync(resultsFile, `${JSON.stringify({ ...score, model: outcome.record.model, effort: outcome.record.effort, port: parsed.port })}\n`);
        // A recording is replayed offline with no judge, so only a run that passes on the phrases alone may become one.
        const rescued = score.judge?.rescues ?? 0;
        if (parsed.record && parsed.port === 'live' && score.pass && rescued > 0) {
          io.log(`not recorded: ${score.caseId}#${score.repeat} passed only through ${rescued} judge rescue${rescued === 1 ? '' : 's'}, and a recording must pass offline without the judge`);
        }
        if (parsed.record && parsed.port === 'live' && score.pass && rescued === 0) {
          writeFileSync(path.join(path.resolve(parsed.record), `${score.caseId}.json`), `${JSON.stringify({ [score.caseId]: recordingOf(outcome) }, null, 2)}\n`);
        }
        if (parsed.transcripts) {
          const file = path.join(path.resolve(parsed.transcripts), `${score.caseId}#${score.repeat}.json`);
          writeFileSync(file, `${JSON.stringify({ caseId: score.caseId, pass: score.pass, checks: score.checks, steps: recordingOf(outcome), status: outcome.record.status, failure: outcome.record.failure, turns: outcome.record.turns, toolCalls: outcome.record.toolCalls, plan: outcome.record.plan, proposals: outcome.record.proposals, ...(outcome.record.stack ? { stack: outcome.record.stack } : {}) }, null, 2)}
`);
        }
        const failed = score.checks.filter((c) => !c.pass).map((c) => c.name);
        io.log(`${score.pass ? 'PASS' : 'FAIL'}  ${score.caseId}#${score.repeat}  ${score.metrics.modelRequests} requests, ${score.metrics.toolCalls} tool calls${rescued > 0 ? `, judge rescued ${rescued}` : ''}${failed.length > 0 ? `  failed: ${failed.join('; ')}` : ''}`);
      },
      onError(record) {
        appendFileSync(errorsFile, `${JSON.stringify({ caseId: record.caseId, repeat: record.repeat, status: record.status, failure: record.failure, durationMs: record.durationMs })}\n`);
      },
    });
    const summary = summarize([...prior, ...scores]);
    io.log(parsed.json ? JSON.stringify(summary, null, 2) : formatSummary(summary));
    if (parsed.port === 'replay' && !parsed.json) io.log('(replay: token counts and costs are simulated from the recordings, not measured)');
    if (parsed.port === 'live' && spent / 1_000_000 > parsed.maxCostUsd) io.error(`admin-agent eval: stopped early, the cases scored so far cost more than $${parsed.maxCostUsd}`);
    return summary.ok ? 0 : 1;
  } finally {
    await stack?.close?.();
    restoreConsole();
    restoreFetch();
  }
}
