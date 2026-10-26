/**
 * The finder engine (draft-frontend §4.7, FR-5, EvoLiga spec Q43). Client-safe, pure.
 *
 * Filters compile into atomic criteria; each is evaluated PER STAGE (learnsets are not monotonic):
 * - types: `any` = one criterion, `all` = one per type; moves likewise; abilities = one criterion (OR);
 * - each selected utility category is its own criterion (categories AND each other), its picked members OR;
 * - each stat threshold (`>=`), each defensive relation and the max price are their own criterion.
 * Then the stage mode: `same_stage` = one stage satisfies every criterion; `anywhere` = each criterion is
 * satisfied by some stage. The client never decides draftability (FR-3): this only finds and explains.
 */
import type { Locale } from '@/i18n/config';
import type { LineId } from '@/types/draft-queue';
import { parentMatchIds, UTILITY_CATEGORIES } from '@/lib/draft/utility-categories';
import { ABILITY_DEFENSE, abilityMultiplier, typingMultiplier } from './ability-defense';
import { buildChips, type FilterChip } from './chips';
import { STAT_KEYS, type FinderFilters, type FinderViewState, type PriceTabKey, type StageMode, type StatKey } from './filter-types';
import type { IndexStage, TypeId } from './index-types';
import type { DraftLineCatalog, DraftLineCatalogEntry } from './line-catalog';
import { indexAbilityName, indexMoveName, type NameResolver } from './names-port';
import type { PreparedIndex, PreparedLine } from './prepare';
import { foldQuery, isEmptyQuery, lineMatchesText } from './search';
import { sortLineIds } from './sort';
import { countByTab, PRICE_TAB_KEYS, tabOf } from './tabs';

export type CriterionKind = 'type' | 'move' | 'ability' | 'utility' | 'stat' | 'defense' | 'price';

/** One stage of a line, with its prepared lookup sets. */
export interface PreparedStageCtx {
  stage: IndexStage;
  /** Position in `line.stages`. */
  index: number;
  moves: ReadonlySet<number>;
  abilities: ReadonlySet<number>;
}

export type MatchVia =
  | { kind: 'type'; type: TypeId }
  | { kind: 'move'; moveIdx: number }
  | { kind: 'ability'; abilityIdx: number }
  | { kind: 'stat'; stat: StatKey | 'bst'; value: number }
  | { kind: 'typing'; multiplier: number }
  | { kind: 'ability-defense'; abilityIdx: number; multiplier: number }
  | { kind: 'price'; price: number };

export interface Criterion {
  /** Stable chip/criterion id: 'type:any', 'move:stealthrock', 'utility:recovery', 'stat:spe', 'def:immune:Ground', 'price'. */
  id: string;
  kind: CriterionKind;
  /** 'price' is line-level; everything else stage-level. */
  level: 'stage' | 'line';
  /** First satisfying reason or null. */
  test(stage: PreparedStageCtx, line: PreparedLine): MatchVia | null;
}

export interface CriterionResult {
  criterionId: string;
  satisfied: boolean;
  /** Earliest stage satisfying it. */
  firstStage: 1 | 2 | 3 | null;
  /** Reason AT firstStage (moves before abilities; for defense the typing reason before ability reasons). */
  via: MatchVia | null;
  /** All satisfying stages. */
  stages: (1 | 2 | 3)[];
}

export interface LineEvaluation {
  lineId: LineId;
  matches: boolean;
  results: CriterionResult[];
  /** Earliest stage where ALL criteria hold (null if none, or with no criteria). */
  simultaneousFromStage: 1 | 2 | 3 | null;
}

// ── compile ────────────────────────────────────────────────────────

function knownIndices(ids: readonly string[], map: ReadonlyMap<string, number>): number[] {
  const out: number[] = [];
  for (const id of ids) {
    const idx = map.get(id);
    if (idx !== undefined && !out.includes(idx)) out.push(idx);
  }
  return out;
}

function firstMove(ctx: PreparedStageCtx, moveIdx: readonly number[]): MatchVia | null {
  for (const idx of moveIdx) if (ctx.moves.has(idx)) return { kind: 'move', moveIdx: idx };
  return null;
}

