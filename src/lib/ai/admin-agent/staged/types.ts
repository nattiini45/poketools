/**
 * Collaborators of the staged-tool runner (plan 3.5, 3.6.4 to 3.6.7). Everything is injected: the runner imports no route,
 * no Next API and no live guard, so a test runs it over an in-memory store and the real `stageProposal` over fakes.
 */
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

export interface StagedRunnerDeps {
  store: StagedRunnerStore;
  /** `stageProposal` of `proposals/`: the only path from a `propose_*` call to a proposal row. */
  stage(input: StageInput): Promise<StageResult>;
  /** The live facts `planReadiness` needs for this Plan (`proposals/live.ts` binds the real ones). */
  loadPlanFacts(input: { admin: StagingAdmin; plan: PlanDocument }): Promise<PlanFacts>;
}
