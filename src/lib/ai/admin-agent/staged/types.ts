/**
 * Collaborators of the staged-tool runner (plan 3.5, 3.6.4 to 3.6.7). Everything is injected: the runner imports no route,
 * no Next API and no live guard, so a test runs it over an in-memory store and the real `stageProposal` over fakes.
 */
import type { AuditLogEntry } from '@/lib/audit/log';
import type { BindingRegistry } from '../dispatch/binding';
import type { AdminAgentPhase } from '../env';
import type { PlanFacts } from '../plans/facts';
import type { PlanDocument } from '../plans/schema';
import type { StageInput, StageResult, StagingAdmin } from '../proposals/types';
import type { AdminAgentStore } from '../store/create';

/** The part of the store the Plan tools and the staging tools read and write. */
export interface StagedRunnerStore {
  plans: Pick<AdminAgentStore['plans'], 'getActivePlan' | 'createPlan' | 'writePlanRevision' | 'getRevision'>;
  conversations: Pick<AdminAgentStore['conversations'], 'getConversation'>;
  proposals: Pick<AdminAgentStore['proposals'], 'getProposal'>;
}

/**
 * What the private draft tools (`ruleset_create_draft`, `ruleset_patch_draft`; plan 3.6.5) need. The bindings come from the
 * route layer (`_ops/d`, the lib never imports `src/app`); the ledger and the snapshots are the store's. Absent: the draft
 * tools answer `tool_not_available`, as any unbound tool does.
 */
export interface DraftToolDeps {
  /** The D bindings. Never the Build and Go-live bindings (`_ops/g`): those run only on the approve side. */
  bindings: BindingRegistry;
  store: {
    /** "No ledger, no write": the row is inserted before the dispatch and completed after it. */
    actions: Pick<AdminAgentStore['actions'], 'insertAction' | 'completeAction'>;
    /** The previous draft document, kept so a patch can be undone. */
    snapshots: Pick<AdminAgentStore['snapshots'], 'insertSnapshot'>;
  };
  /** `ADMIN_AGENT_MAX_PHASE`, read per call. */
  maxPhase(): AdminAgentPhase;
  /** Fire-and-forget audit writer (`logAuditEvent`). */
  audit(entry: AuditLogEntry): void;
}

export interface StagedRunnerDeps {
  store: StagedRunnerStore;
  /** `stageProposal` of `proposals/`: the only path from a `propose_*` call to a proposal row. */
  stage(input: StageInput): Promise<StageResult>;
  /** The live facts `planReadiness` needs for this Plan (`proposals/live.ts` binds the real ones). */
  loadPlanFacts(input: { admin: StagingAdmin; plan: PlanDocument }): Promise<PlanFacts>;
  /** The private draft tools; see `DraftToolDeps`. */
  drafts?: DraftToolDeps;
}
