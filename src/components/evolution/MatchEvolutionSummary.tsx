'use client';

import Badge from '@/components/ui/Badge';
import { useDataLocale, useT } from '@/i18n/client';
import { draftLegacyEvolutionMessages } from '@/i18n/messages/draft/legacy/evolution';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { MatchEvolutionSnapshot } from '@/types/evolution';

interface MatchEvolutionSummaryProps {
  playerName: string;
  snapshots: MatchEvolutionSnapshot[];
  /** Whether this player earned an evolution point this matchday */
  evolutionPointEarned: boolean;
  /** Whether this player is the match winner */
  isWinner: boolean;
  /**
   * Form each evolving line evolved into, keyed by snapshot id (resolved
   * server-side — species_at_match holds the pre-evolution form).
   */
  evolvedInto?: Record<string, string>;
}

/**
 * Per-trainer Evolution League summary shown below the match score.
 * Displays: evolution point, evolutions count, Comeback Tokens (`kill_tokens`),
 * Participation Tokens (`cosmo_points`) and any suspension triggered. Token values are
 * per-match deltas from the snapshot, not cumulative tracker totals.
 * A client leaf (cheap) so it can translate with hooks; it receives plain snapshot data.
 */
export default function MatchEvolutionSummary({
  playerName,
  snapshots,
  evolutionPointEarned,
  isWinner,
  evolvedInto = {},
}: MatchEvolutionSummaryProps) {
  const t = useT(draftLegacyEvolutionMessages);
  const tShared = useT(draftSharedMessages);
  const dataLocale = useDataLocale();
  const evolutions = snapshots.filter((s) => s.evolution_triggered);
  const totalComebackTokens = snapshots.reduce((sum, s) => sum + s.kill_tokens_delta, 0);
  const totalCosmoPoints = snapshots.reduce((sum, s) => sum + s.cosmo_points_delta, 0);
  const suspensions = snapshots.filter((s) => s.suspension_triggered);
  const hasData = snapshots.length > 0;

  if (!hasData) return null;

  return (
    <div className="rounded-lg border border-poke-border bg-poke-elevated p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-heading font-semibold text-poke-text-primary">
          {playerName}
        </span>
        {isWinner && <span className="text-xs text-poke-green">★</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Evolution Point */}
        <Badge variant={evolutionPointEarned ? 'green' : 'gray'} size="sm">
          {t('summary.evolutionPoint', { value: evolutionPointEarned ? '+1' : '0' })}
        </Badge>

        {/* Evolutions count */}
        {evolutions.length > 0 && (
          <Badge variant="blue" size="sm">
            {t('summary.evolutions', { count: evolutions.length })}
          </Badge>
        )}

        {/* Comeback Tokens (`kill_tokens`) */}
        {totalComebackTokens > 0 && (
          <Badge variant="red" size="sm">
            {t('summary.comebackTokens', { count: totalComebackTokens })}
          </Badge>
        )}

        {/* Participation Tokens (`cosmo_points`) */}
        {totalCosmoPoints > 0 && (
          <Badge variant="purple" size="sm">
            {tShared('progress.cosmoChip', { n: totalCosmoPoints })}
          </Badge>
        )}

        {/* Early stage-3 suspension */}
        {suspensions.length > 0 && (
          <Badge variant="red" size="sm">
            {t('summary.suspendedNext')}
          </Badge>
        )}
      </div>

      {/* Evolution details */}
      {evolutions.length > 0 && (
        <div className="mt-2 space-y-1">
          {evolutions.map((s) => (
            <p key={s.id} className="text-xs text-poke-text-secondary">
              <span className="font-medium text-poke-text-primary">
                {localizeSpecies(s.species_at_match, dataLocale)}
              </span>
              {' → '}
              <span className="text-poke-blue">
                {evolvedInto[s.id] ? localizeSpecies(evolvedInto[s.id], dataLocale) : '?'}
              </span>
              <span className="text-poke-text-muted">
                {' '}({s.progress_before} → {s.progress_after})
              </span>
            </p>
          ))}
        </div>
      )}

      {/* Suspension details */}
      {suspensions.length > 0 && (
        <div className="mt-2 space-y-1">
          {suspensions.map((s) => (
            <p key={`susp-${s.id}`} className="text-xs text-red-400">
              {t('summary.suspensionDetail', { name: localizeSpecies(s.species_at_match, dataLocale) })}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
