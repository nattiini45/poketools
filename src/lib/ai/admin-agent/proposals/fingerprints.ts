/**
 * Precondition fingerprints (plan 4.5 "Preconditions"): each step names the pure state reads that guard it. Staging hashes
 * what each read returns and stores the hash with the step; the approve route recomputes the same reads right before the
 * step runs, and a mismatch makes the step and the proposal `stale` (never auto-fixed).
 *
 * The reads themselves are a `FingerprintSource` (live in `live.ts`, scripted in tests); this file owns the vocabulary
 * (`ReadName`), the stored entry (`PreconditionEntry`), the rule for which entries are checked at all, and the hashes, so
 * staging and the executor cannot disagree about them.
 *
 * A read of something the proposal itself creates or changes cannot be fingerprinted at staging: the league a Build is about
 * to create does not exist yet, and after the first roster chunk the roster has changed. Those entries carry
 * `fingerprint: null` ("evaluated by the earlier step") and are skipped by the recheck. Only the first step of a proposal
 * that touches a target carries its fingerprint.
 *
 * Phase enrollment is derived state the admin UI rewrites on load (X13): no read here includes it.
 */
import type { JsonValue } from '@/lib/studio-core/json';
import { hashJson } from '../plans/hash';

export const READ_NAMES = [
  // Build
  'league_name_recent',
  'tournament_name_recent',
  'epb_battle_ruleset_head',
  'season_state',
  'phase_stage_order',
  'roster_hash',
  'draft_pool_state',
  // Go-live
  'ruleset_draft',
  'pin_state',
  'phase_start_state',
  'startup_checklist',
  'channel_set',
] as const;
export type ReadName = (typeof READ_NAMES)[number];

/** What a read is about. */
export type ReadTarget =
  | { kind: 'none' }
  /** A row, by its id. */
  | { kind: 'id'; id: string }
  /** A row an earlier step of the same proposal creates (`league.id`): nothing to read yet. */
  | { kind: 'ref'; ref: string }
  /** A read that needs several inputs (a name, a pin move's targets). */
  | { kind: 'params'; params: JsonValue };

export interface PreconditionEntry {
  read: ReadName;
  target: ReadTarget;
  /** SHA-256 of the canonical read result; `null` when the target is touched by an earlier step of this proposal. */
  fingerprint: string | null;
}

/** The state reads. Results must be plain JSON with every list sorted, so the same state always hashes the same. */
export interface FingerprintSource {
  read(read: ReadName, target: ReadTarget): Promise<JsonValue>;
}

/** The app cannot answer this read (for example the startup checklist before PR5). Staging fails closed on it. */
export class ReadUnavailable extends Error {
  constructor(readonly read: ReadName) {
    super(`fingerprint read unavailable: ${read}`);
    this.name = 'ReadUnavailable';
  }
}

/** The fingerprint of a read right now. */
export async function fingerprintOf(source: FingerprintSource, read: ReadName, target: ReadTarget): Promise<string> {
  return hashJson(await source.read(read, target));
}

/** A read to attach to a step, before the touched-target rule decides whether it is fingerprinted. */
export interface PreconditionSpec {
  read: ReadName;
  target: ReadTarget;
}

/**
 * Turns the specs of a proposal's steps, in step order, into stored entries. A spec whose target is a `ref`, or whose
 * scope an earlier step already touches, gets `fingerprint: null`; everything else is read now.
 *
 * `scopeOf` names the entity a spec reads (`season:<id>`, or `null` for a read of nothing a step changes); a step lists in
 * `touches` the same keys for the entities it creates or changes, which later steps then treat as already moved.
 */
export async function buildPreconditions(
  source: FingerprintSource,
  steps: ReadonlyArray<{ specs: readonly PreconditionSpec[]; touches: readonly string[] }>,
  scopeOf: (spec: PreconditionSpec) => string | null,
): Promise<PreconditionEntry[][]> {
  const touched = new Set<string>();
  const out: PreconditionEntry[][] = [];
  for (const step of steps) {
    const entries: PreconditionEntry[] = [];
    for (const spec of step.specs) {
      const scope = scopeOf(spec);
      const skip = spec.target.kind === 'ref' || (scope !== null && touched.has(scope));
      entries.push({ read: spec.read, target: spec.target, fingerprint: skip ? null : await fingerprintOf(source, spec.read, spec.target) });
    }
    out.push(entries);
    for (const key of step.touches) touched.add(key);
  }
  return out;
}

/** The entries the recheck evaluates: those with a stored fingerprint. */
export const checkedEntries = (entries: readonly PreconditionEntry[]): PreconditionEntry[] => entries.filter((entry) => entry.fingerprint !== null);

/**
 * The approve route's recheck of one step: the entries whose live fingerprint no longer matches the stored one. Empty means
 * the step may run.
 */
export async function changedPreconditions(source: FingerprintSource, entries: readonly PreconditionEntry[]): Promise<PreconditionEntry[]> {
  const changed: PreconditionEntry[] = [];
  for (const entry of checkedEntries(entries)) {
    if ((await fingerprintOf(source, entry.read, entry.target)) !== entry.fingerprint) changed.push(entry);
  }
  return changed;
}

/** `preconditions_hash` of a proposal: the hash of every step's entries, in step order. */
export function preconditionsHash(stepEntries: ReadonlyArray<readonly PreconditionEntry[]>): string {
  return hashJson(stepEntries.map((entries) => entries.map((entry) => ({ read: entry.read, target: entry.target, fingerprint: entry.fingerprint }))) as unknown as JsonValue);
}
