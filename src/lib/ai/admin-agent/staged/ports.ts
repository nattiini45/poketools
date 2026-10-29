/**
 * The `plans` port of the registry's R and P tools (`plan_get`, `plan_validate`; plan 3.6.2, 3.6.3): the admin's own Plan of
 * this conversation, read from the store. `validate` is the one place the Plan meets live facts outside staging: the same
 * `loadPlanFacts` and the same readiness, step derivation and route-schema checks that `propose_build` runs, reported as
 * data and writing nothing.
 */
import { deriveSteps, parsePlanDocument, planReadiness, summarizeBuild, validateStepBodies, type PlanDocument } from '../plans';
import type { ToolPorts } from '../registry/types';
import type { AdminId } from '../store/ids';
import type { Json } from '../store/types';
import type { StagedRunnerDeps } from './types';

type PlansPort = NonNullable<ToolPorts['plans']>;

/** What `plan_validate` reports: blockers, warnings, and the Build the Plan would run. Codes and ids only. */
export function validationReport(plan: PlanDocument, revision: number, readiness: ReturnType<typeof planReadiness>): Json {
  const base = {
    revision,
    ready: readiness.ready,
    blockers: readiness.blockers.map((b) => ({ code: b.code, kind: b.kind, section: b.section, path: b.path, params: b.params })),
    warnings: readiness.warnings.map((b) => b.code),
  };
  if (!readiness.ready) return { ...base, build: null } as Json;
  const steps = deriveSteps(plan);
  const summary = summarizeBuild(steps);
  const issues = validateStepBodies(steps);
  return {
    ...base,
    build: { steps: steps.map((step) => ({ key: step.key, op: step.op, class: step.class })), creating: summary.creating, acks: summary.acks },
    step_issues: issues.slice(0, 12).map((issue) => ({ step: issue.stepKey, path: issue.path, code: issue.reason })),
  } as Json;
}

export function createPlanPorts(deps: StagedRunnerDeps): PlansPort {
  return {
    async get({ adminId, conversationId }) {
      const plan = await deps.store.plans.getActivePlan(adminId as AdminId, conversationId);
      return plan ? JSON.stringify({ revision: plan.revision, status: plan.status, doc: plan.doc }) : null;
    },

    async validate({ adminId, conversationId }) {
      const record = await deps.store.plans.getActivePlan(adminId as AdminId, conversationId);
      if (record === null) return null;
      const parsed = parsePlanDocument(record.doc);
      if (!parsed.ok) throw new Error('admin-agent: the stored Plan no longer parses');
      const conversation = await deps.store.conversations.getConversation(adminId as AdminId, conversationId);
      // The conversation's registry is the live tier (startTurn refuses a conversation whose tool set differs from it).
      const admin = { id: adminId as AdminId, isSiteAdmin: conversation?.tool_set === 'site' };
      const facts = await deps.loadPlanFacts({ admin, plan: parsed.plan });
      return JSON.stringify(validationReport(parsed.plan, record.revision, planReadiness(parsed.plan, facts)));
    },
  };
}
