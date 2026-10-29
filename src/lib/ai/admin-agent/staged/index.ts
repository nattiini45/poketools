/**
 * The staged-tool runner (plan 3.5, 3.6.4 to 3.6.7): the D, B and G tools the registry only declares. The loop hands every
 * call of a stage-only tool here (`createToolRuntime({ runStaged })`), and this module is where they meet their modules:
 *
 *  - the Plan tools write the assistant's own Plan through `plans/` and `store.plans`;
 *  - `propose_build` and the `propose_*` tools stage a proposal through `proposals/stage.ts`;
 *  - `request_clarification` returns the structured question for the panel.
 *
 * The D tools that dispatch an existing route (private ruleset drafts; format drafts arrive in phase 3) run through
 * `draft-tools.ts` with the bindings injected as `deps.drafts`; without them, or for a tool with no binding yet, they answer
 * `tool_not_available`, exactly as an unbound tool does.
 *
 * Nothing here can approve or execute a proposal, read an approval token or call a route.
 */
import { describeIssues } from '../registry/define';
import { toolError, toolErrorFromThrown } from '../registry/errors';
import type { StagedToolRunner } from '../loop/tool-runtime';
import { rulesetCreateDraft, rulesetPatchDraft } from './draft-tools';
import { planCreate, planPatch, planRevert, planSet } from './plan-tools';
import { requestClarification, stageTool } from './stage-tools';
import type { StagedRunnerDeps } from './types';

export { createPlanPorts, validationReport } from './ports';
export type { DraftToolDeps, StagedRunnerDeps, StagedRunnerStore } from './types';

export function createStagedRunner(deps: StagedRunnerDeps): StagedToolRunner {
  return async (tool, input, ctx) => {
    try {
      // B and G arguments are validated by `stageProposal` itself (it needs the parsed form and the raw one for the hashes).
      if (tool.class === 'B' || tool.class === 'G') return await stageTool(deps, tool, input, ctx);

      const parsed = tool.args.safeParse(input);
      if (!parsed.success) return toolError('validation_failed', { issues: describeIssues(parsed.error) });
      const args = parsed.data as never;
      switch (tool.name) {
        case 'plan_create':
          return await planCreate(deps, args, ctx);
        case 'plan_set':
          return await planSet(deps, args, ctx);
        case 'plan_patch':
          return await planPatch(deps, args, ctx);
        case 'plan_revert':
          return await planRevert(deps, ctx);
        case 'ruleset_create_draft':
          return await rulesetCreateDraft(deps, tool, args, ctx);
        case 'ruleset_patch_draft':
          return await rulesetPatchDraft(deps, tool, args, ctx);
        case 'request_clarification':
          return requestClarification(args);
        default:
          return toolError('tool_not_available');
      }
    } catch (error) {
      return toolErrorFromThrown(error, tool.name);
    }
  };
}
