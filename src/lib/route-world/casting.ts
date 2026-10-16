/**
 * Manifest casting for world figures (D35 Pokémon core round, 3B).
 *
 * Contract freeze (A1 → fan-out): `ClipName`, `CastRole`, `CastNeeds`,
 * `CastSlot`, `CastPick` and `CastResult` are the frozen design types;
 * changing one needs the lead. SEAT B filled in the functions per
 * the Pokémon core plan (maintainer notes), SEAT B step 2 (reader 2 §6.2).
 *
 * D18 / AGENTS.md: casting is a manifest query. No species, type or stat
 * literals live here; slots name habitats, roles, sizes and clip needs only,
 * and types are read through `habitatAccepts` (habitat-types.ts).
 * D23: the cast is computed once before reveal and latched for the session
 * (the caller freezes it, the `usePopulationCeiling(…, false)` precedent);
 * never recast after reveal — that would fetch.
 *
 * Rules (pinned by `__tests__/casting.test.ts`):
 *  - World-level batch (L3): slots are assigned in order of explicit
 *    `priority` (lower first), then scarcity (fewest available candidates),
 *    then id; each takes its best-ranked candidate whose dexId is not yet
 *    used in this world. Uniqueness is by dexId (so every form of a dex
 *    number). `family` is recorded but grants nothing extra yet: the
 *    manifest carries no evolution-line data, so line-sharing slots are
 *    dexId-unique like every other slot (disclosed).
 *  - Ranking is rendezvous hashing, `hash01(mix32(seed, hashText(slot.id)),
 *    hashText(entry.file))`, under a clip-tier preference (more `prefer`
 *    clips first). Removing one manifest entry moves only the slots it topped.
 *  - Movers (`walker`, `wader`) always require `walk`; a `lane-flyer` never
 *    requires it (`castSlotProblems`). Clip-less figures qualify only with
 *    `needs.allowClipless` (floaters, sitters, guardians: the disclosed D7
 *    low-motion fallback).
 *  - Filters: habitat, clips, the slot's height band on `figureHeightM`, the
 *    slot's width cap on the SCALED horizontal extent, `boundsSane`, the
 *    budget (`DEFAULT_CAST_BUDGET` 1300 kB / 40 k triangles) and the
 *    exclusions (live roster aces by dexId, plus `CAST_DEFECT_FILES`, which
 *    is always merged). `rank` counts entries passed over for exclusion,
 *    budget or uniqueness.
 *  - Fail closed: a manifest older than v3, or one with no type data at all,
 *    gives every slot `{ entry: null, reason: 'no-type-data' }`. It NEVER
 *    falls back to literals.
 *  - `fallback: 'relax-clips'` retries an empty slot once with `needs.require`
 *    dropped and clip-less figures allowed (a mover keeps its own `walk`);
 *    the pick reports `relaxed: true`. The retries run as a SECOND pass,
 *    after every slot's strict pick (R35), so a relaxed slot never takes an
 *    entry a strict slot could have filled. Scarcity order counts the strict
 *    wishlist only.
 *  - Empty reasons (R35): `excluded-all` means roster aces only, i.e. viable
 *    candidates existed and every one was an ace (dexId exclusion). A slot
 *    emptied only by asset defects (`CAST_DEFECT_FILES`, caller file
 *    exclusions), the budget, world uniqueness or no shape match reports
 *    `no-candidate`. `no-type-data` is the v2 / untyped manifest case above.
 */
import { CAST_DEFECT_FILES } from './cast-defects';
import { hash01, hashText, mix32 } from './clip-phase';
import type { KeepOutBox, WorldId } from './data-surfaces';
import { habitatAccepts, hasTypeData, type HabitatId } from './habitat-types';
import {
  castKbOf,
  figureHeightM,
  figureScale,
  figureUrl,
  type FigureEntry,
  type FigureIndex,
  type WorldManifest,
} from './model-manifest';

/** The clip vocabulary the world GLBs ship. */
export type ClipName = 'idle' | 'idle2' | 'walk' | 'run';

export type CastRole =
  | 'floater'
  | 'wader'
  | 'surfacer'
  | 'sitter'
  | 'loiterer'
  | 'walker'
  | 'lane-flyer'
  | 'hover'
  | 'rider'
  | 'guardian';

