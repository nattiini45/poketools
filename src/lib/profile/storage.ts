import 'server-only';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';

export type ProfileStorage = 'legacy' | 'phase';

export async function selectProfileStorage(): Promise<ProfileStorage> {
  const mode = await getPhaseRouteMode();
  return mode === 'phase' || mode === 'frozen_phase' ? 'phase' : 'legacy';
}
