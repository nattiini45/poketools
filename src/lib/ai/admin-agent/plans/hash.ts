/**
 * Canonical JSON and SHA-256 helpers for the confirmation protocol (plan 4.5 "Binding the approval to the exact
 * request"). Everything reuses the studio core: `canonicalizeJson` (sorted keys, no whitespace; throws `JsonError`
 * on anything that is not plain JSON) and `sha256Hex` (pure, synchronous, same result in the browser and on the
 * server).
 *
 * The three hash formulas of 4.5 live here so staging (`proposals/stage.ts`) and the approve route recompute them
 * from the same code:
 *  - `args_hash`     = sha256(canonicalJson({v, op, method, route_template, path_params, query, body_template,
 *                       admin_id, conversation_id, proposal_id, step_key}))
 *  - `proposal_hash` = sha256(canonicalJson([step args hashes in order, preconditions_hash, acks_required sorted]))
 *  - `preview_hash`  = sha256(canonicalJson({preview, outward_effects, targets, locale}))
 * The body template is hashed with its `{"$ref": ...}` placeholders, never the resolved value.
 */
import { canonicalizeJson, contentHash, sha256Hex, type JsonValue } from '@/lib/studio-core/json';
import { jsonClone, type PlanDocument } from './schema';

export { sha256Hex };
export type { JsonValue };

/** Sorted-key, whitespace-free JSON. Throws `JsonError` for a value that is not plain JSON. */
export const canonicalJson = (value: unknown): string => canonicalizeJson(value);

/** Lower-case hex SHA-256 of the canonical JSON of `value`; key order never changes it. */
export const hashJson = (value: unknown): string => contentHash(value);

/** `admin_agent_plans.doc_hash`: the hash of the normalised document. */
export const planDocHash = (plan: PlanDocument): string => hashJson(jsonClone(plan));

/** The `args_hash` of one step: the exact request the executor will rebuild. */
export interface ArgsHashInput {
  v: number;
  op: string;
  method: string;
  route_template: string;
  path_params: JsonValue;
  query: JsonValue;
  body_template: JsonValue;
  admin_id: string;
  conversation_id: string;
  proposal_id: string;
  step_key: string;
}

export function computeArgsHash(input: ArgsHashInput): string {
  return hashJson(jsonClone(input));
}

export interface ProposalHashInput {
  /** Each step's `args_hash`, in step order. */
  stepArgsHashes: readonly string[];
  /** Hash of the steps' state fingerprints. */
  preconditionsHash: string;
  /** Acknowledgement ids the approve request must carry; the order the caller lists them in does not matter. */
  acksRequired: readonly string[];
}

export function computeProposalHash(input: ProposalHashInput): string {
  return hashJson([[...input.stepArgsHashes], input.preconditionsHash, [...new Set(input.acksRequired)].sort()]);
}

export interface PreviewHashInput {
  preview: JsonValue;
  outwardEffects: JsonValue;
  targets: JsonValue;
  locale: string;
}

export function computePreviewHash(input: PreviewHashInput): string {
  return hashJson(jsonClone({ preview: input.preview, outward_effects: input.outwardEffects, targets: input.targets, locale: input.locale }));
}

/** The 8-hex "plan code" a card shows (the start of the proposal hash). */
export const planCode = (proposalHash: string): string => proposalHash.slice(0, 8);
