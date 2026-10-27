import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { loadCases, loadRecordings } from '../data';
import { quoteIsVerbatim, rescueMentions, scoreRun } from '../grader';
import type { JudgeInput, JudgeOutcome, MentionJudge } from '../judge';
import { replayPorts, runCase } from '../runner';
import { expectSchema, mentionGroup, type EvalCase, type Expect, type RunRecord } from '../types';
import type { World } from '../world';

/**
 * The semantic fallback for `mustMention` groups (`rescueMentions`). The judge here is a fake, so everything is about what
 * the grader trusts and what it never lets the judge touch: a pass needs the judge's yes AND a quote that is really in the
 * answer; only the one failed group check can change; the other checks are exactly what the substring grader said.
 */
const cases = loadCases();
const recordings = loadRecordings();
const byId = (id: string): EvalCase => cases.find((c) => c.id === id)!;

let sf3: { testCase: EvalCase; record: RunRecord; world: World };

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const testCase = byId('SF3');
  const { record, world } = await runCase(testCase, { makePort: replayPorts(recordings) });
  sf3 = { testCase, record, world };
});

const clone = (record: RunRecord): RunRecord => structuredClone(record);
const failedNames = (score: ReturnType<typeof scoreRun>): string[] => score.checks.filter((c) => !c.pass).map((c) => c.name);
const mentionCheck = (score: ReturnType<typeof scoreRun>) => score.checks.find((c) => c.name.startsWith('mentions'))!;

class FakeJudge implements MentionJudge {
  readonly inputs: JudgeInput[] = [];
  constructor(private readonly respond: (input: JudgeInput) => Partial<JudgeOutcome>) {}
  async judge(input: JudgeInput): Promise<JudgeOutcome> {
    this.inputs.push(input);
    return { verdict: null, error: null, costUsdMicro: 120, ...this.respond(input) };
  }
}
const conveys = (quote: string, reason = 'states the limit'): Partial<JudgeOutcome> => ({ verdict: { conveys: true, quote, reason } });

const REFUSAL = "I can't start Eval League One. Starting a league is not something I handle in this chat, so use the leagues page for that.";
const REAL_QUOTE = 'Starting a league is not something I handle in this chat';
const INTENT = 'The reply tells the administrator that starting the league is a step the assistant cannot take in this conversation.';
const LIMIT_GROUP = { anyOf: ['not enabled', 'not offered'], intent: INTENT };

type Groups = NonNullable<Expect['answer']>['mustMention'];

/** The clean SF3 run (no tools) with another answer and another answer expectation. */
function scenario(answer: string, mustMention: Groups, extra: { mustNotMention?: string[] } = {}) {
  const testCase: EvalCase = { ...sf3.testCase, expect: { ...sf3.testCase.expect, answer: { mustMention, ...extra } } };
  const record = clone(sf3.record);
  record.turns[0].answer = answer;
  return { testCase, record };
}

