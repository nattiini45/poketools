/**
 * `draft_pools.publish_refused_at`: when the deadline tick last refused to publish a Redraft
 * (REDRAFT_NOT_COMPLETABLE / POOL_CHECK_LIMIT; it retries after a pool change or an hour later).
 *
 * Admin data only. Its readers are the admin draft control page (server render, `loadPublishRefusals`) and the
 * pool admin's `GET /api/drafts/[id]/redraft/submissions` (the room's admin sheet), both behind their admin
 * gate. A failed read throws: it is never read as "not refused" (AGENTS rule: no error masking).
 */
import 'server-only';

import { supabase } from '@/lib/supabase/client';

/** Pool id -> refusal instant, for the given pools that have one. No query for an empty list. */
export async function getPublishRefusals(poolIds: readonly string[]): Promise<Record<string, string>> {
  if (poolIds.length === 0) return {};
  const { data, error } = await supabase.from('draft_pools').select('id, publish_refused_at').in('id', [...poolIds]);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.publish_refused_at) out[row.id] = row.publish_refused_at;
  return out;
}

/** One pool's refusal instant, or null when its automatic publish was never refused. */
export async function getPublishRefusedAt(poolId: string): Promise<string | null> {
  const refusals = await getPublishRefusals([poolId]);
  return refusals[poolId] ?? null;
}
