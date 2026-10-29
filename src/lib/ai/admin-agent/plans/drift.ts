/**
 * Drift basics (plan 4.8): has someone changed, removed or moved to the trash what the assistant built?
 *
 * "Outside" means "differs from the last state the assistant itself wrote", so no attribution is needed. Each built or
 * changed ledger row stores the `after_fingerprint` (and, minimal, the `after` fields it covers); at the start of a turn
 * and on window focus the server re-reads the entity and calls `classifyDrift`:
 *
 *   unchanged | changed_outside {fields} | gone | in_trash | no_access
 *
 * Pure: the caller does the guarded read (`guardFor(entity)` per entity per request; a failed guard is `no_access`
 * and the entity is dropped from the drift list, so a revoked grant cannot keep reading a league) and passes what it
 * saw. Phase enrollment is derived state that the admin UI rewrites on every page load (X13), so it is excluded from
 * fingerprints and drift, otherwise every page view would report `changed_outside`.
 *
 * A league can be `gone` from the live tables yet restorable: a trashed league reports `in_trash` with its purge date
 * instead, and must never be re-created from a stale ref.
 */
import { hashJson } from './hash';
import type { JsonValue } from '@/lib/studio-core/json';

export type DriftState = 'unchanged' | 'changed_outside' | 'gone' | 'in_trash' | 'no_access';

/** Fields that never count toward a fingerprint or a drift report. */
export const DRIFT_IGNORED_FIELDS: readonly string[] = ['enrollment', 'participants_enrollment', 'enrollment_source', 'updated_at'];

export type DriftFields = Record<string, JsonValue>;

function trackedFields(fields: DriftFields): DriftFields {
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !DRIFT_IGNORED_FIELDS.includes(key)));
}

/** The fingerprint of an entity's tracked fields: sorted-key hash, ignored fields left out. */
export function fingerprintFields(fields: DriftFields): string {
  return hashJson(trackedFields(fields));
}

/** The tracked fields whose value differs between two states (a field missing on one side counts as different). */
export function changedFields(after: DriftFields, live: DriftFields): string[] {
  const a = trackedFields(after);
  const b = trackedFields(live);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => !(key in a) || !(key in b) || hashJson(a[key]) !== hashJson(b[key])).sort();
}

export interface DriftInput {
  /** The `plan.refs` key (or any stable label). */
  refKey: string;
  /** What the assistant last wrote: the stored minimal `after`, and/or its fingerprint. */
  after: { fields?: DriftFields; fingerprint?: string | null };
  live: {
    /** The caller's guard let it read the entity. */
    accessible: boolean;
    exists: boolean;
    /** Set when the row is gone but a recycle-bin entry exists (only for callers who may administer the league). */
    trash?: { purgeAfter: string } | null;
    fields?: DriftFields;
    fingerprint?: string | null;
  };
}

export interface DriftResult {
  refKey: string;
  state: DriftState;
  /** `changed_outside`: which fields, when the comparison had fields on both sides. */
  fields?: string[];
  /** `in_trash`: when the bin purges it. */
  purgeAfter?: string;
}

export function classifyDrift(input: DriftInput): DriftResult {
  const { refKey, after, live } = input;
  if (!live.accessible) return { refKey, state: 'no_access' };
  if (!live.exists) {
    return live.trash ? { refKey, state: 'in_trash', purgeAfter: live.trash.purgeAfter } : { refKey, state: 'gone' };
  }
  if (after.fields !== undefined && live.fields !== undefined) {
    const fields = changedFields(after.fields, live.fields);
    return fields.length > 0 ? { refKey, state: 'changed_outside', fields } : { refKey, state: 'unchanged' };
  }
  // Fingerprints only. A missing side cannot prove "unchanged", so it reads as changed (fail closed).
  const liveFingerprint = live.fingerprint ?? (live.fields !== undefined ? fingerprintFields(live.fields) : null);
  const afterFingerprint = after.fingerprint ?? (after.fields !== undefined ? fingerprintFields(after.fields) : null);
  if (liveFingerprint === null || afterFingerprint === null || liveFingerprint !== afterFingerprint) {
    return { refKey, state: 'changed_outside' };
  }
  return { refKey, state: 'unchanged' };
}

export interface DriftReport {
  /** Entities that differ from what the assistant wrote, are gone or are in the trash. */
  drifted: DriftResult[];
  /** Entities the caller may no longer read: dropped from the drift list, never described. */
  noAccess: string[];
}

export function driftReport(inputs: readonly DriftInput[]): DriftReport {
  const drifted: DriftResult[] = [];
  const noAccess: string[] = [];
  for (const input of inputs) {
    const result = classifyDrift(input);
    if (result.state === 'no_access') noAccess.push(result.refKey);
    else if (result.state !== 'unchanged') drifted.push(result);
  }
  return { drifted, noAccess };
}
