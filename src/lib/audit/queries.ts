import { supabase } from '@/lib/supabase/client';
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