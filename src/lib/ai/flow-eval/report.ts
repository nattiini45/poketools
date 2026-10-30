/**
 * Summary and report of an AI flow eval run: one row per flow with the rates and means that
 * decide whether a model, effort or prompt change is safe (parse success, truncation, refusal,
 * fallback, validator errors, tokens, latency, cost).
 */

import { FLOW_IDS, emptyValidatorCounts, type FlowId, type RunRow, type ValidatorCounts } from './types';

export interface CheckFailure {
  id: string;
  hard: boolean;
  failed: number;
  total: number;
}

export interface FlowSummary {
  flow: FlowId;
  /** Runs (case x repeat) that finished, and how many of them passed every hard check. */
  runs: number;
  passedRuns: number;
  /** Model calls (a Kale run has several). */
  calls: number;
  parseTotal: number;
  parseOk: number;
  truncated: number;
  refused: number;
  fallback: number;
  /** Calls that ended in an error other than truncation or refusal. */
  errors: number;
  validator: ValidatorCounts;
  meanInputTokens: number;
  meanOutputTokens: number;
  meanMs: number;
  /** Share of the output tokens that is probably thinking (output minus the visible answer's token estimate). */
  thinkingShare: number;
  costPerCall: number;
  costPerRun: number;
  totalCostUsd: number;
  /** The part of the cost that is an estimate for attempts the provider never reported (failed primary attempts, thrown calls). */
  failedAttemptCostUsd: number;
  failures: CheckFailure[];
}

/** Characters per token of the visible answer, used to separate thinking from text. A rough figure. */
const CHARS_PER_VISIBLE_TOKEN = 3.3;

const isParseCheck = (id: string): boolean => id === 'parse' || id.endsWith(':parse');

/** `matchup_storyline_3:validator` -> `matchup_storyline_N:validator`. */
function checkFamily(id: string): string {
  return id.replace(/_\d+(?=:|$)/, '_N');
}

const mean = (sum: number, n: number): number => (n === 0 ? 0 : sum / n);

export function summarize(rows: readonly RunRow[]): FlowSummary[] {
  const out: FlowSummary[] = [];
  for (const flow of FLOW_IDS) {
    const ofFlow = rows.filter((r) => r.flow === flow);
    if (ofFlow.length === 0) continue;
    const finished = ofFlow.filter((r) => !r.incomplete);
    const calls = ofFlow.flatMap((r) => r.calls).filter((c) => c.servedModel !== null || c.error !== null || c.costUsd > 0);

    const validator = emptyValidatorCounts();
    for (const r of ofFlow) for (const k of Object.keys(validator) as (keyof ValidatorCounts)[]) validator[k] += r.validator[k];

    const parseChecks = finished.flatMap((r) => r.checks).filter((c) => isParseCheck(c.id));
    const failures = new Map<string, CheckFailure>();
    for (const check of finished.flatMap((r) => r.checks)) {
      const id = checkFamily(check.id);
      const entry = failures.get(id) ?? { id, hard: check.hard, failed: 0, total: 0 };
      entry.total += 1;
      if (!check.pass) entry.failed += 1;
      failures.set(id, entry);
    }

    const totalIn = calls.reduce((s, c) => s + c.inputTokens, 0);
    const totalOut = calls.reduce((s, c) => s + c.outputTokens, 0);
    const totalMs = calls.reduce((s, c) => s + c.ms, 0);
    const totalCost = calls.reduce((s, c) => s + c.costUsd, 0);
    const thinking = calls.reduce((s, c) => s + Math.max(0, c.outputTokens - c.outputChars / CHARS_PER_VISIBLE_TOKEN), 0);

    out.push({
      flow,
      runs: finished.length,
      passedRuns: finished.filter((r) => r.pass).length,
      calls: calls.length,
      parseTotal: parseChecks.length,
      parseOk: parseChecks.filter((c) => c.pass).length,
      truncated: calls.filter((c) => c.truncated).length,
      refused: calls.filter((c) => c.refused).length,
      fallback: calls.filter((c) => c.fallback).length,
      errors: calls.filter((c) => c.error !== null && c.error !== 'truncated' && c.error !== 'refused').length,
      validator,
      meanInputTokens: mean(totalIn, calls.length),
      meanOutputTokens: mean(totalOut, calls.length),
      meanMs: mean(totalMs, calls.length),
      thinkingShare: mean(thinking, totalOut),
      costPerCall: mean(totalCost, calls.length),
      costPerRun: mean(totalCost, ofFlow.length),
      totalCostUsd: totalCost,
      failedAttemptCostUsd: calls.reduce((s, c) => s + (c.failedAttemptUsd ?? 0), 0),
      failures: [...failures.values()].filter((f) => f.failed > 0).sort((a, b) => Number(b.hard) - Number(a.hard) || b.failed - a.failed),
    });
  }
  return out;
}

