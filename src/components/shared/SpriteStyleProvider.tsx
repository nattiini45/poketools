'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  SITE_DEFAULT_SPRITE_STYLE,
  resolveSpriteStyle,
  type SpriteStyle,
  type SpriteStylePreference,
} from '@/lib/pkmn/sprite-styles';

/**
 * The viewer's sprite style (docs/pkmn.md, "Sprite styles").
 *
 * The root layout reads the `plc_sprite_style` cookie on the server
 * (`getSpriteStylePreference`) and passes it as `initialPreference`, so the
 * server render and hydration pick the same URLs (no mismatch). A change made
 * in the settings card or the language/display menu updates this state at once
 * (every `PokemonSprite` re-renders); `POST /api/sprite-style` persists it.
 *
 * Without a provider (unit tests, isolated renders) the hooks return the site
 * default, the same as an anonymous viewer without the cookie.
 */

interface SpriteStyleContextValue {
  preference: SpriteStylePreference;
  style: SpriteStyle;
  setPreference: (preference: SpriteStylePreference) => void;
}

const SpriteStyleContext = createContext<SpriteStyleContextValue | null>(null);

export function SpriteStyleProvider({
  initialPreference,
  children,
}: {
  initialPreference: SpriteStylePreference;
  children: ReactNode;
}) {
  const [preference, setPreference] = useState<SpriteStylePreference>(initialPreference);
  const value = useMemo<SpriteStyleContextValue>(
    () => ({ preference, style: resolveSpriteStyle(preference), setPreference }),
    [preference],
  );
  return <SpriteStyleContext.Provider value={value}>{children}</SpriteStyleContext.Provider>;
}

/** The style sprites render with for this viewer. */
export function useSpriteStyle(): SpriteStyle {
  return useContext(SpriteStyleContext)?.style ?? SITE_DEFAULT_SPRITE_STYLE;
}

/** The stored preference ('site' or a style) and its local setter (no network). */
export function useSpriteStylePreference(): {
  preference: SpriteStylePreference;
  setPreference: (preference: SpriteStylePreference) => void;
} {
  const ctx = useContext(SpriteStyleContext);
  return {
    preference: ctx?.preference ?? 'site',
    setPreference: ctx?.setPreference ?? noop,
  };
}

function noop(): void {}
