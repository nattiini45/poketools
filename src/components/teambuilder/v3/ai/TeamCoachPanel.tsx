'use client';

import { useState, useCallback } from 'react';
import type { PokemonSet } from '@/types/team';
import { useT } from '@/i18n/client';
import { toApiErrorLike } from '@/i18n/api-errors';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import { errorsAi, errorsTeams } from '@/i18n/messages/errors';
import {
  apiFailure,
  useTeambuilderErrorText,
  type TeambuilderError,
} from '../hooks/useTeambuilderErrorText';

/**
 * TeamCoachPanel — AI coaching suggestions for the entire team.
 * Fetches from /api/teams/ai/team-coach and displays results.
 */

interface TeamCoachPanelProps {
  team: (PokemonSet | null)[];
  format: string;
  generation: number;
}

export default function TeamCoachPanel({
  team,
  format,
  generation,
}: TeamCoachPanelProps) {
  const t = useT(teambuilderMessages);
  const errorText = useTeambuilderErrorText(errorsAi, errorsTeams);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<TeambuilderError | null>(null);

  const filledCount = team.filter((t) => t?.species).length;

  const handleAnalyze = useCallback(async () => {
    if (filledCount === 0) return;
    setLoading(true);
    setError(null);
    setContent(null);

    try {
      const res = await fetch('/api/teams/ai/team-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
  }, [team, format, generation, filledCount]);

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-heading font-semibold text-poke-text-secondary">
          {t('ai.coach.teamTitle')}
        </h3>
        <button
          onClick={handleAnalyze}
          disabled={loading || filledCount === 0}
          className="px-2 py-1 text-[10px] bg-poke-blue/10 text-poke-blue rounded hover:bg-poke-blue/20 transition-colors font-medium disabled:opacity-50"
        >
          {loading ? t('ai.coach.analyzing') : content ? t('ai.coach.refresh') : t('ai.coach.analyzeTeam')}
        </button>
      </div>

      {filledCount === 0 && (
        <p className="text-[11px] text-poke-text-muted">
          {t('ai.coach.addOne')}
        </p>
      )}

      {loading && (
        <div className="py-4">
          <div className="flex items-center gap-2 text-xs text-poke-text-muted">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t('ai.coach.analyzingTeam', { filled: filledCount })}
          </div>
        </div>
      )}

      {error && (
        <div className="p-2 text-xs text-poke-danger bg-poke-danger-light/20 rounded mb-2">
          {errorText(error)}
        </div>
      )}

      {content && (
        <div className="text-xs text-poke-text-primary leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      )}

      {!loading && !content && !error && filledCount > 0 && (
        <p className="text-[11px] text-poke-text-muted">
          {t('ai.coach.teamHint', { filled: filledCount })}
        </p>
      )}
    </div>
  );
}
