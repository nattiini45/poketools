import { describe, expect, it, vi } from 'vitest';
import { costMicro } from '../pricing';
import { loopCode } from '../codes';
import { startTurn } from '../start';
import { ModelPortError, type AgentStreamEvent, type TurnInput } from '../types';
import { ADMIN, CONVERSATION_ID, harness, readEvents, textStep, toolStep, typesOf, type Harness } from './fakes';

async function turn(h: Harness, input: TurnInput = { kind: 'message', text: 'Make me a league', clientMsgId: 'c1' }) {
  const started = await startTurn(h.deps, { adminId: ADMIN, adminName: 'Test Admin', conversationId: CONVERSATION_ID, input, locale: 'en', timeZone: 'Europe/Berlin', role: 'site' });
  const [events, outcome] = await Promise.all([readEvents(started.stream), started.completion]);
  return { events, outcome };
}

const kinds = (h: Harness) => h.fake.messages.map((m) => `${m.role}:${m.kind}`);
const done = (events: readonly AgentStreamEvent[]) => events.find((e): e is Extract<AgentStreamEvent, { type: 'done' }> => e.type === 'done');
const errorOf = (events: readonly AgentStreamEvent[]) => events.find((e): e is Extract<AgentStreamEvent, { type: 'error' }> => e.type === 'error');

describe('a multi-step tool loop', () => {
  it('runs a tool, feeds the result back and ends on the final answer', async () => {
    const h = harness();
    h.tools.on('league_get', () => ({ ok: true, data: { label: 'Autumn League' } }));
    h.port.script(toolStep([{ name: 'league_get', id: 'toolu_a' }]), textStep('The league is Autumn League.'));

    const { events, outcome } = await turn(h);

    expect(outcome).toMatchObject({ reason: 'completed', resumable: false, steps: 2, toolCalls: 1 });
    expect(typesOf(events).filter((t) => t !== 'usage')).toEqual(['tool.start', 'tool.end', 'text.delta', 'done']);
    expect(typesOf(events)).toContain('tool.start');
    expect(typesOf(events)).toContain('tool.end');
    expect(events.filter((e) => e.type === 'usage')).toHaveLength(2);
    expect(done(events)).toEqual({ type: 'done', reason: 'completed', resumable: false });
    expect(kinds(h)).toEqual(['user:chat', 'system:harness_event', 'assistant:chat', 'user:tool_results', 'assistant:chat']);
    expect(h.port.inputs).toHaveLength(2);
    // The second step saw the tool result, byte for byte.
    const second = h.port.inputs[1].transcript;
    const results = second.find((e) => e.role === 'user' && e.kind === 'tool_results');
    expect(results && results.role === 'user' && results.kind === 'tool_results' ? results.blocks[0] : null).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_a',
      content: '{"data":{"label":"Autumn League"},"ok":true}',
    });
  });

  it('streams the text of each step with its step number', async () => {
    const h = harness();
    h.port.script(textStep('Hello', { deltas: ['Hel', 'lo'] }));
    const { events } = await turn(h);
    expect(events.filter((e) => e.type === 'text.delta')).toEqual([
      { type: 'text.delta', step: 1, delta: 'Hel' },
      { type: 'text.delta', step: 1, delta: 'lo' },
    ]);
  });

  it('persists the assistant message, thinking blocks included, before any tool runs', async () => {
    const h = harness();
    const seen: Array<{ kinds: string[]; stored: unknown }> = [];
    h.tools.on('league_get', () => {
      seen.push({ kinds: kinds(h), stored: h.fake.messages.find((m) => m.role === 'assistant')?.content });
      return { ok: true, data: {} };
    });
    const step = toolStep([{ name: 'league_get', id: 'toolu_a' }], { text: 'Looking it up.' });
    h.port.script(step, textStep('Done'));

    await turn(h);

    expect(seen[0].kinds).toContain('assistant:chat');
    expect(seen[0].kinds).not.toContain('user:tool_results');
    expect(seen[0].stored).toEqual(step.blocks);
  });

  it('writes in the documented order: lease, user message, state, reserve, settle, assistant, results, release', async () => {
    const h = harness();
    h.tools.on('league_get', () => ({ ok: true, data: {} }));
    h.port.script(toolStep([{ name: 'league_get' }]), textStep('ok'));
    await turn(h);
    const ops = h.fake.log.map((entry) => (entry.op === 'append' ? `append:${entry.kind}` : entry.op));
    expect(ops).toEqual([
      'lease',
      'append:chat', // the admin's message
      'append:harness_event', // state refresh
      'reserve',
      'settle',
      'append:chat', // assistant step 1
      'append:tool_results',
      'reserve',
      'settle',
      'append:chat', // assistant step 2
      'release',
    ]);
  });
});

