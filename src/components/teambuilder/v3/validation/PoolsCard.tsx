'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { loadMyFormatView } from '@/lib/format-engine/runtime/client-api';
import type { ItemView, PlayerFormatView } from '@/lib/format-engine/runtime/view-types';
import SpeciesLabel from '@/components/format-runtime/player/SpeciesLabel';
import { useLText } from '@/components/format-runtime/player/useLabels';

type RunningView = Extract<PlayerFormatView, { running: true }>;

/**
 * The viewer's live view of a kit league, for the teambuilder. `null` until it is read, and for anything that is not a
 * running kit league the viewer takes part in (a plain league, a 403, a failed read): the card then shows nothing and
 * the panel never says anything about a league it cannot see. One read per panel mount and season (the validation tab remounts it), no retries (the card is a hint; the
 * server-side check is the authority).
 */
export function useKitLeagueView(seasonId: string | null | undefined): RunningView | null {
  const [loaded, setLoaded] = useState<{ seasonId: string; view: RunningView | null } | null>(null);

  useEffect(() => {
    if (!seasonId) return;
    let live = true;
    void loadMyFormatView(seasonId).then((outcome) => {
      if (live) setLoaded({ seasonId, view: outcome.ok && outcome.data.running ? outcome.data : null });
    });
    return () => {
      live = false;
    };
  }, [seasonId]);

  return seasonId && loaded?.seasonId === seasonId ? loaded.view : null;
}

/** "Your pools this week": the gifts the viewer holds (their own items, per resource) and which of the league's pools are open yet. */
export default function PoolsCard({ view }: { view: RunningView }) {
  const t = useT(teambuilderIntelMessages);
  const labelOf = useLText();

  // Own species items only (counters are not a pool; `holder` is only ever set on other players' items).
  const groups = new Map<string, ItemView[]>();
  for (const item of view.items) {
    if (item.item_id === null || item.holder !== null) continue;
    groups.set(item.resource, [...(groups.get(item.resource) ?? []), item]);
  }
  // Every pool the league defines (the server lists them with their lock state), not only the ones an action step draws
  // from: a pool the calendar unlocks later (the New Year pool) is in no step, and it is the one that changes during the cup.
  const { pools } = view;
  if (groups.size === 0 && pools.length === 0) return null;

  return (
    <div className="mb-3 rounded px-2 py-2" data-pools-card>
      <p className="mb-1 text-caption font-[550] text-fg">{t('validation.pools.title')}</p>
      {[...groups.entries()].map(([resource, rows]) => (
        <p key={resource} className="text-caption text-fg-muted">
          {labelOf(rows[0]!.resource_label)}:{' '}
          {rows.map((row, i) => (
            <span key={`${row.item_id}-${i}`}>
              {i > 0 && ', '}
              <SpeciesLabel id={row.item_id!} />
            </span>
          ))}
        </p>
      ))}
      {pools.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {pools.map((pool) => (
            <li key={pool.key} className="text-caption text-fg-muted">
              {t(pool.unlocked ? 'validation.pools.domainUnlocked' : 'validation.pools.domainLocked', { pool: labelOf(pool.label) })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
