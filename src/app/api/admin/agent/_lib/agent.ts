/**
 * The assistant core for the chat and conversation routes: built once per server instance, on first use.
 *
 * `ops` is the route-binding registry (`_ops/**`, owned by the executor lane). Phase 0 binds no route, so it is empty
 * here. The stage-only tools (the Plan tools, `request_clarification`, `propose_build`) run through the staged-tool runner,
 * and `plan_validate` reads the Plan through its port: this is the one place that wires them to the store and to staging.
 * Nothing in this file imports the approve or executor code: the chat route must not be able to reach an approval token
 * or an executor (plan 3.2).
 */
import { createAdminAgent, type AdminAgent } from '@/lib/ai/admin-agent';
import { createBindingRegistry } from '@/lib/ai/admin-agent/dispatch/binding';
import { loadPlanFacts, stageProposal } from '@/lib/ai/admin-agent/proposals';
import { createPlanPorts, createStagedRunner } from '@/lib/ai/admin-agent/staged';
import { adminAgentStore } from '@/lib/ai/admin-agent/store';

let instance: AdminAgent | undefined;

export function getAdminAgent(): AdminAgent {
  if (instance === undefined) {
    const staged = { store: adminAgentStore, stage: stageProposal, loadPlanFacts };
    instance = createAdminAgent({
      ops: createBindingRegistry([]),
      runStaged: createStagedRunner(staged),
      ports: { plans: createPlanPorts(staged) },
    });
  }
  return instance;
}
