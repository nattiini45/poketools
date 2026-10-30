/**
 * The command line of the AI flow eval. `scripts/ai-flow-eval.ts` is the thin entry (it loads the API
 * key and installs the egress guard); this module holds the logic so a test can run it with injected
 * input, output and model.
 *
 *   npx tsx --tsconfig scripts/tsconfig.ai-flow-eval.json scripts/ai-flow-eval.ts [flags]     (npm run eval:ai-flows -- [flags])
 *
 *   --flow A,B             flows to run (default all): kale-recap, kale-forecast, match-analysis, scouting, team-coach, slot-coach, recap
 *   --cases ID,ID          only cases whose id equals or starts with one of these
 *   --per-flow N           at most N cases per flow (the first N), to fit a budget
 *   --repeat N             runs per case (1 to 5)
 *   --model ID             model to ask (default CLAUDE_MODEL, then claude-sonnet-5-5); must have a price in pricing.ts
 *   --effort E             low, medium or high (default CLAUDE_API_EFFORT, then medium)
 *   --max-cost-usd X       hard stop: no call starts that could take the run past X (default 5)
 *   --fixtures S           synthetic (default), internal (.internal/evals/ai-flows/fixtures) or both
 *   --concurrency N        runs in flight at once inside a flow (default 3)
 *   --out DIR              where results.jsonl, report.md, summary.json and server.log go (default .internal/evals/ai-flows/<run>)
 *   --resume DIR           continue a run: complete runs in DIR/results.jsonl are skipped, their cost counts toward the cap
 *   --env-file FILE        read the API key (ANTHROPIC_API_KEY or CLAUDE_API_KEY, nothing else) from this env file
 *   --dry-run              render every prompt, print token and cost estimates, make no network call (writes the prompts to DIR/prompts when --out is given)
 *   --list                 print the cases and exit
 *   --json                 print the final summary as JSON
 *
 * Exit codes: 0 the run finished and every hard check passed, 1 it finished with failed hard checks or
 * was stopped by the cost cap, 2 usage or environment problem (nothing was sent).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CostGuard } from './cost-guard';
import { loadCases, FixtureError, type FixtureSource, type LoadedCase } from './fixtures';
import { expectedOutputTokens, planCase, type ExecContext } from './flows';
import { createDexLookup, type SpeciesLookup } from './graders';
import { createLiveCaller } from './live';
import { estimateTokens, priceOf, pricedModels, worstCaseCostUsd } from './pricing';
import { formatReport, summarize, type FlowSummary } from './report';
import { runSuite } from './runner';
import { EVAL_EFFORTS, FLOW_IDS, type EvalEffort, type FlowId, type ModelCaller, type RunRow } from './types';

export interface CliIo {
  log(line: string): void;
  error(line: string): void;
}

export interface CliOptions {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  io: CliIo;
  /** Repository root: where fixtures are read and the default output folder goes. */
  root: string;
  now?: () => Date;
  /** Reads an env file for the API key. Defaults to the file system; an absent file means no key. */
  readEnvFile?: (file: string) => string | null;
  /** Makes the live model caller (default: the app's own call paths). Tests pass a fake. */
  createCaller?: () => Promise<ModelCaller>;
  createLookup?: () => Promise<SpeciesLookup>;
}

export class UsageError extends Error {}

interface Parsed {
  help: boolean;
  list: boolean;
  json: boolean;
  dryRun: boolean;
  flows: FlowId[];
  cases: string[];
  perFlow?: number;
  repeat: number;
  model?: string;
  effort?: EvalEffort;
  maxCostUsd: number;
  fixtures: FixtureSource;
  concurrency: number;
  out?: string;
  resume?: string;
  envFile?: string;
}

const VALUE_FLAGS = new Set([
  '--flow', '--cases', '--per-flow', '--repeat', '--model', '--effort', '--max-cost-usd', '--fixtures', '--concurrency', '--out', '--resume', '--env-file',
]);

