import { describe, expect, it, vi } from 'vitest';

// The registry's guards import the NextAuth setup; no guard runs in these tests.
vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { STAGED_TOOLS } from '../../registry/staged';
import { adminIdOf } from '../../store/ids';
import type { StagedToolContext } from '../../loop/tool-runtime';
import { createPlanPorts, createStagedRunner } from '../index';
import type { StagedRunnerDeps } from '../types';

const ADMIN = adminIdOf('11111111-1111-4111-8111-111111111111');
const CONVERSATION = '33333333-3333-4333-8333-333333333333';
const PROPOSAL = '44444444-4444-4444-8444-444444444444';
const tool = (name: string) => STAGED_TOOLS.find((entry) => entry.name === name)!;

const context = (role: 'site' | 'scoped' = 'site'): StagedToolContext =>
  ({
    adminId: ADMIN,
    adminName: 'Test Admin',
    conversationId: CONVERSATION,
    toolUseId: 'toolu_1',
    step: 1,
    now: () => new Date('2026-10-27T12:00:00.000Z'),
    timeZone: 'Europe/Berlin',
    locale: 'en',
    model: 'claude-opus-5-5',
    effort: 'medium',
    systemPromptVersion: 'sp',
    toolRegistryVersion: 'rv',
    userTextHash: null,
    ops: {} as never,
    toolSet: { role } as never,
  }) as StagedToolContext;

function deps(overrides: Partial<StagedRunnerDeps> = {}): StagedRunnerDeps {
  return {
    store: {
      plans: { getActivePlan: vi.fn(async () => null), createPlan: vi.fn(), writePlanRevision: vi.fn(), getRevision: vi.fn() },
      conversations: { getConversation: vi.fn(async () => ({ id: CONVERSATION, tool_set: 'site', tool_registry_version: 'rv', ui_locale: 'de' })) },
      proposals: { getProposal: vi.fn(async () => null) },
    } as never,
    stage: vi.fn(),
    loadPlanFacts: vi.fn(),
    ...overrides,
  };
}

