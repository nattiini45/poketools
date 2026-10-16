/**
 * Theme figure contract (C-100 criterion 1) — the pure planner half.
 *
 * A theme declares WHAT should stand in its world; the engine's shared
 * figure pipeline (KTX2 arm + preload queue in `figure-loader.ts`, fitted
 * clones + manifest clips in `Figure.tsx`, species fallback chain in
 * `FigureIndex`) decides HOW. Two declaration sources, per the bar:
 *
 *  - `roster` — roster-driven, the plaza StatueRow pattern: one entry per
 *    participant, resolved through the manifest's `resolve` chain (current
 *    form first, then base species).
 *  - `pool` — pool-driven: an arbitrary species list ("many different
 *    pools" ruling), each resolved by exact species / cosmetic alias /
 *    regional file / base species.
 *
 * Height handling comes from the manifest itself (`figureHeightM` over the
 * entry's recorded bounds): aces above `COLOSSAL_M` stand on the ground
 * beside their slot furniture, aces below `TINY_M` get a pedestal insert —
 * the same thresholds StatueRow authored (COLOSSAL_M 2.5 / TINY_M 0.5),
 * restated here as engine-level defaults the shared mounter applies.
 *
 * Pure data + pure functions — no client-only imports, unit-testable in
 * node. The React mounter lives at
 * `src/components/world/route/figures/ThemeFigures.tsx`.
 */

import {
  figureHeightM,
  figureUrl,
  type FigureEntry,
  type FigureIndex,
} from './model-manifest';

/** Aces at or above this height stand on the ground behind their furniture. */
export const COLOSSAL_M = 2.5;
/** Aces below this height get a pedestal insert so their eye-line rises. */
export const TINY_M = 0.5;

/** One roster-driven declaration: a participant's ace line. */
export interface ThemeFigureRosterEntry {
  /** Stable key for React reconciliation (the participant id in practice). */
  id: string;
  /** Display label the mounter may put on furniture (player name in practice). */
  label: string;
  /** Current form to resolve first (the tracker's `current_form`). */
  species: string | null;
  /** Base species to fall back to (the tracker's `base_pokemon`). */
  baseSpecies?: string | null;
}

/** What a theme declares: either source, both, or neither. */
export interface ThemeFigurePlan {
  /** Per-player aces, resolved through the roster chain. */
  roster?: readonly ThemeFigureRosterEntry[];
  /** Arbitrary species set, resolved by species name. */
  pool?: readonly string[];
}

/** How a planned figure stands: ground-level (colossal), pedestal (tiny), or as-declared. */
export type FigureStance = 'colossal' | 'standard' | 'tiny';

/** One planned figure, ready for the shared mounter. */
export interface PlannedFigure {
  /** Declaration key (roster id; the species for pool entries, later repeats suffixed `#n`). */
  key: string;
  /** Display label from the declaration (`key` for pool entries). */
  label: string;
  /** The species string as declared (for billboard fallbacks). */
  species: string;
  /** Manifest entry, or `null` when the line has no model (billboard). */
  entry: FigureEntry | null;
  /** Pokédex height the figure will stand at; `0` when unresolved. */
  heightM: number;
  /** Colossal/tiny handling derived from the manifest bounds. */
  stance: FigureStance;
}

/** Stance from the manifest-recorded height — the colossal/tiny rule. */
function stanceFor(heightM: number): FigureStance {
  if (heightM >= COLOSSAL_M) return 'colossal';
  if (heightM < TINY_M) return 'tiny';
  return 'standard';
}

function planned(key: string, label: string, species: string, entry: FigureEntry | null): PlannedFigure {
  const heightM = entry ? figureHeightM(entry) : 0;
  return { key, label, species, entry, heightM, stance: entry ? stanceFor(heightM) : 'standard' };
}

/**
 * Resolve a theme's figure declaration against the manifest index.
 * Roster entries come first (in declaration order), then pool entries.
 * Unresolvable species yield `entry: null` — the mounter renders the
 * billboard fallback for them, exactly like the plaza row does.
 */
export function planThemeFigures(index: FigureIndex, plan: ThemeFigurePlan): PlannedFigure[] {
  const out: PlannedFigure[] = [];
  for (const slot of plan.roster ?? []) {
    out.push(planned(slot.id, slot.label, slot.species ?? slot.baseSpecies ?? '', index.resolve(slot.species, slot.baseSpecies ?? null)));
  }
  // A pool may legitimately repeat a species (the clouds float row rides
  // more slots than its front tiny pool holds), and the mounter keys its
  // children by this key — later occurrences get an occurrence suffix so
  // React identity stays unique. Labels keep the bare species.
  const poolSeen = new Map<string, number>();
  for (const species of plan.pool ?? []) {
    const seen = poolSeen.get(species) ?? 0;
    poolSeen.set(species, seen + 1);
    const key = seen === 0 ? species : `${species}#${seen}`;
    out.push(planned(key, species, species, index.find(species)));
  }
  return out;
}

/**
 * Every GLB URL the plan will need, deduped in plan order — the set the
 * mounter kicks through `preloadFigure` in one effect (PB-100: without the
 * collective kick, figures start fetching only when their Suspense boundary
 * commits and a row streams in one at a time).
 */
export function themeFigureLoadSet(figures: readonly PlannedFigure[]): string[] {
  const urls: string[] = [];
  for (const figure of figures) {
    if (!figure.entry) continue;
    const url = figureUrl(figure.entry);
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}