export interface CastNeeds {
  /** Every one of these clips must exist (movers need `walk`; a lane flyer never uses it). */
  require?: readonly ClipName[];
  /** Ranked preference among the survivors (full set > idle > clip-less). */
  prefer?: readonly ClipName[];
  /** Clip-less figures allowed (floaters, sitters, guardians: the disclosed low-motion fallback, D7). */
  allowClipless?: boolean;
}

export interface CastSlot {
  /** Stable, species-free id `<world>:<group>:<n>`: seeds, allowlist keys and snapshot keys. */
  id: string;
  world: WorldId;
  habitat: HabitatId;
  role: CastRole;
  /** Station window for dormancy and visibility (not a mount gate, D23). */
  station: number;
  /** Pokédex-scaled height band (figureHeightM), metres. */
  height: { min?: number; max: number };
  /** Horizontal extent cap after figureScale (the keep-out envelope width), metres. */
  maxWidthM: number;
  needs: CastNeeds;
  /** Assignment order, lower first. By default it derives from candidate scarcity. */
  priority?: number;
  /** When nothing qualifies: leave the slot empty (default), or retry once with `needs.require` dropped (disclosed). */
  fallback?: 'empty' | 'relax-clips';
  /** Slots sharing a family key may repeat a dex line, never the same dexId. */
  family?: string;
}

export interface CastPick {
  slotId: string;
  entry: FigureEntry | null;
  /** 0 = first choice; > 0 = fell through (ace taken, uniqueness, budget). */
  rank: number;
  relaxed: boolean;
  reason: null | 'no-candidate' | 'no-type-data' | 'excluded-all';
}

export interface CastResult {
  /** One pick per slot, in slot declaration order. */
  picks: readonly CastPick[];
  /** GLB URLs to kick at load (PB-100), deduped; they feed the residency store before reveal. */
  loadSet: readonly string[];
}

// ── Options, budget, seed ────────────────────────────────────────────────────

export interface CastExclusions {
  /** dexIds of live roster aces: every form of that dex number is excluded. */
  dexIds: ReadonlySet<number>;
  /** Files additionally barred (asset defects by path). `CAST_DEFECT_FILES` is always merged. */
  files?: ReadonlySet<string>;
}

export const NO_CAST_EXCLUSIONS: CastExclusions = { dexIds: new Set<number>() };

export interface CastBudget {
  maxKb: number;
  maxTriangles: number;
}

/** 1300 kB (the ambient cap `AMBIENT_MAX_KB`) and 40 k triangles (the prop bar). */
export const DEFAULT_CAST_BUDGET: CastBudget = { maxKb: 1300, maxTriangles: 40_000 };

export interface CastOptions {
  exclude: CastExclusions;
  budget?: CastBudget;
}

/** Bump deliberately to re-roll every world's cast. */
export const CAST_EPOCH = 'v1';

/**
 * World cast seed (C8 / L4): league plus world plus the epoch, with NO date,
 * so captures stay reproducible across midnight. `?castSeed=` (routeDebug)
 * overrides it at the caller.
 */
export function castSeed(world: WorldId, leagueId: string): number {
  return hashText(`cast|${CAST_EPOCH}|${world}|${leagueId}`);
}

// ── Per-entry filters ────────────────────────────────────────────────────────

/** Raw rest-pose height (model units) under which the bounds are degenerate. */
export const MIN_BOUNDS_HEIGHT_UNITS = 0.02;
/** Largest plausible scaled width / height ratio (a mis-axis export fails it). */
export const MAX_WIDTH_TO_HEIGHT = 4;

/** Horizontal extent (the larger of x and z) after `figureScale`, metres. */
export function scaledWidthM(entry: FigureEntry): number {
  const { min, max } = entry.bounds;
  return Math.max(max[0] - min[0], max[2] - min[2]) * figureScale(entry);
}

/**
 * Cheap insurance against mis-exported bounds: finite, a non-degenerate raw
 * height, and a scaled width that is positive and at most
 * `MAX_WIDTH_TO_HEIGHT` × the scaled height.
 */
