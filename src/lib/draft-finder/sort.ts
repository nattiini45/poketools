/**
 * Finder sorting (draft-frontend §4.7 rule 4). Client-safe, pure.
 *
 * - `default`: price desc, then base display name, then final-stage display name (product decision);
 * - `alpha`: base display name asc, then final stage;
 * - `favorites`: favourites first, then `default`;
 * - stat sorts and `bst`: the value desc at the chosen stage (`sortStage`: the line's base stage or its final
 *   stage, see `lineStage`), then `default`. The tie-break does not depend on the stage.
 * Display names are compared in the data locale (`names.compare`), so German order differs from English.
 */
import type { Locale } from '@/i18n/config';
import type { LineId } from '@/types/draft-queue';
import { STAT_KEYS, type SortKey, type SortStage } from './filter-types';
import type { DraftLineCatalogEntry } from './line-catalog';
import type { NameResolver } from './names-port';
import { lineStage, type PreparedIndex } from './prepare';

export interface SortContext {
  catalog: ReadonlyMap<LineId, DraftLineCatalogEntry>;
  ix: PreparedIndex | null;
  /** Whose stats the stat sorts read; no effect on the other sorts. */
  sortStage: SortStage;
  favorites: ReadonlySet<LineId>;
  names: NameResolver;
  dataLocale: Locale;
}

interface SortRow {
  id: LineId;
  order: number;
  price: number;
  base: string;
  final: string;
  stat: number;
  favorite: boolean;
}

function statOf(ix: PreparedIndex | null, id: LineId, sort: SortKey, stage: SortStage): number {
  const line = ix?.byLineId.get(id);
  if (!line) return Number.NEGATIVE_INFINITY;
  const { stats } = lineStage(line, stage);
  if (sort === 'bst') return stats.reduce((sum, v) => sum + v, 0);
  const i = STAT_KEYS.indexOf(sort as (typeof STAT_KEYS)[number]);
  return i >= 0 ? stats[i] : 0;
}

/** True for the sorts that read a stat (and so a stage): the five stat sorts and `bst`. */
export function isStatSort(sort: SortKey): sort is Exclude<SortKey, 'default' | 'alpha' | 'favorites'> {
  return sort === 'bst' || (STAT_KEYS as readonly string[]).includes(sort);
}

/** Returns a new, sorted array of the ids; ties keep the input order. Ids missing from the catalog go last. */
export function sortLineIds(ids: readonly LineId[], sort: SortKey, ctx: SortContext): LineId[] {
  const { names, dataLocale: dl } = ctx;
  const rows: SortRow[] = ids.map((id, order) => {
    const entry = ctx.catalog.get(id);
    const stages = entry?.stages ?? [];
    return {
      id,
      order,
      price: entry ? entry.price : Number.NEGATIVE_INFINITY,
      base: stages[0] ? names.species(stages[0].name, dl) : '',
      final: stages.length > 0 ? names.species(stages[stages.length - 1].name, dl) : '',
      stat: isStatSort(sort) ? statOf(ctx.ix, id, sort, ctx.sortStage) : 0,
      favorite: ctx.favorites.has(id),
    };
  });

  const byNames = (a: SortRow, b: SortRow) => names.compare(a.base, b.base, dl) || names.compare(a.final, b.final, dl);
  const byDefault = (a: SortRow, b: SortRow) => b.price - a.price || byNames(a, b);

  let cmp: (a: SortRow, b: SortRow) => number;
  if (sort === 'alpha') cmp = byNames;
  else if (sort === 'favorites') cmp = (a, b) => Number(b.favorite) - Number(a.favorite) || byDefault(a, b);
  else if (isStatSort(sort)) cmp = (a, b) => b.stat - a.stat || byDefault(a, b);
  else cmp = byDefault;

  return rows
    .sort((a, b) => {
      const missingA = !ctx.catalog.has(a.id);
      const missingB = !ctx.catalog.has(b.id);
      if (missingA !== missingB) return missingA ? 1 : -1;
      return cmp(a, b) || a.order - b.order;
    })
    .map((r) => r.id);
}
