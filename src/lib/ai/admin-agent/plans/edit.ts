/**
 * How a Plan changes (plan 3.6.4, 4.3): the model edits only through `plan_set` and `plan_patch`, the admin through the
 * Plan panel; both land here. Every edit is validated against the whole document and returns the NORMALISED Plan, so
 * what is stored and hashed is always `parsePlanDocument` output. Nothing mutates its input.
 *
 *  - `applyPlanSet` replaces one slot wholesale (the value is checked with that slot's schema; defaults such as
 *    `advancement_rule.per_group: false` are filled).
 *  - `applyPlanPatch` applies RFC 6901 `add` / `replace` / `remove` ops given as a JSON string (`ops_json`: strict tool
 *    schemas forbid open JSON), with the studio core's `applyPatch`, so a refusal names a reason and the op's index.
 *    Only these paths may be patched: `/title`, `/intent`, `/contentLocale`, `/assumptions[/...]` and
 *    `/slots/<slot>[/...]`. `/v` and `/refs` are never reachable (Build fills `refs` through `setPlanRef`).
 *
 * A slot that Build already created (an entry in `refs`) is frozen: the live row wins, so changing it is refused with
 * `slot_already_built`; an edit of an existing entity is a change card, not a Plan edit.
 *
 * Errors are data with machine kinds (a `kind`, not an API `code`: they reach the model inside the text of a `validation_failed`,
 * never as an error-catalog key). No zod message or exception text is returned.
 */
import { z } from 'zod';
import { applyPatch, parsePointer, type PatchFailureReason, type PatchOp } from '@/lib/studio-core/patch';
import { inspectJson, type JsonValue } from '@/lib/studio-core/json';
import { hashJson } from './hash';
import {
  PLAN_REF_KEY_PATTERN,
  PLAN_SLOT_NAMES,
  PLAN_SLOT_SCHEMAS,
  jsonClone,
  parsePlanDocument,
  toPlanIssues,
  type PlanDocument,
  type PlanIssue,
  type PlanSlotName,
} from './schema';

export type PlanEditError =
  | { kind: 'plan_invalid'; issues: PlanIssue[] }
  | { kind: 'plan_slot_unknown'; slot: string }
  | { kind: 'slot_already_built'; refKey: string }
  | { kind: 'plan_patch_json_invalid' }
  | { kind: 'plan_patch_too_large' }
  | { kind: 'plan_patch_ops_invalid'; issues: PlanIssue[] }
  | { kind: 'plan_patch_path_forbidden'; index: number; path: string }
  | { kind: 'plan_patch_failed'; index: number; reason: PatchFailureReason }
  | { kind: 'plan_ref_invalid' };

export type PlanEditResult =
  | { ok: true; plan: PlanDocument; /** Slots whose content differs from before. */ changedSlots: PlanSlotName[] }
  | { ok: false; error: PlanEditError };

const fail = (error: PlanEditError): PlanEditResult => ({ ok: false, error });

// ─── Built slots ─────────────────────────────────────────────────────

/** The part of the Plan a `refs` key stands for, or undefined. */
function slotPart(plan: PlanDocument, refKey: string): unknown {
  const { slots } = plan;
  if (refKey === 'league') return slots.league;
  if (refKey === 'roster') return slots.roster;
  if (refKey === 'groups') return slots.groups;
  if (refKey === 'tournament') return slots.tournament;
  if (refKey.startsWith('phase.')) return slots.phases?.find((phase) => phase.key === refKey.slice('phase.'.length));
  if (refKey.startsWith('draft.')) {
    const groupKey = refKey.slice('draft.'.length);
    return slots.draft?.find((entry) => (groupKey === 'all' ? entry.group_key === undefined : entry.group_key === groupKey));
  }
  return undefined;
}

const same = (a: unknown, b: unknown): boolean => hashJson(a === undefined ? null : a) === hashJson(b === undefined ? null : b);

/** The first built slot whose content `after` changed (or removed), or null. */
function builtViolation(before: PlanDocument, after: PlanDocument): string | null {
  for (const refKey of Object.keys(before.refs)) {
    if (!same(slotPart(before, refKey), slotPart(after, refKey))) return refKey;
  }
  return null;
}

function changedSlotsOf(before: PlanDocument, after: PlanDocument): PlanSlotName[] {
  return PLAN_SLOT_NAMES.filter((name) => !same(before.slots[name], after.slots[name]));
}

function finish(before: PlanDocument, candidate: unknown): PlanEditResult {
  const parsed = parsePlanDocument(candidate);
  if (!parsed.ok) return fail({ kind: 'plan_invalid', issues: parsed.issues });
  const built = builtViolation(before, parsed.plan);
  if (built !== null) return fail({ kind: 'slot_already_built', refKey: built });
  return { ok: true, plan: parsed.plan, changedSlots: changedSlotsOf(before, parsed.plan) };
}

// ─── plan_set ────────────────────────────────────────────────────────

export interface PlanSetInput {
  slot: string;
  value: unknown;
}

export function applyPlanSet(plan: PlanDocument, input: PlanSetInput): PlanEditResult {
  const slot = input.slot as PlanSlotName;
  if (!PLAN_SLOT_NAMES.includes(slot)) return fail({ kind: 'plan_slot_unknown', slot: String(input.slot).slice(0, 32) });
  const value = PLAN_SLOT_SCHEMAS[slot].safeParse(input.value);
  if (!value.success) return fail({ kind: 'plan_invalid', issues: toPlanIssues(value.error, ['slots', slot]) });
  return finish(plan, { ...plan, slots: { ...plan.slots, [slot]: value.data } });
}

