'use client';

import { useState } from 'react';
import Input from '@/components/ui/Input';
import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { PoolView } from '@/lib/format-engine/runtime/view-types';
import { entryMatchesSearch } from './entry-names';
import { EntrySprite, PLAYER_CARD, PlayerSection } from './parts';
import SpeciesLabel from './SpeciesLabel';
import { useLText } from './useLabels';

export default function PoolsSection({ pools }: { pools: readonly PoolView[] }) {
  const t = useT(formatRuntimePlayerMessages);
  const labelOf = useLText();
  const [query, setQuery] = useState('');
  const sections = pools.flatMap(({ key, label, overview }) => overview === undefined ? [] : [{
    key, label, rules: overview.rules, entries: overview.entries.filter(({ id }) => entryMatchesSearch(id, query)),
  }]);
  if (sections.length === 0) return null;

  return (
    <PlayerSection title={t('pools.heading')}>
      <Input
        type="search"
        label={t('pools.search')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />
      {sections.every(({ entries }) => entries.length === 0) && (
        <p role="status" className="text-body text-fg-muted">{t('pools.empty')}</p>
      )}
      {sections.filter(({ entries, rules }) => entries.length > 0 || (rules && query.trim() === '')).map(({ key, label, rules, entries }) => (
        <section key={key} className={PLAYER_CARD}>
          <h3 className="text-body font-semibold text-fg">{labelOf(label)}</h3>
          {rules && query.trim() === '' && <p className="text-body text-fg-muted">{labelOf(rules)}</p>}
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map(({ id, exact_level, detail }) => (
              <li key={id} className="flex min-w-0 items-center gap-2 rounded-poke-md border border-hairline p-2">
                <EntrySprite id={id} size={32} />
                <span className="min-w-0 break-words text-body text-fg">
                  <SpeciesLabel id={id} />
                  {detail && <span className="block text-caption text-fg-muted">{labelOf(detail)}</span>}
                  {exact_level !== undefined && (
                    <span className="block text-caption text-fg-muted">{t('pools.exactLevel', { level: exact_level })}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PlayerSection>
  );
}
