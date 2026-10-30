import { describe, expect, it } from 'vitest';
import { ModelPortError, type ModelStepInput, type ModelStepResult } from '../../loop/types';
import { failingPort, RecordingExhaustedError, ReplayPort, stepFromResult, TallyPort } from '../ports';
import { recordingSchema, type Recording } from '../types';

/** The replay port plays a recording through the same `step` call the real port serves; the tally counts what any port did. */
const input = (over: Partial<ModelStepInput> = {}): ModelStepInput => ({ model: 'claude-sonnet-5-5', effort: 'medium', system: 's', tools: [], transcript: [], sentinel: 'x', maxOutputTokens: 1000, timeoutMs: 1000, ...over });
const identity = <T>(value: T): T => value;
const recording: Recording = recordingSchema.parse({
  turns: [
    [{ calls: [{ name: 'league_list', input: { name_contains: '{{x}}' } }] }, { text: 'Two leagues.' }],
    [{ text: 'Another answer.', stop: 'max_tokens' }],
  ],
});

describe('ReplayPort', () => {
  it('plays the steps of the current turn in order and ends them with the natural stop', async () => {
    const port = new ReplayPort(recording, { resolve: (value) => JSON.parse(JSON.stringify(value).replace('{{x}}', 'two')) });
    port.beginTurn(0);
    const first = await port.step(input());
    expect(first.stopReason).toBe('tool_use');
    expect(first.blocks.map((b) => b.type)).toEqual(['thinking', 'tool_use']);
    expect(first.toolCalls).toEqual([{ id: 'toolu_eval_1', name: 'league_list', input: { name_contains: 'two' } }]);
    expect(first.blocks[0]).toMatchObject({ type: 'thinking', signature: 'eval-sig-1' });

    const deltas: string[] = [];
    const second = await port.step(input({ onTextDelta: (d) => deltas.push(d) }));
    expect(second.stopReason).toBe('end_turn');
    expect(second.blocks).toEqual([{ type: 'text', text: 'Two leagues.' }]);
    expect(deltas).toEqual(['Two leagues.']);
    expect(port.unplayed).toBe(0);
  });

  it('turns a recorded stop into the port stop reason', async () => {
    const port = new ReplayPort(recording, { resolve: identity });
    port.beginTurn(1);
    const result = await port.step(input());
    expect(result.stopReason).toBe('max_tokens');
    // The optional finish fields a real port reports, so the loop's diagnostics see a replay as they see a live run.
    expect(result).toMatchObject({ rawFinishReason: 'max_tokens', finishReason: 'length' });
    expect(result).not.toHaveProperty('stopDetails');
  });

  it('reports finish reasons for a natural stop and a refusal, and for the small call', async () => {
    const port = new ReplayPort(recordingSchema.parse({ turns: [[{ calls: [{ name: 'league_list', input: {} }] }, { text: 'Done.' }, { text: 'No.', stop: 'refusal' }]] }), { resolve: identity });
    port.beginTurn(0);
    expect(await port.step(input())).toMatchObject({ rawFinishReason: 'tool_use', finishReason: 'tool-calls' });
    expect(await port.step(input())).toMatchObject({ rawFinishReason: 'end_turn', finishReason: 'stop' });
    expect(await port.step(input())).toMatchObject({ rawFinishReason: 'refusal', finishReason: 'content-filter' });
    expect(await port.complete({ model: 'm', effort: 'low', system: 's', prompt: 'p', maxOutputTokens: 10, timeoutMs: 10 })).toMatchObject({ stopReason: 'end_turn', rawFinishReason: 'end_turn' });
  });

  it('writes the first request to the cache and reads it afterwards, unless the recording says otherwise', async () => {
    const port = new ReplayPort(recordingSchema.parse({ turns: [[{ text: 'a' }, { text: 'b' }, { text: 'c', usage: { cacheRead: 1, cacheWrite: 2, input: 3, output: 4 } }]] }), { resolve: identity });
    port.beginTurn(0);
    const [a, b, c] = [await port.step(input()), await port.step(input()), await port.step(input())];
    expect(a.usage.cacheWrite1hTokens).toBeGreaterThan(0);
    expect(a.usage.cacheReadTokens).toBe(0);
    expect(b.usage.cacheReadTokens).toBeGreaterThan(0);
    expect(b.usage.cacheWrite1hTokens).toBe(0);
    expect(c.usage).toMatchObject({ cacheReadTokens: 1, cacheWrite1hTokens: 2, inputTokens: 3, outputTokens: 4 });
  });

  it('reports a recording that is too short as exhausted, once and loudly', async () => {
    const port = new ReplayPort(recording, { resolve: identity });
    port.beginTurn(1);
    await port.step(input());
    await expect(port.step(input())).rejects.toBeInstanceOf(RecordingExhaustedError);
    expect(port.exhausted).toBe(true);
  });

  it('answers the title call without a model', async () => {
    const port = new ReplayPort(recording, { resolve: identity });
    await expect(port.complete({ model: 'm', effort: 'low', system: '', prompt: 'p', maxOutputTokens: 10, timeoutMs: 10 })).resolves.toMatchObject({ text: 'Eval conversation' });
  });

  it('keeps tool ids and thinking signatures unique across turns', async () => {
    const two = recordingSchema.parse({ turns: [[{ calls: [{ name: 'whoami', input: {} }] }], [{ calls: [{ name: 'whoami', input: {} }] }]] });
    const port = new ReplayPort(two, { resolve: identity });
    port.beginTurn(0);
    const a = await port.step(input());
    port.beginTurn(1);
    const b = await port.step(input());
    expect(a.toolCalls[0].id).not.toBe(b.toolCalls[0].id);
    expect(JSON.stringify(a.blocks)).not.toBe(JSON.stringify(b.blocks));
  });
});

