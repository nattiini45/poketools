/**
 * Scoring of one eval run's tool calls (`scripts/agent-eval.ts`), apart from the script so it can be tested.
 *
 * A tool call fails on the schema in two places: the model-facing schema (what the model was shown and validated
 * against) and, after the server has set its own fields, the STRICT schema inside `executeTool`. The second is invisible
 * in the model's own input, so it is read from the tool RESULT the model was handed back. A run counts as a tool-schema
 * failure when either happened.
 */
import type { AgentTool } from './tools/registry';
import { isStrictSchemaFailure } from './tools/execute';

/** The parts of an AI SDK step this scoring reads. */
export interface ScoredStep {
  toolCalls?: ReadonlyArray<{ toolName: string; input: unknown }>;
  toolResults?: ReadonlyArray<{ toolName: string; output: unknown }>;
}

export function hasToolSchemaFailure(
  steps: ReadonlyArray<ScoredStep>,
  tools: Record<string, Pick<AgentTool, 'inputSchema' | 'modelInputSchema'>>,
): boolean {
  for (const step of steps) {
    for (const call of step.toolCalls ?? []) {
      const tool = tools[call.toolName];
      if (!tool || !(tool.modelInputSchema ?? tool.inputSchema).safeParse(call.input).success) return true;
    }
    for (const result of step.toolResults ?? []) {
      if (isStrictSchemaFailure(result.output)) return true;
    }
  }
  return false;
}
