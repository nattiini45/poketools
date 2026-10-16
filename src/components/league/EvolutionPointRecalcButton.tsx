'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsDraftLegacy, errorsSeasons } from '@/i18n/messages/errors';
import { draftLegacyLeagueAdminEvolutionMessages } from '@/i18n/messages/draft/legacy/league-admin/evolution';

interface EvolutionPointRecalcButtonProps {
  seasonId: string;
}

/** The server's counts; the sentence is built in render (never translated text in state). */
interface RecalcResult {
  points: number;
  players: number;
}

export default function EvolutionPointRecalcButton({ seasonId }: EvolutionPointRecalcButtonProps) {
  const t = useT(draftLegacyLeagueAdminEvolutionMessages);
  const apiErrorText = useApiErrorText(errorsDraftLegacy, errorsSeasons);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecalcResult | null>(null);
  /** A failed call keeps the API body; a failure without one keeps the message key. */
  const [error, setError] = useState<{ api: ApiErrorLike } | { key: 'failed' } | null>(null);

  async function handleRecalculate() {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch(`/api/seasons/${seasonId}/evolution-points/recalculate`, {
        method: 'POST',
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        const api = toApiErrorLike(json);
        setError(api.error || api.code ? { api } : { key: 'failed' });
        return;
      }

      setResult({ points: json.data.points_awarded, players: json.data.players_updated });
    } catch {
      setError({ key: 'failed' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        onClick={handleRecalculate}
        disabled={loading}
      >
        {loading ? t('recalc.recalculating') : t('recalc.cta')}
      </Button>
      {result && (
        <p className="text-sm text-green-600">
          {t('recalc.done', {
            points: t('recalc.points', { count: result.points }),
            players: t('recalc.players', { count: result.players }),
          })}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-600">{'api' in error ? apiErrorText(error.api) : t(`recalc.${error.key}`)}</p>
      )}
    </div>
  );
}