describe('tool execution order', () => {
  it('runs consecutive reads at once', async () => {
    const h = harness();
    let inFlight = 0;
    let peak = 0;
    const slow = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { ok: true as const, data: {} };
    };
    h.tools.on('league_get', slow).on('league_list', slow).on('dex_lookup', slow);
    h.port.script(toolStep([{ name: 'league_get' }, { name: 'league_list' }, { name: 'dex_lookup' }]), textStep('ok'));
    await turn(h);
    expect(peak).toBe(3);
  });

  it('runs D tools one at a time and skips the later writes after the first failure, while reads still run', async () => {
    const h = harness();
    let inFlight = 0;
    let peak = 0;
    h.tools.on('plan_set', async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: false, code: 'validation_failed', params: { issues: 'bad slot' } };
    });
    h.tools.on('plan_patch', () => ({ ok: true, data: {} }));
    h.tools.on('league_get', () => ({ ok: true, data: { label: 'x' } }));
    h.port.script(toolStep([{ name: 'plan_set', id: 'a' }, { name: 'plan_patch', id: 'b' }, { name: 'league_get', id: 'c' }]), textStep('ok'));

    await turn(h);

    expect(peak).toBe(1);
    expect(h.tools.calls.map((c) => c.name)).toEqual(['plan_set', 'league_get']);
    const results = h.fake.messages.find((m) => m.kind === 'tool_results')?.content as Array<{ tool_use_id: string; content: string; is_error?: boolean }>;
    expect(results.map((r) => r.tool_use_id)).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(results[0].content)).toEqual({ ok: false, code: 'validation_failed', params: { issues: 'bad slot' } });
    expect(JSON.parse(results[1].content)).toEqual({ ok: false, code: 'step_failed', params: { reason: 'earlier_call_failed' } });
    expect(results[1].is_error).toBe(true);
    expect(JSON.parse(results[2].content).ok).toBe(true);
  });

  it('keeps call order across read groups and writes', async () => {
    const h = harness();
    const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
    h.tools.on('league_get', async () => (await wait(), { ok: true, data: {} }));
    h.tools.on('plan_set', async () => (await wait(), { ok: true, data: {} }));
    h.port.script(toolStep([{ name: 'league_get', id: '1' }, { name: 'plan_set', id: '2' }, { name: 'league_get', id: '3' }]), textStep('ok'));
    await turn(h);
    expect(h.tools.timeline).toEqual(['start:league_get', 'end:league_get', 'start:plan_set', 'end:plan_set', 'start:league_get', 'end:league_get']);
  });

  it('hands the tool the call context and nothing from the browser', async () => {
    const h = harness();
    h.tools.on('league_get', () => ({ ok: true, data: {} }));
    h.port.script(toolStep([{ name: 'league_get', id: 'toolu_ctx' }]), textStep('ok'));
    await turn(h);
    expect(h.tools.calls[0].ctx).toMatchObject({
      adminId: ADMIN,
      conversationId: CONVERSATION_ID,
      toolUseId: 'toolu_ctx',
      step: 1,
      timeZone: 'Europe/Berlin',
      locale: 'en',
      model: 'claude-opus-5-5',
      systemPromptVersion: 'prompt-test',
      toolRegistryVersion: 'registry-test',
    });
    // The audit trail ties anything a tool stages to the admin message that started the turn.
    expect(h.tools.calls[0].ctx.userTextHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('emits the extras of a successful tool after its tool.end, and none for a failed one', async () => {
    const h = harness();
    h.tools.on('plan_set', () => ({ ok: true, data: {}, events: [{ type: 'plan.updated', revision: 3 }, { type: 'card', kind: 'plan', ref: 'p1' }], ui: { chip: 'applied' } }));
    h.tools.on('plan_patch', () => ({ ok: false, code: 'plan_stale', events: [{ type: 'plan.updated', revision: 9 }] }));
    h.port.script(toolStep([{ name: 'plan_set', id: 'a' }]), toolStep([{ name: 'plan_patch', id: 'b' }]), textStep('ok'));
    const { events } = await turn(h);
    const order = events.filter((e) => ['tool.start', 'tool.end', 'plan.updated', 'card'].includes(e.type)).map((e) => e.type);
    expect(order).toEqual(['tool.start', 'tool.end', 'plan.updated', 'card', 'tool.start', 'tool.end']);
    const ui = h.fake.messages.find((m) => m.kind === 'tool_results')?.ui as { results: Array<{ ui?: unknown }> };
    expect(ui.results[0].ui).toEqual({ chip: 'applied' });
  });

  it('answers a provider-flagged invalid call without running anything', async () => {
    const h = harness();
    h.port.script(toolStep([{ name: 'league_get', id: 'bad' }], { invalidToolCallIds: ['bad'] }), textStep('ok'));
    await turn(h);
    expect(h.tools.calls).toHaveLength(0);
    const results = h.fake.messages.find((m) => m.kind === 'tool_results')?.content as Array<{ content: string }>;
    expect(JSON.parse(results[0].content).code).toBe('validation_failed');
  });
});

describe('tool failures never leak an error message', () => {
  it('turns a throwing runtime into agent_harness_error', async () => {
    const h = harness();
    h.tools.on('league_get', () => {
      throw new Error('secret internal detail: db password is hunter2');
    });
    h.port.script(toolStep([{ name: 'league_get' }]), textStep('ok'));
    await turn(h);
    const stored = JSON.stringify(h.fake.messages);
    expect(stored).not.toContain('hunter2');
    expect(stored).toContain('agent_harness_error');
  });

  it('replaces an uncatalogued code with agent_harness_error', async () => {
    const h = harness();
    h.tools.on('league_get', () => ({ ok: false, code: 'made_up_code' as never }));
    h.port.script(toolStep([{ name: 'league_get' }]), textStep('ok'));
    await turn(h);
    const results = h.fake.messages.find((m) => m.kind === 'tool_results')?.content as Array<{ content: string }>;
    expect(JSON.parse(results[0].content).code).toBe('agent_harness_error');
  });

  it('answers the call with a harness error when the store refuses the result (a private field)', async () => {
    const h = harness();
    h.tools.on('league_get', () => ({ ok: true, data: { label: 'x', discord_id: '1234' } }));
    h.port.script(toolStep([{ name: 'league_get', id: 'a' }]), textStep('ok'));
    const { outcome } = await turn(h);
    expect(outcome.reason).toBe('completed');
    const stored = JSON.stringify(h.fake.messages.find((m) => m.kind === 'tool_results'));
    expect(stored).not.toContain('discord_id');
    expect(stored).toContain('agent_harness_error');
    expect(stored).toContain('"tool_use_id":"a"');
  });

  it('replaces an oversized result', async () => {
    const h = harness();
    h.tools.on('league_get', () => ({ ok: true, data: { label: 'x'.repeat(200_000) } }));
    h.port.script(toolStep([{ name: 'league_get' }]), textStep('ok'));
    await turn(h);
    const results = h.fake.messages.find((m) => m.kind === 'tool_results')?.content as Array<{ content: string }>;
    expect(JSON.parse(results[0].content).code).toBe('agent_harness_error');
  });
});

describe('per-turn caps', () => {
  it('stops at the step cap with a resumable event', async () => {
    const h = harness({ env: { ADMIN_AGENT_MAX_STEPS_PER_TURN: '2' } });
    h.tools.on('league_get', () => ({ ok: true, data: {} }));
    h.port.script(toolStep([{ name: 'league_get' }]), toolStep([{ name: 'league_get' }]), toolStep([{ name: 'league_get' }]));
    const { events, outcome } = await turn(h);
    expect(h.port.inputs).toHaveLength(2);
    expect(outcome).toMatchObject({ reason: 'step_limit', resumable: true, steps: 2 });
    expect(done(events)).toEqual({ type: 'done', reason: 'step_limit', resumable: true });
    const last = h.fake.messages[h.fake.messages.length - 1];
    expect(last).toMatchObject({ kind: 'harness_event', role: 'system', ui: { event: 'turn_limit', data: { limit: 'steps' } } });
  });

  it('resumes a capped turn with continue', async () => {
    const h = harness({ env: { ADMIN_AGENT_MAX_STEPS_PER_TURN: '1' } });
    h.tools.on('league_get', () => ({ ok: true, data: {} }));
    h.port.script(toolStep([{ name: 'league_get' }]), textStep('All done.'));
    await turn(h);
    const second = await turn(h, { kind: 'continue' });
    expect(second.outcome.reason).toBe('completed');
    expect(h.port.inputs).toHaveLength(2);
    const lastEntry = h.port.inputs[1].transcript.at(-1);
    expect(lastEntry).toMatchObject({ role: 'event' });
  });

  it('answers calls past the tool-call cap with a limit error and stops resumably', async () => {
    const h = harness({ env: { ADMIN_AGENT_MAX_TOOL_CALLS_PER_TURN: '2' } });
    h.tools.on('league_get', () => ({ ok: true, data: {} }));
    h.port.script(toolStep([{ name: 'league_get', id: '1' }, { name: 'league_get', id: '2' }, { name: 'league_get', id: '3' }]), textStep('never'));
    const { outcome, events } = await turn(h);
    expect(h.tools.calls).toHaveLength(2);
    expect(outcome).toMatchObject({ reason: 'tool_limit', resumable: true, toolCalls: 2 });
    expect(h.port.inputs).toHaveLength(1);
    const results = h.fake.messages.find((m) => m.kind === 'tool_results')?.content as Array<{ content: string }>;
    expect(JSON.parse(results[2].content)).toEqual({ ok: false, code: 'agent_turn_limit_reached', params: { limit: 'tool_calls' } });
    // The skipped call is still visible on the stream.
    expect(events.filter((e) => e.type === 'tool.end')).toHaveLength(3);
  });

  it('caps stagings per turn and lets the model go on', async () => {
    const h = harness({ env: { ADMIN_AGENT_MAX_STAGINGS_PER_TURN: '1' } });
    h.tools.on('propose_build', () => ({ ok: true, data: { status: 'staged' } }));
    h.port.script(toolStep([{ name: 'propose_build', id: '1' }, { name: 'propose_build', id: '2' }]), textStep('Staged one.'));
    const { outcome } = await turn(h);
    expect(h.tools.calls).toHaveLength(1);
    expect(outcome).toMatchObject({ reason: 'completed', stagings: 1 });
    const results = h.fake.messages.find((m) => m.kind === 'tool_results')?.content as Array<{ content: string }>;
    expect(JSON.parse(results[1].content)).toEqual({ ok: false, code: 'agent_turn_limit_reached', params: { limit: 'stagings' } });
  });

  it('allows one go-live proposal per turn', async () => {
    const h = harness();
    h.tools.on('propose_start_phase', () => ({ ok: true, data: { status: 'staged' } }));
    h.tools.on('propose_publish_ruleset', () => ({ ok: true, data: { status: 'staged' } }));
    h.port.script(toolStep([{ name: 'propose_start_phase', id: '1' }]), toolStep([{ name: 'propose_publish_ruleset', id: '2' }]), textStep('ok'));
    await turn(h);
    expect(h.tools.calls.map((c) => c.name)).toEqual(['propose_start_phase']);
    const results = h.fake.messages.filter((m) => m.kind === 'tool_results').map((m) => (m.content as Array<{ content: string }>)[0].content);
    expect(JSON.parse(results[1])).toEqual({ ok: false, code: 'agent_turn_limit_reached', params: { limit: 'go_live_proposal' } });
  });

  it('starts no new step after the wall-clock deadline and persists a resumable event', async () => {
    const h = harness({ env: { ADMIN_AGENT_TURN_DEADLINE_SECONDS: '30' } });
    h.tools.on('league_get', () => ({ ok: true, data: {} }));
    h.port.script(toolStep([{ name: 'league_get' }], { advanceMs: 31_000 }), textStep('never'));
    const { events, outcome } = await turn(h);
    expect(h.port.inputs).toHaveLength(1);
    expect(outcome).toMatchObject({ reason: 'deadline', resumable: true });
    expect(done(events)).toEqual({ type: 'done', reason: 'deadline', resumable: true });
    // The step that finished is kept: assistant message and its results are stored before the event.
    expect(kinds(h).slice(-3)).toEqual(['assistant:chat', 'user:tool_results', 'system:harness_event']);
    expect(h.fake.messages.at(-1)?.ui).toMatchObject({ event: 'turn_deadline' });
  });

  it('starts no write too close to the hard deadline, answers it with a catalogued code and stops resumable (reads still run)', async () => {
    const h = harness();
    h.tools.on('league_get', () => ({ ok: true, data: { found: true } }));
    h.tools.on('plan_set', () => ({ ok: true, data: {} }));
    h.tools.on('propose_build', () => ({ ok: true, data: {} }));
    // The model step ends 260 s in: past the 255 s line (285 s hard deadline minus the 30 s margin), before the 285 s itself.
    h.port.script(toolStep([{ name: 'league_get' }, { name: 'plan_set' }, { name: 'propose_build' }], { advanceMs: 260_000 }), textStep('never'));
    const { events, outcome } = await turn(h);
    expect(h.tools.calls.map((c) => c.name)).toEqual(['league_get']);
    expect(outcome).toMatchObject({ reason: 'deadline', resumable: true });
    expect(done(events)).toEqual({ type: 'done', reason: 'deadline', resumable: true });
    const results = h.fake.messages.filter((m) => m.kind === 'tool_results').map((m) => m.content as Array<{ tool_use_id: string; content: string; is_error?: boolean }>);
    expect(results).toHaveLength(1);
    expect(results[0].map((r) => JSON.parse(r.content))).toEqual([
      { ok: true, data: { found: true } },
      { ok: false, code: 'agent_turn_limit_reached', params: { limit: 'deadline' } },
      { ok: false, code: 'agent_turn_limit_reached', params: { limit: 'deadline' } },
    ]);
    expect(h.fake.messages.at(-1)?.ui).toMatchObject({ event: 'turn_deadline' });
    expect(kinds(h).slice(-3)).toEqual(['assistant:chat', 'user:tool_results', 'system:harness_event']);
  });

  it('runs a write that starts before the margin', async () => {
    const h = harness();
    h.tools.on('plan_set', () => ({ ok: true, data: {} }));
    h.port.script(toolStep([{ name: 'plan_set' }], { advanceMs: 200_000 }), textStep('done'));
    const { outcome } = await turn(h);
    expect(h.tools.calls.map((c) => c.name)).toEqual(['plan_set']);
    expect(outcome.reason).toBe('completed');
  });
});

describe('the end of a turn', () => {
  it('releases the lease before the client can see `done`, so a client that reacts to it does not meet a busy conversation', async () => {
    const h = harness();
    h.port.script(textStep('Hello'));
    const started = await startTurn(h.deps, { adminId: ADMIN, adminName: 'Test Admin', conversationId: CONVERSATION_ID, input: { kind: 'message', text: 'Hi', clientMsgId: 'c1' }, locale: 'en', timeZone: 'Europe/Berlin', role: 'site' });
    const reader = started.stream.getReader();
    const decoder = new TextDecoder();
    let leaseAtDone: string | null | undefined;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (leaseAtDone === undefined && text.includes('"type":"done"')) leaseAtDone = h.fake.conversation.turn_lease_until;
    }
    await started.completion;
    expect(leaseAtDone).toBeNull();
    expect(text.trimEnd().endsWith('}')).toBe(true);
  });
});