export function parseArgs(argv: readonly string[]): Parsed {
  const parsed: Parsed = {
    help: false, list: false, json: false, dryRun: false, flows: [...FLOW_IDS], cases: [], repeat: 1, maxCostUsd: 5, fixtures: 'synthetic', concurrency: 3,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') parsed.help = true;
    else if (flag === '--list') parsed.list = true;
    else if (flag === '--json') parsed.json = true;
    else if (flag === '--dry-run') parsed.dryRun = true;
    else if (VALUE_FLAGS.has(flag)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) throw new UsageError(`${flag} needs a value (a value cannot start with '-')`);
      i += 1;
      switch (flag) {
        case '--flow': {
          const wanted = value.split(',').map((v) => v.trim()).filter(Boolean);
          const unknown = wanted.filter((f) => !(FLOW_IDS as readonly string[]).includes(f));
          if (unknown.length > 0) throw new UsageError(`unknown flow ${unknown.join(', ')} (flows: ${FLOW_IDS.join(', ')})`);
          parsed.flows = FLOW_IDS.filter((f) => wanted.includes(f));
          break;
        }
        case '--cases':
          parsed.cases = value.split(',').map((v) => v.trim()).filter(Boolean);
          break;
        case '--per-flow':
          parsed.perFlow = Number(value);
          if (!Number.isInteger(parsed.perFlow) || parsed.perFlow < 1) throw new UsageError('--per-flow is a whole number of 1 or more');
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
          if (!(EVAL_EFFORTS as readonly string[]).includes(value)) throw new UsageError('--effort is low, medium or high');
          parsed.effort = value as EvalEffort;
          break;
        case '--max-cost-usd':
          parsed.maxCostUsd = Number(value);
          if (!Number.isFinite(parsed.maxCostUsd) || parsed.maxCostUsd <= 0) throw new UsageError('--max-cost-usd is a positive number');
          break;
        case '--fixtures':
          if (value !== 'synthetic' && value !== 'internal' && value !== 'both') throw new UsageError('--fixtures is synthetic, internal or both');
          parsed.fixtures = value;
          break;
        case '--concurrency':
          parsed.concurrency = Number(value);
          if (!Number.isInteger(parsed.concurrency) || parsed.concurrency < 1 || parsed.concurrency > 8) throw new UsageError('--concurrency is a whole number from 1 to 8');
          break;
        case '--out':
          parsed.out = value;
          break;
        case '--resume':
          parsed.resume = value;
          break;
        case '--env-file':
          parsed.envFile = value;
          break;
      }
    } else {
      throw new UsageError(`unknown argument ${flag}`);
    }
  }
  if (parsed.out !== undefined && parsed.resume !== undefined) throw new UsageError('--out and --resume are exclusive: a resumed run keeps writing to its own folder');
  return parsed;
}

/** The value of each allow-listed key in the text of an env file, and nothing else. */
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

const API_KEY_NAMES = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'] as const;

/** Only the model API may be reached: a run must never touch a database or any other host. */
export function installEgressGuard(allowedHosts: readonly string[] = ['api.anthropic.com']): void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      // A relative URL has no host to allow.
    }
    if (!allowedHosts.includes(host)) throw new Error(`ai-flow eval: a request to ${host || 'an unknown host'} was blocked; only ${allowedHosts.join(', ')} may be reached`);
    return original(input, init);
  }) as typeof fetch;
}

const USAGE = `ai-flow eval. Flags: --flow A,B, --cases IDS, --per-flow N, --repeat N, --model ID, --effort low|medium|high, --max-cost-usd X, --fixtures synthetic|internal|both, --concurrency N, --out DIR, --resume DIR, --env-file FILE, --dry-run, --list, --json, --help. See the header of src/lib/ai/flow-eval/cli.ts.`;

function readIfPresent(file: string): string | null {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

/** The rows already in `dir/results.jsonl` (the last row of a key wins; a torn last line is dropped) and what they cost. */
export function priorRows(dir: string): { rows: RunRow[]; spentUsd: number } {
  const text = readIfPresent(path.join(dir, 'results.jsonl'));
  const all: RunRow[] = [];
  for (const line of (text ?? '').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line) as RunRow;
      if (typeof row.key === 'string' && Array.isArray(row.calls) && Array.isArray(row.checks)) all.push(row);
    } catch {
      // That run runs again.
    }
  }
  const last = new Map<string, RunRow>();
  for (const row of all) last.set(row.key, row);
  // Every row ever written was paid for, replaced or not.
  const spentUsd = all.reduce((sum, row) => sum + row.calls.reduce((s, c) => s + c.costUsd, 0), 0);
  return { rows: [...last.values()], spentUsd };
}

