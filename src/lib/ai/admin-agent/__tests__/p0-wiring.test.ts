import { describe, expect, it, vi } from 'vitest';

// The registry's guards import the NextAuth setup, and `plan_validate` runs the real `any` guard: a live admin.
vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireAnyAdmin: vi.fn(async () => ({ playerId: '11111111-1111-4111-8111-111111111111', isAdmin: true, name: 'Test Admin' })),
  requireDraftAdmin: vi.fn(),
  requireFormatViewer: vi.fn(),
  requireResourceAdmin: vi.fn(),
}));

import { createBindingRegistry } from '../dispatch/binding';
import { createAdminAgent } from '../index';
import { parseAdminAgentEnv } from '../env';
import { ADMIN, CONVERSATION_ID, FakePort, FakeStore, makeConversation, readEvents, textStep, toolStep } from '../loop/__tests__/fakes';
import { PLAYERS, RULESET_VERSION, uid, workedExample } from '../plans/__tests__/fixtures';
import type { PlanDocument } from '../plans/schema';
import { makeHarness, PLAN_ID } from '../proposals/__tests__/helpers';
import { createProposalStager } from '../proposals/stage';
import { createPlanPorts, createStagedRunner, type StagedRunnerStore } from '../staged';
import { AdminAgentStoreError } from '../store/errors';
import type { PlanRecord, PlanRevisionRecord } from '../store/types';

/**
 * Phase 0 end to end, with the production wiring and nothing faked but the edges: the real `createAdminAgent`, the real
 * registry (`plan_validate`), the real staged-tool runner over the real `stageProposal`, a scripted model and in-memory
 * rows. The Plan tools write a Plan, `plan_validate` reads it with live facts, `propose_build` stages a Build card, and the
 * provenance rule (plan 6.3) is the one the store enforces: an id the admin typed is staged, an invented one is refused.
 */

const config = () => parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: 'true', ADMIN_AGENT_ALLOW_HOSTED: 'true' });

/** The Plan rows (`plans` of the store) in memory, with the compare-and-set and the supersede the real store does. */
class PlansMemory {
  plan: PlanRecord | null = null;
  readonly revisions: PlanRevisionRecord[] = [];
  constructor(private readonly onWrite: (nextRevision: number) => number) {}

  getActivePlan = async () => this.plan;

  createPlan = async (adminId: string, input: { conversationId: string; mode: string; doc: unknown; docHash: string }) => {
    this.plan = {
      id: PLAN_ID,
      conversation_id: input.conversationId,
      admin_id: adminId,
      admin_name: 'Test Admin',
      mode: input.mode,
      status: 'drafting',
      revision: 1,
      doc: input.doc,
      doc_hash: input.docHash,
      created_at: '2026-10-27T12:00:00.000Z',
      updated_at: '2026-10-27T12:00:00.000Z',
    } as PlanRecord;
    this.revisions.push({ plan_id: PLAN_ID, revision: 1, doc: input.doc, patch: null, author: 'agent' } as PlanRevisionRecord);
    return this.plan;
  };

  writePlanRevision = async (_adminId: string, planId: string, write: { expectedRevision: number; doc: unknown; docHash: string; patch?: unknown; author: string }) => {
    if (this.plan === null || this.plan.id !== planId) throw new AdminAgentStoreError('conversation_not_found');
    if (this.plan.revision !== write.expectedRevision) throw new AdminAgentStoreError('plan_stale', undefined, { detail: { currentRevision: this.plan.revision } });
    const next = write.expectedRevision + 1;
    const superseded = this.onWrite(next);
    this.plan = { ...this.plan, revision: next, doc: write.doc, doc_hash: write.docHash } as PlanRecord;
    this.revisions.push({ plan_id: planId, revision: next, doc: write.doc, patch: write.patch ?? null, author: write.author } as PlanRevisionRecord);
    return { plan: this.plan, supersededProposals: superseded };
  };

  getRevision = async (_adminId: string, planId: string, revision: number) => this.revisions.find((row) => row.plan_id === planId && row.revision === revision) ?? null;
}