function firstAbility(ctx: PreparedStageCtx, abilityIdx: readonly number[]): MatchVia | null {
  for (const idx of abilityIdx) if (ctx.abilities.has(idx)) return { kind: 'ability', abilityIdx: idx };
  return null;
}

function statValue(stage: IndexStage, stat: StatKey | 'bst'): number {
  if (stat === 'bst') return stage.stats.reduce((sum, v) => sum + v, 0);
  return stage.stats[STAT_KEYS.indexOf(stat)];
}

function defenseCriterion(
  relation: 'resists' | 'immune' | 'weak',
  atk: TypeId,
  abilityDefense: boolean,
  ix: PreparedIndex,
): Criterion {
  const holds = (m: number) => (relation === 'resists' ? m < 1 && m > 0 : relation === 'immune' ? m === 0 : m > 1);
  const abilityHolds = (m: number) => (relation === 'resists' ? m < 1 : m === 0);
  return {
    id: `def:${relation}:${atk}`,
    kind: 'defense',
    level: 'stage',
    test(ctx) {
      const typing = typingMultiplier(atk, ctx.stage.types);
      if (holds(typing)) return { kind: 'typing', multiplier: typing };
      // Weakness is typing only (FR-9); resist/immune also count abilities when the switch is on.
      if (relation === 'weak' || !abilityDefense) return null;
      for (const idx of ctx.stage.abilities) {
        const id = ix.raw.abilities[idx];
        if (!id || !ABILITY_DEFENSE[id]) continue;
        const m = abilityMultiplier(id, atk, ctx.stage.types);
        if (m !== null && abilityHolds(m)) return { kind: 'ability-defense', abilityIdx: idx, multiplier: m };
      }
      return null;
    },
  };
}

export function compileCriteria(f: FinderFilters, ix: PreparedIndex, ctx: { banned: ReadonlySet<string> }): Criterion[] {
  const criteria: Criterion[] = [];

  if (f.types.ids.length > 0) {
    if (f.types.match === 'any') {
      const wanted = [...f.types.ids];
      criteria.push({
        id: 'type:any',
        kind: 'type',
        level: 'stage',
        test: (s) => {
          const t = wanted.find((w) => s.stage.types.includes(w));
          return t ? { kind: 'type', type: t } : null;
        },
      });
    } else {
      for (const t of f.types.ids) {
        criteria.push({
          id: `type:${t}`,
          kind: 'type',
          level: 'stage',
          test: (s) => (s.stage.types.includes(t) ? { kind: 'type', type: t } : null),
        });
      }
    }
  }

  if (f.moves.ids.length > 0) {
    if (f.moves.match === 'any') {
      const idx = knownIndices(f.moves.ids, ix.moveIdToIdx);
      criteria.push({ id: 'move:any', kind: 'move', level: 'stage', test: (s) => firstMove(s, idx) });
    } else {
      for (const id of f.moves.ids) {
        const idx = knownIndices([id], ix.moveIdToIdx);
        criteria.push({ id: `move:${id}`, kind: 'move', level: 'stage', test: (s) => firstMove(s, idx) });
      }
    }
  }

  if (f.abilities.ids.length > 0) {
    const idx = knownIndices(f.abilities.ids, ix.abilityIdToIdx);
    criteria.push({ id: 'ability:any', kind: 'ability', level: 'stage', test: (s) => firstAbility(s, idx) });
  }

  for (const u of f.utility) {
    const def = UTILITY_CATEGORIES.find((c) => c.key === u.key);
    if (!def) continue;
    let moveIds: string[];
    let abilityIds: string[];
    if (u.members.length === 0) {
      ({ moves: moveIds, abilities: abilityIds } = parentMatchIds(def, ctx.banned));
    } else {
      // Exactly the picked members, minus banned moves (never matched, even when picked).
      moveIds = def.moves.filter((m) => u.members.includes(m) && !ctx.banned.has(m));
      abilityIds = def.abilities.filter((a) => u.members.includes(a));
    }
    const moveIdx = knownIndices(moveIds, ix.moveIdToIdx);
    const abilityIdx = knownIndices(abilityIds, ix.abilityIdToIdx);
    criteria.push({
      id: `utility:${u.key}`,
      kind: 'utility',
      level: 'stage',
      test: (s) => firstMove(s, moveIdx) ?? firstAbility(s, abilityIdx),
    });
  }

  for (const stat of [...STAT_KEYS, 'bst'] as const) {
    const min = f.stats[stat];
    if (min === undefined) continue;
    criteria.push({
      id: `stat:${stat}`,
      kind: 'stat',
      level: 'stage',
      test: (s) => {
        const value = statValue(s.stage, stat);
        return value >= min ? { kind: 'stat', stat, value } : null;
      },
    });
  }

  for (const d of f.defense) criteria.push(defenseCriterion(d.relation, d.type, f.abilityDefense, ix));

  if (f.maxPrice !== null) {
    const max = f.maxPrice;
    criteria.push({
      id: 'price',
      kind: 'price',
      level: 'line',
      test: (_s, line) => (line.price <= max ? { kind: 'price', price: line.price } : null),
    });
  }

  return criteria;
}