export interface ReportMeta {
  runName: string;
  model: string;
  effort: string;
  repeat: number;
  capUsd: number;
  spentUsd: number;
  stoppedByCap: boolean;
  notRun: number;
  resumed: number;
  startedAt: string;
}

const pct = (n: number, total: number): string => (total === 0 ? '-' : `${((100 * n) / total).toFixed(1)}%`);
const usd = (n: number, digits = 4): string => `$${n.toFixed(digits)}`;

/** A markdown report: the table first, then the failing checks per flow. */
export function formatReport(summaries: readonly FlowSummary[], meta: ReportMeta): string {
  const lines: string[] = [];
  lines.push(`# AI flow eval: ${meta.runName}`, '');
  lines.push(
    `Model ${meta.model}, effort ${meta.effort}, repeat ${meta.repeat}, started ${meta.startedAt}.`,
    `Spent ${usd(meta.spentUsd)} of the ${usd(meta.capUsd, 2)} cap${meta.stoppedByCap ? ' (the cap stopped the run)' : ''}; ${meta.notRun} run(s) not started, ${meta.resumed} resumed from an earlier run.`,
    '',
  );
  lines.push(
    '| flow | runs ok | calls | parse | truncated | refused | fallback | errors | wrong_score | wrong_player | mean in | mean out | ~thinking | mean ms | $/call | $ total |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const s of summaries) {
    lines.push(
      `| ${s.flow} | ${s.passedRuns}/${s.runs} | ${s.calls} | ${pct(s.parseOk, s.parseTotal)} | ${pct(s.truncated, s.calls)} | ${pct(s.refused, s.calls)} | ${pct(s.fallback, s.calls)} | ${s.errors} | ${s.validator.wrong_score} | ${s.validator.wrong_player} | ${Math.round(s.meanInputTokens)} | ${Math.round(s.meanOutputTokens)} | ${pct(s.thinkingShare * 100, 100)} | ${Math.round(s.meanMs)} | ${usd(s.costPerCall)} | ${usd(s.totalCostUsd)} |`,
    );
  }
  const total = summaries.reduce((sum, s) => sum + s.totalCostUsd, 0);
  const estimated = summaries.reduce((sum, s) => sum + s.failedAttemptCostUsd, 0);
  lines.push('', `Total cost of the table: ${usd(total)}${estimated > 0 ? `, of which ${usd(estimated)} is a worst-case estimate for failed attempts (a failed primary attempt before a fallback answer, or a call that threw)` : ''}.`, '');
  lines.push(
    'Notes: tokens are what the provider billed (output includes thinking; ~thinking is the output not accounted for by the visible text at about 3.3 characters per token, so a rough figure). ' +
      'Parse is the app parser (`parse-analysis.ts`, `parse-scouting.ts`) and, for Kale, the matchup storyline JSON. ' +
      '`wrong_score` / `wrong_player` are the `kale/validator.ts` errors; its `checkPlayerNames` is a no-op and its Pokémon-name checks are warnings, so a clean validator run proves the scores and the winner attribution, not every name. ' +
      'Truncated is `stop_reason` `max_tokens` (Kale: `length`). A call that threw, and the primary attempt that failed before a fallback answered, report no usage and are costed at the worst case of the attempt, so the cap is a ceiling.',
    '',
  );
  for (const s of summaries) {
    if (s.failures.length === 0) continue;
    lines.push(`## ${s.flow}: checks that failed`, '');
    for (const f of s.failures) lines.push(`- ${f.hard ? 'hard' : 'soft'} \`${f.id}\`: ${f.failed}/${f.total}`);
    lines.push('');
  }
  return lines.join('\n');
}