describe('TallyPort', () => {
  it('counts requests, tokens, stops and thinking signatures, and separates the warm requests', async () => {
    const replay = new ReplayPort(recording, { resolve: identity });
    const tally = new TallyPort(replay);
    replay.beginTurn(0);
    await tally.step(input());
    await tally.step(input());
    expect(tally.usage.modelRequests).toBe(2);
    expect(tally.usage.cacheWriteTokens).toBeGreaterThan(0);
    expect(tally.usage.warmCacheReadTokens).toBeGreaterThan(0);
    expect(tally.usage.warmCacheWriteTokens).toBe(0);
    expect(tally.stops).toEqual(['tool_use', 'end_turn']);
    expect(tally.signatures).toEqual(['eval-sig-1']);
    expect(tally.results).toHaveLength(2);
  });

  it('counts a failed request and rethrows', async () => {
    const tally = new TallyPort(failingPort('unavailable'));
    await expect(tally.step(input())).rejects.toBeInstanceOf(ModelPortError);
    expect(tally.failures).toBe(1);
    expect(tally.usage.modelRequests).toBe(1);
  });
});

describe('stepFromResult', () => {
  it('writes a live step back as a recorded one that parses', () => {
    const result: ModelStepResult = {
      blocks: [
        { type: 'thinking', thinking: 't', signature: 's' },
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'toolu_1', name: 'league_list', input: { name_contains: 'x' } },
      ],
      toolCalls: [],
      stopReason: 'tool_use',
      rawStopReason: 'tool_use',
      usage: { inputTokens: 5, cacheWrite5mTokens: 0, cacheWrite1hTokens: 7, cacheReadTokens: 9, outputTokens: 3 },
      model: 'm',
    };
    const step = stepFromResult(result);
    expect(step).toEqual({ text: 'Checking.', thinking: true, calls: [{ name: 'league_list', input: { name_contains: 'x' } }], usage: { input: 5, cacheRead: 9, cacheWrite: 7, output: 3 } });
    expect(() => recordingSchema.parse({ turns: [[step]] })).not.toThrow();
    expect(stepFromResult({ ...result, blocks: [{ type: 'text', text: 'cut' }], stopReason: 'max_tokens' })).toMatchObject({ stop: 'max_tokens' });
  });
});

describe('failingPort', () => {
  it('fails every call the way an unreachable provider does', async () => {
    const port = failingPort('timeout');
    await expect(port.step(input())).rejects.toMatchObject({ kind: 'timeout', retryable: true });
    await expect(port.complete({ model: 'm', effort: 'low', system: '', prompt: '', maxOutputTokens: 1, timeoutMs: 1 })).rejects.toBeInstanceOf(ModelPortError);
  });
});
