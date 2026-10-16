'use client';

import { useState, useEffect } from 'react';
import { useDataLocale } from '@/i18n/client';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';

interface ItemSpriteProps {
  /** Canonical English item name; the sprite request stays English, only the aria-label is localized. */
  item: string;
  size?: number;
  className?: string;
}

// Cache sprite coordinates fetched from API
const spriteCache = new Map<string, { top: number; left: number } | null>();

/**
 * Renders a Pokémon item icon using the Showdown spritesheet via @pkmn/img.
 * Coordinates are fetched from /api/pkmn/item-sprite (server-side @pkmn/img).
 */
export default function ItemSprite({ item, size = 24, className = '' }: ItemSpriteProps) {
  const dataLocale = useDataLocale();
  const [fetchedState, setFetchedState] = useState<{
    item: string;
    coords: { top: number; left: number } | null;
    loaded: boolean;
  } | null>(null);
  const cachedCoords = item ? spriteCache.get(item) ?? null : null;
  const coords = item
    ? cachedCoords ?? (fetchedState?.item === item ? fetchedState.coords : null)
    : null;
  const loaded = !item
    ? true
    : spriteCache.has(item) || (fetchedState?.item === item ? fetchedState.loaded : false);

  useEffect(() => {
    if (!item || spriteCache.has(item)) return;

    let cancelled = false;

    fetch(`/api/pkmn/item-sprite?item=${encodeURIComponent(item)}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success && json.data) {
          const data = { top: json.data.top, left: json.data.left };
          spriteCache.set(item, data);
          setFetchedState({ item, coords: data, loaded: true });
        } else {
          spriteCache.set(item, null);
          setFetchedState({ item, coords: null, loaded: true });
        }
      })
      .catch(() => {
        spriteCache.set(item, null);
        if (!cancelled) {
          setFetchedState({ item, coords: null, loaded: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [item]);

  if (!item || (loaded && !coords)) {
    return (
      <span
        className={`inline-block rounded-sm bg-poke-elevated ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }

  if (!loaded) {
    return (
      <span
        className={`inline-block rounded-sm bg-poke-elevated/50 ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }

  const scale = size / 24;

  return (
    <span
      className={`inline-block overflow-hidden ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={localizeItem(item, dataLocale)}
    >
      <span
        style={{
          display: 'block',
          width: 24,
          height: 24,
          imageRendering: 'pixelated',
          background: `transparent url(https://play.pokemonshowdown.com/sprites/itemicons-sheet.png) no-repeat scroll ${coords!.left}px ${coords!.top}px`,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'top left',
        }}
      />
    </span>
  );
}
