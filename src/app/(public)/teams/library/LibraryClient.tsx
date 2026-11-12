'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { GlideGrid, GlideGridItem } from '@/components/discover/GlideGrid';
import PokemonSprite from '@/components/shared/PokemonSprite';
import PageContainer from '@/components/ui/PageContainer';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ItemIcon from '@/components/ui/ItemIcon';
import Skeleton from '@/components/ui/Skeleton';
import SkewChip from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import type { TeamLibraryEntry } from '@/types/team';
import { useFormatter, useT } from '@/i18n/client';
import { teamsLibraryMessages } from '@/i18n/messages/teams-library';

/** ↑ ↑ ↓ ↓ — cycles a local-only "shiny sort" of the loaded grid. No fetch. */
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown'];
const SORT_MODES = ['latest', 'nameAsc', 'nameDesc'] as const;

/**
 * Library page — public grid of published teams.
 * Supports search, tag filtering, and pagination.
 */

export default function LibraryClient() {
  const t = useT(teamsLibraryMessages);
  const [entries, setEntries] = useState<TeamLibraryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 30;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await fetch(`/api/teams/library?${params}`);
      const json = await res.json();
      if (json.success) {
        setEntries(json.data);
        setTotal(json.total);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, offset]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const hasMore = offset + limit < total;

  // Konami-style easter egg: the sequence cycles a client-side sort of the
  // entries already on screen. Purely cosmetic, zero network.
  useEffect(() => {
    let progress = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === KONAMI[progress]) {
        progress += 1;
        if (progress === KONAMI.length) {
          progress = 0;
          setSortMode((m) => (m + 1) % SORT_MODES.length);
        }
      } else {
        progress = e.key === KONAMI[0] ? 1 : 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const displayed = useMemo(() => {
    if (sortMode === 0) return entries;
    const key = (e: TeamLibraryEntry) =>
      e.library_title ?? e.pokemon[0]?.species ?? e.id;
    const sorted = [...entries].sort((a, b) => key(a).localeCompare(key(b)));
    return sortMode === 2 ? sorted.reverse() : sorted;
  }, [entries, sortMode]);

  return (
    <PageContainer maxWidth="lg" title={t('library.title')} subtitle={t('library.subtitle')} icon="choice-scarf">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-md">
          <Input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            placeholder={t('library.searchPlaceholder')}
            aria-label={t('library.searchPlaceholder')}
          />
        </div>
        {sortMode > 0 && (
          <Badge variant="accent" size="sm">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            {t('library.shinySort', { mode: t(`library.sortModes.${SORT_MODES[sortMode]}`) })}
          </Badge>
        )}
      </div>

      {loading && entries.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label={t('library.loading')}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-52 w-full" rounded="lg" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-poke-lg border border-hairline bg-surface px-6 py-12 text-center">
          <ItemIcon item="poke-doll" size={96} />
          <h2 className="font-heading text-title text-fg">
            {debouncedSearch ? t('library.emptySearch') : t('library.empty')}
          </h2>
          <p className="max-w-md text-body text-fg-muted">
            {debouncedSearch ? t('library.emptySearchHint') : t('library.emptyHint')}
          </p>
          {debouncedSearch ? (
            <Button type="button" variant="secondary" className="mt-2 max-sm:h-11" onClick={() => setSearch('')}>
              {t('library.clearSearch')}
            </Button>
          ) : (
            <Link href="/teambuilder" className="mt-2 inline-flex min-h-11 items-center">
              <SkewPlate variant="button">{t('library.openTeambuilder')}</SkewPlate>
            </Link>
          )}
        </div>
      ) : (
        <>
          <GlideGrid className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayed.map((entry, index) => (
              <GlideGridItem key={entry.id} index={index}>
                <LibraryCard entry={entry} />
              </GlideGridItem>
            ))}
          </GlideGrid>

          <div className={total > limit ? 'flex items-center justify-between gap-3' : 'flex justify-center'}>
            {total > limit && (
              <Button
                type="button"
                variant="secondary"
                className="max-sm:h-11"
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
              >
                {t('library.previous')}
              </Button>
            )}
            <span className="text-caption tabular-nums text-fg-muted">
              {t('library.range', { from: offset + 1, to: Math.min(offset + limit, total), total })}
            </span>
            {total > limit && (
              <Button
                type="button"
                variant="secondary"
                className="max-sm:h-11"
                onClick={() => setOffset(offset + limit)}
                disabled={!hasMore}
              >
                {t('library.next')}
              </Button>
            )}
          </div>
        </>
      )}
    </PageContainer>
  );
}

function LibraryCard({ entry }: { entry: TeamLibraryEntry }) {
  const t = useT(teamsLibraryMessages);
  const formatter = useFormatter();
  const pokemon = entry.pokemon.filter((p) => p.species);
  const speciesList = pokemon.slice(0, 6).map((p) => p.species);

  return (
    <Link
      href={`/teams/library/${entry.id}`}
      className="flex h-full flex-col rounded-poke-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
    >
      <div className="grid grid-cols-6 justify-items-center gap-1 rounded-t-[inherit] bg-sunken px-3 py-3">
        {speciesList.map((species, i) => (
          <PokemonSprite key={i} name={species} size={48} />
        ))}
      </div>

      <div className="flex flex-1 flex-col gap-2 px-4 py-3">
        <h2 className="truncate font-heading text-title text-fg">
          {entry.library_title || t('library.untitled')}
        </h2>

        {entry.library_description && (
          <p className="line-clamp-2 text-caption text-fg-muted">
            {entry.library_description}
          </p>
        )}

        {entry.library_tags && entry.library_tags.length > 0 && (
          <div className="flex flex-wrap gap-x-2.5 gap-y-1.5 pl-0.5">
            {entry.library_tags.map((tag) => (
              <SkewChip key={tag}>{tag}</SkewChip>
            ))}
          </div>
        )}

        <p className="mt-auto pt-1 text-micro text-fg-muted">
          {t('library.published', { date: formatter.instant(entry.library_published_at, 'date') })}
        </p>
      </div>
    </Link>
  );
}
