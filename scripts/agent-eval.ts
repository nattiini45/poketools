/**
 * §8.4 agent eval harness — runs the golden set through one or more T0 models
 * and reports tool-call success, answer accuracy, latency, and escalation rate.
 *
 * This is the gate that picks the T0 model (DeepSeek vs Xiaomi …) and catches
 * tool-call regressions before any user-facing route is cut over to the agent.
 *
 * Usage:
 *   npx tsx scripts/agent-eval.ts                      # all configured T0 text models
 *   npx tsx scripts/agent-eval.ts --model deepseek-v4-pro
 *   npx tsx scripts/agent-eval.ts --model deepseek-v4-pro --cases dex-garchomp-hp,type-eq-gyarados
 *
 * Each case calls `runAgent()` DIRECTLY (no HTTP) with a fake userId
 * `eval-<modelId>`. The `eval-` prefix opts the run out of all DB persistence
 * (see `agent/memory.ts` DRY_RUN_USER_PREFIX) and encodes the model under test
 * as the router's first preference. Execution is sequential (RAM), with a
 * per-CATEGORY case timeout (teambuild gets longer — see {@link timeoutForCategory});
 * failures are logged and the run continues.
 *
 * Loads env from .env.local like scripts/agent-smoke.ts. Requires the same env
 * the app needs (model keys + Supabase URL/service-role for the context pack).
 * pokepast.es is mocked so no eval ever publishes to the network.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import type { EvalCase, EvalExpect } from '../src/lib/ai/agent/__tests__/evals/golden-set';

// ─── Env loading (mirrors scripts/agent-smoke.ts) ────────────────────

function loadEnvLocal(): void {
  for (const file of ['.env.local', '.env']) {
    try {
      const content = readFileSync(resolve(process.cwd(), file), 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    } catch {
      // file may not exist if env is provided another way
    }
  }
}
loadEnvLocal();

// ─── pokepaste network mock (safety net — chat never wires createPokepaste) ──

function installPokepasteMock(): void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.includes('pokepast.es')) {
      return new Response(null, {
        status: 303,
        headers: { location: 'https://pokepast.es/eval-mock-0000000000' },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

// ─── Constants ───────────────────────────────────────────────────────

/**
 * Per-case wall-clock budget. Most cases are a single tool round-trip and settle
 * in well under 90s. Teambuild cases legitimately need far longer: assembling a
 * full 6-mon legal team walks the model-router fallback chain (up to 3 hops × the
 * 60s per-call budget = ~180s) before the winning model writes the Showdown
 * export. A blanket 90s ceiling killed those runs mid-chain and reported a
 * harness "timeout" that masked the real model signal (slow build / empty
 * answer). Give teambuild room to either finish or honestly exhaust.
 */
const DEFAULT_CASE_TIMEOUT_MS = 90_000;
const TEAMBUILD_CASE_TIMEOUT_MS = 240_000;

function timeoutForCategory(category: EvalCase['category']): number {
  return category === 'teambuild' ? TEAMBUILD_CASE_TIMEOUT_MS : DEFAULT_CASE_TIMEOUT_MS;
}

// ─── CLI ─────────────────────────────────────────────────────────────

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

// ─── Result shapes ───────────────────────────────────────────────────

interface CaseResult {
  id: string;
  category: EvalCase['category'];
  persona: string;
  tool_success: boolean;
  answer_correct: boolean;
  latency_ms: number;
  escalated: boolean;
  /** Final model that produced the answer (may differ from the model under test). */
  answered_by: string;
  called_tools: string[];
  error: string | null;
}

interface ModelSummary {
  tool_call_success_rate: number;
  answer_accuracy: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  escalation_rate: number;
  cases: number;
}

// ─── Scoring helpers ─────────────────────────────────────────────────

function matches(text: string, m: string | RegExp): boolean {
  return m instanceof RegExp ? m.test(text) : text.toLowerCase().includes(m.toLowerCase());
}

