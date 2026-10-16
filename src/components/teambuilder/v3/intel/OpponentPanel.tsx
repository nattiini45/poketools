'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { errorsMatches } from '@/i18n/messages/errors/matches';
import { errorsTeams } from '@/i18n/messages/errors/teams';
import { useApiErrorText } from '@/i18n/use-api-error';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useEditorContext } from '../editor/EditorContext';
import { useOpponentSummary } from '../hooks/useOpponentSummary';
import { formatUsagePct } from '../workspace/usagePercent';

export default function OpponentPanel() {
  const { state } = useEditorContext();
  const matchId = state.matchId;
  const { summary, loading, apiError } = useOpponentSummary(matchId);
  const t = useT(teambuilderIntelMessages);
  const errorText = useApiErrorText(errorsTeams, errorsMatches);
  const locale = useLocale();
  const dl = useDataLocale();

  if (state.mode !== 'plan' || !matchId) return null;

  if (loading) {
    return (
      <div className="text-[11px] text-poke-text-muted text-center py-6">
        {t('opponent.loading')}
      </div>
    );
  }

  if (apiError) {
    return <div className="text-[11px] text-red-400 text-center py-4">{errorText(apiError)}</div>;
  }

  if (!summary) return null;

  /** Rates arrive as 0–100 numbers (`45` = 45%). */
  const rate = (value100: number) => formatUsagePct(value100 / 100, locale, value100 % 1 === 0 ? 0 : 1);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium text-poke-text-primary">
          {summary.opponent_name}
        </h3>
        <span className="text-[9px] text-poke-text-muted">
          {t('opponent.gamesAnalyzed', { count: summary.total_games })}
        </span>
      </div>

      {summary.pokemon.length === 0 ? (
        <p className="text-[11px] text-poke-text-muted text-center py-4">
          {t('opponent.empty')}
        </p>
      ) : (
        <div className="space-y-1.5">
          {summary.pokemon.map((mon) => (
            <div key={mon.species} className="bg-poke-surface rounded-lg p-2">
              <div className="flex items-center gap-2 mb-1.5">
                <PokemonSprite name={mon.species} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-poke-text-primary truncate">
                    {localizeSpecies(mon.species, dl)}
                  </div>
                  {mon.sample_moves.length > 0 && (
                    <div className="text-[9px] text-poke-text-muted truncate">
                      {mon.sample_moves.map((m) => localizeMove(m, dl)).join(' · ')}
                    </div>
                  )}
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-4 gap-0.5 text-center">
                <div>
                  <div className="text-[11px] font-mono text-poke-text-primary">
                    {rate(mon.bring_rate)}
                  </div>
                  <div className="text-[8px] text-poke-text-muted">{t('opponent.bring')}</div>
                </div>
                <div>
                  <div
                    className={`text-[11px] font-mono ${mon.ko_rate >= 50 ? 'text-red-400' : 'text-poke-text-primary'}`}
                  >
                    {rate(mon.ko_rate)}
                  </div>
                  <div className="text-[8px] text-poke-text-muted">{t('opponent.ko')}</div>
                </div>
                <div>
                  <div className="text-[11px] font-mono text-poke-text-primary">
                    {rate(mon.lead_rate)}
                  </div>
                  <div className="text-[8px] text-poke-text-muted">{t('opponent.lead')}</div>
                </div>
                <div>
                  <div
                    className={`text-[11px] font-mono ${mon.win_rate >= 60 ? 'text-green-400' : mon.win_rate <= 40 ? 'text-red-400' : 'text-poke-text-primary'}`}
                  >
                    {rate(mon.win_rate)}
                  </div>
                  <div className="text-[8px] text-poke-text-muted">{t('opponent.win')}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
