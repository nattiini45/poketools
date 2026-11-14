'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { InsightsScope } from '@/lib/insights/scope';
import type { HistoricalCompetitionOption } from '@/lib/pack-extensions/historical-statistics-types';
import { scopeToQueryString } from '@/lib/insights/scope';
import Combobox from '@/components/ui/Combobox';
import Select from '@/components/ui/Select';
import { cn } from '@/lib/utils/cn';
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
  archiveOptions?: readonly HistoricalCompetitionOption[];
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
  archiveOptions = [],
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

  const scopeType = scope.type;

  // The combobox's own label is smaller than the select's, so both fields get the select's label here.
  const picker = (kind: 'league' | 'tournament' | 'archive', options: readonly ScopeOption[], selectedId: string) => (
    <label className="block min-w-0 flex-1 basis-56 space-y-1.5 sm:max-w-sm">
      <span className="block text-sm font-body font-medium text-fg">{t(`scope.${kind}`)}</span>
      <Combobox
        mode="static"
        placeholder={t(`scope.${kind}Search`)}
        value={options.find((option) => option.id === selectedId)?.name ?? ''}
        staticOptions={options.map((option) => ({ value: option.id, label: option.name }))}
        // Clearing the field leaves the scope as it is: the page always shows one league or tournament.
        onChange={(id) => id && pushScope({ type: kind, id })}
      />
    </label>
  );

  return (
    <div className={cn('flex flex-wrap items-start gap-3', className)}>
      <div className="min-w-0 flex-1 basis-56 sm:max-w-60">
        <Select
          label={t('scope.label')}
          value={globalOnly ? 'global' : scopeType}
          disabled={globalOnly}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'global') pushScope({ type: 'global' });
            else if (v === 'league' && leagues[0]) pushScope({ type: 'league', id: leagues[0].id });
            else if (v === 'tournament' && tournaments[0]) {
              pushScope({ type: 'tournament', id: tournaments[0].id });
            }
            else if (v === 'archive' && archiveOptions[0]) {
              pushScope({ type: 'archive', id: archiveOptions[0].id });
            }
          }}
          title={globalOnly ? t('scope.globalOnly') : undefined}
        >
          <option value="global">{t('scope.global')}</option>
          {!globalOnly && <option value="league">{t('scope.league')}</option>}
          {!globalOnly && <option value="tournament">{t('scope.tournament')}</option>}
          {!globalOnly && (archiveOptions.length > 0 || scope.type === 'archive') && <option value="archive">{t('scope.archive')}</option>}
        </Select>
      </div>

      {!globalOnly && scope.type === 'league' && picker('league', leagues, scope.id)}
      {!globalOnly && scope.type === 'tournament' && picker('tournament', tournaments, scope.id)}
      {!globalOnly && scope.type === 'archive' && picker('archive', archiveOptions, scope.id)}
    </div>
  );
}
