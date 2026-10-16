'use client';

import Link from 'next/link';
import { useState } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { FOCUS_RING, PANEL_INSET } from '@/components/world/panel';
import { useDataLocale, useT } from '@/i18n/client';
import { worldClientMessages } from '@/i18n/messages/world/client';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

/**
 * One line of the `?board=roster` list, pre-shaped on the server by the
 * world's overlay builder (EvoligaOverlays / ThemeOverlays) from the SAME
 * rows its roster section and its painted frieze read — no fetch here.
 *
 * Every field is plain JSON so the rows cross the server → client boundary.
 */
export interface RosterListRow {
  id: string;
  /** 1-based roster position (the line number the frieze paints). */
  line: number;
  /** Base species for a point-buy line; ace or trainer name for a fallback tile. */
  name: string;
  /** Raw band key (price group or gym band) — the filter chips group on it. */
  band: string;
  /** The band as the world's boards paint it (`priceBandLabel`, per locale). */
  bandLabel: string;
  /** Point-buy price; null on participant-derived tiles. */
  price: number | null;
  /**
   * Sprite only for point-buy lines: a fallback tile's `name` may be a
   * trainer, never a species (the `RosterSection` discriminator).
   */
  sprite: boolean;
  /**
   * The trainer a participant-derived tile belongs to (its `name` may be the
   * ace species); null on point-buy lines.
   */
  trainer: string | null;
  /** The row's focus link (`?mon=<line id>` or `?team=<player id>`), or null. */
  href: string | null;
}

export interface RosterBandChip {
  band: string;
  label: string;
  count: number;
}

/**
 * The filter chips: one per band present in the rows, ordered as a value
 * ladder — highest price in the band first, bands without prices (gym bands
 * of the participant fallback) after them in first-appearance order. Derived
 * from the data, never from a hand-listed band vocabulary. Pure.
 */
export function rosterBandChips(rows: readonly RosterListRow[]): RosterBandChip[] {
  const chips = new Map<string, RosterBandChip & { top: number; first: number }>();
  rows.forEach((row, index) => {
    const chip = chips.get(row.band);
    if (chip) {
      chip.count += 1;
      if (row.price !== null) chip.top = Math.max(chip.top, row.price);
    } else {
      chips.set(row.band, {
        band: row.band,
        label: row.bandLabel,
        count: 1,
        top: row.price ?? Number.NEGATIVE_INFINITY,
        first: index,
      });
    }
  });
  return [...chips.values()]
    .sort((a, b) => b.top - a.top || a.first - b.first)
    .map(({ band, label, count }) => ({ band, label, count }));
}

/** Rows in the chosen band (all rows for `null`), roster order kept. Pure. */
export function filterRosterRows(
  rows: readonly RosterListRow[],
  band: string | null,
): RosterListRow[] {
  return band === null ? [...rows] : rows.filter((row) => row.band === band);
}

const CHIP =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ' +
  'transition-colors duration-150 motion-reduce:transition-none';

/**
 * Body of the `?board=roster` panel (fidelity wave 2, seat 2D; D15 corollary,
 * reversing the sakura "no panel" ruling): EVERY roster line — sprite, name,
 * price band, points — with band filter chips, each row linking its own
 * focus panel. It is the readable answer to a frieze that no frozen pose can
 * show whole (92 lines on a 12-tile wall), opened from the kiosk / roster
 * walls and the Station Card CTA.
 *
 * Works in both docked shapes ContextOverlay gives it (desktop right rail,
 * ≤ 767 px bottom sheet): the panel body scrolls, rows are full-width tap
 * targets, and every row string — chip counts included — is ≥ 14 px
 * (`text-sm`, no opacity dimming), the acceptance floor for the sidecar's
 * panel font-size check. Names wrap instead of truncating.
 *
 * A row link replaces the query (`?mon=<id>`), so opening a line swaps this
 * panel for the line's — one sheet at a time, never a sheet over a sheet.
 *
 * Honest limit: the filter is local UI state, not a URL param, so a shared
 * link always opens the unfiltered list.
 */
