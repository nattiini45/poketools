'use client';

import {
  SITE_PALETTES,
  sitePaletteSwatchVar,
  type SitePaletteCoreRole,
  type SitePaletteId,
} from '@/lib/design/site-palettes';
import { useSitePalette } from '@/lib/design/site-palette-store';
import { useMessages } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';

/**
 * Site colour-scheme picker (docs/design.md § Site palettes). The per-device
 * palette for the whole site; league world pages keep their own world
 * palette whatever is picked here.
 *
 * - `PaletteOptions`: the presentational radio group (native radios: arrow
 *   keys move and select, Tab enters at the checked option, screen readers
 *   announce "Plaza, radio button, 1 of 4"). Selecting applies at once.
 * - `PalettePickerSection`: the group in the site menus (the account menu's Appearance, the signed-out
 *   drawer). The account menu is a disclosure inside `#site-nav` (`nav/use-nav-disclosure.ts`), never portalled.
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
  'flex items-center gap-3 rounded-poke-md px-2 py-2 cursor-pointer text-sm text-fg ' +
  'hover:bg-elevated has-[:checked]:bg-accent-subtle ' +
  'has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ' +
  'has-[:focus-visible]:outline-poke-focus';

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
                className="inline-flex h-6 w-6 shrink-0 overflow-hidden rounded-full ring-1 ring-hairline-strong"
              >
                {SWATCH_ROLES.map((role) => (
                  <span key={role} className="flex-1" style={{ background: sitePaletteSwatchVar(meta.id, role) }} />
                ))}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-[550] leading-tight">{words.label}</span>
                <span className="text-xs leading-tight text-fg-muted">{words.description}</span>
              </span>
              <svg
                aria-hidden="true"
                className={checked ? 'h-4 w-4 shrink-0 text-accent-ink' : 'h-4 w-4 shrink-0 invisible'}
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

/** The palette group of the site menus: Appearance in the account menu and in the signed-out drawer. */
export function PalettePickerSection({ name, legendClassName }: { name: string; legendClassName?: string }) {
  const { palette, setPalette } = useSitePalette();
  return <PaletteOptions name={name} legendClassName={legendClassName} value={palette} onSelect={setPalette} />;
}
