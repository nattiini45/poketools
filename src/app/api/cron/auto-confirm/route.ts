import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { createAutoConfirmCronHandler, createLegacyAutoConfirmRunner } from '@/lib/match/auto-confirm';

export const maxDuration = 300;

const legacy = createLegacyAutoConfirmRunner();
const standalone = createLegacyAutoConfirmRunner(true);
const handle = createAutoConfirmCronHandler(async () => {
  if (await requireOpenPhaseRouteMode() === 'legacy') return [legacy];
  const [{ createNativePhaseServices }, { expireSeasonReads, revalidatePhaseMatchPages }] = await Promise.all([
    import('@/lib/league-phase/services'),
    import('@/lib/revalidation'),
  ]);
  const { matches } = createNativePhaseServices({
    invalidateMatch: (phase, match) => revalidatePhaseMatchPages(phase, match),
    invalidateSeason: (season, phaseIds) => expireSeasonReads(season, { phaseIds }),
    invalidateWiki: (phase) => revalidatePhaseMatchPages(phase),
  });
  return [standalone, matches.autoConfirm];
}, () => process.env.CRON_SECRET);

export const GET = handle;
export const POST = handle;
