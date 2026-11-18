import 'server-only';

import { isSeasonStarted } from '@/lib/season/season-started';
import { getSeasonPhaseStartSignals, isNativeSeasonStarted } from '@/lib/supabase/queries/season-start';
import type { Season } from '@/types/season';
import { getPhaseRouteMode } from './route-mode';

export async function readLeagueStarted({ id, status }: Pick<Season, 'id' | 'status'>): Promise<boolean> {
  const mode = await getPhaseRouteMode();
  if (mode === 'phase' || mode === 'frozen_phase') return isNativeSeasonStarted(id);
  return isSeasonStarted({ status, phases: await getSeasonPhaseStartSignals(id) });
}