/** `plan_set` where the tool carries the slot value as a JSON string (`value_json`), like `plan_patch` does. */
export function applyPlanSetJson(plan: PlanDocument, input: { slot: string; valueJson: string }): PlanEditResult {
  if (typeof input.valueJson !== 'string') return fail({ kind: 'plan_patch_json_invalid' });
  if (input.valueJson.length > PLAN_PATCH_LIMITS.chars) return fail({ kind: 'plan_patch_too_large' });
  let value: unknown;
  try {
    value = JSON.parse(input.valueJson);
  } catch {
    return fail({ kind: 'plan_patch_json_invalid' });
  }
  return applyPlanSet(plan, { slot: input.slot, value });
}

// ─── plan_patch ──────────────────────────────────────────────────────

/** Bounds on the `ops_json` string and on the ops it holds. */
export const PLAN_PATCH_LIMITS = Object.freeze({ chars: 65_536, ops: 40, valueBytes: 65_536 });

const patchValue = z.custom<JsonValue>((value) => value !== undefined && inspectJson(value, { maxBytes: PLAN_PATCH_LIMITS.valueBytes }).ok, {
  message: 'patch_value_not_json',
});

const patchOpsSchema = z
  .array(
    z.discriminatedUnion('op', [
      z.object({ op: z.literal('add'), path: z.string().max(256), value: patchValue }).strict(),
      z.object({ op: z.literal('replace'), path: z.string().max(256), value: patchValue }).strict(),
      z.object({ op: z.literal('remove'), path: z.string().max(256) }).strict(),
    ]),
  )
  .min(1)
  .max(PLAN_PATCH_LIMITS.ops);

const TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set(['title', 'intent', 'contentLocale']);

/** Whether a pointer may be patched (see the module comment). The document root and `/refs` never may. */
export function isPatchablePath(path: string): boolean {
  const segments = parsePointer(path);
  if (segments === null || segments.length === 0) return false;
  const [head, second] = segments;
  if (TOP_LEVEL_FIELDS.has(head)) return segments.length === 1;
  if (head === 'assumptions') return true;
  if (head === 'slots') return segments.length >= 2 && (PLAN_SLOT_NAMES as readonly string[]).includes(second);
  return false;
}

/** `plan_patch`: `opsJson` is the string the tool received (`ops_json`). */
export function applyPlanPatch(plan: PlanDocument, opsJson: string): PlanEditResult {
  if (typeof opsJson !== 'string') return fail({ kind: 'plan_patch_json_invalid' });
  if (opsJson.length > PLAN_PATCH_LIMITS.chars) return fail({ kind: 'plan_patch_too_large' });
  let raw: unknown;
  try {
    raw = JSON.parse(opsJson);
  } catch {
    return fail({ kind: 'plan_patch_json_invalid' });
  }
  const ops = patchOpsSchema.safeParse(raw);
  if (!ops.success) return fail({ kind: 'plan_patch_ops_invalid', issues: toPlanIssues(ops.error) });

  for (let index = 0; index < ops.data.length; index += 1) {
    const { path } = ops.data[index];
    if (!isPatchablePath(path)) return fail({ kind: 'plan_patch_path_forbidden', index, path: path.slice(0, 64) });
  }

  const applied = applyPatch(jsonClone(plan) as unknown as JsonValue, ops.data as PatchOp[]);
  if (!applied.ok) return fail({ kind: 'plan_patch_failed', index: applied.index, reason: applied.reason });
  return finish(plan, applied.value);
}

/**
 * `plan_revert`: the Plan returns to `previous`'s content. The built entities (`refs`) are the current Plan's, never the
 * old one's, and a revert that would change a built slot is refused like any other edit (`slot_already_built`).
 */
export function applyPlanRevert(current: PlanDocument, previous: PlanDocument): PlanEditResult {
  return finish(current, { ...previous, refs: current.refs });
}

/** A short, plain description of a refusal for the model: kinds, indices and paths, never a zod message. */
export function describePlanEditError(error: PlanEditError): string {
  if ('issues' in error) return error.issues.slice(0, 6).map((issue) => `${issue.path || '/'}: ${issue.code}`).join('; ');
  if (error.kind === 'plan_patch_failed') return `op ${error.index}: ${error.reason}`;
  if (error.kind === 'plan_patch_path_forbidden') return `op ${error.index}: ${error.kind} ${error.path}`;
  if (error.kind === 'plan_slot_unknown') return `${error.kind} ${error.slot}`;
  if (error.kind === 'slot_already_built') return `${error.kind} ${error.refKey}`;
  return error.kind;
}

// ─── refs (filled by Build, never by the model) ──────────────────────

export interface PlanRefValue {
  entity_type: string;
  entity_id: string;
}

/** Record the entity a built slot became. Bypasses the built-slot freeze on purpose: this is how a slot becomes built. */
export function setPlanRef(plan: PlanDocument, refKey: string, value: PlanRefValue): PlanEditResult {
  if (!PLAN_REF_KEY_PATTERN.test(refKey)) return fail({ kind: 'plan_ref_invalid' });
  const parsed = parsePlanDocument({ ...plan, refs: { ...plan.refs, [refKey]: value } });
  if (!parsed.ok) return fail({ kind: 'plan_ref_invalid' });
  return { ok: true, plan: parsed.plan, changedSlots: [] };
}

/** Forget a built entity (it is gone; a fresh Build may create the slot again). */
export function clearPlanRef(plan: PlanDocument, refKey: string): PlanDocument {
  const refs = { ...plan.refs };
  delete refs[refKey];
  return { ...plan, refs };
}
