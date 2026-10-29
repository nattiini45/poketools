import { describe, expect, it, vi } from 'vitest';

// The registry's guards import the NextAuth setup; the loop never calls a guard in these tests.
vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { createBindingRegistry } from '../dispatch/binding';
import { createAdminAgent, SYSTEM_PROMPT_VERSION } from '../index';
import { AdminAgentHostedDatabaseError } from '../loop';
import { buildToolSet } from '../registry';
import { parseAdminAgentEnv } from '../env';
import { ADMIN, CONVERSATION_ID, FakePort, FakeStore, readEvents, textStep, toolStep } from '../loop/__tests__/fakes';
import { makeConversation } from '../loop/__tests__/fakes';

/**
 * `createAdminAgent` wiring: defaults come from the real registry and the frozen prompt, everything else is injected, so
 * the same loop runs here with a fake port and an in-memory store (no network, no database).
 */
const ops = createBindingRegistry([]);
// The unit-test environment points at a placeholder hosted URL, so the tests opt in to the hosted guard explicitly.
const config = () => parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: 'true', ADMIN_AGENT_ALLOW_HOSTED: 'true' });

function agentWith(overrides: Parameters<typeof createAdminAgent>[0] extends infer O ? Partial<O> : never = {}) {
  const fake = new FakeStore(makeConversation({ title: 'Named' }));
  const port = new FakePort();
  const audit = vi.fn();
  const agent = createAdminAgent({ ops, store: fake.store, port, config, audit, now: fake.clock.now, ...overrides });
  // A conversation made the way a route would make it.
  const defaults = agent.conversationDefaults({ role: 'site', writeCapable: true });
  fake.conversation = makeConversation({
    title: 'Named',
    model: defaults.model,
    effort: defaults.effort,
    tool_set: defaults.toolSet,
    tool_registry_version: defaults.toolRegistryVersion,
    system_prompt_version: defaults.systemPromptVersion,
  });
  return { agent, fake, port, audit };
}

const request = (text = 'hello') => ({
  adminId: ADMIN,
  adminName: 'Test Admin',
  conversationId: CONVERSATION_ID,
  input: { kind: 'message' as const, text, clientMsgId: `c-${text}` },
  locale: 'en' as const,
  timeZone: 'Europe/Berlin',
  role: 'site' as const,
});