/** What differs between a resumed run's stored config and the flags of this invocation, or null when they agree (or there is no stored config). */
export function resumeMismatch(stored: string | null, now: { model: string; effort: string; fixtures: string; flows: readonly string[] }): string | null {
  if (stored === null) return null;
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(stored) as Record<string, unknown>;
  } catch {
    return 'config.json is unreadable';
  }
  const differences: string[] = [];
  for (const key of ['model', 'effort', 'fixtures'] as const) {
    if (config[key] !== now[key]) differences.push(`${key}: ${String(config[key])} -> ${now[key]}`);
  }
  const storedFlows = Array.isArray(config.flows) ? (config.flows as unknown[]).map(String).sort().join(',') : '';
  if (storedFlows !== [...now.flows].sort().join(',')) differences.push('flows');
  return differences.length > 0 ? differences.join('; ') : null;
}

function selectCases(all: LoadedCase[], parsed: Parsed): LoadedCase[] {
  let selected = all.filter((c) => parsed.flows.includes(c.flow));
  if (parsed.cases.length > 0) {
    selected = selected.filter((c) => parsed.cases.some((id) => c.case.id === id || c.case.id.startsWith(id)));
  }
  if (parsed.perFlow !== undefined) {
    const counts = new Map<FlowId, number>();
    selected = selected.filter((c) => {
      const n = counts.get(c.flow) ?? 0;
      counts.set(c.flow, n + 1);
      return n < parsed.perFlow!;
    });
  }
  return selected;
}