describe('createStagedRunner', () => {
  it('validates the arguments of a Plan tool with its own schema before it touches the store', async () => {
    const d = deps();
    const run = createStagedRunner(d);
    const result = await run(tool('plan_set'), { slot: 'nonsense', value_json: '{}' }, context());
    expect(result).toMatchObject({ ok: false, code: 'validation_failed' });
    expect(d.store.plans.getActivePlan).not.toHaveBeenCalled();
  });

  it('answers a Plan edit without a Plan with validation_failed and no_plan', async () => {
    const run = createStagedRunner(deps());
    expect(await run(tool('plan_set'), { slot: 'league', value_json: '{"name":"A"}' }, context())).toEqual({
      ok: false,
      code: 'validation_failed',
      params: { issues: 'no_plan: call plan_create first' },
    });
    expect(await run(tool('plan_revert'), {}, context())).toMatchObject({ ok: false, code: 'validation_failed' });
  });

  it('does not seed a Plan from an existing league yet: amend is tool_not_available', async () => {
    const d = deps();
    const result = await createStagedRunner(d)(tool('plan_create'), { mode: 'amend', title: 'x', entity_kind: 'league', entity_id: '00000000-0000-4000-8000-000000000001' }, context());
    expect(result).toEqual({ ok: false, code: 'tool_not_available' });
    expect(d.store.plans.createPlan).not.toHaveBeenCalled();
  });

  it('returns a clarification as data for the panel and tells the model it is waiting', async () => {
    const result = await createStagedRunner(deps())(
      tool('request_clarification'),
      { question: 'Which Monday?', kind: 'choice', options: [{ value: '2026-11-02', label: 'Next Monday' }] },
      context(),
    );
    expect(result).toMatchObject({
      ok: true,
      data: { status: 'waiting_for_admin' },
      ui: { clarification: { kind: 'choice', question: 'Which Monday?', options: [{ value: '2026-11-02', label: 'Next Monday' }] } },
    });
  });

  it('stages through stageProposal for the live tier, passes the raw arguments, and links the card in the UI projection', async () => {
    const stage = vi.fn(async () => ({
      status: 'staged' as const,
      proposal_id: PROPOSAL,
      kind: 'build' as const,
      class: 'B' as const,
      plan_code: 'abcd1234',
      expires_at: '2026-10-27T12:30:00.000Z',
      note: 'not executed; the admin must approve the card',
    }));
    const d = deps({ stage });
    (d.store.proposals.getProposal as ReturnType<typeof vi.fn>).mockResolvedValue({ id: PROPOSAL, proposal_hash: 'a'.repeat(64), preview: { kind: 'build' } });
    const result = await createStagedRunner(d)(tool('propose_build'), { plan_revision: 2, extra: 'left for stageProposal to refuse' }, context('site'));
    expect(stage).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'propose_build',
        args: { plan_revision: 2, extra: 'left for stageProposal to refuse' },
        admin: { id: ADMIN, isSiteAdmin: true },
        conversation: { id: CONVERSATION, tool_set: 'site', tool_registry_version: 'rv', ui_locale: 'de' },
      }),
    );
    expect(result).toMatchObject({ ok: true, data: { status: 'staged', plan_code: 'abcd1234' }, ui: { proposal_id: PROPOSAL } });
    expect(result.ok && result.events).toEqual([{ type: 'proposal', id: PROPOSAL, hash: 'a'.repeat(64), preview: { kind: 'build' } }]);
    // Nothing like a token reaches the model or the stream.
    expect(JSON.stringify(result)).not.toMatch(/token/i);
  });

  it('treats a scoped conversation as a non-site admin when staging', async () => {
    const stage = vi.fn(async () => ({ status: 'refused' as const, code: 'forbidden' as const }));
    await createStagedRunner(deps({ stage }))(tool('propose_build'), { plan_revision: 1 }, context('scoped'));
    expect(stage).toHaveBeenCalledWith(expect.objectContaining({ admin: { id: ADMIN, isSiteAdmin: false } }));
  });

  it('answers a refusal as a failed call with its catalogued code, params and a short findings summary', async () => {
    const stage = vi.fn(async () => ({
      status: 'refused' as const,
      code: 'plan_not_ready' as const,
      params: { blockers: 2 },
      findings: [
        { code: 'roster_unresolved', section: 'roster', path: '/slots/roster' },
        { code: 'ruleset_missing', section: 'ruleset', path: '/slots/ruleset' },
      ],
    }));
    const result = await createStagedRunner(deps({ stage }))(tool('propose_build'), { plan_revision: 1 }, context());
    expect(result).toEqual({ ok: false, code: 'plan_not_ready', params: { blockers: 2, findings: 'roster_unresolved@roster;ruleset_missing@ruleset' } });
  });

  it('maps a throw to a catalogued code and never leaks the message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stage = vi.fn(async () => {
      throw new Error('relation "admin_agent_proposals" does not exist');
    });
    const result = await createStagedRunner(deps({ stage }))(tool('propose_build'), { plan_revision: 1 }, context());
    expect(result).toEqual({ ok: false, code: 'agent_harness_error' });
    spy.mockRestore();
  });

  it('answers a D tool that has no binding yet with tool_not_available', async () => {
    const result = await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'fork_preset', preset_id: 'gen9ou' }, context());
    expect(result).toEqual({ ok: false, code: 'tool_not_available' });
  });
});

describe('createPlanPorts', () => {
  it('reads and validates nothing for a conversation without a Plan', async () => {
    const ports = createPlanPorts(deps());
    expect(await ports.get({ adminId: ADMIN, conversationId: CONVERSATION })).toBeNull();
    expect(await ports.validate({ adminId: ADMIN, conversationId: CONVERSATION })).toBeNull();
  });
});
