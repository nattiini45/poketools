import { describe, expect, it } from 'vitest';
import { emptyLive, reduceLive, type LiveTurn } from '../live-turn';
import { asAgentEvent, createSseParser, readAgentStream } from '../sse';
import { toolGroup } from '../tool-group';
import type { AgentEvent } from '../types';

const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

function collect(): { events: AgentEvent[]; parser: ReturnType<typeof createSseParser> } {
  const events: AgentEvent[] = [];
  return { events, parser: createSseParser((event) => events.push(event)) };
}

describe('the event stream parser', () => {
  it('reads one event per frame', () => {
    const { events, parser } = collect();
    parser.push(frame({ type: 'text.delta', step: 1, delta: 'Hel' }) + frame({ type: 'text.delta', step: 1, delta: 'lo' }));
    expect(events).toEqual([
      { type: 'text.delta', step: 1, delta: 'Hel' },
      { type: 'text.delta', step: 1, delta: 'lo' },
    ]);
  });

  it('joins a frame that arrives in pieces', () => {
    const { events, parser } = collect();
    const text = frame({ type: 'text.delta', step: 1, delta: 'Größe 日本' });
    for (let i = 0; i < text.length; i += 7) parser.push(text.slice(i, i + 7));
    expect(events).toEqual([{ type: 'text.delta', step: 1, delta: 'Größe 日本' }]);
  });

  it('accepts CRLF frames and a final frame without its blank line', () => {
    const { events, parser } = collect();
    parser.push('data: {"type":"plan.updated","revision":3}\r\n\r\n');
    parser.push('data: {"type":"done","reason":"completed","resumable":false}');
    expect(events).toHaveLength(1);
    parser.end();
    expect(events.map((event) => event.type)).toEqual(['plan.updated', 'done']);
  });

  it('drops anything that is not a known event: comments, bad JSON, unknown types, missing fields', () => {
    const { events, parser } = collect();
    parser.push(': keep-alive\n\n');
    parser.push('data: {not json}\n\n');
    parser.push(frame({ type: 'run.command', command: 'rm -rf /' }));
    parser.push(frame({ type: 'text.delta', step: 'one', delta: 1 }));
    parser.push(frame({ type: 'tool.end', id: 't' }));
    parser.push(frame('just a string'));
    parser.push(frame(null));
    parser.push(frame({ type: 'error', code: 'agent_budget_conversation' }));
    expect(events).toEqual([{ type: 'error', code: 'agent_budget_conversation' }]);
  });

  it('validates every event shape it hands on', () => {
    expect(asAgentEvent({ type: 'usage', step: 1, input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd_micro: 10, conversation_usd_micro: null, warn: false })).not.toBeNull();
    expect(asAgentEvent({ type: 'usage', cost_usd_micro: 'free' })).toBeNull();
    expect(asAgentEvent({ type: 'proposal', id: 'p', hash: 'h', preview: {} })).not.toBeNull();
    expect(asAgentEvent({ type: 'proposal', hash: 'h' })).toBeNull();
    expect(asAgentEvent({ type: 'done', reason: 'completed' })).toBeNull();
  });

  it('reads a whole response body to its end', async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(frame({ type: 'text.delta', step: 1, delta: 'é' }) + frame({ type: 'done', reason: 'completed', resumable: false }));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Split inside the two-byte character.
        const cut = bytes.indexOf(0xc3) + 1;
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    const seen: string[] = [];
    await readAgentStream(new Response(body), (event) => seen.push(event.type === 'text.delta' ? event.delta : event.type));
    expect(seen).toEqual(['é', 'done']);
  });
});

describe('the live turn', () => {
  const fold = (events: AgentEvent[]): LiveTurn => events.reduce(reduceLive, emptyLive());

  it('grows one text block per step and keeps tool lines in order', () => {
    const live = fold([
      { type: 'text.delta', step: 1, delta: 'Let me ' },
      { type: 'text.delta', step: 1, delta: 'look.' },
      { type: 'tool.start', id: 'a', name: 'league_list', label_code: 'tool.league_list' },
      { type: 'tool.end', id: 'a', name: 'league_list', ok: true },
      { type: 'text.delta', step: 2, delta: 'Found two.' },
    ]);
    expect(live.blocks).toEqual([
      { kind: 'text', step: 1, text: 'Let me look.' },
      { kind: 'tool', id: 'a', name: 'league_list', status: 'ok', code: null },
      { kind: 'text', step: 2, text: 'Found two.' },
    ]);
  });

  it('marks a failed tool with its catalogued code and adds a call whose start was missed', () => {
    const live = fold([
      { type: 'tool.start', id: 'a', name: 'player_search', label_code: 'x' },
      { type: 'tool.start', id: 'a', name: 'player_search', label_code: 'x' },
      { type: 'tool.end', id: 'a', name: 'player_search', ok: false, code: 'rate_limited' },
      { type: 'tool.end', id: 'b', name: 'dex_lookup', ok: true },
    ]);
    expect(live.blocks).toEqual([
      { kind: 'tool', id: 'a', name: 'player_search', status: 'failed', code: 'rate_limited' },
      { kind: 'tool', id: 'b', name: 'dex_lookup', status: 'ok', code: null },
    ]);
  });

  it('records staged proposals once, the plan revision, the usage, the errors and the end', () => {
    const live = fold([
      { type: 'proposal', id: 'p1', hash: 'h', preview: {} },
      { type: 'proposal', id: 'p1', hash: 'h', preview: {} },
      { type: 'plan.updated', revision: 4 },
      { type: 'usage', step: 1, input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd_micro: 5, conversation_usd_micro: 3_200_000, warn: true },
      { type: 'error', code: 'agent_budget_conversation', params: { n: 1 }, reason: 'cap' },
      { type: 'card', kind: 'x', ref: 'y' },
      { type: 'action.updated', id: 'a', status: 'ok' },
      { type: 'done', reason: 'budget', resumable: false },
    ]);
    expect(live).toMatchObject({
      proposalIds: ['p1'],
      planRevision: 4,
      usage: { conversationMicro: 3_200_000, warn: true },
      errors: [{ code: 'agent_budget_conversation', params: { n: 1 }, reason: 'cap' }],
      done: { reason: 'budget', resumable: false },
    });
  });

  it('never mutates the state it was given', () => {
    const before = fold([{ type: 'text.delta', step: 1, delta: 'a' }]);
    const snapshot = JSON.stringify(before);
    reduceLive(before, { type: 'text.delta', step: 1, delta: 'b' });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('toolGroup', () => {
  it.each([
    ['league_list', 'league'],
    ['phase_get', 'league'],
    ['round_schedule_preview', 'league'],
    ['tournament_bracket_preview', 'tournament'],
    ['ruleset_build_preview', 'ruleset'],
    ['format_fork', 'format'],
    ['attachable_formats', 'format'],
    ['draft_setup_get', 'draft'],
    ['pointbuy_list_get', 'draft'],
    ['pool_template_list', 'draft'],
    ['plan_patch', 'plan'],
    ['propose_build', 'propose'],
    ['player_search', 'player'],
    ['dex_lookup', 'dex'],
    ['request_clarification', 'clarify'],
    ['whoami', 'lookup'],
    ['something_new', 'lookup'],
  ])('%s is a %s tool', (name, group) => {
    expect(toolGroup(name)).toBe(group);
  });
});
