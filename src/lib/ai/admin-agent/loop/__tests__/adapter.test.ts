import { describe, expect, it } from 'vitest';
import { ANCHOR_TEXT, DEFAULT_ADAPTER, blocksOfContent, renderTranscript, sentinelText } from '../ai-sdk-messages';
import { harnessEventText } from '../harness';
import type { TranscriptEntry } from '../transcript';

const user = (seq: number, text: string): TranscriptEntry => ({ role: 'user', kind: 'chat', seq, blocks: [{ type: 'text', text }] });
const assistant = (seq: number, blocks: Extract<TranscriptEntry, { role: 'assistant' }>['blocks']): TranscriptEntry => ({ role: 'assistant', kind: 'chat', seq, blocks });
const event = (seq: number, name: string, data: Record<string, never> = {}): TranscriptEntry => ({ role: 'event', kind: 'harness_event', seq, event: name, text: harnessEventText(name, data), data });

const base = { adapter: DEFAULT_ADAPTER, sentinel: 'abc123' };

describe('renderTranscript: the state channel switch', () => {
  const transcript: TranscriptEntry[] = [user(1, 'build it'), assistant(2, [{ type: 'text', text: 'Staged.' }]), event(3, 'proposal_approved'), event(4, 'state_refresh')];

  it('system-message (default): harness events are system messages, with a user anchor after an assistant message', () => {
    const out = renderTranscript(transcript, base);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'system', 'system']);
    expect(out[2]).toEqual({ role: 'user', content: [{ type: 'text', text: ANCHOR_TEXT }] });
    expect(out[3]).toEqual({ role: 'system', content: '[harness_event] proposal_approved' });
  });

  it('system-message without the anchor when the API does not need it', () => {
    const out = renderTranscript(transcript, { ...base, adapter: { ...DEFAULT_ADAPTER, systemAnchor: 'never' } });
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'system', 'system']);
  });

  it('no anchor after a user or tool message', () => {
    const afterUser = renderTranscript([user(1, 'hi'), event(2, 'state_refresh')], base);
    expect(afterUser.map((m) => m.role)).toEqual(['user', 'system']);
    const afterTool = renderTranscript(
      [
        user(1, 'hi'),
        assistant(2, [{ type: 'tool_use', id: 't', name: 'league_get', input: {} }]),
        { role: 'user', kind: 'tool_results', seq: 3, blocks: [{ type: 'tool_result', tool_use_id: 't', content: '{}' }] },
        event(4, 'turn_deadline'),
      ],
      base,
    );
    expect(afterTool.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'system']);
  });

  it('sentinel-user: harness events are user messages that start with the sentinel tag, and there is no system role at all', () => {
    const out = renderTranscript(transcript, { adapter: { ...DEFAULT_ADAPTER, stateChannel: 'sentinel-user' }, sentinel: 'abc123' });
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'user']);
    expect(out[2]).toEqual({ role: 'user', content: [{ type: 'text', text: '[harness_event:abc123] proposal_approved' }] });
    expect(out.some((m) => m.role === 'system')).toBe(false);
  });

  it('the sentinel tag keeps the event data', () => {
    expect(sentinelText('[harness_event] turn_limit\n{"limit":"steps"}', 's')).toBe('[harness_event:s] turn_limit\n{"limit":"steps"}');
  });
});

describe('renderTranscript: blocks', () => {
  it('replays thinking with its signature, redacted thinking, text and tool calls in order', () => {
    const out = renderTranscript(
      [
        user(1, 'go'),
        assistant(2, [
          { type: 'thinking', thinking: 'hmm', signature: 'sig-1' },
          { type: 'redacted_thinking', data: 'REDACTED' },
          { type: 'text', text: 'Looking.' },
          { type: 'tool_use', id: 't1', name: 'league_get', input: { id: 'x' } },
        ]),
      ],
      base,
    );
    expect(out[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'hmm', providerOptions: { anthropic: { signature: 'sig-1' } } },
        { type: 'reasoning', text: '', providerOptions: { anthropic: { redactedData: 'REDACTED' } } },
        { type: 'text', text: 'Looking.' },
        { type: 'tool-call', toolCallId: 't1', toolName: 'league_get', input: { id: 'x' } },
      ],
    });
  });

  it('replays a tool result as the stored string, an error result as an error', () => {
    const out = renderTranscript(
      [
        user(1, 'go'),
        assistant(2, [
          { type: 'tool_use', id: 't1', name: 'league_get', input: {} },
          { type: 'tool_use', id: 't2', name: 'plan_set', input: {} },
        ]),
        {
          role: 'user',
          kind: 'tool_results',
          seq: 3,
          blocks: [
            { type: 'tool_result', tool_use_id: 't1', content: '{"data":{"n":1.0},"ok":true}' },
            { type: 'tool_result', tool_use_id: 't2', content: '{"code":"plan_stale","ok":false}', is_error: true },
          ],
        },
      ],
      base,
    );
    expect(out[2]).toEqual({
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 't1', toolName: 'league_get', output: { type: 'text', value: '{"data":{"n":1.0},"ok":true}' } },
        { type: 'tool-result', toolCallId: 't2', toolName: 'plan_set', output: { type: 'error-text', value: '{"code":"plan_stale","ok":false}' } },
      ],
    });
  });
});

describe('blocksOfContent', () => {
  it('maps the SDK parts to blocks and drops empty text', () => {
    const result = blocksOfContent([
      { type: 'reasoning', text: 'a', providerMetadata: { anthropic: { signature: 's' } } },
      { type: 'reasoning', text: '', providerMetadata: { anthropic: { redactedData: 'r' } } },
      { type: 'text', text: '' },
      { type: 'text', text: 'hi' },
      { type: 'tool-call', toolCallId: 't', toolName: 'league_get', input: { a: 1 } },
    ]);
    expect(result.blocks).toEqual([
      { type: 'thinking', thinking: 'a', signature: 's' },
      { type: 'redacted_thinking', data: 'r' },
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 't', name: 'league_get', input: { a: 1 } },
    ]);
    expect(result.invalidToolCallIds).toEqual([]);
  });

  it('reads the signature from providerOptions too, and drops a thinking part that cannot be replayed', () => {
    const result = blocksOfContent([
      { type: 'reasoning', text: 'a', providerOptions: { anthropic: { signature: 's2' } } },
      { type: 'reasoning', text: 'no signature' },
    ]);
    expect(result.blocks).toEqual([{ type: 'thinking', thinking: 'a', signature: 's2' }]);
    expect(result.droppedThinking).toBe(1);
  });

  it('keeps a call with unparseable input as an empty-input call and flags it', () => {
    const result = blocksOfContent([
      { type: 'tool-call', toolCallId: 'bad', toolName: 'league_get', input: '{"broken', invalid: true },
      { type: 'tool-call', toolCallId: 'str', toolName: 'league_get', input: 'not an object' },
    ]);
    expect(result.blocks).toEqual([
      { type: 'tool_use', id: 'bad', name: 'league_get', input: {} },
      { type: 'tool_use', id: 'str', name: 'league_get', input: {} },
    ]);
    expect(result.invalidToolCallIds).toEqual(['bad', 'str']);
  });
});