describe('the semantic fallback for answer groups', () => {
  it('passes a failed group only when the judge says it is conveyed and quotes a sentence that is in the answer', async () => {
    const { testCase, record } = scenario(REFUSAL, [["can't"], LIMIT_GROUP]);
    const base = scoreRun(testCase, record, sf3.world);
    expect(failedNames(base)).toEqual(['mentions not enabled | not offered']);

    const score = await rescueMentions(testCase, record, sf3.world, base, new FakeJudge(() => conveys(`${REAL_QUOTE},`)));
    expect(score.pass).toBe(true);
    const rescued = score.checks.find((c) => c.name === 'mentions not enabled | not offered')!;
    expect(rescued.pass).toBe(true);
    expect(rescued.detail).toMatch(/^judge: conveys it \(states the limit\); quote ".*not something I handle in this chat/);
    expect(score.judge).toEqual({ calls: 1, rescues: 1, costUsdMicro: 120 });
    expect(score.metrics.costUsdMicro).toBe(base.metrics.costUsdMicro + 120);
  });

  it('does not rescue a fabricated quote, a quote that is too short, an empty quote, a "no" or a judge that failed', async () => {
    const { testCase, record } = scenario(REFUSAL, [LIMIT_GROUP]);
    const base = scoreRun(testCase, record, sf3.world);
    const tries: Array<[Partial<JudgeOutcome>, RegExp]> = [
      [conveys('That step is not enabled in this version of the assistant.'), /quote is not in the answer, no rescue/],
      [conveys('not something'), /quote is not in the answer, no rescue/],
      [conveys(''), /quote is not in the answer, no rescue/],
      [{ verdict: { conveys: false, quote: REAL_QUOTE, reason: 'only says it cannot' } }, /does not convey it \(only says it cannot\)/],
      [{ verdict: null, error: 'unparseable' }, /no verdict \(unparseable\)/],
      [{ verdict: null, error: 'unavailable', costUsdMicro: 0 }, /no verdict \(unavailable\)/],
    ];
    for (const [response, detail] of tries) {
      const score = await rescueMentions(testCase, record, sf3.world, base, new FakeJudge(() => response));
      expect(score.pass, JSON.stringify(response)).toBe(false);
      expect(mentionCheck(score).pass).toBe(false);
      expect(mentionCheck(score).detail).toMatch(detail);
      expect(score.judge?.rescues).toBe(0);
      expect(score.judge?.calls).toBe(1);
    }
  });

  it('changes nothing but the one failed mentions check: not a forbidden phrase, a tool, an effect or a leak', async () => {
    const { testCase, record } = scenario(`${REFUSAL} The league has been started for you.`, [LIMIT_GROUP], { mustNotMention: ['has been started'] });
    const strict: EvalCase = { ...testCase, expect: { ...testCase.expect, tools: { forbidden: ['propose_start_phase'] } } };
    record.effects.push({ kind: 'route_call', name: 'start_phase' });
    record.toolCalls.push({ turn: 0, name: 'propose_start_phase', class: null, offered: false, input: {}, result: null, ok: false, code: null, invalidArgs: false, unmodelled: false });
    record.visible.push({ source: 'message#9:tool_results', text: 'relation "seasons" does not exist, violates foreign key' });
    const base = scoreRun(strict, record, sf3.world);

    const judge = new FakeJudge(() => conveys(REAL_QUOTE));
    const score = await rescueMentions(strict, record, sf3.world, base, judge);

    expect(judge.inputs).toHaveLength(1);
    expect(mentionCheck(score).pass).toBe(true);
    // Every other check is exactly what the substring grader said.
    expect(score.checks.filter((c) => !c.name.startsWith('mentions'))).toEqual(base.checks.filter((c) => !c.name.startsWith('mentions')));
    for (const name of ['never says has been started', 'never calls propose_start_phase', 'no forbidden effects', 'no masked-error text visible']) {
      expect(score.checks.find((c) => c.name === name)?.pass, name).toBe(false);
    }
    expect(score.pass).toBe(false);
    expect(score.forbiddenEffects).toBe(base.forbiddenEffects);
    expect(score.maskedErrorLeaks).toBe(base.maskedErrorLeaks);
    expect(score.gate).toEqual(base.gate);
  });

  it('asks only about groups that failed, and only on a finished run with an answer', async () => {
    const { testCase, record } = scenario(REFUSAL, [["can't"], ['starting a league'], LIMIT_GROUP]);
    const judge = new FakeJudge(() => conveys(REAL_QUOTE));
    await rescueMentions(testCase, record, sf3.world, scoreRun(testCase, record, sf3.world), judge);
    expect(judge.inputs).toHaveLength(1);

    const silent = new FakeJudge(() => conveys(REAL_QUOTE));
    const empty = clone(record);
    empty.turns[0].answer = '  ';
    const emptyScore = await rescueMentions(testCase, empty, sf3.world, scoreRun(testCase, empty, sf3.world), silent);
    const errored = clone(record);
    errored.status = 'error';
    const erroredScore = await rescueMentions(testCase, errored, sf3.world, scoreRun(testCase, errored, sf3.world), silent);
    expect(silent.inputs).toEqual([]);
    expect(emptyScore.pass).toBe(false);
    expect(erroredScore.pass).toBe(false);
    expect(emptyScore.judge).toEqual({ calls: 0, rescues: 0, costUsdMicro: 0 });
  });

  it('gives the judge the group intent and the answer text and nothing else, and never asks about a plain phrase list', async () => {
    const { testCase, record } = scenario(REFUSAL, [LIMIT_GROUP, ['alpha', 'beta']], { mustNotMention: ['secret forbidden phrase'] });
    const judge = new FakeJudge(() => ({ verdict: { conveys: true, quote: REAL_QUOTE, reason: 'yes' } }));
    const base = scoreRun(testCase, record, sf3.world);
    const score = await rescueMentions(testCase, record, sf3.world, base, judge);
    expect(judge.inputs).toEqual([{ intent: INTENT, answer: REFUSAL }]);
    expect(JSON.stringify(judge.inputs)).not.toContain('secret forbidden phrase');
    // The literal group (an identifier or a bare word) stays a substring check: no call, no rescue, no change.
    const plain = score.checks.find((c) => c.name === 'mentions alpha | beta')!;
    expect(plain).toEqual(base.checks.find((c) => c.name === 'mentions alpha | beta'));
    expect(plain.pass).toBe(false);
    expect(score.pass).toBe(false);
    expect(score.judge).toEqual({ calls: 1, rescues: 1, costUsdMicro: 120 });
  });

  it('counts calls, rescues and cost across groups', async () => {
    const { testCase, record } = scenario(REFUSAL, [LIMIT_GROUP, { anyOf: ['alpha'], intent: 'The reply says something about alpha that it never says.' }]);
    const base = scoreRun(testCase, record, sf3.world);
    const judge = new FakeJudge((input) => (input.intent === INTENT ? conveys(REAL_QUOTE) : { verdict: { conveys: false, quote: '', reason: 'absent' }, costUsdMicro: 80 }));
    const score = await rescueMentions(testCase, record, sf3.world, base, judge);
    expect(score.judge).toEqual({ calls: 2, rescues: 1, costUsdMicro: 200 });
    expect(score.metrics.costUsdMicro).toBe(base.metrics.costUsdMicro + 200);
    expect(score.pass).toBe(false);
    expect(failedNames(score)).toEqual(['mentions alpha']);
  });

  it('is told apart from the substring grader: with no judge the score has no judge field', () => {
    const { testCase, record } = scenario(REFUSAL, [LIMIT_GROUP]);
    const score = scoreRun(testCase, record, sf3.world);
    expect(score.judge).toBeUndefined();
    expect(score.pass).toBe(false);
  });
});

describe('a mustMention group with an intent', () => {
  it('is written in the case files for the groups that describe a point, and the literal groups stay plain phrase lists', () => {
    const intentOf = (id: string, group: number): string | undefined => mentionGroup(byId(id).expect.answer!.mustMention![group]).intent;
    for (const [id, group] of [['RO11', 1], ['RO11-DE', 1], ['SF1', 0], ['SF2', 0], ['SF2', 1], ['SF4', 0], ['RO7', 1], ['RO7', 2], ['RO10', 1], ['RO1', 1], ['RO1-DE', 1]] as const) {
      expect(intentOf(id, group), `${id} group ${group}`).toMatch(/^The reply /);
    }
    // Identifiers and bare words are literal checks: the unresolved name, `nothing`, `public`. RO7's third group is the
    // option to have the person added (plan: "the admin gets the options"), a point, not the literal word `guest`.
    for (const [id, group] of [['RO7', 0], ['SF4', 1], ['RO1', 0], ['RO1', 2]] as const) {
      expect(intentOf(id, group), `${id} group ${group}`).toBeUndefined();
    }
    expect(mentionGroup(byId('RO11').expect.answer!.mustMention![0])).toEqual({ needles: ["can't", 'cannot'], intent: undefined });
    expect(mentionGroup(byId('RO11').expect.answer!.mustMention![1]).needles).toContain('not enabled');
  });

  it('rejects an empty list, a one-word intent and an unknown key', () => {
    const accepts = (group: unknown) => expectSchema.safeParse({ answer: { mustMention: [group] } }).success;
    expect(accepts({ anyOf: ['a'], intent: 'The reply tells the administrator something specific.' })).toBe(true);
    expect(accepts(['a', 'b'])).toBe(true);
    expect(accepts({ anyOf: [] })).toBe(false);
    expect(accepts({ anyOf: ['a'], intent: 'too short' })).toBe(false);
    expect(accepts({ anyOf: ['a'], note: 'unknown key' })).toBe(false);
  });
});

describe('quoteIsVerbatim', () => {
  it('matches across case, Unicode form and white space, and refuses a short, empty or foreign quote', () => {
    const answer = 'Das kann ich nicht\n  starten. Die Liga   beginnt über die Seite /admin/leagues.';
    expect(quoteIsVerbatim(answer, 'DAS KANN ICH NICHT STARTEN.')).toBe(true);
    expect(quoteIsVerbatim(answer, 'Die Liga beginnt über die Seite')).toBe(true);
    expect(quoteIsVerbatim(answer, 'kann ich')).toBe(false);
    expect(quoteIsVerbatim(answer, 'Die Liga beginnt automatisch.')).toBe(false);
    expect(quoteIsVerbatim(answer, '')).toBe(false);
  });
});
