/**
 * Display text of the finder (draft-frontend §5.5, §10.3): chip labels, criterion labels and match reasons.
 *
 * State and engine results hold ids, canonical English names and indices only (i18n-core §1.7); these
 * helpers turn them into text at render time. Pokémon data names come from the name layer in the data
 * locale (`NameResolver`), every other word from `draft/finder`, `draft/shared` or `glossary`.
 *
 * The pure functions take a `FinderLabelContext`; components build one with `useFinderLabelContext()`.
 * This file is the one implementation of the match explanation: the hover popover and the pinned line's
 * panel render their rows through `shared/MatchReasons`, and the compare tray labels its criteria with
 * `criterionLabel`. A result names the Pokémon of the stage it first holds on ("Spikes, from Incineroar"),
 * never a bare stage number.
 */
import { useMemo } from 'react';
import { useDataLocale, useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import type { Translator } from '@/i18n/core';
import { draftFinderMessages, type DraftFinderEn } from '@/i18n/messages/draft/finder';
import { draftSharedMessages, type DraftSharedEn } from '@/i18n/messages/draft/shared';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { utilityLabel as packUtilityLabel } from '@/lib/format-pack';
import type { UtilityKey } from '@/types/draft-queue';
import type { ChipLabelParts } from '@/lib/draft-finder/chips';
import type { CriterionResult, LineEvaluation, MatchVia } from '@/lib/draft-finder/engine';
import type { DefenseRelation, FinderFilters, StageMode, StatKey } from '@/lib/draft-finder/filter-types';
import { isTypeId } from '@/lib/draft-finder/index-types';
import { indexAbilityName, indexMoveName, pkmnNameResolver, type NameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';

export type GlossaryEn = (typeof glossaryMessages)['en'];

export interface FinderLabelContext {
  t: Translator<DraftFinderEn>;
  tg: Translator<GlossaryEn>;
  ts: Translator<DraftSharedEn>;
  names: NameResolver;
  /** The data locale (Pokémon names). */
  dl: Locale;
}

/** Builds the label context from the provider (UI locale for copy, data locale for Pokémon names). */
export function useFinderLabelContext(names: NameResolver = pkmnNameResolver): FinderLabelContext {
  const t = useT(draftFinderMessages);
  const tg = useT(glossaryMessages);
  const ts = useT(draftSharedMessages);
  const dl = useDataLocale();
  return useMemo(() => ({ t, tg, ts, names, dl }), [t, tg, ts, names, dl]);
}

/** One active criterion with its display text (the compare tray's ✓/✕ rows). */
export interface CriterionLabel {
  id: string;
  label: string;
}

/** The stages of a line as the catalog holds them: stage number and canonical English species name. */
export type LineStages = readonly { stage: number; name: string }[];

/** Separator between alternatives of one criterion ("Ground / Water"). */
const ALTERNATIVES = ' / ';

/** A utility category's label in the UI locale (the active format pack's `messages.<locale>.utility`). */
export function utilityLabel(key: UtilityKey, ctx: FinderLabelContext): string {
  return packUtilityLabel(key, ctx.tg.locale);
}

/** A stat's label: the pkmn layer's stat name, or "BST". */
export function statLabel(stat: StatKey | 'bst', ctx: FinderLabelContext, form: 'short' | 'long' = 'short'): string {
  return stat === 'bst' ? ctx.t('sort.bst') : ctx.names.stat(stat, ctx.dl, form);
}

export function defenseLabel(relation: DefenseRelation, type: string, ctx: FinderLabelContext): string {
  const typeName = isTypeId(type) ? ctx.names.type(type, ctx.dl) : type;
  return ctx.t(`defense.${relation}`, { type: typeName });
}

/** The display name of a move id, through the index's English name; the id when the index lacks it. */
export function moveDisplayName(id: string, ix: PreparedIndex | null, ctx: FinderLabelContext): string {
  const idx = ix?.moveIdToIdx.get(id);
  return ix && idx !== undefined ? indexMoveName(ix.raw, idx, ctx.names, ctx.dl) : id;
}

export function abilityDisplayName(id: string, ix: PreparedIndex | null, ctx: FinderLabelContext): string {
  const idx = ix?.abilityIdToIdx.get(id);
  return ix && idx !== undefined ? indexAbilityName(ix.raw, idx, ctx.names, ctx.dl) : id;
}

/**
 * The text of an active-filter chip. `short` is the visible chip: a utility member is just its move or
 * ability name (the category is no longer a chip beside it). `full` is `title` and the remove button's
 * accessible name: it keeps the category in front ("Hazards: Spikes"), so a member chip is told apart from
 * a move chip of the same name.
 */
export function chipLabel(parts: ChipLabelParts, ctx: FinderLabelContext, form: 'short' | 'full'): string {
  switch (parts.kind) {
    case 'type':
      return ctx.names.type(parts.type, ctx.dl);
    case 'move':
      return ctx.names.move(parts.name, ctx.dl);
    case 'ability':
      return ctx.names.ability(parts.name, ctx.dl);
    case 'utility':
      return utilityLabel(parts.key, ctx);
    case 'utilityMember': {
      const member =
        parts.memberKind === 'move' ? ctx.names.move(parts.name, ctx.dl) : ctx.names.ability(parts.name, ctx.dl);
      return form === 'short' ? member : ctx.t('chips.utilityMember', { category: utilityLabel(parts.key, ctx), member });
    }
    case 'stat':
      return ctx.t('chips.stat', { stat: statLabel(parts.stat, ctx), n: parts.value });
    case 'price':
      return ctx.t('chips.price', { n: parts.max });
    case 'defense':
      return defenseLabel(parts.relation, parts.type, ctx);
  }
}

/**
 * What a criterion asks for, from its id (`engine.compileCriteria` ids) and the filters it was compiled
 * from: 'type:any' → "Ground / Water", 'move:stealthrock' → "Stealth Rock", 'utility:recovery' → "Recovery",
 * 'stat:spe' → "Spe ≥ 100", 'def:immune:Ground' → "immune to Ground", 'price' → "≤15 P".
 */
export function criterionLabel(
  criterionId: string,
  filters: FinderFilters,
  ix: PreparedIndex | null,
  ctx: FinderLabelContext,
): string {
  if (criterionId === 'price') return ctx.t('chips.price', { n: filters.maxPrice ?? 0 });
  const [head, a, b] = criterionId.split(':');
  switch (head) {
    case 'type':
      if (a === 'any') return filters.types.ids.map((t) => ctx.names.type(t, ctx.dl)).join(ALTERNATIVES);
      return isTypeId(a) ? ctx.names.type(a, ctx.dl) : a;
    case 'move':
      if (a === 'any') return filters.moves.ids.map((id) => moveDisplayName(id, ix, ctx)).join(ALTERNATIVES);
      return moveDisplayName(a, ix, ctx);
    case 'ability':
      return filters.abilities.ids.map((id) => abilityDisplayName(id, ix, ctx)).join(ALTERNATIVES);
    case 'utility': {
      const entry = filters.utility.find((u) => u.key === a);
      return entry ? utilityLabel(entry.key, ctx) : a;
    }
    case 'stat': {
      const stat = a as StatKey | 'bst';
      const value = filters.stats[stat];
      return value === undefined ? statLabel(stat, ctx) : ctx.t('chips.stat', { stat: statLabel(stat, ctx), n: value });
    }
    case 'def':
      return a === 'resists' || a === 'immune' || a === 'weak' ? defenseLabel(a, b, ctx) : criterionId;
    default:
      return criterionId;
  }
}

/** The concrete thing that satisfied a criterion ("Stealth Rock", "with ability Levitate", "Spe 110"). */
export function viaText(via: MatchVia, ix: PreparedIndex | null, ctx: FinderLabelContext): string {
  switch (via.kind) {
    case 'move':
      return ix ? indexMoveName(ix.raw, via.moveIdx, ctx.names, ctx.dl) : '';
    case 'ability':
      return ix ? indexAbilityName(ix.raw, via.abilityIdx, ctx.names, ctx.dl) : '';
    case 'type':
      return ctx.names.type(via.type, ctx.dl);
    case 'stat':
      return ctx.t('hover.statValue', { stat: statLabel(via.stat, ctx), value: via.value });
    case 'typing':
      return ctx.t('hover.typing', { multiplier: via.multiplier });
    case 'ability-defense':
      return ctx.t('defense.viaAbility', {
        ability: ix ? indexAbilityName(ix.raw, via.abilityIdx, ctx.names, ctx.dl) : '',
      });
    case 'price':
      return ctx.ts('points', { n: via.price });
  }
}

/**
 * The localised name of the line's Pokémon at a stage number; null when the line has no such stage. Looks the
 * stage up by its number, never by array position.
 */
export function stageSpecies(stages: LineStages, stage: number, ctx: FinderLabelContext): string | null {
  const found = stages.find((s) => s.stage === stage);
  return found ? ctx.names.species(found.name, ctx.dl) : null;
}

/**
 * "Stealth Rock, from Incineroar": what satisfied a criterion and the Pokémon of the stage it first holds on.
 * A line-level reason (the price) names no Pokémon, a stage the line lacks leaves it out; '' when unsatisfied.
 */
export function resultText(result: CriterionResult, stages: LineStages, ix: PreparedIndex | null, ctx: FinderLabelContext): string {
  if (!result.satisfied || !result.via) return '';
  const what = viaText(result.via, ix, ctx);
  if (result.via.kind === 'price' || result.firstStage === null) return what;
  const species = stageSpecies(stages, result.firstStage, ctx);
  if (species === null) return what;
  return what ? ctx.t('hover.via', { what, species }) : ctx.t('hover.fromStage', { species });
}

/**
 * The line under several criteria: "All at once – from Incineroar" when they all hold on one Pokémon, "Not
 * all on the same Pokémon" when the stage mode lets them hold apart and they never meet; null otherwise.
 */
export function togetherText(
  evaluation: LineEvaluation | null,
  stages: LineStages,
  stageMode: StageMode,
  ctx: FinderLabelContext,
): string | null {
  if (!evaluation || evaluation.results.length < 2) return null;
  if (evaluation.simultaneousFromStage !== null) {
    const species = stageSpecies(stages, evaluation.simultaneousFromStage, ctx);
    return species === null ? null : ctx.t('hover.allAtOnce', { species });
  }
  return stageMode === 'anywhere' && evaluation.matches ? ctx.t('hover.notTogether') : null;
}