describe('createAdminAgent', () => {
  it('refuses a hosted database outside a production build unless the operator opted in', () => {
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toContain('supabase.co');
    expect(() => createAdminAgent({ ops, config: () => parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: 'true' }) })).toThrow(AdminAgentHostedDatabaseError);
    expect(() => createAdminAgent({ ops, config })).not.toThrow();
  });

  it('pins the write model at medium, the read model for read-only, and the current versions', () => {
    const { agent } = agentWith();
    const write = agent.conversationDefaults({ role: 'site', writeCapable: true });
    expect(write).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium', toolSet: 'site', systemPromptVersion: SYSTEM_PROMPT_VERSION });
    expect(write.toolRegistryVersion).toBe(buildToolSet({ role: 'site', maxPhase: 0 }).registryVersion);
    expect(agent.conversationDefaults({ role: 'scoped', writeCapable: false })).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium', toolSet: 'scoped' });
    expect(agent.systemPromptVersion).toBe(SYSTEM_PROMPT_VERSION);
  });

  it('follows ADMIN_AGENT_MAX_PHASE for the tool set, so a raised cap makes old conversations "outdated"', () => {
    const { agent } = agentWith({ config: () => parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: 'true', ADMIN_AGENT_ALLOW_HOSTED: 'true', ADMIN_AGENT_MAX_PHASE: '1' }) });
    expect(agent.toolSetFor('site').maxPhase).toBe(1);
    expect(agent.toolSetFor('site').registryVersion).not.toBe(buildToolSet({ role: 'site', maxPhase: 0 }).registryVersion);
  });

  it('runs a turn with the real registry and the frozen prompt, sending the registry tools and the prompt to the port', async () => {
    const { agent, port, fake } = agentWith();
    port.script(textStep('Hi there.'));
    const started = await agent.startTurn(request());
    const [events, outcome] = await Promise.all([readEvents(started.stream), started.completion]);
    expect(outcome.reason).toBe('completed');
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed', resumable: false });
    const input = port.inputs[0];
    expect(input.system).toContain('You are the Assistant');
    expect(input.tools.map((t) => t.name)).toEqual(buildToolSet({ role: 'site', maxPhase: 0 }).names);
    expect(input.model).toBe('claude-opus-5-5');
    expect(fake.conversation.turn_lease_until).toBeNull();
  });

  it('answers a stage-only tool with tool_not_available until a runner is bound, then hands it the bindings', async () => {
    const unbound = agentWith();
    unbound.port.script(toolStep([{ name: 'plan_create', id: 'p1', input: {} }]), textStep('ok'));
    const started = await unbound.agent.startTurn(request('one'));
    await Promise.all([readEvents(started.stream), started.completion]);
    const results = unbound.fake.messages.find((m) => m.kind === 'tool_results')?.content as Array<{ content: string }>;
    expect(JSON.parse(results[0].content)).toEqual({ ok: false, code: 'tool_not_available' });

    const runStaged = vi.fn(async () => ({ ok: true as const, data: { status: 'applied' } }));
    const bound = agentWith({ runStaged });
    bound.port.script(toolStep([{ name: 'plan_create', id: 'p1', input: { x: 1 } }]), textStep('ok'));
    const second = await bound.agent.startTurn(request('two'));
    await Promise.all([readEvents(second.stream), second.completion]);
    expect(runStaged).toHaveBeenCalledTimes(1);
    const [tool, input, ctx] = runStaged.mock.calls[0] as unknown as [{ name: string; class: string }, unknown, { ops: unknown; toolUseId: string; conversationId: string }];
    expect(tool).toMatchObject({ name: 'plan_create', class: 'D' });
    expect(input).toEqual({ x: 1 });
    expect(ctx.ops).toBe(ops);
    expect(ctx).toMatchObject({ toolUseId: 'p1', conversationId: CONVERSATION_ID });
  });

  it('derives a stable per-conversation sentinel only when the sentinel channel needs one', async () => {
    const { agent, port } = agentWith({ adapter: { stateChannel: 'sentinel-user' }, sentinelSecret: 'test-secret' });
    port.script(textStep('ok'), textStep('ok again'));
    const first = await agent.startTurn(request('a'));
    await Promise.all([readEvents(first.stream), first.completion]);
    const second = await agent.startTurn(request('b'));
    await Promise.all([readEvents(second.stream), second.completion]);
    expect(port.inputs[0].sentinel).toMatch(/^[0-9a-f]{12}$/);
    expect(port.inputs[1].sentinel).toBe(port.inputs[0].sentinel);
  });

  it('derives the sentinel from the one auth secret of the app, NEXTAUTH_SECRET, when none is injected', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'a-nextauth-secret-of-enough-length');
    try {
      const { agent, port } = agentWith({ adapter: { stateChannel: 'sentinel-user' } });
      port.script(textStep('ok'));
      const started = await agent.startTurn(request('a'));
      const [, outcome] = await Promise.all([readEvents(started.stream), started.completion]);
      expect(outcome.reason).toBe('completed');
      expect(port.inputs[0].sentinel).toMatch(/^[0-9a-f]{12}$/);
      // A different secret gives a different sentinel: it is derived from it, not constant.
      vi.stubEnv('NEXTAUTH_SECRET', 'another-nextauth-secret-of-length');
      const other = agentWith({ adapter: { stateChannel: 'sentinel-user' } });
      other.port.script(textStep('ok'));
      const second = await other.agent.startTurn(request('a'));
      await Promise.all([readEvents(second.stream), second.completion]);
      expect(other.port.inputs[0].sentinel).not.toBe(port.inputs[0].sentinel);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
