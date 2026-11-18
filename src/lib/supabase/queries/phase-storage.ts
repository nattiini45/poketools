import 'server-only';
import { phaseStorageMachine } from '@/lib/league-phase/storage-state';
import { supabase } from '../client';

export type PhaseStorageMode = typeof phaseStorageMachine.spec.states[number];

export async function readPhaseStorageMode(): Promise<PhaseStorageMode> {
  const { data, error } = await supabase.from('phase_storage_state').select('mode').eq('id', true).single();
  if (error) throw error;
  const mode = data?.mode;
  if (!phaseStorageMachine.isState(mode)) throw new Error('Invalid phase storage mode');
  return mode;
}
