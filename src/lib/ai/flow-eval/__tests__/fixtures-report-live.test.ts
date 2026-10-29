import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FixtureError, INTERNAL_FIXTURE_DIR, SYNTHETIC_FIXTURE_DIR, loadCases, parseFixtureFile } from '../fixtures';
import { formatReport, summarize } from '../report';
import { FLOW_IDS, emptyValidatorCounts, type CallRecord, type RunRow } from '../types';

const ROOT = path.resolve(__dirname, '../../../../..');

describe('committed synthetic fixtures', () => {
  const cases = loadCases(ROOT, FLOW_IDS, 'synthetic');

  it('hold at least eight cases per flow, all marked synthetic and unique per flow', () => {
    for (const flow of FLOW_IDS) {
      const ids = cases.filter((c) => c.flow === flow).map((c) => c.case.id);
      expect(ids.length).toBeGreaterThanOrEqual(8);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(cases.every((c) => c.source === 'synthetic')).toBe(true);
  });

  it('are the only fixture files under scripts/eval-fixtures/ai-flows', () => {
    expect(readdirSync(path.join(ROOT, SYNTHETIC_FIXTURE_DIR)).sort()).toEqual(FLOW_IDS.map((f) => `${f}.json`).sort());
  });

  it('contain no link, address, long numeric id or secret-looking token', () => {
    for (const flow of FLOW_IDS) {
      const text = readFileSync(path.join(ROOT, SYNTHETIC_FIXTURE_DIR, `${flow}.json`), 'utf8');
      expect(text, flow).not.toMatch(/https?:\/\//);
      expect(text, flow).not.toMatch(/\b\d{17,20}\b/);
      expect(text, flow).not.toMatch(/\bsk-[A-Za-z0-9_-]{10,}/);
      expect(text, flow).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    }
  });

  it('keep real-data fixtures out of the committed folder by path, and the internal folder is gitignored', () => {
    expect(INTERNAL_FIXTURE_DIR.split(path.sep)[0]).toBe('.internal');
    const gitignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\/\.internal\/$/m);
  });
});

describe('parseFixtureFile', () => {
  const good = (cases: unknown[]) => JSON.stringify({ schemaVersion: 1, flow: 'recap', synthetic: true, cases });
  const recap = { id: 'r1', label: 'l', locale: 'en', input: { leagueName: 'L', tournamentName: 'T', roundName: 'R', roundNumber: 1, results: [{ player1_name: 'A', player2_name: 'B', winner_name: 'A', score: '1-0' }], headlineMatch: null } };

  it('accepts a valid file', () => {
    expect(parseFixtureFile('recap', good([recap]), 'x').cases).toHaveLength(1);
  });

  it.each([
    ['not JSON', '{', /not valid JSON/],
    ['the wrong flow', JSON.stringify({ schemaVersion: 1, flow: 'scouting', synthetic: true, cases: [] }), /expected \{ schemaVersion: 1, flow: "recap"/],
    ['a missing field', good([{ ...recap, input: { ...recap.input, results: [] } }]), /case 0 is invalid/],
    ['a bad locale', good([{ ...recap, locale: 'fr' }]), /case 0 is invalid/],
    ['a duplicate id', good([recap, recap]), /duplicate case id r1/],
  ])('rejects %s', (_name, text, message) => {
    expect(() => parseFixtureFile('recap', text, 'x')).toThrow(FixtureError);
    expect(() => parseFixtureFile('recap', text, 'x')).toThrow(message);
  });

  it('loads the internal folder only on request, and refuses a non-synthetic file in the committed folder', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ai-flow-fixtures-'));
    const synthetic = path.join(root, SYNTHETIC_FIXTURE_DIR);
    const internal = path.join(root, INTERNAL_FIXTURE_DIR);
    mkdirSync(synthetic, { recursive: true });
    mkdirSync(internal, { recursive: true });
    writeFileSync(path.join(synthetic, 'recap.json'), good([recap]));
    writeFileSync(path.join(internal, 'recap.json'), JSON.stringify({ schemaVersion: 1, flow: 'recap', synthetic: false, cases: [{ ...recap, id: 'real-1' }] }));

    expect(loadCases(root, ['recap'], 'synthetic').map((c) => c.case.id)).toEqual(['r1']);
    expect(loadCases(root, ['recap'], 'internal').map((c) => [c.case.id, c.source])).toEqual([['real-1', 'internal']]);
    expect(loadCases(root, ['recap'], 'both').map((c) => c.case.id)).toEqual(['r1', 'real-1']);

    writeFileSync(path.join(synthetic, 'recap.json'), JSON.stringify({ schemaVersion: 1, flow: 'recap', synthetic: false, cases: [recap] }));
    expect(() => loadCases(root, ['recap'], 'synthetic')).toThrow(/must be marked synthetic/);
  });
});

const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  taskId: 'main', requestedModel: 'claude-sonnet-5-5', servedModel: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 16000,
  inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500, outputChars: 600, ms: 2000, costUsd: 0.01,
  failedAttemptUsd: 0, costEstimated: false, stopReason: 'end_turn', truncated: false, refused: false, fallback: false, error: null, ...over,
});

const row = (caseId: string, calls: CallRecord[], checks: RunRow['checks'], over: Partial<RunRow> = {}): RunRow => ({
  key: `match-analysis/${caseId}/r1`, flow: 'match-analysis', caseId, repeat: 1, calls, checks, pass: checks.every((c) => !c.hard || c.pass),
  incomplete: false, validator: emptyValidatorCounts(), outputs: {}, ...over,
});