interface FlowEstimate {
  flow: FlowId;
  cases: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function estimate(cases: readonly LoadedCase[], model: string, repeat: number): { perFlow: FlowEstimate[]; totalUsd: number } {
  const price = priceOf(model);
  if (!price) throw new UsageError(`no price for model ${model}`);
  const perFlow: FlowEstimate[] = [];
  for (const flow of FLOW_IDS) {
    const ofFlow = cases.filter((c) => c.flow === flow);
    if (ofFlow.length === 0) continue;
    let calls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    for (const loaded of ofFlow) {
      for (const call of planCase(flow, loaded.case)) {
        calls += 1;
        inputTokens += estimateTokens(call.system) + estimateTokens(call.user);
        outputTokens += expectedOutputTokens(flow, call.taskId);
      }
    }
    const costUsd = ((inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000) * repeat;
    perFlow.push({ flow, cases: ofFlow.length, calls: calls * repeat, inputTokens: inputTokens * repeat, outputTokens: outputTokens * repeat, costUsd });
  }
  return { perFlow, totalUsd: perFlow.reduce((s, f) => s + f.costUsd, 0) };
}

function slug(text: string): string {
  return text.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '');
}

/** Route the app's own console output (usage lines, fallback warnings) to a file, so it does not bury the eval's output. */
function captureServerLog(file: string): () => void {
  const originals = { info: console.info, warn: console.warn, error: console.error };
  const write = (...args: unknown[]): void => {
    appendFileSync(file, `${args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
  };
  console.info = write;
  console.warn = write;
  console.error = write;
  return () => {
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
  };
}

export async function main(options: CliOptions): Promise<number> {
  const { io, env } = options;
  let parsed: Parsed;
  try {
    parsed = parseArgs(options.argv);
  } catch (error) {
    io.error(`ai-flow eval: ${error instanceof UsageError ? error.message : 'bad arguments'}\n${USAGE}`);
    return 2;
  }
  if (parsed.help) {
    io.log(USAGE);
    return 0;
  }

  const model = parsed.model ?? (env.CLAUDE_MODEL || 'claude-sonnet-5-5');
  const effort = parsed.effort ?? (EVAL_EFFORTS.find((e) => e === env.CLAUDE_API_EFFORT) ?? 'medium');
  if (!priceOf(model)) {
    io.error(`ai-flow eval: no price for model ${model}; the cost cap needs one (priced: ${pricedModels().join(', ')}).`);
    return 2;
  }

  let cases: LoadedCase[];
  try {
    cases = selectCases(loadCases(options.root, parsed.flows, parsed.fixtures), parsed);
  } catch (error) {
    io.error(`ai-flow eval: ${error instanceof FixtureError ? error.message : 'fixtures could not be loaded'}`);
    return 2;
  }
  if (cases.length === 0) {
    io.error('ai-flow eval: no cases selected. Build the synthetic fixtures with `npm run eval:ai-flows:fixtures`, or check --flow, --cases and --fixtures.');
    return 2;
  }

  if (parsed.list) {
    for (const c of cases) io.log(`${c.flow.padEnd(15)} ${c.case.id.padEnd(28)} ${c.case.locale}  ${c.source === 'internal' ? '[internal] ' : ''}${c.case.label}`);
    return 0;
  }

  const est = estimate(cases, model, parsed.repeat);
  const now = options.now ?? (() => new Date());
  const runName = parsed.resume ? path.basename(parsed.resume) : `${now().toISOString().replace(/[:.]/g, '-')}-${slug(model)}-${effort}`;
  const outDir = path.resolve(options.root, parsed.resume ?? parsed.out ?? path.join('.internal', 'evals', 'ai-flows', runName));

  // ─── Dry run: prompts and estimates, no key, no network ─────────────
  if (parsed.dryRun) {
    if (parsed.out !== undefined) {
      for (const loaded of cases) {
        const dir = path.join(outDir, 'prompts', loaded.flow, loaded.case.id);
        mkdirSync(dir, { recursive: true });
        for (const call of planCase(loaded.flow, loaded.case)) {
          writeFileSync(path.join(dir, `${call.taskId}.txt`), `=== SYSTEM ===\n${call.system}\n\n=== USER ===\n${call.user}\n`);
        }
      }
    }
    const worstCase = cases.reduce(
      (sum, c) => sum + planCase(c.flow, c.case).reduce((s, call) => s + worstCaseCostUsd(model, estimateTokens(call.system) + estimateTokens(call.user), call.maxTokens), 0),
      0,
    ) * parsed.repeat;
    if (parsed.json) {
      io.log(JSON.stringify({ dryRun: true, model, effort, repeat: parsed.repeat, capUsd: parsed.maxCostUsd, estimate: est, worstCaseUsd: worstCase }, null, 2));
    } else {
      io.log(`dry run: ${model} at effort ${effort}, repeat ${parsed.repeat}, ${cases.length} case(s); no network call, no key read`);
      io.log('flow             cases  calls  est in tok  est out tok  est cost');
      for (const f of est.perFlow) {
        io.log(`${f.flow.padEnd(16)} ${String(f.cases).padStart(5)}  ${String(f.calls).padStart(5)}  ${String(f.inputTokens).padStart(10)}  ${String(f.outputTokens).padStart(11)}  $${f.costUsd.toFixed(3)}`);
      }
      io.log(`estimated cost $${est.totalUsd.toFixed(3)} (expected output per call is an assumption; worst case, every call at max_tokens, is $${worstCase.toFixed(2)})`);
      if (est.totalUsd > parsed.maxCostUsd) io.log(`WARNING: the estimate is over the cap of $${parsed.maxCostUsd}; lower --per-flow or --cases.`);
    }
    return 0;
  }

  // ─── Live run ───────────────────────────────────────────────────────
  const configFile = path.join(outDir, 'config.json');
  if (parsed.resume !== undefined) {
    const mismatch = resumeMismatch(readIfPresent(configFile), { model, effort, fixtures: parsed.fixtures, flows: parsed.flows });
    if (mismatch) {
      io.error(`ai-flow eval: --resume ${parsed.resume} was started with a different setup (${mismatch}). Resume with the same --model, --effort, --fixtures and --flow, or start a new run.`);
      return 2;
    }
  }
  // Same order as `anthropicApiKey()`: ANTHROPIC_API_KEY, then the deprecated CLAUDE_API_KEY; blank counts as unset.
  let apiKey = (env.ANTHROPIC_API_KEY ?? '').trim() || (env.CLAUDE_API_KEY ?? '').trim();
  if (!apiKey) {
    const file = path.resolve(options.root, parsed.envFile ?? env.AI_FLOW_EVAL_ENV_FILE ?? '.env.local');
    const text = (options.readEnvFile ?? readIfPresent)(file);
    const keys = text === null ? {} : readAllowedKeys(text, API_KEY_NAMES);
    apiKey = keys.ANTHROPIC_API_KEY || keys.CLAUDE_API_KEY || '';
  }
  if (!apiKey) {
    io.error('ai-flow eval: no API key (ANTHROPIC_API_KEY or CLAUDE_API_KEY in the environment or an env file; see --env-file). Nothing was sent. Use --dry-run to see the prompts and the estimate.');
    return 2;
  }
  // The app's call paths read these; nothing else is taken from an env file, and tracing stays off.
  env.ANTHROPIC_API_KEY = apiKey;
  env.CLAUDE_MODEL = model;
  env.CLAUDE_API_EFFORT = effort;
  delete env.BRAINTRUST_API_KEY;

  mkdirSync(outDir, { recursive: true });
  const prior = parsed.resume ? priorRows(outDir) : { rows: [] as RunRow[], spentUsd: 0 };
  const guard = new CostGuard(parsed.maxCostUsd, prior.spentUsd);
  const resultsFile = path.join(outDir, 'results.jsonl');
  // A resumed run keeps the config it was started with; it is written only when it is missing.
  if (parsed.resume === undefined || !existsSync(configFile)) writeFileSync(configFile, JSON.stringify({ runName, model, effort, repeat: parsed.repeat, capUsd: parsed.maxCostUsd, flows: parsed.flows, fixtures: parsed.fixtures, cases: cases.map((c) => `${c.flow}/${c.case.id}`) }, null, 2));

  io.log(`ai-flow eval ${runName}: ${model}, effort ${effort}, repeat ${parsed.repeat}, ${cases.length} case(s), cap $${parsed.maxCostUsd}, estimate $${est.totalUsd.toFixed(2)}${prior.spentUsd > 0 ? `, $${prior.spentUsd.toFixed(4)} already spent` : ''}`);

  const caller = await (options.createCaller ?? createLiveCaller)();
  const lookup = await (options.createLookup ?? createDexLookup)();
  const ctx: ExecContext = { settings: { model, effort }, caller, guard, lookup };
  const restoreConsole = captureServerLog(path.join(outDir, 'server.log'));
  let result;
  try {
    result = await runSuite({
      cases,
      repeat: parsed.repeat,
      ctx,
      concurrency: parsed.concurrency,
      priorRows: prior.rows,
      onRow: (row) => appendFileSync(resultsFile, `${JSON.stringify(row)}\n`),
      onProgress: (line) => io.log(line),
    });
  } finally {
    restoreConsole();
  }

  const allRows = [...prior.rows.filter((r) => !result.rows.some((n) => n.key === r.key)), ...result.rows];
  const summaries: FlowSummary[] = summarize(allRows);
  const meta = {
    runName, model, effort, repeat: parsed.repeat, capUsd: parsed.maxCostUsd, spentUsd: guard.spentUsd,
    stoppedByCap: guard.stopped, notRun: result.notRun.length, resumed: result.resumed.length, startedAt: now().toISOString(),
  };
  writeFileSync(path.join(outDir, 'report.md'), formatReport(summaries, meta));
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ meta, summaries }, null, 2));

  if (parsed.json) io.log(JSON.stringify({ meta, summaries }, null, 2));
  else {
    io.log('');
    io.log(formatReport(summaries, meta));
    io.log(`results: ${outDir}`);
  }
  const hardFailed = allRows.some((r) => !r.pass);
  return hardFailed || guard.stopped ? 1 : 0;
}