export function boundsSane(entry: FigureEntry): boolean {
  const { min, max } = entry.bounds;
  for (let i = 0; i < 3; i += 1) {
    if (!Number.isFinite(min[i]) || !Number.isFinite(max[i]) || max[i] < min[i]) return false;
  }
  if (max[1] - min[1] < MIN_BOUNDS_HEIGHT_UNITS) return false;
  const width = scaledWidthM(entry);
  return width > 0 && width <= MAX_WIDTH_TO_HEIGHT * figureHeightM(entry);
}

/** Does the manifest carry type data casting can use (v3 and at least one typed entry)? */
export function manifestHasTypeData(manifest: WorldManifest): boolean {
  return manifest.version >= 3 && manifest.figures.some(hasTypeData);
}

const MOVER_ROLES: ReadonlySet<CastRole> = new Set<CastRole>(['walker', 'wader']);

/** Structural problems of a slot (empty = valid). `castSlots` throws on any. */
export function castSlotProblems(slot: CastSlot): string[] {
  const out: string[] = [];
  if (!slot.id || slot.id.trim() !== slot.id) out.push('id must be a non-empty trimmed string');
  if (slot.role === 'lane-flyer' && slot.needs.require?.includes('walk')) out.push('a lane-flyer never requires walk');
  if (!(slot.height.max > 0)) out.push('height.max must be > 0');
  if (slot.height.min !== undefined && slot.height.min > slot.height.max) out.push('height.min > height.max');
  if (!(slot.maxWidthM > 0)) out.push('maxWidthM must be > 0');
  return out;
}

/** The clips a slot requires: its `needs.require` (unless relaxed) plus `walk` for movers. */
export function requiredClips(slot: CastSlot, relaxed = false): ClipName[] {
  const out: ClipName[] = relaxed ? [] : [...(slot.needs.require ?? [])];
  if (MOVER_ROLES.has(slot.role) && !out.includes('walk')) out.push('walk');
  return out;
}

/** Does the slot's shape (habitat, clips, height, width, bounds) accept the entry? Exclusions and budget aside. */
export function slotAccepts(slot: CastSlot, entry: FigureEntry, relaxed = false): boolean {
  if (!habitatAccepts(slot.habitat, entry)) return false;
  if (entry.clips.length === 0 && !(relaxed || slot.needs.allowClipless)) return false;
  for (const clip of requiredClips(slot, relaxed)) if (!entry.clips.includes(clip)) return false;
  if (!boundsSane(entry)) return false;
  const h = figureHeightM(entry);
  if (h > slot.height.max || h < (slot.height.min ?? 0)) return false;
  return scaledWidthM(entry) <= slot.maxWidthM;
}

function withinBudget(entry: FigureEntry, budget: CastBudget): boolean {
  // D42: the cast currency (`castKb`, the A-encoding bytes; `kb` before D42).
  return castKbOf(entry) <= budget.maxKb && entry.triangles <= budget.maxTriangles;
}

/** Barred by file: an asset defect (`CAST_DEFECT_FILES`, always merged) or a caller file exclusion. */
function isDefect(entry: FigureEntry, exclude: CastExclusions): boolean {
  return !!exclude.files?.has(entry.file) || CAST_DEFECT_FILES.has(entry.file);
}

function isExcluded(entry: FigureEntry, exclude: CastExclusions): boolean {
  return exclude.dexIds.has(entry.dexId) || isDefect(entry, exclude);
}

function clipTier(slot: CastSlot, entry: FigureEntry): number {
  let tier = 0;
  for (const clip of slot.needs.prefer ?? []) if (entry.clips.includes(clip)) tier += 1;
  return tier;
}

