'use client';

import { useState, useEffect, useMemo } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import { errorsTeams } from '@/i18n/messages/errors';
import { localizeSpecies, speciesSearchKeys } from '@/lib/pkmn/i18n/names/species';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { matchRank, NO_MATCH } from '@/lib/pkmn/i18n/search';
import {
  apiFailure,
  errorKey,
  useTeambuilderErrorText,
  type TeambuilderError,
} from './v3/hooks/useTeambuilderErrorText';
import type { PokemonSet } from '@/types/team';

interface TeamPickerTeam {
  id: string;
  pokemon: PokemonSet[];
  tournament_id: string | null;
  tournament_name?: string | null;
  locked: boolean;
  updated_at: string;
}

interface TeamPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (pokemon: PokemonSet[]) => void;
}

export default function TeamPicker({ open, onClose, onSelect }: TeamPickerProps) {
  const t = useT(teambuilderMessages);
  const dl = useDataLocale();
  const formatter = useFormatter();
  const errorText = useTeambuilderErrorText(errorsTeams);
  const [teams, setTeams] = useState<TeamPickerTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<TeambuilderError | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    fetch('/api/teams')
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          setTeams(json.data);
        } else {
          setError(apiFailure(json, 'loadTeamsFailed'));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(errorKey('networkError'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!search) return teams;
    // Species match in English and German whatever the language (pkmn-l10n §5.2 rule 4).
    const q = search.toLowerCase();
    return teams.filter(
      (team) =>
        team.tournament_name?.toLowerCase().includes(q) ||
        team.pokemon.some((p) => !!p.species && matchRank(search, speciesSearchKeys(p.species)) !== NO_MATCH),
    );
  }, [teams, search]);

  if (!open) return null;

  return (
    <Card variant="outlined" padding="md" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-heading font-semibold text-poke-text-primary">
          {t('picker.title')}
        </h3>
        <Button variant="ghost" onClick={onClose} className="!p-1 !text-lg leading-none" aria-label={t('picker.close')}>
          &times;
        </Button>
      </div>

      {/* Search filter */}
      {!loading && !error && teams.length >= 3 && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('picker.filterPlaceholder')}
          className="w-full px-3 py-2 text-sm rounded-poke-md border border-poke-border bg-poke-surface text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20 transition-colors"
        />
      )}

      {/* Content */}
      <div className="max-h-[400px] overflow-y-auto space-y-3">
        {loading && (
          <div className="text-center py-6">
            <p className="text-sm text-poke-text-muted animate-pulse">{t('picker.loading')}</p>
          </div>
        )}

        {error && (
          <div className="text-center py-6">
            <p className="text-sm text-poke-danger">{errorText(error)}</p>
          </div>
        )}

        {!loading && !error && teams.length === 0 && (
          <div className="text-center py-6 space-y-2">
            <p className="text-sm font-heading font-semibold text-poke-text-secondary">
              {t('picker.emptyTitle')}
            </p>
            <p className="text-xs text-poke-text-muted max-w-xs mx-auto leading-relaxed">
              {t('picker.emptyHint')}
            </p>
          </div>
        )}

        {!loading && !error && teams.length > 0 && filtered.length === 0 && (
          <div className="text-center py-4">
            <p className="text-sm text-poke-text-muted">
              {t('picker.noMatch', { query: search })}
            </p>
          </div>
        )}

        {/* Team cards */}
        {!loading &&
          filtered.map((team) => (
            <button
              key={team.id}
              onClick={() => onSelect(team.pokemon)}
              className="w-full text-left border border-poke-border rounded-poke-lg p-4 hover:border-poke-border-focus hover:bg-poke-elevated/50 hover:shadow-poke-card transition-all group"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-heading font-semibold text-poke-text-primary">
                  {team.tournament_name ?? t('picker.standalone')}
                </span>
                <div className="flex items-center gap-2 text-xs text-poke-text-muted">
                  {team.locked && (
                    <span className="inline-flex items-center gap-1 text-poke-warning font-medium">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                      {t('picker.locked')}
                    </span>
                  )}
                  <span>{formatter.instant(team.updated_at, 'date')}</span>
                </div>
              </div>

              {/* Sprites row */}
              <div className="flex gap-1.5 mb-3">
                {team.pokemon.slice(0, 6).map((p, i) => (
                  <div
                    key={i}
                    className="w-10 h-10 flex items-center justify-center bg-poke-elevated/50 rounded-poke border border-poke-border/50 group-hover:border-poke-border-focus/30 transition-colors"
                  >
                    <PokemonSprite name={p.species} size={36} />
                  </div>
                ))}
              </div>

              {/* Pokemon detail rows */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                {team.pokemon.slice(0, 6).map((p, i) => (
                  <div key={i} className="text-xs text-poke-text-muted truncate">
                    <span className="text-poke-text-secondary font-medium">{localizeSpecies(p.species, dl)}</span>
                    {p.item && (
                      <span className="opacity-70"> · {localizeItem(p.item, dl)}</span>
                    )}
                  </div>
                ))}
              </div>
            </button>
          ))}
      </div>

      {/* Footer */}
      <p className="text-xs text-poke-text-muted border-t border-poke-border pt-3">
        {t('picker.footer')}
      </p>
    </Card>
  );
}
