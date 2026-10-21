'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { FOCUS_RING } from '@/components/ui/panel';
import {
  SITE_PALETTES,
  sitePaletteSwatchVar,
  type SitePaletteCoreRole,
  type SitePaletteId,
} from '@/lib/design/site-palettes';
import { clearInvalidStoredSitePalette, useSitePalette } from '@/lib/design/site-palette-store';
import { useMessages, useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';

/**
 * Site colour-scheme picker (docs/design.md § Site palettes). The per-device
 * palette for the whole site; league world pages keep their own world
 * palette whatever is picked here.
 *
 * - `PaletteOptions`: the presentational radio group (native radios: arrow
 *   keys move and select, Tab enters at the checked option, screen readers
 *   announce "Plaza, radio button, 1 of 4"). Selecting applies at once.
 * - `PalettePicker` (default): the desktop NavBar disclosure, next to the
 *   light/dark toggle. Not portalled and not a Radix Popover: the panel must
 *   stay a DOM descendant of `#site-nav`, so the D33 reveal over the 3D world
 *   keeps the bar open while the pointer or focus is in the panel, and the
 *   nav's `backdrop-filter` would break a fixed-position popper anyway.
 * - `PalettePickerSection`: the inline group in the mobile drawer.
 *
 * Theme tokens only (no dark slab): the swatches read the palette cores
 * through `var(--palette-<id>-<role>)`, so they show each palette in the
 * current light/dark mode with no hex and no mode logic here.
 *
 * Words come from `ui.palette` in the viewer's language, keyed by palette id;
 * `SITE_PALETTES` carries only ids and world keys, no display labels.
 */

const SWATCH_ROLES: readonly SitePaletteCoreRole[] = ['ground', 'surface', 'accent'];

const ROW =
  'flex items-center gap-3 rounded-poke-md px-2 py-2 cursor-pointer text-sm text-poke-text-primary ' +
  'hover:bg-poke-elevated has-[:checked]:bg-poke-accent-light ' +
  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ' +
  'has-[:focus-visible]:outline-poke-focus';

const LEGEND_PANEL =
  'px-2 pb-1 text-xs font-heading font-semibold uppercase tracking-wide text-poke-text-secondary';
const LEGEND_DRAWER =
  'pb-2 text-xs font-heading font-semibold uppercase tracking-wide text-poke-text-secondary';

export function PaletteOptions({
  value,
  onSelect,
  name,
  legendClassName,
}: {
  /** null before hydration: nothing is checked. */
  value: SitePaletteId | null;
  onSelect: (id: SitePaletteId) => void;
  /** Radio group name; unique per mounted instance (two groups never merge). */
  name: string;
  legendClassName?: string;
}) {
  const copy = useMessages(uiMessages).palette;
  return (
    <fieldset className="min-w-0">
      <legend className={legendClassName}>{copy.legend}</legend>
      <div className="space-y-1">
        {SITE_PALETTES.map((meta) => {
          const checked = value === meta.id;
          const words = copy.options[meta.id];
          return (
            <label key={meta.id} className={ROW}>
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={meta.id}
                checked={checked}
                onChange={() => onSelect(meta.id)}
              />
              <span
                aria-hidden="true"
                className="inline-flex h-6 w-6 shrink-0 overflow-hidden rounded-full ring-1 ring-poke-border-strong"
              >
                {SWATCH_ROLES.map((role) => (
                  <span key={role} className="flex-1" style={{ background: sitePaletteSwatchVar(meta.id, role) }} />
                ))}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-heading font-semibold leading-tight">{words.label}</span>
                <span className="text-xs leading-tight text-poke-text-secondary">{words.description}</span>
              </span>
              <svg
                aria-hidden="true"
                className={checked ? 'h-4 w-4 shrink-0 text-poke-accent-strong' : 'h-4 w-4 shrink-0 invisible'}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The desktop NavBar disclosure (hidden below `md`; the drawer has the section). */
export default function PalettePicker() {
  const { palette, setPalette } = useSitePalette();
  const t = useT(uiMessages);
  const copy = useMessages(uiMessages).palette;
  // The panel belongs to the page it was opened on: the open state records
  // that pathname, so a soft navigation (back/forward, a router push from
  // elsewhere) closes it with no effect and no event. An object, so a null
  // pathname (no App Router context, the tests) still opens. The first render on
  // another pathname also drops the record (React's reset-state-during-render
  // pattern), so a Back/Forward round trip to the page never re-opens the panel
  // or moves focus into it.
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<{ path: string | null } | null>(null);
  if (openOn !== null && openOn.path !== pathname) setOpenOn(null);
  const open = openOn !== null && openOn.path === pathname;
  const setOpen = (next: boolean) => setOpenOn(next ? { path: pathname } : null);
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // One cleanup of hand-edited / retired stored values. Side effect only, no setState.
  useEffect(() => {
    clearInvalidStoredSitePalette();
  }, []);

  // Opening moves focus to the checked radio (or the first one).
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const target =
      panel.querySelector<HTMLInputElement>('input[type="radio"]:checked') ??
      panel.querySelector<HTMLInputElement>('input[type="radio"]');
    target?.focus();
  }, [open]);

  // Close paths, attached only while open; setState happens inside the listeners.
  useEffect(() => {
    if (!open) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const closeToTrigger = () => {
      setOpenOn(null);
      triggerRef.current?.focus();
    };
    // Native listener on the wrapper, not React's onKeyDown: the App Router's
    // React root is `document`, the same node RouteNavReveal listens on. The
    // Escape that closes this panel must stop here, or it would also close the
    // revealed bar over the 3D world and move focus out of the nav (D33).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeToTrigger();
        return;
      }
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type === 'radio') {
        event.preventDefault();
        closeToTrigger();
      }
    };
    // Tab out of the panel closes it without moving focus. A null
    // relatedTarget (a press on non-focusable panel space) is not "out".
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !wrapper.contains(next)) setOpenOn(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapper.contains(event.target)) return;
      setOpenOn(null);
    };
    wrapper.addEventListener('keydown', onKeyDown);
    wrapper.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      wrapper.removeEventListener('keydown', onKeyDown);
      wrapper.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  const label = palette ? t('palette.triggerWithPalette', { palette: copy.options[palette].label }) : copy.legend;

  return (
    <div ref={wrapperRef} className="relative hidden md:block">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={() => setOpen(!open)}
        className={`p-2 rounded-poke-md text-poke-text-secondary hover:bg-poke-elevated hover:text-poke-text-primary transition-colors ${FOCUS_RING}`}
      >
        {/* The applied palette's ground and accent, straight from CSS: right before hydration too. */}
        <span aria-hidden="true" className="flex h-5 w-5 overflow-hidden rounded-full ring-1 ring-poke-border-strong">
          <span className="flex-1 bg-poke-base" />
          <span className="flex-1 bg-poke-accent" />
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          ref={panelRef}
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-poke-lg border border-poke-border bg-poke-surface p-2 shadow-poke-lg"
        >
          <PaletteOptions name="site-palette" legendClassName={LEGEND_PANEL} value={palette} onSelect={setPalette} />
        </div>
      )}
    </div>
  );
}

/** The mobile drawer's inline palette group (inside the drawer's scroll region). */
export function PalettePickerSection() {
  const { palette, setPalette } = useSitePalette();
  return (
    <div className="px-4 py-3 border-t border-poke-border">
      <PaletteOptions
        name="site-palette-mobile"
        legendClassName={LEGEND_DRAWER}
        value={palette}
        onSelect={setPalette}
      />
    </div>
  );
}
