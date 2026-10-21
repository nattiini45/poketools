'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Card from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import { buildOverlayUrl, OVERLAY_DEFAULTS } from '@/lib/broadcast/url-builder';
import type { OverlayConfig } from '@/types/broadcast';
import type { SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import type { Round } from '@/types/round';
import type { ApiResult } from '@/types/api';
import { useLocale, useT } from '@/i18n/client';
import { creatorContentMessages } from '@/i18n/messages/creator/content';
import { translateEngineLabel } from '@/i18n/content/engine-labels';

interface RecapGeneratorProps {
  seasons: SeasonWithDetails[];
}

export default function RecapGenerator({ seasons }: RecapGeneratorProps) {
  const t = useT(creatorContentMessages);
  const locale = useLocale();
  const [seasonId, setSeasonId] = useState('');
  const [tournamentId, setTournamentId] = useState('');
  const [roundId, setRoundId] = useState('');
  const [theme, setTheme] = useState<OverlayConfig['theme']>(OVERLAY_DEFAULTS.theme);
  const [copied, setCopied] = useState(false);

  // Cascading data
  const [tournaments, setTournaments] = useState<TournamentWithDetails[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loadingTournaments, setLoadingTournaments] = useState(false);
  const [loadingRounds, setLoadingRounds] = useState(false);

  // Track current fetch to avoid stale updates
  const tournamentFetchRef = useRef(0);
  const roundFetchRef = useRef(0);

  // Fetch child tournaments when league changes
  useEffect(() => {
    if (!seasonId) return;

    const fetchId = ++tournamentFetchRef.current;

    fetch(`/api/tournaments?season_id=${seasonId}`)
      .then((res) => res.json())
      .then((json: ApiResult<TournamentWithDetails[]>) => {
        if (fetchId === tournamentFetchRef.current && json.success) {
          setTournaments(json.data);
        }
      })
      .catch((err) => {
        console.error('[RecapGenerator] fetch tournaments failed:', err);
        if (fetchId === tournamentFetchRef.current) setTournaments([]);
      })
      .finally(() => {
        if (fetchId === tournamentFetchRef.current) setLoadingTournaments(false);
      });
  }, [seasonId]);

  // Fetch rounds when tournament changes
  useEffect(() => {
    if (!tournamentId) return;

    const fetchId = ++roundFetchRef.current;

    fetch(`/api/tournaments/${tournamentId}/rounds`)
      .then((res) => res.json())
      .then((json: ApiResult<Round[]>) => {
        if (fetchId === roundFetchRef.current && json.success) {
          setRounds(json.data);
        }
      })
      .catch((err) => {
        console.error('[RecapGenerator] fetch rounds failed:', err);
        if (fetchId === roundFetchRef.current) setRounds([]);
      })
      .finally(() => {
        if (fetchId === roundFetchRef.current) setLoadingRounds(false);
      });
  }, [tournamentId]);

  const handleSeasonChange = useCallback((newSeasonId: string) => {
    setSeasonId(newSeasonId);
    setTournamentId('');
    setRoundId('');
    setTournaments([]);
    setRounds([]);
    if (newSeasonId) setLoadingTournaments(true);
  }, []);

  const handleTournamentChange = useCallback((newTournamentId: string) => {
    setTournamentId(newTournamentId);
    setRoundId('');
    setRounds([]);
    if (newTournamentId) setLoadingRounds(true);
  }, []);

  // The overlay never reads the viewer's cookie (i18n-core §6.5): the URL
  // carries the language, here the creator's current UI language.
  const recapUrl = useMemo(() => {
    if (!seasonId || !tournamentId || !roundId) return '';
    return buildOverlayUrl('recap', seasonId, { theme }, {
      tournament_id: tournamentId,
      round_id: roundId,
      lang: locale,
    });
  }, [seasonId, tournamentId, roundId, theme, locale]);

  const handleCopy = useCallback(async () => {
    if (!recapUrl) return;
    const fullUrl = `${window.location.origin}${recapUrl}`;
    await navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [recapUrl]);

  const seasonOptions = seasons.map((s) => ({ value: s.id, label: s.name }));
  const tournamentOptions = tournaments.map((tournament) => ({ value: tournament.id, label: tournament.name }));
  const roundOptions = rounds.map((r) => ({ value: r.id, label: translateEngineLabel('round', r.name, locale) }));

  return (
    <Card>
      <h3 className="text-lg font-heading font-bold text-poke-text-primary mb-4">
        {t('recap.title')}
      </h3>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Select
            label={t('common.league')}
            value={seasonId}
            onChange={(e) => handleSeasonChange(e.target.value)}
          >
            <option value="">{t('common.selectLeague')}</option>
            {seasonOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>

          <Select
            label={t('common.tournament')}
            value={tournamentId}
            onChange={(e) => handleTournamentChange(e.target.value)}
            disabled={!seasonId || loadingTournaments}
          >
            <option value="">
              {loadingTournaments
                ? t('common.loading')
                : !seasonId
                  ? t('common.selectLeagueFirst')
                  : tournaments.length === 0
                    ? t('common.noTournaments')
                    : t('common.selectTournament')}
            </option>
            {tournamentOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>

          <Select
            label={t('common.round')}
            value={roundId}
            onChange={(e) => setRoundId(e.target.value)}
            disabled={!tournamentId || loadingRounds}
          >
            <option value="">
              {loadingRounds
                ? t('common.loading')
                : !tournamentId
                  ? t('common.selectTournamentFirst')
                  : rounds.length === 0
                    ? t('common.noRounds')
                    : t('common.selectRound')}
            </option>
            {roundOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>

          <Select
            label={t('common.theme')}
            value={theme}
            options={[
              { value: 'dark', label: t('theme.dark') },
              { value: 'light', label: t('theme.light') },
            ]}
            onChange={(e) => setTheme(e.target.value as OverlayConfig['theme'])}
          />
        </div>

        {recapUrl && (
          <div className="flex items-center gap-3 pt-2">
            <Button variant="primary" size="sm" onClick={handleCopy}>
              {copied ? t('common.copied') : t('recap.copyUrl')}
            </Button>
            <a
              href={recapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-poke-accent hover:underline"
            >
              {t('common.openPreview')}
            </a>
          </div>
        )}
      </div>
    </Card>
  );
}