/** The slot's rendezvous score for an entry (higher wins). */
export function castScore(seed: number, slotId: string, file: string): number {
  return hash01(mix32(seed, hashText(slotId)), hashText(file));
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Shape-accepted entries in rank order (clip tier, then score, then file). */
function wishlist(slot: CastSlot, manifest: WorldManifest, seed: number, relaxed: boolean): FigureEntry[] {
  const scored: { entry: FigureEntry; tier: number; score: number }[] = [];
  for (const entry of manifest.figures) {
    if (!slotAccepts(slot, entry, relaxed)) continue;
    scored.push({ entry, tier: clipTier(slot, entry), score: castScore(seed, slot.id, entry.file) });
  }
  scored.sort((a, b) => b.tier - a.tier || b.score - a.score || compareText(a.entry.file, b.entry.file));
  return scored.map((s) => s.entry);
}

/**
 * Candidates for one slot, ranked deterministically (rendezvous hash), with
 * exclusions and the budget applied. Exposed for tests and the debug
 * readout; `[]` on a manifest without type data.
 */
export function rankCandidates(
  slot: CastSlot,
  manifest: WorldManifest,
  seed: number,
  exclude: CastExclusions,
  budget: CastBudget = DEFAULT_CAST_BUDGET,
): FigureEntry[] {
  if (!manifestHasTypeData(manifest)) return [];
  return wishlist(slot, manifest, seed, false).filter((e) => withinBudget(e, budget) && !isExcluded(e, exclude));
}

// ── The world batch ──────────────────────────────────────────────────────────

function pickFrom(
  list: readonly FigureEntry[],
  used: ReadonlySet<number>,
  exclude: CastExclusions,
  budget: CastBudget,
): { entry: FigureEntry; rank: number } | null {
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (used.has(entry.dexId) || isExcluded(entry, exclude) || !withinBudget(entry, budget)) continue;
    return { entry, rank: i };
  }
  return null;
}

/**
 * The empty pick for a slot whose (strict or relaxed) wishlist yielded
 * nothing. `excluded-all` (R35) means the roster aces took it: at least one
 * viable candidate (not a defect / file exclusion, within budget) existed and
 * every viable one is an ace by dexId. Emptiness from asset defects, the
 * budget, world uniqueness or no shape match at all is `no-candidate`.
 */
function emptyPick(
  slotId: string,
  considered: readonly FigureEntry[],
  exclude: CastExclusions,
  budget: CastBudget,
): CastPick {
  let viable = 0;
  let aces = 0;
  for (const entry of considered) {
    if (isDefect(entry, exclude) || !withinBudget(entry, budget)) continue;
    viable += 1;
    if (exclude.dexIds.has(entry.dexId)) aces += 1;
  }
  const reason = viable > 0 && aces === viable ? 'excluded-all' : 'no-candidate';
  return { slotId, entry: null, rank: 0, relaxed: false, reason };
}

/**
 * Cast a world. Deterministic in (slots, manifest, seed, exclude, budget).
 * Picks come back in slot declaration order; `loadSet` lists the picked GLB
 * URLs (deduped, declaration order) for the load-time kick (PB-100).
 * Throws on a structurally invalid slot or a duplicate slot id (static data:
 * the per-world snapshot tests catch it before it ships).
 */
