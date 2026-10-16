import { supabase } from '../client';
import type { Tables, Json } from '@/types/database';
import type {
  DraftReplayEvent,
  DraftReplayEventInsert,
  DraftReplayEventData,
  DraftReplayEventType,
} from '@/types/broadcast';

type DraftReplayEventRow = Tables<'draft_replay_events'>;

function toDraftReplayEvent(row: DraftReplayEventRow): DraftReplayEvent {
  return {
    id: row.id,
    draft_pool_id: row.draft_pool_id,
    pick_id: row.pick_id,
    event_type: row.event_type as DraftReplayEventType,
    event_data: row.event_data as unknown as DraftReplayEventData,
    sequence_number: row.sequence_number,
    wall_clock_time: row.wall_clock_time,
    display_duration_ms: row.display_duration_ms,
  };
}

// ─── Read ───────────────────────────────────────────────────────────

export async function getReplayEventsByPool(
  draftPoolId: string
): Promise<DraftReplayEvent[]> {
  const { data, error } = await supabase
    .from('draft_replay_events')
    .select('*')
    .eq('draft_pool_id', draftPoolId)
    .order('sequence_number', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(toDraftReplayEvent);
}

export async function getReplayEventById(
  id: string
): Promise<DraftReplayEvent | null> {
  const { data, error } = await supabase
    .from('draft_replay_events')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toDraftReplayEvent(data) : null;
}

export async function getNextSequenceNumber(draftPoolId: string): Promise<number> {
  const { data, error } = await supabase
    .from('draft_replay_events')
    .select('sequence_number')
    .eq('draft_pool_id', draftPoolId)
    .order('sequence_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? data.sequence_number + 1 : 1;
}

// ─── Write ──────────────────────────────────────────────────────────

export async function createReplayEvent(
  input: DraftReplayEventInsert
): Promise<DraftReplayEvent> {
  const { data, error } = await supabase
    .from('draft_replay_events')
    .insert({
      draft_pool_id: input.draft_pool_id,
      pick_id: input.pick_id ?? null,
      event_type: input.event_type,
      event_data: input.event_data as unknown as Json,
      sequence_number: input.sequence_number,
      wall_clock_time: input.wall_clock_time ?? new Date().toISOString(),
      display_duration_ms: input.display_duration_ms ?? 5000,
    })
    .select()
    .single();

  if (error) throw error;
  return toDraftReplayEvent(data);
}

export async function updateReplayEvent(
  id: string,
  updates: Partial<Pick<DraftReplayEvent, 'event_data' | 'display_duration_ms'>>
): Promise<DraftReplayEvent> {
  const updateData: Record<string, unknown> = {};
  if (updates.event_data !== undefined) {
    updateData.event_data = updates.event_data as unknown as Json;
  }
  if (updates.display_duration_ms !== undefined) {
    updateData.display_duration_ms = updates.display_duration_ms;
  }

  const { data, error } = await supabase
    .from('draft_replay_events')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toDraftReplayEvent(data);
}

// ─── Delete ─────────────────────────────────────────────────────────

export async function deleteReplayEvent(id: string): Promise<void> {
  const { error } = await supabase
    .from('draft_replay_events')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
