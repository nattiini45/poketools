/**
 * The default tool runtime (plan 3.5, 3.6): R and P tools run through the registry's `runTool`; the stage-only D, B and G
 * tools go to one injected runner. The runner is where the Plan tools (`plans/`), the private draft writes (route
 * bindings through `dispatch/`) and the staging of proposals (`proposals/`) plug in; none of them is a dependency of the
 * loop. Without a runner, a stage-only tool answers `tool_not_available`, exactly as the registry's own `runTool` does.
 */
import type { StagedTool, ToolContext, ToolDefinition, ToolSet } from '../registry';
import type { NewRef } from '../store/types';
import type { runTool as registryRunTool } from '../registry';
import type { ToolPorts } from '../registry/types';
import type { BindingRegistry } from '../dispatch/binding';
import type { ToolCallContext, ToolRunResult, ToolRuntime } from './types';

/** What a stage-only tool's runner receives: the call's context, the injected bindings and the tool set it was offered in. */
export interface StagedToolContext extends ToolCallContext {
  ops: BindingRegistry;
  toolSet: ToolSet;
}

/**
 * Runs a D, B or G tool (the Plan tools, a private draft write, a staging). It validates the arguments with the tool's
 * own Zod schema, answers a catalogued failure instead of throwing, and may add stream events and a UI projection.
 */
export type StagedToolRunner = (tool: StagedTool, input: unknown, ctx: StagedToolContext) => Promise<ToolRunResult>;

/** The ids a read's typed result carries (`extractResultRefs` of the registry), injected so the loop imports no registry code. */
export type ResultRefsReader = (definition: ToolDefinition, data: unknown) => readonly NewRef[];

export interface ToolRuntimeOptions {
  runTool: typeof registryRunTool;
  /** Provenance (plan 6.3): without it a read's ids are not recorded and no write that names one can be staged. */
  resultRefs?: ResultRefsReader;
  ports: ToolPorts;
  ops: BindingRegistry;
  runStaged?: StagedToolRunner;
}

export function createToolRuntime(options: ToolRuntimeOptions): ToolRuntime {
  return {
    async run(set, call, ctx) {
      const definition = set.definitions.get(call.name);
      if (definition === undefined) return { ok: false, code: 'tool_not_available' };
      if (definition.class === 'R' || definition.class === 'P') {
        const toolContext: Omit<ToolContext, 'role' | 'maxPhase' | 'offeredTools'> = {
          conversationId: ctx.conversationId,
          now: ctx.now,
          timeZone: ctx.timeZone,
          locale: ctx.locale,
          ports: options.ports,
        };
        const result = await options.runTool(set, call.name, call.input, toolContext);
        if (!result.ok || options.resultRefs === undefined) return result;
        try {
          return { ...result, refs: options.resultRefs(definition, result.data) };
        } catch (error) {
          // A reader that cannot find the ids costs the admin a retry at staging, never the read itself.
          console.error(`[admin-agent] could not read the ids of a ${call.name} result`, error);
          return result;
        }
      }
      if (options.runStaged === undefined) return { ok: false, code: 'tool_not_available' };
      return options.runStaged(definition as StagedTool, call.input, { ...ctx, ops: options.ops, toolSet: set });
    },
  };
}
