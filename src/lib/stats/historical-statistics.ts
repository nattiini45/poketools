import 'server-only';
import { cache } from 'react';
import { loadSupplement, packExtensions } from '@/lib/pack-extensions';
import type {
  HistoricalStatisticsRequest,
  HistoricalUsageContribution,
} from '@/lib/pack-extensions/historical-statistics-types';
import type { HistoricalStatisticsView } from './combined-statistics';

export const historicalCompetitionOptions = cache(async () => packExtensions.historicalScopes?.() ?? []);

export async function readHistoricalUsage(request: HistoricalStatisticsRequest): Promise<{
  data: HistoricalUsageContribution | null;
  history: HistoricalStatisticsView;
}> {
  const provider = packExtensions.historicalUsage;
  if (!provider) return { data: null, history: { state: 'absent', coverage: [] } };
  const result = await loadSupplement('historicalUsage', (ctx) => provider(request, ctx));
  if (result.state !== 'ready') {
    return { data: null, history: { state: result.state, coverage: [] } };
  }
  if (result.value.state === 'not_ready') {
    return { data: null, history: { state: 'not_ready', coverage: [] } };
  }
  return {
    data: result.value.data,
    history: { state: 'ready', coverage: result.value.data?.coverage ?? [] },
  };
}
