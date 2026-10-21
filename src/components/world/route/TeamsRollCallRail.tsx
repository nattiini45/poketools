'use client';

import Link from 'next/link';
import { typeColors } from '@/lib/design/tokens';
import type { TeamChip } from '@/lib/route-world/station-digest';

/**
 * Fidelity wave 2 (2B; D16 at 390): the Teams Station Card's digest slot as a
 * roll-call rail — one chip per trainer, in STANDINGS order (the ledger's
 * order), each a real link to that trainer's panel (`?team=<id>`), which
 * FocusUrlSync turns into a camera blend to the pedestal. The rail scrolls
 * sideways; names are never smaller than 14 px (`text-sm`) and each chip is a
 * 44 px tap target.
 *
 * The gym-band dot takes the participant's own `gym_type` through the shared
 * type palette (`typeColors`, matched case-insensitively); a trainer without a
 * band gets a neutral dot. No type is named in logic here — the dot colour is
 * a lookup of the data's own string.
 *
 * DOM only; 0 draw calls.
 */

const BAND_COLOR = new Map(Object.entries(typeColors).map(([type, color]) => [type.toLowerCase(), color.bg]));

function bandColor(gymType: string | null): string | null {
  return gymType ? (BAND_COLOR.get(gymType.toLowerCase()) ?? null) : null;
}

interface TeamsRollCallRailProps {
  chips: readonly TeamChip[];
  /** The chip's panel link (the card merges it into the current query). */
  hrefFor: (chip: TeamChip) => string;
  /** Accessible name of the rail (theme language). */
  label: string;
}

export default function TeamsRollCallRail({ chips, hrefFor, label }: TeamsRollCallRailProps) {
  return (
    <ul aria-label={label} data-roll-call-rail="" className="world-roll-call-rail">
      {chips.map((chip) => {
        const color = bandColor(chip.gymType);
        return (
          <li key={chip.id}>
            <Link href={hrefFor(chip)} scroll={false} data-roll-call-chip={chip.id} className="world-roll-call-chip">
              <span
                aria-hidden="true"
                className="world-roll-call-dot"
                style={color ? { background: color } : undefined}
                data-band={chip.gymType ?? 'none'}
              />
              {chip.rank !== null ? <span className="world-roll-call-rank">{chip.rank}.</span> : null}
              <span className="world-roll-call-name">{chip.name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