describe('provenance of ids (plan 6.3)', () => {
  const LEAGUE = '00000000-0000-4000-8000-000000000a01';
  const TYPED = '00000000-0000-4000-8000-000000000b02';

  it('records the ids a read returned, once per step, before the results are stored', async () => {
    const h = harness();
    let recordedBeforeResults = false;
    h.tools.on('league_get', () => ({ ok: true, data: {}, refs: [{ kind: 'league', id: LEAGUE, label: 'Autumn League', source: 'tool_result' }] }));
    h.tools.on('league_list', () => ({ ok: true, data: {}, refs: [{ kind: 'league', id: LEAGUE, label: 'Autumn League', source: 'tool_result' }] }));
    h.port.script(toolStep([{ name: 'league_get' }, { name: 'league_list' }]), textStep('done'));
    const append = h.fake.store.messages.appendMessage;
    h.fake.store.messages.appendMessage = async (adminId, id, input) => {
      if (input.kind === 'tool_results') recordedBeforeResults = h.fake.refs.length > 0;
      return append(adminId, id, input);
    };
    await turn(h);
    expect(h.fake.refs).toEqual([{ kind: 'league', id: LEAGUE, label: 'Autumn League', source: 'tool_result' }]);
    expect(recordedBeforeResults).toBe(true);
  });

  it('records no id for a failed call and none for a tool that returns none', async () => {
    const h = harness();
    h.tools.on('league_get', () => ({ ok: false, code: 'forbidden' }));
    h.tools.on('league_list', () => ({ ok: true, data: {} }));
    h.port.script(toolStep([{ name: 'league_get' }, { name: 'league_list' }]), textStep('done'));
    await turn(h);
    expect(h.fake.refs).toEqual([]);
  });

  it('records the uuids the admin typed, lower-cased, as seen in the admin message', async () => {
    const h = harness();
    h.port.script(textStep('ok'));
    await turn(h, { kind: 'message', text: `Change league ${TYPED.toUpperCase()} and not 123-not-a-uuid`, clientMsgId: 'c2' });
    expect(h.fake.refs).toEqual([{ kind: 'id', id: TYPED, label: null, source: 'user_message' }]);
  });

  it('does not lose the turn when the ids cannot be recorded (a later write is refused instead)', async () => {
    const h = harness();
    h.fake.failRecordRefs = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.tools.on('league_get', () => ({ ok: true, data: {}, refs: [{ kind: 'league', id: LEAGUE, label: null, source: 'tool_result' }] }));
    h.port.script(toolStep([{ name: 'league_get' }]), textStep('done'));
    const { outcome } = await turn(h, { kind: 'message', text: `look at ${TYPED}`, clientMsgId: 'c3' });
    expect(outcome.reason).toBe('completed');
    spy.mockRestore();
  });
});

