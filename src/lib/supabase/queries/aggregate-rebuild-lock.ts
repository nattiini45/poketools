import { UserFacingError } from '@/lib/api/user-facing-error';
import { supabase } from '@/lib/supabase/client';
import type { AggregateScope } from '@/types/game';

/**
 * CAS-427: the singleton `aggregate_rebuild_lock` row coordinates scope
 * rebuilds against result writes on both stores. While a live lock exists the
 * claim/apply/rollback RPCs refuse (PT409); the write entry points call
 * `assertNoAggregateRebuild` up front so a user write fails with a clean 409
 * instead of straddling the clear.
 */

/** PostgREST error carrying the rebuild fence (migration 20261124090000). */
export function isAggregateRebuildFence(error: unknown): boolean {
  // The apply wrappers translate the raw PT409 before it reaches the queue,
  // so the wrapped error is the fence too — otherwise a fenced apply falls
  // through to storage.fail and the attempt refund never runs.
  if (error instanceof AggregateRebuildInProgressError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'PT409'
  );
}

/**
 * Raised when a result write or an aggregate maintenance call runs into a
 * held rebuild lock. UserFacing by design: the message names the fence, never
 * internals; clients see 409.
 */
export class AggregateRebuildInProgressError extends UserFacingError {
  constructor(cause?: unknown) {
    super('Aggregate rebuild in progress — result writes and aggregate jobs are fenced until it finishes', {
      status: 409,
    });
    this.name = 'AggregateRebuildInProgressError';
    if (cause !== undefined) this.cause = cause;
  }
}

function throwIfRpcError(error: unknown): void {
  if (!error) return;
  if (isAggregateRebuildFence(error)) throw new AggregateRebuildInProgressError(error);
  throw error;
}

/**
 * Fail fast when a scope rebuild holds the lock. Called at the top of
 * recordGameResult / editGame / deleteGame (both stores share the pipeline).
 */
export async function assertNoAggregateRebuild(): Promise<void> {
  const { error } = await supabase.rpc('assert_no_aggregate_rebuild');
  throwIfRpcError(error);
}

export async function isAggregateRebuildActive(): Promise<boolean> {
  const { data, error } = await supabase.rpc('aggregate_rebuild_active');
  // Fail open: the probe is only the drain's spin-guard, not a correctness
  // gate — a transient error must not abort the bounded drain loop.
  if (error) {
    console.error('[aggregate-rebuild] lock probe failed:', error);
    return false;
  }
  return data === true;
}

/**
 * Claim the rebuild lock for a scope; returns the holder token for
 * heartbeat/release. Throws AggregateRebuildInProgressError while another
 * rebuild holds it.
 */
export async function claimAggregateRebuildLock(
  scopeType: AggregateScope,
  scopeId: string | null,
  ttlSeconds: number
): Promise<string> {
  const { data, error } = await supabase.rpc('claim_aggregate_rebuild_lock', {
    p_scope_type: scopeType,
    // Generated-style arg types are non-nullable; SQL accepts NULL for a
    // scope-wide lock (e.g. all_time).
    p_scope_id: scopeId as string,
    p_ttl_seconds: ttlSeconds,
  });
  throwIfRpcError(error);
  return data as string;
}

export async function heartbeatAggregateRebuildLock(holder: string, ttlSeconds: number): Promise<void> {
  const { error } = await supabase.rpc('heartbeat_aggregate_rebuild_lock', {
    p_holder: holder,
    p_ttl_seconds: ttlSeconds,
  });
  throwIfRpcError(error);
}

/** Best-effort: a release failure only delays the expiry, never corrupts. */
export async function releaseAggregateRebuildLock(holder: string): Promise<void> {
  const { error } = await supabase.rpc('release_aggregate_rebuild_lock', { p_holder: holder });
  if (error) console.error('[aggregate-rebuild] lock release failed:', error);
}
