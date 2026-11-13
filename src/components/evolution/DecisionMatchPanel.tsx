'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useT } from '@/i18n/client';
import { draftLegacyEvolutionMessages } from '@/i18n/messages/draft/legacy/evolution';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import type { EvolutionStanding } from '@/lib/tournament/evolution-standings';

interface DecisionMatchPanelProps {
  tiedPlayers: EvolutionStanding[];
  tournamentId: string;
  seasonId?: string;
  /** When true, show admin schedule links (server/session-derived). */
  isAdmin?: boolean;
}

/**
 * Surfaces unresolved EPB ties and links league admins to schedule a decision match: to the
 * tournament, and to the league admin's Phases tab (where the phase and its rounds live).
 */
export default function DecisionMatchPanel({
  tiedPlayers,
  tournamentId,
  seasonId,
  isAdmin = false,
}: DecisionMatchPanelProps) {
  const t = useT(draftLegacyEvolutionMessages);
  const [expanded, setExpanded] = useState(true);

  const names = [...new Set(tiedPlayers.map((p) => p.player_name))];

  return (
    <div className="rounded-lg border border-[rgb(180_83_9/0.5)] bg-[rgb(69_26_3/0.2)] p-4">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={expanded}
      >
        <span className="text-sm font-semibold text-amber-400">
          {t('decision.title')}
        </span>
        <span className="text-xs text-fg-muted">{expanded ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2 text-sm text-fg-muted">
          <p>
            {t.rich('decision.tied', {
              names: names.join(', '),
              b: (chunks) => <strong className="text-fg">{chunks}</strong>,
            })}
          </p>
          <p className="text-xs">
            {t('decision.hint')}
          </p>
          {isAdmin && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Link
                href={`/admin/tournaments/${tournamentId}/rounds`}
                className="rounded-lg border border-[rgb(217_119_6/0.5)] bg-[rgb(120_53_15/0.3)] px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-[rgb(120_53_15/0.5)]"
              >
                {t('decision.enter')}
              </Link>
              {seasonId && (
                <Link
                  href={leagueAdminHref(seasonId, 'phases')}
                  className="rounded-lg border border-hairline px-3 py-1.5 text-xs text-fg-muted hover:bg-elevated"
                >
                  {t('decision.leagueAdmin')}
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