describe('stop reasons that run nothing', () => {
  it('a refusal executes no tool, keeps the history valid and reports a retryable failure', async () => {
    const h = harness();
    h.port.script(toolStep([{ name: 'plan_set', id: 'x' }], { stopReason: 'refusal' }));
    const { events, outcome } = await turn(h);
    expect(h.tools.calls).toHaveLength(0);
    expect(outcome).toMatchObject({ reason: 'refused', resumable: false });
    expect(errorOf(events)).toMatchObject({ code: loopCode('refused'), reason: 'refusal' });
    // The stored assistant message has a tool_use, so it is answered.
    expect(kinds(h).slice(-2)).toEqual(['assistant:chat', 'user:tool_results']);
    const results = h.fake.messages.at(-1)?.content as Array<{ tool_use_id: string; is_error?: boolean }>;
    expect(results[0]).toMatchObject({ tool_use_id: 'x', is_error: true });
  });

  it('max_tokens with a tool call executes nothing', async () => {
    const h = harness();
    h.port.script(toolStep([{ name: 'plan_set', id: 'x' }], { stopReason: 'max_tokens', rawStopReason: 'max_tokens' }));
    const { events, outcome } = await turn(h);
    expect(h.tools.calls).toHaveLength(0);
    expect(outcome.reason).toBe('truncated');
    expect(errorOf(events)).toMatchObject({ code: loopCode('truncated'), reason: 'max_tokens' });
    expect(done(events)).toEqual({ type: 'done', reason: 'truncated', resumable: false });
  });

  it('max_tokens in plain text keeps the partial text and fails the turn', async () => {
    const h = harness();
    h.port.script(textStep('A very long ans', { stopReason: 'max_tokens' }));
    const { outcome } = await turn(h);
    expect(outcome.reason).toBe('truncated');
    expect(kinds(h).at(-1)).toBe('assistant:chat');
  });

  it('a tool_use block under an end_turn stop runs nothing', async () => {
    const h = harness();
    h.port.script({ blocks: [{ type: 'tool_use', id: 'x', name: 'league_get', input: {} }], stopReason: 'end_turn' });
    const { outcome } = await turn(h);
    expect(h.tools.calls).toHaveLength(0);
    expect(outcome.reason).toBe('failed');
  });

  it('an empty response is a failure the admin can resume', async () => {
    const h = harness();
    h.port.script({ blocks: [], stopReason: 'end_turn' });
    const { outcome, events } = await turn(h);
    expect(outcome).toMatchObject({ reason: 'failed', resumable: true });
    expect(errorOf(events)?.reason).toBe('empty_response');
    expect(h.fake.messages.at(-1)?.ui).toMatchObject({ event: 'turn_interrupted' });
  });
});

