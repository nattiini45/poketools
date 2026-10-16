'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useT } from '@/i18n/client';
import { draftLegacyEvolutionMessages } from '@/i18n/messages/draft/legacy/evolution';
import type { EvolutionStanding } from '@/lib/tournament/evolution-standings';

interface DecisionMatchPanelProps {
  tiedPlayers: EvolutionStanding[];
  tournamentId: string;
  seasonId?: string;
  /** When true, show admin schedule links (server/session-derived). */
  isAdmin?: boolean;
}

/**
 * Surfaces unresolved EPB ties and links league admins to schedule a decision match.
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
    <div className="rounded-lg border border-amber-700/50 bg-amber-950/20 p-4">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={expanded}
      >
        <span className="text-sm font-semibold text-amber-400">
          {t('decision.title')}
        </span>
        <span className="text-xs text-poke-text-muted">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2 text-sm text-poke-text-secondary">
          <p>
            {t.rich('decision.tied', {
              names: names.join(', '),
              b: (chunks) => <strong className="text-poke-text">{chunks}</strong>,
            })}
          </p>
          <p className="text-xs">
            {t('decision.hint')}
          </p>
          {isAdmin && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Link
                href={`/admin/tournaments/${tournamentId}`}
                className="rounded-lg border border-amber-600/50 bg-amber-900/30 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-900/50"
              >
                {t('decision.enter')}
              </Link>
              {seasonId && (
                <Link
                  href={`/admin/leagues/${seasonId}`}
                  className="rounded-lg border border-poke-border px-3 py-1.5 text-xs text-poke-text-secondary hover:bg-poke-elevated"
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