export function castSlots(
  slots: readonly CastSlot[],
  manifest: WorldManifest,
  seed: number,
  options: CastOptions,
): CastResult {
  const ids = new Set<string>();
  for (const slot of slots) {
    const problems = castSlotProblems(slot);
    if (problems.length > 0) throw new Error(`cast slot ${slot.id}: ${problems.join('; ')}`);
    if (ids.has(slot.id)) throw new Error(`cast slot ${slot.id}: duplicate id`);
    ids.add(slot.id);
  }
  const budget = options.budget ?? DEFAULT_CAST_BUDGET;
  const exclude = options.exclude;

  if (!manifestHasTypeData(manifest)) {
    const picks = slots.map<CastPick>((slot) => ({
      slotId: slot.id,
      entry: null,
      rank: 0,
      relaxed: false,
      reason: 'no-type-data',
    }));
    return { picks, loadSet: [] };
  }

  const strict = new Map<string, FigureEntry[]>();
  const available = new Map<string, number>();
  for (const slot of slots) {
    const list = wishlist(slot, manifest, seed, false);
    strict.set(slot.id, list);
    available.set(slot.id, list.filter((e) => withinBudget(e, budget) && !isExcluded(e, exclude)).length);
  }
  const order = [...slots].sort(
    (a, b) =>
      (a.priority ?? Number.POSITIVE_INFINITY) - (b.priority ?? Number.POSITIVE_INFINITY) ||
      (available.get(a.id) ?? 0) - (available.get(b.id) ?? 0) ||
      compareText(a.id, b.id),
  );

  // Pass 1: every slot takes its best STRICT candidate, in priority/scarcity
  // order. Pass 2 (R35): only then do `relax-clips` slots that came up empty
  // retry with the relaxed wishlist, so a disclosed fallback never takes an
  // entry a strict slot could have used.
  const used = new Set<number>();
  const byId = new Map<string, CastPick>();
  const retry: CastSlot[] = [];
  for (const slot of order) {
    const found = pickFrom(strict.get(slot.id) ?? [], used, exclude, budget);
    if (found) {
      used.add(found.entry.dexId);
      byId.set(slot.id, { slotId: slot.id, entry: found.entry, rank: found.rank, relaxed: false, reason: null });
    } else if (slot.fallback === 'relax-clips') {
      retry.push(slot);
    } else {
      byId.set(slot.id, emptyPick(slot.id, strict.get(slot.id) ?? [], exclude, budget));
    }
  }
  for (const slot of retry) {
    const relaxedList = wishlist(slot, manifest, seed, true);
    const found = pickFrom(relaxedList, used, exclude, budget);
    if (found) {
      used.add(found.entry.dexId);
      byId.set(slot.id, { slotId: slot.id, entry: found.entry, rank: found.rank, relaxed: true, reason: null });
    } else {
      // The relaxed wishlist is a superset of the strict one.
      byId.set(slot.id, emptyPick(slot.id, relaxedList, exclude, budget));
    }
  }

  const picks = slots.map((slot) => byId.get(slot.id) as CastPick);
  const loadSet: string[] = [];
  for (const pick of picks) {
    if (!pick.entry) continue;
    const url = figureUrl(pick.entry);
    if (!loadSet.includes(url)) loadSet.push(url);
  }
  return { picks, loadSet };
}

/** One-slot convenience wrapper (L3): the slot cast alone, with no world uniqueness. */
export function castSlot(slot: CastSlot, manifest: WorldManifest, seed: number, options: CastOptions): CastPick {
  return castSlots([slot], manifest, seed, options).picks[0];
}

// ── Exclusions, envelopes, roles ─────────────────────────────────────────────

/**
 * Live roster aces → exclusions (L5, C8). Only aces, by dexId across forms.
 * The caller passes `pickAceTracker`'s picks (components/), so lib never
 * imports components; call it once before reveal and freeze the result.
 */
export function aceExclusions(
  aces: readonly { currentForm: string | null; baseSpecies: string | null }[],
  index: Pick<FigureIndex, 'resolve'>,
): CastExclusions {
  const dexIds = new Set<number>();
  for (const ace of aces) {
    const entry = index.resolve(ace.currentForm, ace.baseSpecies);
    if (entry) dexIds.add(entry.dexId);
  }
  return { dexIds };
}

/**
 * The keep-out / visibility audit box of a slot at its root: the largest
 * figure the slot may cast (its height cap and width cap), standing on `at`.
 * Roster- and bake-independent, so allowlist keys never churn with the cast.
 */
export function slotEnvelope(slot: CastSlot, at: { x: number; y: number; z: number }): KeepOutBox {
  const h = slot.height.max;
  const w = slot.maxWidthM;
  return { id: slot.id, center: [at.x, at.y + h / 2, at.z], half: [w / 2, h / 2, w / 2] };
}

/** Species-identity roles baked into the manifest (Q2). */
export type ManifestRole = 'nurse';

/**
 * Entries carrying a baked role, in manifest order (dexId, then form). Empty
 * on a manifest baked before the core round (no `roles`): fail closed, never
 * a literal fallback.
 */
export function roleEntries(manifest: WorldManifest, role: ManifestRole): FigureEntry[] {
  return manifest.figures.filter((entry) => entry.roles?.includes(role) ?? false);
}

/** The figure cast for a role (Q2: the nurse), or null when none is baked. Regular forms first. */
export function castRole(manifest: WorldManifest, role: ManifestRole): FigureEntry | null {
  const entries = roleEntries(manifest, role);
  return entries.find((entry) => entry.form === 'regular') ?? entries[0] ?? null;
}
