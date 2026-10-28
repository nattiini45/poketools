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
import { createAdminAgent, type AdminAgent } from '@/lib/ai/admin-agent';
import { parseAdminAgentEnv } from '@/lib/ai/admin-agent/env';
import { createBindingRegistry } from '@/lib/ai/admin-agent/dispatch/binding';
import { loadPlanFacts, stageProposal } from '@/lib/ai/admin-agent/proposals';
import { createPlanPorts, createStagedRunner } from '@/lib/ai/admin-agent/staged';
import { adminAgentStore } from '@/lib/ai/admin-agent/store';
import { logAuditEvent } from '@/lib/audit/log';
import { getDraftBindingRegistry } from '../_ops/d';

let instance: AdminAgent | undefined;

export function getAdminAgent(): AdminAgent {
  if (instance === undefined) {
    const staged = {
      store: adminAgentStore,
      stage: stageProposal,
      loadPlanFacts,
      // The private draft tools dispatch the D bindings (`_ops/d`), which the chat side may reach; `_ops/g` it never does.
      drafts: {
        bindings: getDraftBindingRegistry(),
        store: { actions: adminAgentStore.actions, snapshots: adminAgentStore.snapshots },
        maxPhase: () => parseAdminAgentEnv().maxPhase,
        audit: logAuditEvent,
      },
    };
    instance = createAdminAgent({
      ops: createBindingRegistry([]),
      runStaged: createStagedRunner(staged),
      ports: { plans: createPlanPorts(staged) },
    });
  }
  return instance;
}
