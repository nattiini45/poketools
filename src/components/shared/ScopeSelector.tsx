'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { InsightsScope } from '@/lib/insights/scope';
import { scopeToQueryString } from '@/lib/insights/scope';
import { useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';

export interface ScopeOption {
  id: string;
  name: string;
}

interface ScopeSelectorProps {
  scope: InsightsScope;
  leagues: ScopeOption[];
  tournaments: ScopeOption[];
  /** When true, only global scope is selectable (e.g. ratings tab). */
  globalOnly?: boolean;
  className?: string;
  /** Controlled mode: call on change instead of updating the URL. */
  onScopeChange?: (scope: InsightsScope) => void;
}

export default function ScopeSelector({
  scope,
  leagues,
  tournaments,
  globalOnly = false,
  className = '',
  onScopeChange,
}: ScopeSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useT(uiMessages);

  const pushScope = (next: InsightsScope) => {
    if (onScopeChange) {
      onScopeChange(next);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    const scopeQuery = scopeToQueryString(next);
    for (const part of scopeQuery.split('&')) {
      const [key, value] = part.split('=');
      if (key && value !== undefined) {
        params.set(key, decodeURIComponent(value));
      }
    }
    if (next.type === 'global') {
      params.delete('id');
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  const scopeType =
    scope.type === 'global' ? 'global' : scope.type === 'league' ? 'league' : 'tournament';

  return (
    <div className={`flex flex-wrap gap-3 items-end ${className}`}>
      <div>
        <label className="block text-xs text-poke-text-secondary mb-1">{t('scope.label')}</label>
        <select
          value={globalOnly ? 'global' : scopeType}
          disabled={globalOnly}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'global') pushScope({ type: 'global' });
            else if (v === 'league' && leagues[0]) pushScope({ type: 'league', id: leagues[0].id });
            else if (v === 'tournament' && tournaments[0]) {
              pushScope({ type: 'tournament', id: tournaments[0].id });
            }
          }}
          className="px-2 py-1.5 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary disabled:opacity-60"
          title={globalOnly ? t('scope.globalOnly') : undefined}
        >
          <option value="global">{t('scope.global')}</option>
          {!globalOnly && <option value="league">{t('scope.league')}</option>}
          {!globalOnly && <option value="tournament">{t('scope.tournament')}</option>}
        </select>
      </div>

      {!globalOnly && scope.type === 'league' && (
        <div>
          <label className="block text-xs text-poke-text-secondary mb-1">{t('scope.league')}</label>
          <select
            value={scope.id}
            onChange={(e) => pushScope({ type: 'league', id: e.target.value })}
            className="px-2 py-1.5 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary min-w-[160px]"
          >
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!globalOnly && scope.type === 'tournament' && (
        <div>
          <label className="block text-xs text-poke-text-secondary mb-1">{t('scope.tournament')}</label>
          <select
            value={scope.id}
            onChange={(e) => pushScope({ type: 'tournament', id: e.target.value })}
            className="px-2 py-1.5 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary min-w-[160px]"
          >
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
