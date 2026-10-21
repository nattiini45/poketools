'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import type { TeamLibraryEntry, PokemonSet } from '@/types/team';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { teamsLibraryMessages } from '@/i18n/messages/teams-library';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsTeams } from '@/i18n/messages/errors/teams';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeNature } from '@/lib/pkmn/i18n/names/misc';
import { formatStatSpread, hasEv } from '../../stat-spread';

/**
 * Public library entry page — read-only view of a published team.
 * Supports forking (if logged in).
 */

export default function LibraryEntryPage() {
  const params = useParams<{ id: string }>();
  const formatter = useFormatter();
  const router = useRouter();
  const t = useT(teamsLibraryMessages);
  const errorText = useApiErrorText(errorsTeams);
  const [entry, setEntry] = useState<TeamLibraryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [forking, setForking] = useState(false);

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;

    // Fetch via library API (the library listing returns entries with their ID)
    // For individual entry, fetch from shared endpoint or direct lookup
    fetch(`/api/teams/library/${params.id}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) {
          setError(toApiErrorLike(json));
          return;
        }
        setEntry(json.team);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toApiErrorLike(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [params.id]);

  const handleFork = useCallback(async () => {
    if (!entry) return;
    setForking(true);
    try {
      const res = await fetch('/api/teams/library/fork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTeamId: entry.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fork');
      router.push('/teambuilder');
    } catch {
      // silent — user might not be logged in
    } finally {
      setForking(false);
    }
  }, [entry, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-sm text-poke-text-muted">{t('entry.loading')}</p>
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h1 className="text-lg font-heading font-bold text-poke-text-primary mb-2">
            {t('entry.notFound')}
          </h1>
          <p className="text-sm text-poke-text-muted">
            {error
              ? error.error || error.code
                ? errorText(error)
                : t('entry.loadFailed')
              : t('entry.unpublished')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-poke-text-primary mb-1">
          {entry.library_title || t('library.untitled')}
        </h1>
        {entry.library_description && (
          <p className="text-sm text-poke-text-muted mb-3">{entry.library_description}</p>
        )}
        <div className="flex items-center gap-3">
          {entry.library_tags?.map((tag) => (
            <span key={tag} className="text-[10px] px-2 py-0.5 bg-poke-muted rounded text-poke-text-secondary">
              {tag}
            </span>
          ))}
          <span className="text-[10px] text-poke-text-muted ml-auto">
            {t('library.published', { date: formatter.instant(entry.library_published_at, 'date') })}
          </span>
        </div>
      </div>

      {/* Fork button */}
      <div className="mb-6">
        <button
          onClick={handleFork}
          disabled={forking}
          className="px-4 py-2 text-sm font-medium bg-poke-blue text-poke-on-blue rounded-poke-md hover:bg-poke-blue/80 transition-colors disabled:opacity-50"
        >
          {forking ? t('entry.forking') : t('entry.fork')}
        </button>
      </div>

      {/* Team grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {entry.pokemon.map((set, i) => (
          <LibraryTeamCard key={i} set={set} index={i} />
        ))}
      </div>
    </div>
  );
}

function LibraryTeamCard({ set, index }: { set: PokemonSet; index: number }) {
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
    <div className="border border-poke-border rounded-poke-md p-4 bg-poke-surface">
      <div className="flex items-center gap-3 mb-3">
        <PokemonSprite name={set.species} size={48} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{set.name || localizeSpecies(set.species, dl)}</p>
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

      {set.moves?.filter(Boolean).map((move, i) => (
        <p key={i} className="text-[11px] text-poke-text-secondary">- {localizeMove(move, dl)}</p>
      ))}

      {set.evs && Object.values(set.evs).some((v) => v > 0) && (
        <p className="text-[10px] text-poke-text-muted font-mono mt-2">
          {formatStatSpread(set.evs, hasEv, dl)}
        </p>
      )}

      {set.nature && (
        <p className="text-[10px] text-poke-text-muted">
          {t('set.nature', { nature: localizeNature(set.nature, dl) })}
        </p>
      )}
    </div>
  );
}
