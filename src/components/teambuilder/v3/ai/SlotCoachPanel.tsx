'use client';

import { useState, useCallback } from 'react';
import type { PokemonSet } from '@/types/team';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useDataLocale, useT } from '@/i18n/client';
import { toApiErrorLike } from '@/i18n/api-errors';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import { errorsAi, errorsTeams } from '@/i18n/messages/errors';
import {
  apiFailure,
  useTeambuilderErrorText,
  type TeambuilderError,
} from '../hooks/useTeambuilderErrorText';

/**
 * SlotCoachPanel — AI coaching suggestions for a selected team slot.
 * Fetches from /api/teams/ai/slot-coach and displays streaming text.
 */

interface SlotCoachPanelProps {
  set: PokemonSet | null;
  team: (PokemonSet | null)[];
  format: string;
  generation: number;
}

export default function SlotCoachPanel({
  set,
  team,
  format,
  generation,
}: SlotCoachPanelProps) {
  const t = useT(teambuilderMessages);
  const dl = useDataLocale();
  const errorText = useTeambuilderErrorText(errorsAi, errorsTeams);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<TeambuilderError | null>(null);
  const [lastSpecies, setLastSpecies] = useState<string | null>(null);

  const handleAnalyze = useCallback(async () => {
    if (!set?.species) return;
    setLoading(true);
    setError(null);
    setContent(null);
    setLastSpecies(set.species);

    try {
      const res = await fetch('/api/teams/ai/slot-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          set,
          team: team.filter(Boolean),
          format,
          generation,
        }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(apiFailure(json, 'aiRequestFailed'));
        return;
      }
      setContent((json as { content?: string | null }).content ?? null);
    } catch (err) {
      const like = toApiErrorLike(err);
      setError(like.error || like.code ? { kind: 'api', error: like } : { kind: 'key', key: 'coachUnavailable' });
    } finally {
      setLoading(false);
    }
  }, [set, team, format, generation]);

  // No set selected
  if (!set?.species) {
    return (
      <div className="p-3">
        <p className="text-xs text-poke-text-muted">
          {t('ai.coach.selectSlot')}
        </p>
      </div>
    );
  }

  const species = localizeSpecies(set.species, dl);

  // Show results or button
  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-heading font-semibold text-poke-text-secondary">
          {t('ai.coach.slotTitle', { species })}
        </h3>
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="px-2 py-1 text-[10px] bg-poke-blue/10 text-poke-blue rounded hover:bg-poke-blue/20 transition-colors font-medium disabled:opacity-50"
        >
          {loading ? t('ai.coach.analyzing') : lastSpecies === set.species ? t('ai.coach.refresh') : t('ai.coach.analyze')}
        </button>
      </div>

      {loading && (
        <div className="py-4">
          <div className="flex items-center gap-2 text-xs text-poke-text-muted">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t('ai.coach.analyzingSet')}
          </div>
        </div>
      )}

      {error && (
        <div className="p-2 text-xs text-poke-danger bg-poke-danger-light/20 rounded mb-2">
          {errorText(error)}
        </div>
      )}

      {content && (
        <div className="prose-poke-ai text-xs text-poke-text-primary leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      )}

      {!loading && !content && !error && (
        <p className="text-[11px] text-poke-text-muted">
          {t('ai.coach.slotHint', { species })}
        </p>
      )}
    </div>
  );
}
