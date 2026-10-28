/**
 * The bindings of the private draft writes (class D, spec §18.4): the allow-list of routes the chat loop can dispatch
 * without an approval. Unlike `_ops/g` (Build and Go-live, approve side only) this directory is reachable from the chat
 * route, and so it must never reach a privileged file: no `_ops/g`, no executor, no approve code (a module-graph test).
 *
 * Phase 1: the two ruleset draft tools. `ruleset_create_draft` has one binding per mode; `ruleset_patch_draft` one. The
 * Format Studio draft tools (phase 3) arrive with their own bindings here. Every binding declares a strict body schema and,
 * for a path with parameters, a params schema (`schemas.ts`); the runner parses the resolved request with them
 * (`checkCall`) before it dispatches.
 */
import { createBindingRegistry, type BindingRegistry, type RouteBinding } from '@/lib/ai/admin-agent/dispatch';
import { rulesetCreateForkPreset, rulesetCreateForkRuleset, rulesetCreateNew } from './ruleset-create';
import { rulesetPatchDraft } from './ruleset-patch';

/** Every binding the chat loop can dispatch. */
export const DRAFT_BINDINGS: readonly RouteBinding[] = [rulesetCreateNew, rulesetCreateForkPreset, rulesetCreateForkRuleset, rulesetPatchDraft];

let registry: BindingRegistry | undefined;

export function getDraftBindingRegistry(): BindingRegistry {
  registry ??= createBindingRegistry(DRAFT_BINDINGS);
  return registry;
}
