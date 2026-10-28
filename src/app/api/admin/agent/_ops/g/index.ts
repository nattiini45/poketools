/**
 * The bindings of every Build and Go-live operation (spec §18.4): the allow-list of routes the approve route can dispatch.
 * Only the approve and resume routes import this file (a module-graph test keeps the chat route away from it).
 *
 * Phase 1, slice 1 ships the executor against an empty registry; the real bindings (league, roster, phases, tournaments,
 * the first Go-live cards) are added to this list one operation at a time, each with its route-manifest entry. An empty
 * registry makes every stored step `proposal_stale` (unknown op), so nothing can be dispatched until a binding exists.
 */
import { createBindingRegistry, type BindingRegistry } from '@/lib/ai/admin-agent/dispatch';

let registry: BindingRegistry | undefined;

export function getBindingRegistry(): BindingRegistry {
  registry ??= createBindingRegistry([]);
  return registry;
}
