import type { Session } from 'next-auth';
import { describe, expect, it } from 'vitest';
import { startTurn } from '../start';
import type { TurnInput, TurnRequest } from '../types';
import { ADMIN, CONVERSATION_ID, harness, readEvents, textStep, toolStep, type Harness } from './fakes';

/**
 * The verified session and the inbound request travel from the chat route to a D tool by reference and nowhere else
 * (plan 3.3, spike S1): the tool's context holds the very objects, and neither a persisted row, a stream event, a usage row,
 * a model-port input nor a store call ever contains anything of the session.
 */
const SENTINEL_EMAIL = 'session-sentinel-7f3a91@example.invalid';
const SENTINEL_NAME = 'Session Sentinel 7f3a91';
const SENTINEL_IP = '198.51.100.77';
const SENTINEL_SUB = 'sub-sentinel-7f3a91';

const session = {
  user: { id: ADMIN, name: SENTINEL_NAME, email: SENTINEL_EMAIL, image: null },
  player: null,
  expires: '2099-01-01T00:00:00.000Z',
  sub: SENTINEL_SUB,
} as unknown as Session;
const inbound = new Request('https://example.invalid/api/admin/agent/conversations/x/messages', { headers: { 'x-forwarded-for': SENTINEL_IP, 'user-agent': SENTINEL_NAME } });

async function turn(h: Harness, extra: Partial<TurnRequest> = {}) {
  const input: TurnInput = { kind: 'message', text: 'Create a draft ruleset', clientMsgId: 'c1' };
  const started = await startTurn(h.deps, { adminId: ADMIN, adminName: 'Test Admin', conversationId: CONVERSATION_ID, input, locale: 'en', timeZone: 'Europe/Berlin', role: 'site', ...extra });
  const [events, outcome] = await Promise.all([readEvents(started.stream), started.completion]);
  return { events, outcome };
}

describe('the dispatch context of a turn', () => {
  it('reaches the tool context by reference: the same session object and the same inbound request', async () => {
    const h = harness({ classes: { ruleset_create_draft: 'D' } });
    h.tools.on('ruleset_create_draft', () => ({ ok: true, data: { ruleset_id: 'x' } }));
    h.port.script(toolStep([{ name: 'ruleset_create_draft', id: 'toolu_a' }]), textStep('Done'));

    await turn(h, { dispatch: { session, inbound } });

    expect(h.tools.calls).toHaveLength(1);
    expect(h.tools.calls[0].ctx.dispatch?.session).toBe(session);
    expect(h.tools.calls[0].ctx.dispatch?.inbound).toBe(inbound);
  });

  it('leaves the tool context without a dispatch when the request carried none', async () => {
    const h = harness({ classes: { ruleset_create_draft: 'D' } });
    h.tools.on('ruleset_create_draft', () => ({ ok: true, data: {} }));
    h.port.script(toolStep([{ name: 'ruleset_create_draft', id: 'toolu_a' }]), textStep('Done'));

    await turn(h);

    expect(Object.keys(h.tools.calls[0].ctx)).not.toContain('dispatch');
  });

  it('never puts the session or the request into a persisted row, a stream event, a usage row, a ref or a model-port input', async () => {
    const h = harness({ classes: { ruleset_create_draft: 'D', league_get: 'R' } });
    h.tools.on('league_get', () => ({ ok: true, data: { label: 'Autumn' } }));
    h.tools.on('ruleset_create_draft', (_input, ctx) => {
      // The tool may use the session; what it answers is plain data.
      expect(ctx.dispatch?.session).toBe(session);
      return { ok: true, data: { ruleset_id: 'abc' }, ui: { proposal_id: null }, refs: [{ kind: 'ruleset', id: '11111111-1111-4111-8111-111111111111', label: 'spring', source: 'tool_result' }] };
    });
    h.port.script(
      toolStep([{ name: 'league_get', id: 'toolu_a' }, { name: 'ruleset_create_draft', id: 'toolu_b', input: { mode: 'new' } }]),
      textStep('Created.'),
    );

    const { events } = await turn(h, { dispatch: { session, inbound } });

    const everything = JSON.stringify({
      messages: h.fake.messages,
      log: h.fake.log,
      usage: h.fake.usage,
      audit: h.audit,
      refs: h.fake.refs,
      events,
      portInputs: h.port.inputs.map(({ transcript, system, tools, model, effort, sentinel }) => ({ transcript, system, tools, model, effort, sentinel })),
      portCompletions: h.port.completions,
      toolResults: h.tools.calls.map(({ name, input }) => ({ name, input })),
    });
    for (const secret of [SENTINEL_EMAIL, SENTINEL_NAME, SENTINEL_IP, SENTINEL_SUB, '2099-01-01']) expect(everything).not.toContain(secret);
    // The scan is real: a turn that did persist and stream things.
    expect(h.fake.messages.length).toBeGreaterThan(3);
    expect(events.length).toBeGreaterThan(3);
  });
});