// ── evaluate ───────────────────────────────────────────────────────

function stageCtxs(line: PreparedLine): PreparedStageCtx[] {
  return line.stages.map((stage, index) => ({
    stage,
    index,
    moves: line.stageMoveSets[index],
    abilities: line.stageAbilitySets[index],
  }));
}

export function evaluateLine(line: PreparedLine, criteria: readonly Criterion[], mode: StageMode): LineEvaluation {
  if (criteria.length === 0) {
    return { lineId: line.lineId, matches: true, results: [], simultaneousFromStage: null };
  }
  const ctxs = stageCtxs(line);
  // perStage[c][s] = the reason criterion c holds at stage s, or null.
  const perStage = criteria.map((c) => {
    if (c.level === 'line') {
      const via = ctxs.length > 0 ? c.test(ctxs[0], line) : null;
      return ctxs.map(() => via);
    }
    return ctxs.map((ctx) => c.test(ctx, line));
  });

  const results: CriterionResult[] = criteria.map((c, ci) => {
    const stages: (1 | 2 | 3)[] = [];
    let via: MatchVia | null = null;
    for (let si = 0; si < ctxs.length; si++) {
      const v = perStage[ci][si];
      if (!v) continue;
      if (stages.length === 0) via = v;
      stages.push(ctxs[si].stage.stage);
    }
    return { criterionId: c.id, satisfied: stages.length > 0, firstStage: stages[0] ?? null, via, stages };
  });

  let simultaneousFromStage: 1 | 2 | 3 | null = null;
  for (let si = 0; si < ctxs.length; si++) {
    if (perStage.every((row) => row[si] !== null)) {
      simultaneousFromStage = ctxs[si].stage.stage;
      break;
    }
  }

  const matches = mode === 'same_stage' ? simultaneousFromStage !== null : results.every((r) => r.satisfied);
  return { lineId: line.lineId, matches, results, simultaneousFromStage };
}

/**
 * The Pokémon-data subject of a match reason in the data locale: the move, ability (incl. a defensive one),
 * type or stat name. `null` for the typing multiplier, the price and BST, whose wording is UI copy.
 */
export function viaSubject(via: MatchVia, ix: PreparedIndex, names: NameResolver, dl: Locale): string | null {
  switch (via.kind) {
    case 'move':
      return indexMoveName(ix.raw, via.moveIdx, names, dl);
    case 'ability':
    case 'ability-defense':
      return indexAbilityName(ix.raw, via.abilityIdx, names, dl);
    case 'type':
      return names.type(via.type, dl);
    case 'stat':
      return via.stat === 'bst' ? null : names.stat(via.stat, dl, 'short');
    case 'typing':
    case 'price':
      return null;
  }
}

// ── run ────────────────────────────────────────────────────────────

/**
 * The parts of the view state the finder reads. The sheet UI state (open groups, picker queries), the
 * compare tray and the open flag are not among them, so a caller can memoise on these fields alone and a
 * keystroke in a filter picker does not re-run the finder.
 */
export type FinderQueryView = Pick<
  FinderViewState,
  'filters' | 'stageMode' | 'tab' | 'sort' | 'sortStage' | 'showDrafted' | 'pinnedLineId'
