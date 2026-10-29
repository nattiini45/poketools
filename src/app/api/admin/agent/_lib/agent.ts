/**
 * The assistant core for the chat and conversation routes: built once per server instance, on first use.
 *
 * `ops` is the route-binding registry handed to the loop; the chat side binds no route of its own, so it is empty. The
 * private draft tools (`ruleset_create_draft`, `ruleset_patch_draft`) get the D bindings (`_ops/d`) through the staged
 * runner's `drafts` dependency instead. The stage-only tools (the Plan tools, `request_clarification`, `propose_build`)
 * run through the staged-tool runner, and `plan_validate` reads the Plan through its port: this is the one place that
 * wires them to the store, to the draft bindings and to staging.
 * Nothing in this file imports the approve or executor code or `_ops/g`: the chat route must not be able to reach an
 * approval token or an executor (plan 3.2).
 */
import { createAdminAgent, type AdminAgent, type CreateAdminAgentOptions } from '@/lib/ai/admin-agent';
import { parseAdminAgentEnv } from '@/lib/ai/admin-agent/env';
import { createBindingRegistry } from '@/lib/ai/admin-agent/dispatch/binding';
import { loadPlanFacts, stageProposal } from '@/lib/ai/admin-agent/proposals';
import { createPlanPorts, createStagedRunner } from '@/lib/ai/admin-agent/staged';
import { adminAgentStore } from '@/lib/ai/admin-agent/store';
import { logAuditEvent } from '@/lib/audit/log';
import { getDraftBindingRegistry } from '../_ops/d';

let instance: AdminAgent | undefined;

/**
 * The agent with the production wiring below. `overrides` are the collaborators a caller may swap without touching the wiring:
 * the model port, the clock, the configuration and the provider switches. The routes call `getAdminAgent()` (no overrides, one
 * instance); the local-stack eval (`scripts/admin-agent-eval/`) calls this with a replayed or live port and a fixed clock, so
 * it runs the same staged tools, draft bindings and store as the chat route.
 */
export function createConfiguredAgent(overrides: Pick<CreateAdminAgentOptions, 'port' | 'now' | 'config' | 'adapter'> = {}): AdminAgent {
  const config = overrides.config ?? (() => parseAdminAgentEnv());
  const staged = {
    store: adminAgentStore,
    stage: stageProposal,
    loadPlanFacts,
    // The private draft tools dispatch the D bindings (`_ops/d`), which the chat side may reach; `_ops/g` it never does.
    drafts: {
      bindings: getDraftBindingRegistry(),
      store: { actions: adminAgentStore.actions, snapshots: adminAgentStore.snapshots },
      maxPhase: () => config().maxPhase,
      audit: logAuditEvent,
    },
  };
  return createAdminAgent({
    ops: createBindingRegistry([]),
    runStaged: createStagedRunner(staged),
    ports: { plans: createPlanPorts(staged) },
    ...overrides,
  });
}

export function getAdminAgent(): AdminAgent {
  instance ??= createConfiguredAgent();
  return instance;
}
