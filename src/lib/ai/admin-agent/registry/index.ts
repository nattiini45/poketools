import 'server-only';
/**
 * The Admin Assistant tool registry (plan 3.5, 3.6, 6.1; spec §18.5).
 *
 *   buildToolSet({ role, maxPhase })  the frozen tool set of one conversation: sorted by name, strict-tool wire
 *                                     schemas, one `tool_registry_version` hash over the exact bytes
 *   getToolDefinition(name)           lookup of a registered tool by name (offered or not)
 *   runTool(set, name, args, ctx)     runs an R or P tool of `set`; every outcome is a `ToolResult`
 *
 * Two registries, chosen server-side from the live admin tier: `site` (site admins, every tool) and `scoped` (league and
 * tournament admins: the site-admin-only tools are not even offered). The offered list is UX; the route guard each tool
 * runs is the enforcement. `ADMIN_AGENT_MAX_PHASE` caps which tools exist: a tool of a later phase is not in the set.
 *
 * Cache discipline (plan 3.4): the wire bytes of a set are identical for every admin of the same role and phase, so the
 * prompt-cache prefix is shared, and a change to any tool text, schema or name changes `registryVersion`. A conversation
 * stores the version it started with.
 */
import { createHash } from 'node:crypto';
import type { AdminAgentPhase } from '../env';
import { ALL_PREVIEWS } from '../previews';
import { ALL_READERS } from '../readers';
import { toolError } from './errors';
import type { RunnableTool, ToolDefinition } from './define';
import { STAGED_TOOLS } from './staged';
import { DEFERRED_TOOLS } from './deferred';
import type { ToolContext, ToolResult, ToolRole } from './types';
import { chooseStrictTools } from './strict-budget';
import { canonicalWireJson, toWireSchema, type JsonValue } from './wire-schema';

export type { RunnableTool, StagedTool, ToolDefinition } from './define';
export type { ToolContext, ToolResult, ToolError, ToolRole, ToolClass, DeferredTool } from './types';
export { DEFERRED_TOOLS } from './deferred';
export { NOT_TOOLS, NOT_TOOL_NAMES, notToolPath } from './not-tools';
export { isCataloguedCode } from './errors';
export { STRICT_LIMITS, chooseStrictTools, schemaCost } from './strict-budget';
export { extractResultRefs, RESULT_REFS_MAX } from './result-refs';
export type { ResultRef } from './result-refs';

const NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/** Every registered tool, sorted by name. Throws at load on a malformed or duplicate name. */
export const ALL_TOOLS: readonly ToolDefinition[] = (() => {
  const tools: ToolDefinition[] = [...ALL_READERS, ...ALL_PREVIEWS, ...STAGED_TOOLS];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (!NAME.test(tool.name)) throw new Error(`[admin-agent] tool name is not snake_case: ${tool.name}`);
    if (seen.has(tool.name)) throw new Error(`[admin-agent] duplicate tool name: ${tool.name}`);
    seen.add(tool.name);
  }
  return Object.freeze([...tools].sort((a, b) => (a.name < b.name ? -1 : 1)));
})();

const BY_NAME: ReadonlyMap<string, ToolDefinition> = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

/** A registered tool by name, offered or not; `undefined` for any other name (including an N operation). */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

/** One tool as the model port sends it (Anthropic tool shape). `strict` comes from the set's strict budget (S4). */
export interface WireTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Readonly<Record<string, JsonValue>>;
  readonly strict: boolean;
}

export interface ToolSet {
  readonly role: ToolRole;
  readonly maxPhase: AdminAgentPhase;
  /** Sorted by name; frozen. */
  readonly tools: readonly WireTool[];
  readonly names: readonly string[];
  /** The exact canonical bytes the hash covers (and the tool block the port sends). */
  readonly wireBytes: string;
  /** 16 hex characters of the SHA-256 of `wireBytes`; stored on the conversation (`tool_registry_version`). */
  readonly registryVersion: string;
  /** The offered definitions by name. */
  readonly definitions: ReadonlyMap<string, ToolDefinition>;
}

/** One tool's wire shape; `strict` defaults to true for the per-tool snapshot hash, the set decides the real flag. */
export function toWireTool(tool: ToolDefinition, strict = true): WireTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: toWireSchema(tool.name, tool.args),
    strict,
  };
}

/** SHA-256 (16 hex) of one tool's canonical wire bytes: the per-tool line of the snapshot. */
export function toolHash(tool: ToolDefinition): string {
  return createHash('sha256').update(canonicalWireJson(toWireTool(tool) as unknown as JsonValue)).digest('hex').slice(0, 16);
}

/** Whether a tool is in the registry of `role` at `maxPhase`. */
export function isOffered(tool: ToolDefinition, role: ToolRole, maxPhase: AdminAgentPhase): boolean {
  if (tool.phase > maxPhase) return false;
  return role === 'site' || tool.audience === 'any';
}

const cache = new Map<string, ToolSet>();

export function buildToolSet(input: { role: ToolRole; maxPhase: AdminAgentPhase }): ToolSet {
  const key = `${input.role}:${input.maxPhase}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const offered = ALL_TOOLS.filter((tool) => isOffered(tool, input.role, input.maxPhase));
  const schemas = offered.map((tool) => toWireSchema(tool.name, tool.args));
  const strict = chooseStrictTools(offered.map((tool, i) => ({ name: tool.name, class: tool.class, inputSchema: schemas[i] })));
  const wire = offered.map((tool) => toWireTool(tool, strict.has(tool.name)));
  const wireBytes = canonicalWireJson(wire as unknown as JsonValue);
  const set: ToolSet = Object.freeze({
    role: input.role,
    maxPhase: input.maxPhase,
    tools: Object.freeze(wire),
    names: Object.freeze(offered.map((tool) => tool.name)),
    wireBytes,
    registryVersion: createHash('sha256').update(wireBytes).digest('hex').slice(0, 16),
    definitions: new Map(offered.map((tool) => [tool.name, tool])),
  });
  cache.set(key, set);
  return set;
}

/** A tool of `set` by name, or `undefined` when it is not offered there. */
export function lookupOffered(set: ToolSet, name: string): ToolDefinition | undefined {
  return set.definitions.get(name);
}

/**
 * Runs an R or P tool of `set`. Anything else answers `tool_not_available`: an unknown name, a tool not offered to this
 * role or phase, and the stage-only D, B and G tools, which the loop and `proposals/` handle (this registry never
 * executes them). The context's role, phase and tool list come from the set, not from the caller.
 */
export async function runTool(
  set: ToolSet,
  name: string,
  rawArgs: unknown,
  ctx: Omit<ToolContext, 'role' | 'maxPhase' | 'offeredTools'>,
): Promise<ToolResult> {
  const tool = set.definitions.get(name);
  if (tool === undefined || (tool.class !== 'R' && tool.class !== 'P')) return toolError('tool_not_available');
  return (tool as RunnableTool).run(rawArgs, { ...ctx, role: set.role, maxPhase: set.maxPhase, offeredTools: set.names });
}

/** Rough token cost of a tool set (bytes over 3.5), for the per-phase budget in the registry test. */
export function estimateToolTokens(set: ToolSet): number {
  return Math.ceil(Buffer.byteLength(set.wireBytes, 'utf8') / 3.5);
}

/** Tools the plan lists that are registered but not built, with the phase and what they wait for. */
export function listDeferredTools() {
  return DEFERRED_TOOLS;
}
