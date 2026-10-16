'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Image from 'next/image';
import showdownCatalog from '@/lib/avatar/showdown-trainers.json';
import { useT } from '@/i18n/client';
import { avatarMessages } from '@/i18n/messages/avatar';
import {
  avatarErrorFromBody,
  avatarErrorFromCatch,
  useAvatarErrorText,
  type AvatarError,
} from './avatar-error';

const SHOWDOWN_CDN = 'https://play.pokemonshowdown.com/sprites/trainers';

interface ShowdownSprite {
  id: string;
  label: string;
}

interface ShowdownCategory {
  category: string;
  sprites: ShowdownSprite[];
}

const catalog = showdownCatalog as ShowdownCategory[];

interface ShowdownPickerProps {
  playerId: string;
  /** Awaited before the buttons re-enable, as in AvatarBuilder (no second save racing the page's follow-up). */
  onSaved?: () => void | Promise<void>;
  /**
   * Reports a save's start (true) and end (false), spanning the POST and the awaited onSaved, so
   * AvatarBuilder can keep its mode tabs locked for the whole save, not only its follow-up.
   */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * Showdown trainer sprite picker — browse 1,400+ official trainer sprites
 * organized by generation/game, with search functionality.
 */
const SPRITES_PER_PAGE = 60;

export default function ShowdownPicker({ playerId, onSaved, onBusyChange }: ShowdownPickerProps) {
  const t = useT(avatarMessages);
  const errorText = useAvatarErrorText();
  const [activeCategory, setActiveCategory] = useState(catalog[0]?.category ?? 'Default');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AvatarError | null>(null);
  const [visibleCount, setVisibleCount] = useState(SPRITES_PER_PAGE);
  // Single-flight: claimed synchronously before the POST. `saving` only lands on the next render,
  // so a second click in the same tick would still see it false and start a second POST.
  const savingRef = useRef(false);

  // Search across all categories or filter within current one
  const allSprites = useMemo(() => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const results: ShowdownSprite[] = [];
      for (const cat of catalog) {
        for (const sprite of cat.sprites) {
          if (sprite.label.toLowerCase().includes(q) || sprite.id.toLowerCase().includes(q)) {
            results.push(sprite);
          }
        }
      }
      return results;
    }
    return catalog.find((c) => c.category === activeCategory)?.sprites ?? [];
  }, [search, activeCategory]);

  // Reset pagination when category or search changes
  useEffect(() => {
    setVisibleCount(SPRITES_PER_PAGE);
  }, [search, activeCategory]);

  const visibleSprites = allSprites.slice(0, visibleCount);
  const hasMore = visibleCount < allSprites.length;

  const save = useCallback(async () => {
    if (!selected || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    onBusyChange?.(true);
    setError(null);

    try {
      const spriteUrl = `${SHOWDOWN_CDN}/${selected}.png`;

      const res = await fetch(`/api/players/${playerId}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          showdown_sprite: selected,
          sprite_url: spriteUrl,
        }),
      });

      const result = await res.json();
      if (!result.success) {
        setError(avatarErrorFromBody(result, 'saveFailed'));
        return;
      }

      await onSaved?.();
    } catch (err) {
      setError(avatarErrorFromCatch(err, 'saveFailed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
      onBusyChange?.(false);
    }
  }, [selected, playerId, onSaved, onBusyChange]);

  return (
    <div className="flex flex-col gap-4">
      {/* Search bar */}
      <div className="relative">
        <input
          type="text"
          placeholder={t('showdown.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2 pl-10 text-sm bg-poke-elevated border border-poke-border
                     rounded-poke-lg text-poke-text-primary placeholder:text-poke-text-muted
                     focus:outline-none focus:ring-2 focus:ring-poke-accent/50 focus:border-poke-accent"
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-poke-text-muted"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Category tabs (hidden during search) */}
      {!search.trim() && (
        <div className="flex flex-wrap gap-1">
          {catalog.map((cat) => (
            <button
              key={cat.category}
              onClick={() => setActiveCategory(cat.category)}
              className={`
                px-2.5 py-1 text-xs font-heading font-semibold rounded-poke-md transition-colors
                ${activeCategory === cat.category
                  ? 'bg-poke-accent text-poke-surface'
                  : 'bg-poke-elevated text-poke-text-secondary hover:bg-poke-border'
                }
              `}
            >
              {cat.category}
              <span className="ml-1 opacity-60">({cat.sprites.length})</span>
            </button>
          ))}
        </div>
      )}

      {/* Search result count */}
      {search.trim() && (
        <p className="text-xs text-poke-text-muted">
          {t('showdown.results', { count: allSprites.length, query: search })}
        </p>
      )}

      {/* Sprite count */}
      {!search.trim() && allSprites.length > SPRITES_PER_PAGE && (
        <p className="text-xs text-poke-text-muted">
          {t('showdown.showing', { shown: Math.min(visibleCount, allSprites.length), total: allSprites.length })}
        </p>
      )}

      {/* Sprite grid — auto-fill ensures cells never shrink below 72px */}
      <div
        className="max-h-[480px] overflow-y-auto p-1 -m-1"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: '0.5rem' }}
      >
        {visibleSprites.map((sprite) => (
          <button
            key={sprite.id}
            onClick={() => setSelected(sprite.id)}
            title={sprite.label}
            className={`
              rounded-poke-md border-2 transition-all duration-150
              overflow-hidden flex items-center justify-center bg-poke-surface
              w-full h-[72px]
              ${selected === sprite.id
                ? 'border-poke-accent shadow-poke-sm scale-105 z-10'
                : 'border-transparent hover:border-poke-border hover:scale-102'
              }
            `}
          >
            <Image
              src={`${SHOWDOWN_CDN}/${sprite.id}.png`}
              alt={sprite.label}
              width={80}
              height={80}
              className="w-full h-full object-contain"
              loading="lazy"
              unoptimized
            />
          </button>
        ))}
      </div>

      {/* Load more */}
      {hasMore && (
        <button
          onClick={() => setVisibleCount((c) => c + SPRITES_PER_PAGE)}
          className="mx-auto px-6 py-2 text-sm font-heading font-semibold rounded-poke-md
                   bg-poke-elevated text-poke-text-secondary border border-poke-border
                   hover:bg-poke-border transition-colors"
        >
          {t('showdown.showMore', { count: allSprites.length - visibleCount })}
        </button>
      )}

      {/* Selected preview + save */}
      {selected && (
        <div className="flex items-center gap-4 p-3 bg-poke-elevated rounded-poke-lg border border-poke-border">
          <div className="bg-poke-surface rounded-poke-md p-2 shrink-0">
            <Image
              src={`${SHOWDOWN_CDN}/${selected}.png`}
              alt={t('showdown.selectedAlt')}
              width={80}
              height={80}
              className="w-20 h-20 object-contain"
              unoptimized
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-heading font-bold text-poke-text-primary truncate">
              {catalog.flatMap((c) => c.sprites).find((s) => s.id === selected)?.label ?? selected}
            </p>
            <p className="text-xs text-poke-text-muted">{`${selected}.png`}</p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 text-sm font-heading font-bold rounded-poke-md shrink-0
                     bg-poke-accent text-poke-surface hover:bg-poke-accent/90
                     transition-colors disabled:opacity-50"
          >
            {saving ? t('showdown.saving') : t('showdown.useThis')}
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-poke-danger-ink">{errorText(error)}</p>
      )}
    </div>
  );
}
