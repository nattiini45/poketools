import type { InsightsScope } from '@/lib/insights/scope';

export type WikiUsageScopeType = 'all_time' | 'league' | 'tournament';

export function wikiScopeToInsights(
  scopeType: WikiUsageScopeType,
  scopeId: string,
): InsightsScope {
  if (scopeType === 'all_time') return { type: 'global' };
  if (scopeType === 'league') return { type: 'league', id: scopeId };
  return { type: 'tournament', id: scopeId };
}

export function insightsScopeToWiki(scope: InsightsScope): {
  scopeType: WikiUsageScopeType;
  scopeId: string;
} {
  if (scope.type === 'global') return { scopeType: 'all_time', scopeId: '' };
  if (scope.type === 'league') return { scopeType: 'league', scopeId: scope.id };
  return { scopeType: 'tournament', scopeId: scope.id };
}
