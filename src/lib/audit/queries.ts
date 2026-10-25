import { supabase } from '@/lib/supabase/client';
import { assertValidUuid } from '@/lib/utils/uuid';
import { toMatchHistoryEntry } from '@/lib/admin/match-detail';
import type { MatchDisputeInfo, MatchHistoryPage } from '@/lib/admin/match-detail';
import type { AuditLogQueryInput } from '@/lib/validation';
import type { Json, Tables } from '@/types/database';

export interface AuditLogRecord {
  id: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  changes: Json | null;
  metadata: Json | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditLogListResult {
  entries: AuditLogRecord[];
  total: number;
  limit: number;
  offset: number;
}

function toAuditLogRecord(row: Tables<'audit_log'>): AuditLogRecord {
  return {
    id: row.id,
    actor_id: row.actor_id,
    actor_name: row.actor_name,
    action: row.action,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    resource_name: row.resource_name,
    changes: row.changes,
    metadata: row.metadata,
    ip_address: row.ip_address,
    created_at: row.created_at,
  };
}

export async function listAuditLogEntries(
  filters: AuditLogQueryInput
): Promise<AuditLogListResult> {
  let query = supabase
    .from('audit_log')
    .select('*', { count: 'exact' });

  if (filters.action) query = query.eq('action', filters.action);
  if (filters.actor_id) query = query.eq('actor_id', filters.actor_id);
  if (filters.actor) query = query.ilike('actor_name', `%${filters.actor}%`);
  if (filters.resource_type) query = query.eq('resource_type', filters.resource_type);
  if (filters.resource_id) query = query.eq('resource_id', filters.resource_id);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) query = query.lte('created_at', filters.to);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(filters.offset, filters.offset + filters.limit - 1);

  if (error) throw error;

  return {
    entries: (data ?? []).map(toAuditLogRecord),
    total: count ?? 0,
    limit: filters.limit,
    offset: filters.offset,
  };
}

// ── Per-match history ───────────────────────────────────────────────

/**
 * Audit events of one match: its own events (resource_type match) plus the
 * events of its games (resource_type game, `metadata.match_id`). One page,
 * newest first. `matchId` is validated as a uuid before it is interpolated
 * into the filter, so the string cannot be bent by the caller. The returned
 * entries drop `ip_address`.
 */
export async function listMatchAuditEvents(
  matchId: string,
  opts: { limit: number; offset: number }
): Promise<MatchHistoryPage> {
  assertValidUuid(matchId, 'match id');

  const { data, error, count } = await supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .or(
      `and(resource_type.eq.match,resource_id.eq.${matchId}),` +
        `and(resource_type.eq.game,metadata->>match_id.eq.${matchId})`
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);

  if (error) throw error;

  return {
    entries: (data ?? []).map((row) => toMatchHistoryEntry(toAuditLogRecord(row))),
    total: count ?? 0,
    offset: opts.offset,
    limit: opts.limit,
  };
}

/** The newest `match.dispute` event of a match, or null when none was recorded. */
export async function getLatestMatchDispute(matchId: string): Promise<MatchDisputeInfo | null> {
  assertValidUuid(matchId, 'match id');

  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .eq('action', 'match.dispute')
    .eq('resource_type', 'match')
    .eq('resource_id', matchId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);

  if (error) throw error;

  const row = data?.[0];
  if (!row) return null;

  const record = toAuditLogRecord(row);
  const entry = toMatchHistoryEntry(record);
  const metadata =
    record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? record.metadata
      : null;
  return {
    actor_id: entry.actor_id,
    actor_name: entry.actor_name,
    disputed_at: entry.created_at,
    reason: entry.reason,
    by_admin: metadata?.by_admin === true,
  };
}
