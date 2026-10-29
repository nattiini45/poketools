/**
 * The suite runner of the AI flow eval: runs the selected cases in passes, one pass per repeat and
 * the flows in order inside a pass, so a run stopped by the cost cap has covered every flow once
 * before it covers any flow twice. Every finished run goes to `onRow` for persistence; what a
 * resumed run already has is skipped.
 */

import { executeCase, type ExecContext, type ExecResult } from './flows';
import type { LoadedCase } from './fixtures';
import { rowKey, FLOW_IDS, type CaseByFlow, type FlowId, type RunRow } from './types';

export interface SuiteOptions {
  cases: LoadedCase[];
  repeat: number;
  ctx: ExecContext;
  /** Runs in flight at once. */
  concurrency: number;
  /** Rows of a run being resumed; a complete row for a (flow, case, repeat) is not run again. */
  priorRows?: readonly RunRow[];
  onRow: (row: RunRow) => void;
  /** A line of progress for the console. */
  onProgress?: (line: string) => void;
}

export interface SuiteResult {
  rows: RunRow[];
  /** Keys that were never started because the cost cap had stopped the run. */
  notRun: string[];
  /** Keys a resumed run already had. */
  resumed: string[];
}

interface WorkItem {
  flow: FlowId;
  loaded: LoadedCase;
  repeat: number;
  key: string;
}

export function buildRow(flow: FlowId, caseId: string, repeat: number, result: ExecResult): RunRow {
  const hardFailed = result.checks.some((c) => c.hard && !c.pass);
  return {
    key: rowKey(flow, caseId, repeat),
    flow,
    caseId,
    repeat,
    calls: result.calls,
    checks: result.checks,
    pass: !result.incomplete && !hardFailed,
    incomplete: result.incomplete,
    validator: result.validator,
    outputs: result.outputs,
  };
}

export function workOrder(cases: readonly LoadedCase[], repeat: number): WorkItem[] {
  const items: WorkItem[] = [];
  for (let r = 1; r <= repeat; r += 1) {
    for (const flow of FLOW_IDS) {
      for (const loaded of cases.filter((c) => c.flow === flow)) {
        items.push({ flow, loaded, repeat: r, key: rowKey(flow, loaded.case.id, r) });
      }
    }
  }
  return items;
}

/** Run `items` with at most `limit` in flight, starting them in order; stops starting new ones once `halted()` is true. */
async function pool<T>(items: readonly T[], limit: number, halted: () => boolean, run: (item: T) => Promise<void>): Promise<T[]> {
  const notStarted: T[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      if (halted()) {
        notStarted.push(items[index]);
        continue;
      }
      await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
  return notStarted;
}

export async function runSuite(options: SuiteOptions): Promise<SuiteResult> {
  const done = new Set((options.priorRows ?? []).filter((r) => !r.incomplete).map((r) => r.key));
  const all = workOrder(options.cases, options.repeat);
  const todo = all.filter((item) => !done.has(item.key));
  const resumed = all.filter((item) => done.has(item.key)).map((item) => item.key);
  const rows: RunRow[] = [];

  // Passes (repeats) run one after the other, and inside a pass the flows in order; the runs of
  // one flow in one pass run `concurrency` at a time.
  const notRun: string[] = [];
  const passes: { flow: FlowId; repeat: number; items: WorkItem[] }[] = [];
  for (const item of todo) {
    const last = passes[passes.length - 1];
    if (last && last.flow === item.flow && last.repeat === item.repeat) last.items.push(item);
    else passes.push({ flow: item.flow, repeat: item.repeat, items: [item] });
  }
  for (const { flow, items: ofFlow } of passes) {
    const skipped = await pool(
      ofFlow,
      options.concurrency,
      () => options.ctx.guard.stopped,
      async (item) => {
        const result = await executeCase(flow, item.loaded.case as CaseByFlow[typeof flow], options.ctx);
        const row = buildRow(flow, item.loaded.case.id, item.repeat, result);
        rows.push(row);
        options.onRow(row);
        const cost = row.calls.reduce((sum, c) => sum + c.costUsd, 0);
        options.onProgress?.(
          `${row.incomplete ? 'STOP' : row.pass ? 'pass' : 'FAIL'}  ${item.key}  $${cost.toFixed(4)}  (run total $${options.ctx.guard.spentUsd.toFixed(4)})`,
        );
      },
    );
    notRun.push(...skipped.map((item) => item.key));
  }
  return { rows, notRun, resumed };
}
