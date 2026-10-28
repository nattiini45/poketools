/**
 * The stored step (plan 4.5, 4.6 `admin_agent_proposals.steps`): the exact request a step will dispatch, as DATA.
 *
 * Immutable once staged. The approve route treats it as data, never logic: it re-resolves `op` in the in-code registry,
 * refuses the proposal (`409 proposal_stale`) when the class, method or route template differ from the binding, re-parses
 * the body and path with the binding's own schema, recomputes `args_hash` from these fields, and rebuilds the request from
 * them. The model's later text has no influence on any of it.
 *
 * `args_hash` covers the proposal id, so a step cannot be copied from one proposal to another; that is why the staging code
 * generates the proposal uuid first and the store inserts under it.
 */
import { z } from 'zod';
import type { JsonValue } from '@/lib/studio-core/json';
import { computeArgsHash } from '../plans/hash';

export const STEP_VERSION = 1;

export const HTTP_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** A route a step dispatches: a Next route path with `[param]` segments. */
export interface OpRoute {
  readonly method: HttpMethod;
  readonly routeTemplate: string;
}

const json: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]),
);

const target = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('id'), id: z.string() }),
  z.strictObject({ kind: z.literal('ref'), ref: z.string() }),
  z.strictObject({ kind: z.literal('params'), params: json }),
]);

export const storedStepSchema = z.strictObject({
  key: z.string().min(1).max(64),
  op: z.string().min(1).max(64),
  /** Build steps are B; a Go-live step is G. An undo step carries its binding's class, so it can also be D (a draft restore). */
  class: z.enum(['B', 'G', 'D']),
  method: z.enum(HTTP_METHODS),
  route_template: z.string().min(1).max(200),
  path_params: z.record(z.string(), json),
  query: z.record(z.string(), json),
  body_template: json,
  /** Floor for the live role at staging and again at approve; the route's own guard does the rest. */
  min_role: z.enum(['any', 'site']),
  /** Step keys that must be `ok` first. */
  blocked_by: z.array(z.string()).max(40),
  entity_type: z.string().max(40),
  /** Counts toward the cap on entity-creating steps. */
  creates: z.boolean(),
  /** The `plan.refs` key this step fills when it is `ok`; null for a Go-live step. */
  ref_key: z.string().max(64).nullable(),
  verify: z.string().max(64),
  reversal: z.string().max(64),
  preconditions: z.array(z.strictObject({ read: z.string(), target, fingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable() })).max(8),
  /** Outward-effect group keys the card acknowledges (Go-live only). */
  outward_effects: z.array(z.string()).max(12),
  /** Existing entities the step acts on, for the ledger's entity columns. */
  targets: z.array(z.strictObject({ kind: z.string().max(24), id: z.string() })).max(60),
  args_hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type StoredStep = z.infer<typeof storedStepSchema>;

export type StepDraft = Omit<StoredStep, 'args_hash'>;

export function argsHashOf(step: StepDraft, ids: { adminId: string; conversationId: string; proposalId: string }): string {
  return computeArgsHash({
    v: STEP_VERSION,
    op: step.op,
    method: step.method,
    route_template: step.route_template,
    path_params: step.path_params,
    query: step.query,
    body_template: step.body_template,
    admin_id: ids.adminId,
    conversation_id: ids.conversationId,
    proposal_id: ids.proposalId,
    step_key: step.key,
  });
}

/** A step with its `args_hash`. */
export function sealStep(step: StepDraft, ids: { adminId: string; conversationId: string; proposalId: string }): StoredStep {
  return { ...step, args_hash: argsHashOf(step, ids) };
}

/**
 * What the approve route recomputes: whether a stored step's hash still matches its fields. A row edited after staging, or
 * copied from another proposal, fails here.
 */
export function stepHashMatches(step: StoredStep, ids: { adminId: string; conversationId: string; proposalId: string }): boolean {
  const { args_hash: _stored, ...draft } = step;
  return argsHashOf(draft, ids) === step.args_hash;
}
