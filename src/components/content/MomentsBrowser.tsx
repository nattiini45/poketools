'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Card from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import type { BroadcastMoment, BroadcastMomentType } from '@/types/broadcast';
import type { PublicMatch } from '@/lib/match/public-match';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsBroadcast, errorsMatches } from '@/i18n/messages/errors';
import { creatorContentMessages } from '@/i18n/messages/creator/content';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface MomentsBrowserProps {
  matches: PublicMatch[];
}

const MOMENT_TYPES: readonly BroadcastMomentType[] = ['turning_point', 'big_ko', 'misplay', 'clutch', 'highlight'];

const MOMENT_TYPE_COLORS: Record<BroadcastMomentType, string> = {
  turning_point: 'bg-[var(--poke-moment-amber-bg)] text-[var(--poke-moment-amber)]',
  big_ko: 'bg-[var(--poke-moment-red-bg)] text-[var(--poke-moment-red)]',
  misplay: 'bg-[var(--poke-moment-purple-bg)] text-[var(--poke-moment-purple)]',
  clutch: 'bg-[var(--poke-moment-emerald-bg)] text-[var(--poke-moment-emerald)]',
  highlight: 'bg-[var(--poke-moment-blue-bg)] text-[var(--poke-moment-blue)]',
};

/** A failure to show: the API's error when it sent one, else the local message key. */
interface MomentsError {
  res: ApiErrorLike | null;
  fallback: 'loadFailed' | 'networkError';
}

export default function MomentsBrowser({ matches }: MomentsBrowserProps) {
  const t = useT(creatorContentMessages);
  const dataLocale = useDataLocale();
  const formatter = useFormatter();
  const errorText = useApiErrorText(errorsBroadcast, errorsMatches);
  const [matchId, setMatchId] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [moments, setMoments] = useState<BroadcastMoment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<MomentsError | null>(null);

  const fetchMoments = useCallback(async (mid: string) => {
    if (!mid) {
      setMoments([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/broadcast/moments?match_id=${mid}`);
      const json = await res.json();
      if (json.success) {
        setMoments(json.data);
      } else {
        setError({ res: toApiErrorLike(json), fallback: 'loadFailed' });
      }
    } catch {
      setError({ res: null, fallback: 'networkError' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMoments(matchId);
  }, [matchId, fetchMoments]);

  const filteredMoments = typeFilter
    ? moments.filter((m) => m.moment_type === typeFilter)
    : moments;

  const matchOptions = matches.map((m) => ({
    value: m.id,
    label: t('common.matchup', { player1: m.player_1_name, player2: m.player_2_name }),
  }));

  const momentTypeOptions = useMemo(
    () => [
      { value: '', label: t('moments.allTypes') },
      ...MOMENT_TYPES.map((type) => ({ value: type, label: t(`momentType.${type}`) })),
    ],
    [t],
  );

  return (
    <Card>
      <h3 className="text-lg font-heading font-bold text-poke-text-primary mb-4">
        {t('moments.title')}
      </h3>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label={t('common.match')}
            value={matchId}
            onChange={(e) => setMatchId(e.target.value)}
          >
            <option value="">{t('common.selectMatch')}</option>
            {matchOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>

          <Select
            label={t('moments.momentType')}
            value={typeFilter}
            options={momentTypeOptions}
            onChange={(e) => setTypeFilter(e.target.value)}
          />
        </div>

        {loading && (
          <p className="text-sm text-poke-text-muted">{t('moments.loading')}</p>
        )}

        {error && (
          <p className="text-sm text-poke-danger">
            {error.res && (error.res.error || error.res.code) ? errorText(error.res) : t(`moments.${error.fallback}`)}
          </p>
        )}

        {!loading && !error && matchId && filteredMoments.length === 0 && (
          <p className="text-sm text-poke-text-muted">{t('moments.empty')}</p>
        )}

        {filteredMoments.length > 0 && (
          <div className="space-y-2">
            {filteredMoments.map((moment) => (
              <div
                key={moment.id}
                className="flex items-start gap-3 px-3 py-2 rounded-poke-md bg-poke-muted border border-poke-border"
              >
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 mt-0.5 ${MOMENT_TYPE_COLORS[moment.moment_type]}`}
                >
                  {t.dynamic(`momentType.${moment.moment_type}`, undefined, moment.moment_type)}
                </span>
                <div className="min-w-0 flex-1">
                  {moment.description && (
                    <p className="text-sm text-poke-text-primary">{moment.description}</p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-poke-text-muted mt-0.5">
                    {moment.pokemon_name && <span>{localizeSpecies(moment.pokemon_name, dataLocale)}</span>}
                    {moment.turn_number !== null && <span>{t('moments.turn', { n: moment.turn_number })}</span>}
                    <span>{formatter.instant(moment.timestamp, 'dateTimeYear')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
