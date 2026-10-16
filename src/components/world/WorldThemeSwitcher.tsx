'use client';

import { Globe } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { getRegisteredRouteThemeIds, WORLD_OVERRIDE_URL_PARAM } from '@/lib/worlds/registry';
import { useT } from '@/i18n/client';
import { worldClientMessages } from '@/i18n/messages/world/client';

interface WorldThemeSwitcherProps {
  /** Per-tier styling, supplied by WorldNav (HUD chip vs lite-bar link). */
  className?: string;
}

/** Theme ids are proper names (Plaza, Sakura …); only 'auto' is a word to translate. */
function themeName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * The viewer's 3D-world override pill: cycles Auto + the REGISTERED route
 * themes (derived from the world registry — never the DB CHECK list, so the
 * options grow automatically as theme packages land).
 *
 * A pick does two things: it persists the preference, and it navigates so the
 * SERVER re-resolves the world. The server is the only place the scene root,
 * the shell's token namespace, the station manifest, the DOM sections and the
 * palette can be chosen together — applying the override client-side alone
 * would repaint one theme's palette and camera over another theme's furniture
 * and sections. The replace is same-document and preserves every other query
 * param (`?team=`, `?mon=`) plus the hash anchor.
 *
 * The label and the cycle position both name the world that is actually
 * RENDERED (`theme`, resolved server-side), never the persisted pick: the
 * override store is null through SSR and the first paint, disagrees
 * permanently on route-preview (its probe theme is passed directly), and
 * cycling from it would re-pick the theme already on screen. A DOM-only world
 * has no theme and reads as 'Auto'.
 */
export default function WorldThemeSwitcher({ className = '' }: WorldThemeSwitcherProps) {
  const { theme, setRouteThemeOverride } = useWorldState();
  const router = useRouter();
  const t = useT(worldClientMessages);
  const labelFor = (id: string) => (id === 'auto' ? t('themeSwitcher.auto') : themeName(id));
  // ['auto', ...registered] — with one registered theme this cycles Auto ⇄ it.
  const order = ['auto', ...getRegisteredRouteThemeIds()];
  const current = theme?.id ?? 'auto';
  const index = Math.max(0, order.indexOf(current));

  return (
    <button
      type="button"
      className={className}
      title={t('themeSwitcher.title', { world: labelFor(current) })}
      aria-label={t('themeSwitcher.ariaLabel', { world: labelFor(current) })}
      onClick={() => {
        const next = order[(index + 1) % order.length];
        setRouteThemeOverride(next === 'auto' ? null : next);

        const url = new URL(window.location.href);
        if (next === 'auto') url.searchParams.delete(WORLD_OVERRIDE_URL_PARAM);
        else url.searchParams.set(WORLD_OVERRIDE_URL_PARAM, next);
        router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
      }}
    >
      <Globe aria-hidden="true" className="h-3.5 w-3.5" />
      <span>{labelFor(current)}</span>
    </button>
  );
}