describe('usage reservation and settlement', () => {
  it('reserves before the call and settles with the real meters and cost', async () => {
    const h = harness();
    h.port.script(textStep('Hi', { usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 5000, cacheWrite1hTokens: 2000 } }));
    const { events } = await turn(h);
    const order = h.fake.log.filter((e) => e.op === 'reserve' || e.op === 'settle').map((e) => e.op);
    expect(order).toEqual(['reserve', 'settle']);
    const row = h.fake.usage[0];
    expect(row).toMatchObject({ purpose: 'turn', model: 'claude-opus-5-5', settled: true });
    const expected = costMicro('claude-opus-5-5', { inputTokens: 1000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 2000, cacheReadTokens: 5000, outputTokens: 200 });
    // 1000x4 + 2000x8 + 5000x0.2 + 200x20
    expect(expected).toBe(4000 + 16000 + 1000 + 4000);
    expect(row.cost).toBe(expected);
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({ input_tokens: 8000, output_tokens: 200, cache_read_tokens: 5000, cache_write_tokens: 2000, cost_usd_micro: expected, warn: false });
  });

  it('warns once the conversation passes the warn threshold', async () => {
    const h = harness({ env: { ADMIN_AGENT_BUDGET_CONVERSATION_USD: '5', ADMIN_AGENT_BUDGET_CONVERSATION_WARN_USD: '0.005' } });
    h.port.script(textStep('Hi'));
    const { events } = await turn(h);
    expect(events.find((e) => e.type === 'usage')).toMatchObject({ warn: true });
  });

  it('blocks the call when a cap would be passed, with an agent.budget.block audit and a resumable event', async () => {
    const h = harness({ env: { ADMIN_AGENT_BUDGET_CONVERSATION_USD: '0.01', ADMIN_AGENT_BUDGET_CONVERSATION_WARN_USD: '0.005' } });
    h.port.script(textStep('never'));
    const { events, outcome } = await turn(h);
    expect(h.port.inputs).toHaveLength(0);
    expect(outcome).toMatchObject({ reason: 'budget', resumable: true });
    expect(errorOf(events)).toMatchObject({ code: 'agent_budget_conversation' });
    expect(h.audit).toHaveLength(1);
    expect(h.audit[0]).toMatchObject({ action: 'agent.budget.block', actor_id: ADMIN, resource_type: 'agent_conversation', resource_id: CONVERSATION_ID });
    expect(h.audit[0].metadata).toMatchObject({ cap: 'conversation', step: 1, model: 'claude-opus-5-5' });
    expect(h.fake.usage).toHaveLength(0);
    expect(h.fake.messages.at(-1)?.ui).toMatchObject({ event: 'turn_interrupted', data: { reason: 'budget', cap: 'conversation' } });
  });

  it('checks the cap again before every step', async () => {
    // Enough for the first step's reservation, not for the second after the first one settles.
    const h = harness({ env: { ADMIN_AGENT_BUDGET_CONVERSATION_USD: '0.3', ADMIN_AGENT_BUDGET_CONVERSATION_WARN_USD: '0.1' } });
    h.tools.on('league_get', () => ({ ok: true, data: {} }));
    h.port.script(toolStep([{ name: 'league_get' }], { usage: { outputTokens: 10_000 } }), textStep('never'));
    const { events, outcome } = await turn(h);
    expect(outcome.reason).toBe('budget');
    expect(h.port.inputs).toHaveLength(1);
    expect(errorOf(events)?.code).toBe('agent_budget_conversation');
  });

  it('keeps going when a settle fails (the reservation just stays and counts)', async () => {
    const h = harness();
    h.fake.failSettle = true;
    h.port.script(textStep('Hi'));
    const { outcome } = await turn(h);
    expect(outcome.reason).toBe('completed');
    expect(h.fake.usage[0].settled).toBe(false);
  });
});

