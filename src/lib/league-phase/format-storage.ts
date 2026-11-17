import 'server-only';

import { expireSeasonReads } from '@/lib/revalidation';
import { attachSeasonFormat, detachSeasonFormat, getSeasonManualPhaseCount, getSeasonStartSignals } from '@/lib/supabase/queries/season-formats';
import { createCompetitionFromFormat } from '@/lib/supabase/queries/competition-create';

export interface FormatStoragePort {
  startSignals: typeof getSeasonStartSignals;
  manualPhaseCount: typeof getSeasonManualPhaseCount;
  attach: typeof attachSeasonFormat;
  detach: typeof detachSeasonFormat;
  create: typeof createCompetitionFromFormat;
  invalidate(seasonId: string, phaseIds: readonly string[]): void;
}

export const legacyFormatStorage: FormatStoragePort = {
  startSignals: (id) => getSeasonStartSignals(id),
  manualPhaseCount: (id) => getSeasonManualPhaseCount(id),
  attach: (input) => attachSeasonFormat(input),
  detach: (id, clear, counts) => detachSeasonFormat(id, clear, counts),
  create: (input) => createCompetitionFromFormat(input),
  invalidate: (seasonId, phaseIds) => expireSeasonReads(seasonId, [...phaseIds]),
};

export const nativeFormatStorage: FormatStoragePort = {
  startSignals: (seasonId) => getSeasonStartSignals(seasonId, 'native'),
  manualPhaseCount: (seasonId) => getSeasonManualPhaseCount(seasonId, 'native'),
  attach: (input) => attachSeasonFormat(input, 'native'),
  detach: (seasonId, confirmClear, confirmedCounts) => detachSeasonFormat(seasonId, confirmClear, confirmedCounts, 'native'),
  create: (input) => createCompetitionFromFormat(input, 'native'),
  invalidate: (seasonId) => expireSeasonReads(seasonId),
};
