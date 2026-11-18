import { mixedAggregateMaintenanceStorage } from '@/lib/league-phase/aggregate-maintenance';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { createProcessAggregatesHandler, legacyAggregateMaintenanceStorage } from '@/lib/match/process-aggregates';
import { revalidatePhaseMatchPages } from '@/lib/revalidation';

export const maxDuration = 120;

const mixedStorage = mixedAggregateMaintenanceStorage(
  ({ phase_id, season_id }) => revalidatePhaseMatchPages(phase_id, undefined, season_id),
);
const handle = createProcessAggregatesHandler(
  async () => await requireOpenPhaseRouteMode() === 'phase' ? mixedStorage : legacyAggregateMaintenanceStorage,
  () => process.env.CRON_SECRET,
);

export const GET = handle;
export const POST = handle;
