/**
 * Display text of the finder (draft-frontend §5.5, §10.3): chip labels, criterion labels and match reasons.
 *
 * State and engine results hold ids, canonical English names and indices only (i18n-core §1.7); these
 * helpers turn them into text at render time. Pokémon data names come from the name layer in the data
 * locale (`NameResolver`), every other word from `draft/finder`, `draft/shared` or `glossary`.
 *
 * The pure functions take a `FinderLabelContext`; components build one with `useFinderLabelContext()`.
 * DF2a's `MatchExplanation` and `CompareTray` can render criteria through the same functions.
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
import type { CriterionResult, MatchVia } from '@/lib/draft-finder/engine';
import type { DefenseRelation, FinderFilters, StatKey } from '@/lib/draft-finder/filter-types';
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

/** The text of an active-filter chip. */
export function chipLabel(parts: ChipLabelParts, ctx: FinderLabelContext): string {
  switch (parts.kind) {
    case 'type':
      return ctx.names.type(parts.type, ctx.dl);
    case 'move':
      return ctx.names.move(parts.name, ctx.dl);
    case 'ability':
      return ctx.names.ability(parts.name, ctx.dl);
    case 'utility':
      return utilityLabel(parts.key, ctx);
    case 'utilityMember':
      return ctx.t('chips.utilityMember', {
        category: utilityLabel(parts.key, ctx),
        member:
          parts.memberKind === 'move' ? ctx.names.move(parts.name, ctx.dl) : ctx.names.ability(parts.name, ctx.dl),
      });
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

/** "Stealth Rock, from Stage 3"; a line-level reason (price) has no stage; '' when unsatisfied. */
export function resultText(result: CriterionResult, ix: PreparedIndex | null, ctx: FinderLabelContext): string {
  if (!result.satisfied || !result.via) return '';
  const what = viaText(result.via, ix, ctx);
  if (result.via.kind === 'price' || result.firstStage === null) return what;
  return what ? ctx.t('hover.via', { what, stage: result.firstStage }) : ctx.t('hover.fromStage', { stage: result.firstStage });
}