>;

export interface FinderInput {
  ix: PreparedIndex;
  catalog: DraftLineCatalog;
  view: FinderQueryView;
  taken: Record<LineId, string>;
  favorites: ReadonlySet<LineId>;
  dataLocale: Locale;
  names: NameResolver;
  banned: ReadonlySet<string>;
}

export interface FinderResult {
  /** Current tab, sorted, after text + criteria + showDrafted. */
  rows: { lineId: LineId; evaluation: LineEvaluation }[];
  /** Chip-bar count across all tabs (FR-8). */
  matchingAllTabs: number;
  tabCounts: Record<PriceTabKey, { matching: number; total: number }>;
  /** Always computed, even if the pinned line is hidden. */
  pinnedEvaluation: LineEvaluation | null;
  activeChips: FilterChip[];
}

function unindexedEvaluation(lineId: LineId, criteria: readonly Criterion[], textEmpty: boolean): LineEvaluation {
  return {
    lineId,
    matches: criteria.length === 0 && textEmpty,
    results: criteria.map((c) => ({ criterionId: c.id, satisfied: false, firstStage: null, via: null, stages: [] })),
    simultaneousFromStage: null,
  };
}

export function runFinder(input: FinderInput): FinderResult {
  const { ix, catalog, view, taken } = input;
  const criteria = compileCriteria(view.filters, ix, { banned: input.banned });
  const query = foldQuery(view.filters.text);
  const textEmpty = isEmptyQuery(query);
  const catalogById = new Map<LineId, DraftLineCatalogEntry>(catalog.lines.map((l) => [l.lineId, l]));

  const evaluate = (lineId: LineId): LineEvaluation => {
    const line = ix.byLineId.get(lineId);
    return line ? evaluateLine(line, criteria, view.stageMode) : unindexedEvaluation(lineId, criteria, textEmpty);
  };

  const matching: { lineId: LineId; evaluation: LineEvaluation }[] = [];
  for (const entry of catalog.lines) {
    const line = ix.byLineId.get(entry.lineId);
    if (line && !lineMatchesText(line, query)) continue;
    if (!line && !textEmpty) continue;
    if (!view.showDrafted && taken[entry.lineId] !== undefined) continue;
    const evaluation = evaluate(entry.lineId);
    if (evaluation.matches) matching.push({ lineId: entry.lineId, evaluation });
  }

  const priceOf = (id: LineId) => catalogById.get(id)?.price ?? 0;
  const totals = countByTab(
    catalog.lines.map((l) => l.lineId),
    priceOf,
  );
  const matchingCounts = countByTab(
    matching.map((m) => m.lineId),
    priceOf,
  );
  const tabCounts = Object.fromEntries(
    PRICE_TAB_KEYS.map((k) => [k, { matching: matchingCounts[k], total: totals[k] }]),
  ) as Record<PriceTabKey, { matching: number; total: number }>;

  const inTab = view.tab === 'all' ? matching : matching.filter((m) => tabOf(priceOf(m.lineId)) === view.tab);
  const evalById = new Map(inTab.map((m) => [m.lineId, m.evaluation]));
  const sortedIds = sortLineIds(
    inTab.map((m) => m.lineId),
    view.sort,
    {
      catalog: catalogById,
      ix,
      sortStage: view.sortStage,
      favorites: input.favorites,
      names: input.names,
      dataLocale: input.dataLocale,
    },
  );

  const pinned = view.pinnedLineId;
  return {
    rows: sortedIds.map((lineId) => ({ lineId, evaluation: evalById.get(lineId) ?? evaluate(lineId) })),
    matchingAllTabs: matching.length,
    tabCounts,
    pinnedEvaluation: pinned ? evaluate(pinned) : null,
    activeChips: buildChips(view.filters, {
      moveName: (id) => {
        const idx = ix.moveIdToIdx.get(id);
        return idx === undefined ? undefined : ix.raw.moveNames[idx];
      },
      abilityName: (id) => {
        const idx = ix.abilityIdToIdx.get(id);
        return idx === undefined ? undefined : ix.raw.abilityNames[idx];
      },
    }),
  };
}
