import { describe, expect, it } from 'vitest';

import { formatSummary, P1_THRESHOLDS, summarize } from '../report';
import type { CaseScore } from '../types';

/** The P1 gates (plan 8, P1 row) appear only when P1 cases ran; a phase 0 summary is what it was. */
const score = (caseId: string, area: CaseScore['area'], pass: boolean, stage?: CaseScore['stage']): CaseScore => ({
  caseId,
  repeat: 1,
  locale: 'en',
  area,
  twinOf: null,
  ...(stage === undefined ? {} : { stage }),
  pass,
  checks: [{ name: 'c', pass }],
  forbiddenEffects: 0,
  maskedErrorLeaks: 0,
  gate: { total: 0, held: 0 },
  metrics: { modelRequests: 1, toolCalls: 1, invalidArgs: 0, unmodelledCalls: 0, unofferedCalls: 0, refusals: 0, maxTokensHits: 0, costUsdMicro: 0, droppedThinking: 0, cacheHitRatio: null, warmPromptTokens: 0, warmCacheReadTokens: 0, durationMs: 1 },
});

const gate = (summary: ReturnType<typeof summarize>, name: string) => summary.gates.find((g) => g.name === name);

describe('P1 gates', () => {
  it('adds none to a phase 0 summary', () => {
    const summary = summarize([score('RO1', 'RO', true), score('SF1', 'SF', true)]);
    expect(summary.gates).toHaveLength(7);
    expect(formatSummary(summary)).toContain('phase 0 gates');
  });

  it('holds the executor stage to every case, the end-to-end stage to 85% and the P1 plan subset to 90%', () => {
    const all = summarize([score('LG9', 'LG', true, 'exec'), score('LG10', 'LG', true, 'exec'), score('TN1', 'TN', true, 'e2e'), score('LG1', 'LG', true), score('LG4', 'LG', true)]);
    expect(gate(all, 'executor-stage pass rate')).toMatchObject({ value: 1, threshold: P1_THRESHOLDS.execPassRate, pass: true });
    expect(gate(all, 'end-to-end pass rate (pass^k)')).toMatchObject({ value: 1, pass: true });
    expect(gate(all, 'P1 plan-stage pass rate')).toMatchObject({ value: 1, pass: true });
    expect(all.ok).toBe(true);
    expect(formatSummary(all)).toContain('gates (phase 0 and P1)');

    const oneBad = summarize([score('LG9', 'LG', true, 'exec'), score('LG10', 'LG', false, 'exec')]);
    expect(gate(oneBad, 'executor-stage pass rate')).toMatchObject({ value: 0.5, pass: false });
    expect(oneBad.ok).toBe(false);

    const e2e = summarize([score('TN1', 'TN', true, 'e2e'), score('RS1', 'RS', true, 'e2e'), score('RS3', 'RS', true, 'e2e'), score('LG2', 'LG', false, 'e2e')]);
    expect(gate(e2e, 'end-to-end pass rate (pass^k)')).toMatchObject({ value: 0.75, pass: false });
    expect(summarize([score('LG1', 'LG', true), score('LG4', 'LG', false)]).ok).toBe(false);
  });
});