export default function RosterListPanel({ rows }: { rows: RosterListRow[] }) {
  // The copy follows the viewer (i18n D11), in every world.
  const t = useT(worldClientMessages);
  const dataLocale = useDataLocale();
  const [band, setBand] = useState<string | null>(null);
  const chips = rosterBandChips(rows);
  // A band that left the data (a re-render with new rows) falls back to all.
  const active = band !== null && chips.some((chip) => chip.band === band) ? band : null;
  const shown = filterRosterRows(rows, active);
  const lines = rows.some((row) => row.price !== null);
  // A point-buy line's name is a species (the pkmn layer names it); a
  // fallback tile's may be a trainer, so it stays as stored.
  const displayName = (row: RosterListRow) => (row.sprite ? localizeSpecies(row.name, dataLocale) : row.name);

  if (rows.length === 0) {
    return <p className="text-sm text-arena-ink-secondary">{t('rosterList.empty')}</p>;
  }

  const chipClass = (pressed: boolean) =>
    `${CHIP} ${FOCUS_RING} ${
      // Pressed = body ink on the surface pair (the world's own AA text pair,
      // both themes, every world) — never surface-on-accent, which reads
      // 4.1:1 on the plaza's sunlit amber (fid W1 r3: dark ink on chips).
      pressed
        ? 'border-arena-accent bg-arena-ink text-arena-surface'
        : 'border-arena-border bg-arena-surface text-arena-ink hover:border-arena-accent'
    }`;

  return (
    <div className="space-y-3 text-sm" data-roster-panel data-roster-count={rows.length}>
      <p className="text-arena-ink-secondary">{lines
          ? t('rosterList.leadLines', { count: rows.length })
          : t('rosterList.leadTrainers', { count: rows.length })}</p>
      {chips.length > 1 && (
        <div role="group" aria-label={t('rosterList.filterLabel')} className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={active === null}
            onClick={() => setBand(null)}
            className={chipClass(active === null)}
          >
            {t('rosterList.all')}{' '}
            <span className="tabular-nums">{rows.length}</span>
          </button>
          {chips.map((chip) => (
            <button
              key={chip.band}
              type="button"
              aria-pressed={active === chip.band}
              onClick={() => setBand(active === chip.band ? null : chip.band)}
              className={chipClass(active === chip.band)}
            >
              {chip.label}{' '}
              <span className="tabular-nums">{chip.count}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-arena-ink-secondary" aria-live="polite">
        {t(lines ? 'rosterList.shownLines' : 'rosterList.shownTrainers', {
          shown: shown.length,
          total: rows.length,
        })}
      </p>
      <ul className="space-y-1" data-roster-panel-list>
        {shown.map((row) => {
          const body = (
            <>
              <span className="w-7 flex-none text-right font-heading font-bold tabular-nums text-arena-accent-strong">
                {String(row.line).padStart(2, '0')}
              </span>
              {row.sprite ? (
                <PokemonSprite name={row.name} size={32} />
              ) : (
                <span aria-hidden="true" className="h-8 w-8 flex-none" />
              )}
              {/* Names wrap (two lines at 390 for the longest species +
                  trainer), never ellipsis — no dropped words (fid W1 r3). */}
              <span className="min-w-0 flex-1 break-words leading-snug [overflow-wrap:anywhere]">
                <span className="font-semibold text-arena-ink">{displayName(row)}</span>
                {row.trainer !== null && row.trainer !== row.name && (
                  <span className="text-arena-ink-secondary"> · {row.trainer}</span>
                )}
              </span>
              <span className="max-w-[7rem] flex-none text-right leading-snug text-arena-ink-secondary">
                {row.bandLabel}
              </span>
              {row.price !== null && (
                <span className="w-14 flex-none text-right font-semibold tabular-nums text-arena-ink">
                  {t('rosterList.price', { price: row.price })}
                </span>
              )}
            </>
          );
          const rowClass = 'flex min-h-11 items-center gap-2 px-2 py-1.5';
          return (
            <li key={row.id} data-roster-panel-row={row.id} className={PANEL_INSET}>
              {row.href ? (
                <Link
                  href={row.href}
                  scroll={false}
                  aria-label={
                    row.trainer === null
                      ? t('rosterList.openLine', { name: displayName(row) })
                      : t('rosterList.openTeam', { name: row.trainer })
                  }
                  className={`${rowClass} rounded-lg transition-colors duration-150 hover:bg-arena-surface motion-reduce:transition-none ${FOCUS_RING}`}
                >
                  {body}
                </Link>
              ) : (
                <div className={rowClass}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="text-arena-ink-secondary">{t('rosterList.filteredEmpty')}</p>}
    </div>
  );
}
