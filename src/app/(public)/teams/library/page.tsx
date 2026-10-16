'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import PokemonSprite from '@/components/shared/PokemonSprite';
import PageContainer from '@/components/ui/PageContainer';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
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

export default function LibraryPage() {
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
    <PageContainer maxWidth="lg" title={t('library.title')} subtitle={t('library.subtitle')}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-md">
          <Input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            placeholder={t('library.searchPlaceholder')}
          />
        </div>
        {sortMode > 0 && (
          <Badge variant="accent" size="sm">
            {t('library.shinySort', { mode: t(`library.sortModes.${SORT_MODES[sortMode]}`) })}
          </Badge>
        )}
      </div>

      {loading && entries.length === 0 ? (
        <p className="text-sm text-poke-text-muted py-8 text-center">{t('library.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-poke-text-muted py-8 text-center">
          {t('library.empty')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayed.map((entry) => (
              <LibraryCard key={entry.id} entry={entry} />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-6">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="px-4 py-2 text-sm border border-poke-border rounded-poke-md disabled:opacity-40 hover:bg-poke-surface transition-colors"
            >
              {t('library.previous')}
            </button>
            <span className="text-xs text-poke-text-muted">
              {t('library.range', { from: offset + 1, to: Math.min(offset + limit, total), total })}
            </span>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={!hasMore}
              className="px-4 py-2 text-sm border border-poke-border rounded-poke-md disabled:opacity-40 hover:bg-poke-surface transition-colors"
            >
              {t('library.next')}
            </button>
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
      className="block border border-poke-border rounded-poke-md p-4 bg-poke-surface hover:border-poke-blue/40 transition-colors"
    >
      {/* Title */}
      <h2 className="font-heading font-semibold text-sm text-poke-text-primary mb-1 truncate">
        {entry.library_title || t('library.untitled')}
      </h2>

      {/* Description */}
      {entry.library_description && (
        <p className="text-xs text-poke-text-muted mb-3 line-clamp-2">
          {entry.library_description}
        </p>
      )}

      {/* Sprite row */}
      <div className="flex gap-1 mb-2">
        {speciesList.map((species, i) => (
          <PokemonSprite key={i} name={species} size={32} />
        ))}
        {speciesList.length < 6 && Array.from({ length: 6 - speciesList.length }).map((_, i) => (
          <div key={`empty-${i}`} className="w-8 h-8" />
        ))}
      </div>

      {/* Tags */}
      {entry.library_tags && entry.library_tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.library_tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 bg-poke-muted rounded text-poke-text-secondary"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Date */}
      <p className="text-[10px] text-poke-text-muted mt-2">
        {t('library.published', { date: formatter.instant(entry.library_published_at, 'date') })}
      </p>
    </Link>
  );
}