'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import type { SharedTeamView, PokemonSet } from '@/types/team';
import { useT, useDataLocale } from '@/i18n/client';
import { teamsLibraryMessages } from '@/i18n/messages/teams-library';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsTeams } from '@/i18n/messages/errors/teams';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeNature } from '@/lib/pkmn/i18n/names/misc';
import { formatStatSpread, hasCustomIv, hasEv } from '../../stat-spread';

/**
 * PublicTeamView — read-only page for viewing a shared team.
 * Accessed via /teams/shared/[token]
 * No auth required — the token is the authorization.
 */

export default function PublicTeamViewPage() {
  const params = useParams<{ token: string }>();
  const t = useT(teamsLibraryMessages);
  const errorText = useApiErrorText(errorsTeams);
  const [team, setTeam] = useState<SharedTeamView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  useEffect(() => {
    if (!params.token) return;
    let cancelled = false;

    fetch(`/api/teams/shared/${params.token}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) {
          setError(toApiErrorLike(json));
          return;
        }
        setTeam(json.team);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toApiErrorLike(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [params.token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-sm text-poke-text-muted">{t('shared.loading')}</p>
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h1 className="text-lg font-heading font-bold text-poke-text-primary mb-2">
            {t('shared.notFound')}
          </h1>
          <p className="text-sm text-poke-text-muted">
            {error
              ? error.error || error.code
                ? errorText(error)
                : t('shared.loadFailed')
              : t('shared.disabled')}
          </p>
        </div>
      </div>
    );
  }

  const title = team.library_title || t('shared.defaultTitle');
  const description = team.library_description || null;
  const filledPokemon = team.pokemon.filter((p) => p?.species && p.species !== 'hidden');

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-xl font-heading font-bold text-poke-text-primary">
            {title}
          </h1>
          {team.tournament_id && (
            <span className="px-2 py-0.5 text-[10px] bg-poke-blue/10 text-poke-blue rounded font-medium">
              {t('shared.tournament')}
            </span>
          )}
        </div>
        {description && (
          <p className="text-sm text-poke-text-muted">{description}</p>
        )}
      </div>

      {/* Team grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filledPokemon.map((set, i) => (
          <SharedTeamCard key={i} set={set} index={i} />
        ))}
      </div>

      {/* Paste export */}
      <div className="mt-8">
        <h2 className="text-sm font-heading font-semibold text-poke-text-secondary mb-2">
          {t('shared.showdownPaste')}
        </h2>
        <pre className="p-4 bg-poke-surface border border-poke-border rounded-poke-md text-xs text-poke-text-primary font-mono overflow-x-auto whitespace-pre-wrap">
          {filledPokemon.map(formatShowdownSet).join('\n\n')}
        </pre>
        <button
          onClick={() => navigator.clipboard.writeText(filledPokemon.map(formatShowdownSet).join('\n\n'))}
          className="mt-2 px-3 py-1.5 text-xs bg-poke-blue text-poke-on-blue rounded-poke-md hover:bg-poke-blue/80 transition-colors"
        >
          {t('shared.copyPaste')}
        </button>
      </div>
    </div>
  );
}

function SharedTeamCard({ set, index }: { set: PokemonSet; index: number }) {
  const t = useT(teamsLibraryMessages);
  const dl = useDataLocale();
  if (!set.species || set.species === 'hidden') {
    return (
      <div className="border border-poke-border rounded-poke-md p-4 bg-poke-surface/50 text-center">
        <p className="text-xs text-poke-text-muted">{t('set.slot', { n: index + 1 })}</p>
      </div>
    );
  }

  return (
    <div className="border border-poke-border rounded-poke-md p-4 bg-poke-surface hover:border-poke-blue/30 transition-colors">
      <div className="flex items-center gap-3 mb-3">
        <PokemonSprite name={set.species} size={48} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">
            {set.name || localizeSpecies(set.species, dl)}
          </p>
          {set.item && (
            <p className="text-[10px] text-poke-text-muted">{t('set.item', { item: localizeItem(set.item, dl) })}</p>
          )}
        </div>
      </div>

      {set.ability && (
        <p className="text-[11px] text-poke-text-secondary mb-1">
          {t.rich('set.ability', {
            ability: localizeAbility(set.ability, dl),
            value: (chunks) => <span className="text-poke-text-primary">{chunks}</span>,
          })}
        </p>
      )}

      {set.tera_type && (
        <div className="flex items-center gap-1 mb-2">
          <span className="text-[10px] text-poke-text-muted">{t('set.tera')}</span>
          <TypeBadge type={set.tera_type} className="!text-[9px] !px-1.5 !py-0" />
        </div>
      )}

      {/* Moves */}
      {set.moves && set.moves.length > 0 && (
        <div className="mb-2">
          {set.moves.filter(Boolean).map((move, i) => (
            <p key={i} className="text-[11px] text-poke-text-secondary">
              - {localizeMove(move, dl)}
            </p>
          ))}
        </div>
      )}

      {/* EVs */}
      {set.evs && Object.values(set.evs).some((v) => v > 0) && (
        <p className="text-[10px] text-poke-text-muted font-mono">
          {formatStatSpread(set.evs, hasEv, dl)}
        </p>
      )}

      {/* Nature + IVs */}
      {set.nature && (
        <p className="text-[10px] text-poke-text-muted">
          {t('set.nature', { nature: localizeNature(set.nature, dl) })}
          {set.ivs && Object.values(set.ivs).some(hasCustomIv) && (
            <> · {t('set.ivs', { spread: formatStatSpread(set.ivs, hasCustomIv, dl) })}</>
          )}
        </p>
      )}
    </div>
  );
}

/** Showdown paste text: always English (it is import/export text). */
function formatShowdownSet(set: PokemonSet): string {
  const lines: string[] = [];
  const name = set.name || set.species;

  // Header: Name (Species) @ Item
  let header = name !== set.species ? `${name} (${set.species})` : set.species;
  if (set.item) header += ` @ ${set.item}`;
  lines.push(header);

  // Ability
  if (set.ability) lines.push(`Ability: ${set.ability}`);

  // Tera Type
  if (set.tera_type) lines.push(`Tera Type: ${set.tera_type}`);

  // Level
  if (set.level && set.level !== 100) lines.push(`Level: ${set.level}`);

  // EVs
  if (set.evs) {
    const evParts = formatStatSpread(set.evs, hasEv, 'en');
    if (evParts) lines.push(`EVs: ${evParts}`);
  }

  // Nature
  if (set.nature) lines.push(`${set.nature} Nature`);

  // IVs
  if (set.ivs) {
    const ivParts = formatStatSpread(set.ivs, hasCustomIv, 'en');
    // i18n-ignore: Showdown paste syntax stays English
    if (ivParts) lines.push(`IVs: ${ivParts}`);
  }

  // Moves
  if (set.moves) {
    for (const move of set.moves) {
      if (move) lines.push(`- ${move}`);
    }
  }

  return lines.join('\n');
}