function wiring() {
  const harness = makeHarness();
  const fake = new FakeStore(makeConversation({ title: 'Named' }));
  const plans = new PlansMemory((next) => {
    let count = 0;
    for (const row of harness.store.proposals) {
      if (row.kind === 'build' && row.status === 'proposed' && (row.plan_revision ?? 0) < next) {
        row.status = 'superseded';
        count += 1;
      }
    }
    return count;
  });

  // What the loop records is what staging may name: one list, written by the loop, read by the stager.
  const seen = () => new Set(fake.refs.map((ref) => ref.id.toLowerCase()));
  const stagerStore = {
    ...harness.store.asStore(),
    plans: { getActivePlan: plans.getActivePlan },
    refs: {
      knownRefIds: async (_admin: string, _conversation: string, ids: readonly string[]) => new Set(ids.map((id) => id.toLowerCase()).filter((id) => seen().has(id))),
      recordRefs: async () => 0,
    },
  };
  // The harness builds its own stager over its own store; this one is the same stager over the shared rows.
  const stager = createProposalStager({ ...harness.deps, store: stagerStore as never });

  const runnerStore: StagedRunnerStore = {
    plans: plans as unknown as StagedRunnerStore['plans'],
    conversations: { getConversation: async (adminId, id) => fake.store.conversations.getConversation(adminId, id) },
    proposals: {
      getProposal: async (_adminId, id) => (harness.store.proposals.find((row) => row.id === id) as never) ?? null,
    },
  };
  const staged = { store: runnerStore, stage: stager.stageProposal, loadPlanFacts: harness.deps.source.loadPlanFacts };

  const port = new FakePort(fake.clock);
  const agent = createAdminAgent({
    ops: createBindingRegistry([]),
    store: fake.store,
    port,
    config,
    audit: vi.fn(),
    now: fake.clock.now,
    runStaged: createStagedRunner(staged),
    ports: { plans: createPlanPorts(staged) },
  });
  const defaults = agent.conversationDefaults({ role: 'site', writeCapable: true });
  fake.conversation = makeConversation({
    title: 'Named',
    model: defaults.model,
    effort: defaults.effort,
    tool_set: defaults.toolSet,
    tool_registry_version: defaults.toolRegistryVersion,
    system_prompt_version: defaults.systemPromptVersion,
  });
  // Staging keeps the conversation row it staged against: the registry version of the offered tool set.
  harness.conversation.tool_registry_version = defaults.toolRegistryVersion;
  harness.conversation.id = CONVERSATION_ID;

  async function turn(text: string, clientMsgId: string) {
    const started = await agent.startTurn({ adminId: ADMIN, adminName: 'Test Admin', conversationId: CONVERSATION_ID, input: { kind: 'message', text, clientMsgId }, locale: 'en', timeZone: 'Europe/Berlin', role: 'site' });
    const [events, outcome] = await Promise.all([readEvents(started.stream), started.completion]);
    return { events, outcome };
  }
  const results = (): Array<Record<string, unknown>> =>
    fake.messages
      .filter((message) => message.kind === 'tool_results')
      .flatMap((message) => (message.content as Array<{ content: string }>).map((block) => JSON.parse(block.content) as Record<string, unknown>));

  return { harness, fake, plans, port, turn, results };
}

const slotCall = (plan: PlanDocument, slot: keyof PlanDocument['slots']) => ({ name: 'plan_set', input: { slot, value_json: JSON.stringify(plan.slots[slot]) } });

