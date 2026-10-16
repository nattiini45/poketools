import type { AggregateScope } from '@/types/game';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { insightsMessages } from '@/i18n/messages/insights';

export type InsightsScope =
  | { type: 'global' }
  | { type: 'league'; id: string }
  | { type: 'tournament'; id: string };

export type InsightsTab =
  | 'ratings'
  | 'usage'
  | 'moves'
  | 'kills'
  | 'h2h'
  | 'streaks';

const VALID_TABS: InsightsTab[] = ['ratings', 'usage', 'moves', 'kills', 'h2h', 'streaks'];

export function parseInsightsTab(value: string | undefined): InsightsTab {
  if (value && VALID_TABS.includes(value as InsightsTab)) {
    return value as InsightsTab;
  }
  return 'usage';
}

type SearchParamInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function getParam(
  input: SearchParamInput,
  key: string,
): string | undefined {
  if (input instanceof URLSearchParams) {
    return input.get(key) ?? undefined;
  }
  const raw = input[key];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export function parseScopeFromSearchParams(input: SearchParamInput): InsightsScope {
  const scope = getParam(input, 'scope') ?? 'global';
  const id = getParam(input, 'id');

  if (scope === 'league' && id) {
    return { type: 'league', id };
  }
  if (scope === 'tournament' && id) {
    return { type: 'tournament', id };
  }
  return { type: 'global' };
}

export function scopeToQueryString(scope: InsightsScope): string {
  if (scope.type === 'league') {
    return `scope=league&id=${encodeURIComponent(scope.id)}`;
  }
  if (scope.type === 'tournament') {
    return `scope=tournament&id=${encodeURIComponent(scope.id)}`;
  }
  return 'scope=global';
}

export function scopeAggregateKey(
  scope: InsightsScope,
): { scopeType: AggregateScope; scopeId: string | null } {
  if (scope.type === 'league') {
    return { scopeType: 'league', scopeId: scope.id };
  }
  if (scope.type === 'tournament') {
    return { scopeType: 'tournament', scopeId: scope.id };
  }
  return { scopeType: 'all_time', scopeId: null };
}

/** The scope's name in `locale` (English by default). */
export function scopeLabel(scope: InsightsScope, locale: Locale = 'en'): string {
  const t = createTranslator(insightsMessages, locale);
  return t(`scope.${scope.type}`);
}
