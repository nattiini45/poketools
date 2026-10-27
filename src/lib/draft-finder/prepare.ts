/**
 * Prepared search index (draft-frontend §4.2). Client-safe, pure.
 *
 * Built once per session (memoised by `listVersionId` in `useSearchIndex`). Search keys hold English,
 * German and transliterated forms and do not depend on the locale, so a language switch does not re-prepare.
 */
import type { LineId } from '@/types/draft-queue';
import type { SearchKeys } from '@/lib/pkmn/i18n/search';
import type { SortStage } from './filter-types';
import type { DraftSearchIndex, IndexLine } from './index-types';
import type { NameResolver } from './names-port';

export interface PreparedLine extends IndexLine {
  /** Per stage (same order as `stages`): the move indices. */
  stageMoveSets: Set<number>[];
  /** Per stage: the ability indices. */
  stageAbilitySets: Set<number>[];
  /** Per stage: names.searchKeys('species', stage.name). */
  stageKeys: SearchKeys[];
}

export interface PreparedIndex {
  raw: DraftSearchIndex;
  byLineId: Map<LineId, PreparedLine>;
  moveIdToIdx: Map<string, number>;
  abilityIdToIdx: Map<string, number>;
  /** names.searchKeys('move', raw.moveNames[idx]) */
  moveSearch: { idx: number; keys: SearchKeys }[];
  /** names.searchKeys('ability', raw.abilityNames[idx]) */
  abilitySearch: { idx: number; keys: SearchKeys }[];
}

function prepareLine(line: IndexLine, names: NameResolver): PreparedLine {
  return {
    ...line,
    stageMoveSets: line.stages.map((s) => new Set(s.moves)),
    stageAbilitySets: line.stages.map((s) => new Set(s.abilities)),
    stageKeys: line.stages.map((s) => names.searchKeys('species', s.name)),
  };
}

/**
 * The stage of a line a stat or typing reading uses: `base` = the first stage, `final` = the last (stage 3, or
 * stage 2 of a two-stage line; a middle stage is never offered). Every indexed line has at least two stages.
 * Generic over the stage shape, so index lines, prepared lines and catalog entries all read through it.
 */
export function lineStage<S>(line: { stages: readonly S[] }, stage: SortStage): S {
  return stage === 'base' ? line.stages[0] : line.stages[line.stages.length - 1];
}

export function prepareIndex(index: DraftSearchIndex, names: NameResolver): PreparedIndex {
  const byLineId = new Map<LineId, PreparedLine>();
  for (const line of index.lines) {
    if (line.stages.length === 0) continue;
    byLineId.set(line.lineId, prepareLine(line, names));
  }
  return {
    raw: index,
    byLineId,
    moveIdToIdx: new Map(index.moves.map((id, idx) => [id, idx])),
    abilityIdToIdx: new Map(index.abilities.map((id, idx) => [id, idx])),
    moveSearch: index.moves.map((id, idx) => ({ idx, keys: names.searchKeys('move', index.moveNames[idx] ?? id) })),
    abilitySearch: index.abilities.map((id, idx) => ({
      idx,
      keys: names.searchKeys('ability', index.abilityNames[idx] ?? id),
    })),
  };
}