describe('summarize and formatReport', () => {
  const rows: RunRow[] = [
    row('a', [call()], [{ id: 'parse', hard: true, pass: true }, { id: 'game_winners', hard: true, pass: true }]),
    row('b', [call({ truncated: true, stopReason: 'max_tokens', outputTokens: 16000, costUsd: 0.17, ms: 4000 })], [{ id: 'parse', hard: true, pass: false }, { id: 'not_truncated', hard: true, pass: false }]),
    row('c', [call({ fallback: true, servedModel: 'claude-haiku-5-5', costUsd: 0.001 })], [{ id: 'parse', hard: true, pass: true }, { id: 'no_exclamation', hard: false, pass: false }]),
    row('d', [call({ refused: true, stopReason: 'refusal', error: 'refused', costUsd: 0.002 })], [{ id: 'not_refused', hard: true, pass: false }]),
  ];
  rows[1].validator.wrong_score = 2;
  rows[2].validator.wrong_player = 1;

  it('computes the rates, means and costs of a flow', () => {
    const [s] = summarize(rows);
    expect(s).toMatchObject({ flow: 'match-analysis', runs: 4, passedRuns: 2, calls: 4, parseTotal: 3, parseOk: 2, truncated: 1, refused: 1, fallback: 1, errors: 0 });
    expect(s.validator).toMatchObject({ wrong_score: 2, wrong_player: 1 });
    expect(s.meanInputTokens).toBe(1000);
    expect(s.meanOutputTokens).toBeCloseTo((500 + 16000 + 500 + 500) / 4);
    expect(s.meanMs).toBeCloseTo((2000 + 4000 + 2000 + 2000) / 4);
    expect(s.totalCostUsd).toBeCloseTo(0.01 + 0.17 + 0.001 + 0.002);
    expect(s.costPerCall).toBeCloseTo(s.totalCostUsd / 4);
    expect(s.failures.map((f) => `${f.hard ? 'hard' : 'soft'}:${f.id}:${f.failed}/${f.total}`)).toEqual([
      'hard:parse:1/3', 'hard:not_truncated:1/1', 'hard:not_refused:1/1', 'soft:no_exclamation:1/1',
    ]);
  });

  it('leaves out incomplete runs from the rates but keeps their cost', () => {
    const partial = row('e', [call({ costUsd: 0.05 })], [], { incomplete: true, pass: false });
    const [s] = summarize([...rows, partial]);
    expect(s.runs).toBe(4);
    expect(s.totalCostUsd).toBeCloseTo(0.183 + 0.05);
  });

  it('groups numbered Kale tasks into one check family', () => {
    const kale = (i: number, pass: boolean): RunRow => ({
      ...row(`k${i}`, [call({ taskId: `match_one_liner_${i}` })], [{ id: `match_one_liner_${i}:validator`, hard: true, pass }]),
      flow: 'kale-recap',
      key: `kale-recap/k${i}/r1`,
    });
    const [s] = summarize([kale(0, false), kale(1, true), kale(2, false)]);
    expect(s.failures).toEqual([{ id: 'match_one_liner_N:validator', hard: true, failed: 2, total: 3 }]);
  });

  it('prints a markdown table with the totals, the cap and the caveats', () => {
    const text = formatReport(summarize(rows), { runName: 'r', model: 'claude-sonnet-5-5', effort: 'medium', repeat: 1, capUsd: 4, spentUsd: 0.183, stoppedByCap: false, notRun: 0, resumed: 0, startedAt: 'now' });
    expect(text).toMatch(/\| match-analysis \| 2\/4 \| 4 \| 66\.7% \| 25\.0% \| 25\.0% \| 25\.0% \|/);
    expect(text).toMatch(/Spent \$0\.1830 of the \$4\.00 cap/);
    expect(text).toMatch(/checkPlayerNames` is a no-op/);
    expect(text).toMatch(/## match-analysis: checks that failed/);
  });
});

describe('live caller', () => {
  it('routes Kale through the Kale provider and the rest through the legacy client, mapping usage', async () => {
    const result = { content: 'x', model: 'claude-sonnet-5-5', prompt_tokens: 12, completion_tokens: 3, stop_reason: 'end_turn', stop_category: null, cache_read_input_tokens: 4, cache_creation_input_tokens: 2, fallback_used: false };
    const completeStreaming = vi.fn(async () => result);
    const complete = vi.fn(async () => ({ ...result, fallback_used: true }));
    const kaleGenerateText = vi.fn(async () => ({ ...result, stop_reason: 'stop' }));
    vi.doMock('../../client', () => ({ completeStreaming, complete }));
    vi.doMock('../../kale/provider', () => ({ kaleGenerateText }));
    const { createLiveCaller } = await import('../live');
    const caller = await createLiveCaller();
    const settings = { model: 'claude-sonnet-5-5', effort: 'low' as const };
    const base = { system: 's', user: 'u', maxTokens: 100, jsonOutput: false };

    const streamed = await caller({ ...base, surface: 'match-analysis' }, settings);
    expect(completeStreaming).toHaveBeenCalledWith('s', 'u', undefined, undefined, expect.objectContaining({ model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 100, surface: 'match-analysis' }));
    expect(streamed).toMatchObject({ promptTokens: 12, completionTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 2, stopReason: 'end_turn', fallbackUsed: false });

    const blocking = await caller({ ...base, surface: 'team-coach' }, settings);
    expect(complete).toHaveBeenCalledWith('s', 'u', expect.objectContaining({ surface: 'team-coach' }));
    expect(blocking.fallbackUsed).toBe(true);

    const kale = await caller({ ...base, surface: 'kale' }, settings);
    expect(kaleGenerateText).toHaveBeenCalledWith('s', 'u', { maxTokens: 100 });
    expect(kale.stopReason).toBe('stop');
    vi.doUnmock('../../client');
    vi.doUnmock('../../kale/provider');
  });
});