describe('model failures', () => {
  it('releases the reservation, reports a catalogued error and leaves a resumable event', async () => {
    const h = harness();
    h.port.script(new ModelPortError('unavailable', { cause: new Error('529 overloaded') }));
    const { events, outcome } = await turn(h);
    expect(outcome).toMatchObject({ reason: 'model_error', resumable: true });
    expect(errorOf(events)).toMatchObject({ code: loopCode('unavailable'), reason: 'model_unavailable' });
    expect(h.fake.usage[0]).toMatchObject({ settled: true, cost: 0 });
    expect(h.fake.messages.at(-1)?.ui).toMatchObject({ event: 'turn_interrupted', data: { reason: 'model_unavailable' } });
    // The provider's own message never reaches the stream or the store.
    expect(JSON.stringify(events)).not.toContain('529');
    expect(JSON.stringify(h.fake.messages)).not.toContain('529');
  });

  it('keeps the whole estimate for a call that timed out mid-stream', async () => {
    const h = harness();
    h.port.script(new ModelPortError('timeout'));
    await turn(h);
    const reserve = h.fake.log.find((e) => e.op === 'reserve');
    expect(h.fake.usage[0].cost).toBe(reserve && reserve.op === 'reserve' ? reserve.estimate : -1);
  });

  it('does not mark an invalid request resumable', async () => {
    const h = harness();
    h.port.script(new ModelPortError('invalid_request'));
    const { outcome, events } = await turn(h);
    expect(outcome).toMatchObject({ reason: 'model_error', resumable: false });
    expect(errorOf(events)?.code).toBe('agent_harness_error');
  });

  it('reports a context overflow from the provider as agent_context_full', async () => {
    const h = harness();
    h.port.script(new ModelPortError('context_exceeded'));
    const { events } = await turn(h);
    expect(errorOf(events)?.code).toBe('agent_context_full');
  });

  it('refuses a turn when the conversation is over the context threshold', async () => {
    const h = harness({ env: { ADMIN_AGENT_CONTEXT_REFUSE_PERCENT: '50' } });
    h.fake.seed({ role: 'user', kind: 'chat', content: [{ type: 'text', text: 'x'.repeat(400_000) }] });
    h.fake.seed({ role: 'assistant', kind: 'chat', content: [{ type: 'text', text: 'ok' }] });
    h.port.script(textStep('never'));
    const { events, outcome } = await turn(h);
    expect(outcome.reason).toBe('context');
    expect(h.port.inputs).toHaveLength(0);
    expect(errorOf(events)).toMatchObject({ code: 'agent_context_full' });
    expect(h.fake.usage).toHaveLength(0);
  });
});