function answerCorrect(answer: string, expect: EvalExpect): boolean {
  for (const m of expect.answerMustContain ?? []) if (!matches(answer, m)) return false;
  for (const m of expect.answerMustNotContain ?? []) if (matches(answer, m)) return false;
  return true;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`case timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(timer)), timeout]);
}

// ─── Dynamic imports (after env is loaded — these modules touch env at load) ──

type AgentModule = typeof import('../src/lib/ai/agent/orchestrator');
type RegistryModule = typeof import('../src/lib/ai/agent/tools/registry');

async function runCase(
  runAgent: AgentModule['runAgent'],
  tools: RegistryModule['AGENT_TOOLS'],
  modelId: string,
  c: EvalCase,
): Promise<CaseResult> {
  const base: CaseResult = {
    id: c.id,
    category: c.category,
    persona: c.persona,
    tool_success: false,
    answer_correct: false,
    latency_ms: 0,
    escalated: false,
    answered_by: '',
    called_tools: [],
    error: null,
  };

  const start = Date.now();
  try {
    const res = await withTimeout(
      runAgent({
        userId: `eval-${modelId}`,
        persona: c.persona,
        messages: [{ role: 'user', content: c.prompt }],
        context: c.context,
      }),
      timeoutForCategory(c.category),
    );
    const metadata = res.getMetadata();
    const [answer, steps] = await Promise.all([res.result.text, res.result.steps]);
    base.latency_ms = Date.now() - start;

    // Schema-rejected tool calls: any tool_schema escalation OR a final call
    // whose args fail its registry schema (defence-in-depth re-validation).
    let schemaRejected = metadata.escalations.some((e) => e.reason === 'tool_schema');
    const calledTools = new Set<string>();
    for (const step of steps) {
      for (const tc of step.toolCalls ?? []) {
        calledTools.add(tc.toolName);
        const tool = tools[tc.toolName];
        if (!tool || !tool.inputSchema.safeParse(tc.input).success) schemaRejected = true;
      }
    }

    const requiredToolsCalled = (c.expect.mustCallTools ?? []).every((t) => calledTools.has(t));
    base.tool_success = !schemaRejected && requiredToolsCalled;
    base.answer_correct = answerCorrect(answer ?? '', c.expect);
    base.escalated = metadata.escalations.length > 0;
    base.answered_by = metadata.model;
    base.called_tools = [...calledTools];
  } catch (err) {
    base.latency_ms = Date.now() - start;
    base.error = err instanceof Error ? err.message : String(err);
  }
  return base;
}

function summarise(results: CaseResult[]): ModelSummary {
  const n = results.length || 1;
  const latencies = results.map((r) => r.latency_ms);
  return {
    tool_call_success_rate: results.filter((r) => r.tool_success).length / n,
    answer_accuracy: results.filter((r) => r.answer_correct).length / n,
    p50_latency_ms: percentile(latencies, 50),
    p95_latency_ms: percentile(latencies, 95),
    escalation_rate: results.filter((r) => r.escalated).length / n,
    cases: results.length,
  };
}

// ─── Rendering ───────────────────────────────────────────────────────

const tick = (b: boolean) => (b ? '✅' : '❌');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function renderModelMarkdown(modelId: string, results: CaseResult[], summary: ModelSummary): string {
  const lines: string[] = [];
  lines.push(`\n## ${modelId}\n`);
  lines.push('| case | category | tools | answer | latency | escalated | answered by |');
  lines.push('|---|---|:--:|:--:|--:|:--:|---|');
  for (const r of results) {
    const note = r.error ? ` ⚠️ ${r.error}` : '';
    lines.push(
      `| ${r.id}${note} | ${r.category} | ${tick(r.tool_success)} | ${tick(r.answer_correct)} | ${r.latency_ms}ms | ${r.escalated ? 'yes' : 'no'} | ${r.answered_by || '—'} |`,
    );
  }
  lines.push('');
  lines.push('**Summary**');
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|--:|');
  lines.push(`| tool-call success rate | ${pct(summary.tool_call_success_rate)} |`);
  lines.push(`| answer accuracy | ${pct(summary.answer_accuracy)} |`);
  lines.push(`| p50 latency | ${summary.p50_latency_ms}ms |`);
  lines.push(`| p95 latency | ${summary.p95_latency_ms}ms |`);
  lines.push(`| escalation rate | ${pct(summary.escalation_rate)} |`);
  lines.push(`| cases | ${summary.cases} |`);
  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  installPokepasteMock();

  const provider = await import('../src/lib/ai/agent/provider');
  const { runAgent } = await import('../src/lib/ai/agent/orchestrator');
  const { AGENT_TOOLS } = await import('../src/lib/ai/agent/tools/registry');
  const { loadGoldenSet } = await import('../src/lib/ai/agent/__tests__/evals/golden-set');

  const allCases = await loadGoldenSet();

  // Resolve case selection.
  const caseFilter = parseArg('--cases');
  const wanted = caseFilter ? new Set(caseFilter.split(',').map((s) => s.trim())) : null;
  const cases = wanted ? allCases.filter((c) => wanted.has(c.id)) : allCases;
  if (cases.length === 0) {
    console.error(`No cases matched ${caseFilter ?? '(all)'}. Known ids:`);
    console.error(allCases.map((c) => `  ${c.id}`).join('\n'));
    process.exit(1);
  }

  // Resolve models.
  const argModel = parseArg('--model');
  const modelIds = argModel
    ? [argModel]
    : provider.AGENT_MODELS.filter((m) => m.tier === 'T0').map((m) => m.id);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // A fresh owner-only directory per run (mkdtemp), not a predictable name in the shared temp dir.
  const outDir = mkdtempSync(join(tmpdir(), 'agent-eval-'));
  console.error(`Eval harness — ${cases.length} case(s) × ${modelIds.length} model(s)\n`);

  for (const modelId of modelIds) {
    const entry = provider.AGENT_MODELS.find((m) => m.id === modelId);
    if (!entry) {
      console.error(`${modelId}: UNKNOWN (not in AGENT_MODELS) — skipping`);
      continue;
    }
    if (!provider.isModelConfigured(entry)) {
      console.error(`${modelId}: SKIPPED (missing env)`);
      continue;
    }

    console.error(`\n▶ ${modelId}`);
    const results: CaseResult[] = [];
    for (const c of cases) {
      process.stderr.write(`  ${c.id} … `);
      const r = await runCase(runAgent, AGENT_TOOLS, modelId, c);
      results.push(r);
      const verdict = r.error
        ? `ERROR (${r.error})`
        : `${tick(r.tool_success)}tools ${tick(r.answer_correct)}answer ${r.latency_ms}ms${r.escalated ? ' ↑esc' : ''}`;
      console.error(verdict);
    }

    const summary = summarise(results);
    const outPath = join(outDir, `${modelId.replace(/[^\w.-]/g, '_')}-${stamp}.json`);
    writeFileSync(
      outPath,
      JSON.stringify({ model: modelId, timestamp: stamp, summary, results }, null, 2),
    );
    console.log(renderModelMarkdown(modelId, results, summary));
    console.error(`\n  → wrote ${outPath}`);
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error('Eval harness failed:', err);
    process.exit(1);
  },
);
