import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';
import { getPhaseById } from './league-phases';
import { UNTITLED_CAST_SESSION_NAME } from './cast-sessions';
import { castSessionMachine } from '@/lib/broadcast/cast-session-state';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Json, Tables, TablesUpdate } from '@/types/database';
import type { PhaseCastSession, PhaseCastSessionInsert, PhaseCastSessionUpdate } from '@/types/phase-cast-session';

function toPhaseCastSession(row: Tables<'phase_cast_sessions'>): PhaseCastSession {
  return {
    id: row.id, owner_id: row.owner_id, realtime_key: row.realtime_key, phase_id: row.phase_id,
    match_id: row.match_id, season_id: row.season_id, name: row.name,
    mode: row.mode as PhaseCastSession['mode'], status: row.status as PhaseCastSession['status'],
    player1_id: row.player1_id, player1_name: row.player1_name, player1_avatar_url: row.player1_avatar_url,
    player2_id: row.player2_id, player2_name: row.player2_name, player2_avatar_url: row.player2_avatar_url,
    player1_team: row.player1_team as unknown as PhaseCastSession['player1_team'],
    player2_team: row.player2_team as unknown as PhaseCastSession['player2_team'],
    tracker_state: row.tracker_state as PhaseCastSession['tracker_state'],
    overlay_config: row.overlay_config as PhaseCastSession['overlay_config'],
    caster_notes: (row.caster_notes ?? {}) as PhaseCastSession['caster_notes'],
    format: row.format, generation: row.generation, created_at: row.created_at, updated_at: row.updated_at,
  };
}

export async function listPhaseCastSessions(ownerId: string, phaseId?: string): Promise<PhaseCastSession[]> {
  const rows = await readAllPages((from, to) => {
    let query = supabase.from('phase_cast_sessions').select('*').eq('owner_id', ownerId);
    if (phaseId !== undefined) query = query.eq('phase_id', phaseId);
    return query.order('updated_at', { ascending: false }).order('id').range(from, to);
  });
  return rows.map(toPhaseCastSession);
}

export async function getPhaseCastSessionById(id: string): Promise<PhaseCastSession | null> {
  const { data, error } = await supabase.from('phase_cast_sessions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toPhaseCastSession(data) : null;
}

export async function createPhaseCastSession(ownerId: string, input: PhaseCastSessionInsert): Promise<PhaseCastSession> {
  const phase = await getPhaseById(input.phase_id);
  if (!phase) throw new UserFacingError('Phase not found', { code: 'INVALID_PHASE_ID', status: 404 });
  const { data, error } = await supabase.from('phase_cast_sessions').insert({
    owner_id: ownerId, phase_id: phase.id, season_id: phase.season_id, match_id: input.match_id ?? null,
    name: input.name ?? UNTITLED_CAST_SESSION_NAME, mode: input.mode ?? 'cast', status: 'draft',
    player1_id: input.player1_id ?? null, player1_name: input.player1_name ?? null, player1_avatar_url: input.player1_avatar_url ?? null,
    player2_id: input.player2_id ?? null, player2_name: input.player2_name ?? null, player2_avatar_url: input.player2_avatar_url ?? null,
    format: input.format ?? 'gen9ou', generation: input.generation ?? 9,
  }).select('*').single();
  if (error) throw error;
  return toPhaseCastSession(data);
}

export async function updatePhaseCastSession(
  current: PhaseCastSession,
  input: PhaseCastSessionUpdate,
  actor: 'owner' | 'admin',
): Promise<PhaseCastSession | null> {
  if (input.status !== undefined && input.status !== current.status) castSessionMachine.assertTransition(current.status, input.status, actor);
  const values: TablesUpdate<'phase_cast_sessions'> = {
    name: input.name, mode: input.mode, status: input.status, match_id: input.match_id,
    player1_id: input.player1_id, player1_name: input.player1_name, player1_avatar_url: input.player1_avatar_url,
    player2_id: input.player2_id, player2_name: input.player2_name, player2_avatar_url: input.player2_avatar_url,
    player1_team: input.player1_team as unknown as Json | undefined,
    player2_team: input.player2_team as unknown as Json | undefined,
    tracker_state: input.tracker_state as Json | undefined, overlay_config: input.overlay_config as Json | undefined,
    caster_notes: input.caster_notes as Json | undefined, format: input.format, generation: input.generation,
    updated_at: new Date(Math.max(Date.now(), Date.parse(current.updated_at) + 1)).toISOString(),
  };
  if (input.phase_id !== undefined && input.phase_id !== current.phase_id) {
    const phase = await getPhaseById(input.phase_id);
    if (!phase) throw new UserFacingError('Phase not found', { code: 'INVALID_PHASE_ID', status: 404 });
    values.phase_id = phase.id;
    values.season_id = phase.season_id;
  }
  const { data, error } = await supabase.from('phase_cast_sessions').update(values)
    .eq('id', current.id).eq('owner_id', current.owner_id).eq('phase_id', current.phase_id)
    .eq('status', current.status).eq('updated_at', current.updated_at).select('*').maybeSingle();
  if (error) throw error;
  return data ? toPhaseCastSession(data) : null;
}

export async function deletePhaseCastSession(current: PhaseCastSession): Promise<boolean> {
  const { data, error } = await supabase.from('phase_cast_sessions').delete()
    .eq('id', current.id).eq('owner_id', current.owner_id).eq('phase_id', current.phase_id)
    .eq('status', current.status).eq('updated_at', current.updated_at).select('id');
  if (error) throw error;
  return (data ?? []).length === 1;
}

export async function clearPhaseCastSessionsMatchPointer(matchId: string): Promise<number> {
  const { count, error } = await supabase.from('phase_cast_sessions')
    .update({ match_id: null }, { count: 'exact' }).eq('match_id', matchId);
  if (error) throw error;
  return count ?? 0;
}