describe('phase 0, end to end', () => {
  const example = workedExample();
  const typed = `Set up a 12 player league. Ruleset version ${RULESET_VERSION}. Players: ${PLAYERS.join(', ')}.`;

  it('writes the Plan with the Plan tools, validates it with live facts and stages a Build card for the admin to approve', async () => {
    const { harness, fake, plans, port, turn, results } = wiring();
    port.script(
      toolStep([{ name: 'plan_create', input: { mode: 'create', title: 'Gen 9 OU league' } }, slotCall(example, 'ruleset'), slotCall(example, 'league'), slotCall(example, 'phases'), slotCall(example, 'roster')]),
      toolStep([{ name: 'plan_validate', input: {} }]),
      toolStep([{ name: 'propose_build', input: { plan_revision: 5 } }]),
      textStep('The Build is ready for you to approve.'),
    );
    const { events, outcome } = await turn(typed, 'c1');
    expect(outcome.reason).toBe('completed');

    // The Plan tools: five revisions, each a stored revision with its history row.
    expect(plans.plan?.revision).toBe(5);
    expect(plans.revisions.map((row) => row.revision)).toEqual([1, 2, 3, 4, 5]);
    expect(events.filter((event) => event.type === 'plan.updated').map((event) => (event as { revision: number }).revision)).toEqual([1, 2, 3, 4, 5]);

    const [created, , , , , validation, staged] = results() as Array<{ ok: boolean; data: Record<string, unknown> }>;
    expect(created).toMatchObject({ ok: true, data: { plan_revision: 1 } });
    // plan_validate went through the registry's P tool and the plans port, with the live facts.
    const report = JSON.parse((validation.data as { validation_user_text: string }).validation_user_text) as { ready: boolean; blockers: unknown[]; build: { steps: Array<{ op: string }> } };
    expect(report).toMatchObject({ ready: true, blockers: [] });
    expect(report.build.steps.map((step) => step.op)).toEqual(['league_create', 'roster_add', 'phase_create', 'phase_create']);

    // propose_build staged one pending Build proposal, and the model got a status, an id and a plan code, never a token.
    expect(staged).toMatchObject({ ok: true, data: { status: 'staged', kind: 'build', class: 'B', note: 'not executed; the admin must approve the card' } });
    expect(harness.store.proposals).toHaveLength(1);
    expect(harness.store.proposals[0]).toMatchObject({ kind: 'build', status: 'proposed', plan_revision: 5 });
    expect(JSON.stringify(results())).not.toMatch(/token/i);
    // The stream tells the UI about the card (with its hash and preview) and the transcript links the call to it.
    expect(events).toContainEqual(expect.objectContaining({ type: 'proposal', id: harness.store.proposals[0].id }));
    const stored = fake.messages.filter((message) => message.kind === 'tool_results').flatMap((message) => ((message.ui as { results: Array<{ name: string; ui?: { proposal_id?: string } }> }).results));
    expect(stored.find((entry) => entry.name === 'propose_build')?.ui).toEqual({ proposal_id: harness.store.proposals[0].id });
  });

  it('refuses to stage a Build whose roster names an id nobody showed the conversation (plan 6.3), and stages once the id is real', async () => {
    const { harness, plans, port, turn, results } = wiring();
    const stranger = uid(999);
    const roster = { entries: [...example.slots.roster!.entries.slice(0, 11), { input: 'Mystery', state: 'resolved', player_id: stranger }], target_count: 12 };
    port.script(
      toolStep([{ name: 'plan_create', input: { mode: 'create', title: 'Invented' } }, slotCall(example, 'ruleset'), slotCall(example, 'league'), slotCall(example, 'phases'), { name: 'plan_set', input: { slot: 'roster', value_json: JSON.stringify(roster) } }]),
      toolStep([{ name: 'propose_build', input: { plan_revision: 5 } }]),
      textStep('That player is unknown to me.'),
    );
    await turn(typed, 'c2');
    const refused = results().at(-1) as { ok: boolean; code?: string };
    expect(refused).toMatchObject({ ok: false, code: 'unknown_reference' });
    expect(harness.store.proposals).toHaveLength(0);
    expect(plans.plan?.revision).toBe(5);

    // The admin names the player: the id is now one the conversation has seen, and the same call stages.
    port.script(toolStep([{ name: 'propose_build', input: { plan_revision: 5 } }]), textStep('Staged.'));
    await turn(`The missing player is ${stranger}`, 'c3');
    expect(results().at(-1)).toMatchObject({ ok: true, data: { status: 'staged' } });
    expect(harness.store.proposals).toHaveLength(1);
  });

  it('answers a stale revision with a catalogued refusal and supersedes the pending card when the Plan changes', async () => {
    const { harness, plans, port, turn, results } = wiring();
    port.script(
      toolStep([{ name: 'plan_create', input: { mode: 'create', title: 'Gen 9 OU league' } }, slotCall(example, 'ruleset'), slotCall(example, 'league'), slotCall(example, 'phases'), slotCall(example, 'roster')]),
      toolStep([{ name: 'propose_build', input: { plan_revision: 4 } }]),
      toolStep([{ name: 'propose_build', input: { plan_revision: 5 } }]),
      toolStep([{ name: 'plan_patch', input: { ops_json: JSON.stringify([{ op: 'replace', path: '/title', value: 'Renamed league' }]) } }]),
      textStep('done'),
    );
    await turn(typed, 'c4');
    const all = results() as Array<{ ok: boolean; code?: string; params?: Record<string, unknown>; data?: Record<string, unknown> }>;
    expect(all[5]).toMatchObject({ ok: false, code: 'plan_stale' });
    expect(all[6]).toMatchObject({ ok: true, data: { status: 'staged' } });
    expect(all[7]).toMatchObject({ ok: true, data: { plan_revision: 6, superseded_proposals: 1 } });
    expect(harness.store.proposals.map((row) => row.status)).toEqual(['superseded']);
    expect(plans.plan?.revision).toBe(6);
  });

  it('answers a refused edit with validation_failed and the kind of the refusal, and writes nothing', async () => {
    const { plans, port, turn, results } = wiring();
    // A failed write makes the writes after it in the same step wait, so each refusal gets its own step.
    port.script(
      toolStep([{ name: 'plan_create', input: { mode: 'create', title: 'x' } }]),
      toolStep([{ name: 'plan_patch', input: { ops_json: JSON.stringify([{ op: 'replace', path: '/refs/league', value: {} }]) } }]),
      toolStep([{ name: 'plan_set', input: { slot: 'league', value_json: '{oops' } }]),
      textStep('ok'),
    );
    await turn('start', 'c5');
    const all = results() as Array<{ ok: boolean; code?: string; params?: { issues?: string } }>;
    expect(all[1]).toMatchObject({ ok: false, code: 'validation_failed' });
    expect(all[1].params?.issues).toMatch(/plan_patch_path_forbidden/);
    expect(all[2]).toMatchObject({ ok: false, code: 'validation_failed', params: { issues: 'plan_patch_json_invalid' } });
    expect(plans.plan?.revision).toBe(1);
  });

  it('reverts step by step and answers a second plan_create without clobbering the Plan', async () => {
    const { plans, port, turn, results } = wiring();
    port.script(
      toolStep([{ name: 'plan_create', input: { mode: 'create', title: 'one' } }, slotCall(example, 'league')]),
      toolStep([{ name: 'plan_create', input: { mode: 'create', title: 'two' } }]),
      toolStep([{ name: 'plan_revert', input: {} }]),
      toolStep([{ name: 'plan_revert', input: {} }]),
      textStep('ok'),
    );
    await turn('start', 'c6');
    const all = results() as Array<{ ok: boolean; code?: string; params?: { issues?: string }; data?: Record<string, unknown> }>;
    expect(all[2]).toMatchObject({ ok: false, code: 'validation_failed' });
    expect(all[2].params?.issues).toMatch(/^plan_exists/);
    // Revision 1 is the empty Plan and 2 has the league: the revert writes revision 3 with the content of revision 1 ...
    expect(all[3]).toMatchObject({ ok: true, data: { plan_revision: 3 } });
    expect((plans.plan?.doc as { slots: Record<string, unknown> }).slots.league).toBeUndefined();
    // ... and a second revert has nothing before revision 1 to go back to.
    expect(all[4]).toMatchObject({ ok: false, code: 'validation_failed', params: { issues: 'nothing_to_revert' } });
    expect(plans.plan?.revision).toBe(3);
  });
});
