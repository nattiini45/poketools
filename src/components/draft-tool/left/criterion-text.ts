/**
 * Display text for finder criteria and their match reasons (draft-frontend
 * §4.7, §5.5 `MatchExplanation`). Pure: the caller passes translators and the
 * name resolver; Pokémon data names come from the pkmn layer, UI words from
 * `draft/screen` and `glossary`.
 */
import type { Locale } from '@/i18n/config';
import type { Translator } from '@/i18n/core';
import type { Formatter } from '@/i18n/format';
import type { DraftScreenEn } from '@/i18n/messages/draft/screen';
import type { glossaryMessages } from '@/i18n/messages/glossary';
import type { CriterionResult, MatchVia } from '@/lib/draft-finder/engine';
import { viaSubject } from '@/lib/draft-finder/engine';
import type { FinderFilters, StatKey } from '@/lib/draft-finder/filter-types';
import { indexAbilityName, indexMoveName, type NameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import { isTypeId } from '@/lib/draft-finder/index-types';
import { utilityLabel as packUtilityLabel } from '@/lib/format-pack';

type GlossaryEn = (typeof glossaryMessages)['en'];

export interface CriterionLabel {
  id: string;
  label: string;
}

export interface CriterionTextDeps {
  filters: FinderFilters;
  ix: PreparedIndex | null;
  names: NameResolver;
  dl: Locale;
  t: Translator<DraftScreenEn>;
  tGlossary: Translator<GlossaryEn>;
  f: Formatter;
}

const STATS: ReadonlySet<string> = new Set(['hp', 'atk', 'def', 'spa', 'spd', 'spe']);

function moveName(id: string, d: CriterionTextDeps): string {
  const idx = d.ix?.moveIdToIdx.get(id);
  return idx === undefined || !d.ix ? id : indexMoveName(d.ix.raw, idx, d.names, d.dl);
}

function abilityName(id: string, d: CriterionTextDeps): string {
  const idx = d.ix?.abilityIdToIdx.get(id);
  return idx === undefined || !d.ix ? id : indexAbilityName(d.ix.raw, idx, d.names, d.dl);
}

/** The label of one compiled criterion id ('type:any', 'move:stealthrock', 'utility:recovery', 'def:immune:Ground', 'price', …). */
export function criterionLabel(id: string, d: CriterionTextDeps): string {
  const { t, f, filters, names, dl } = d;
  if (id === 'price') return t('explain.criterion.price', { n: filters.maxPrice ?? 0 });
  const [head, a, b] = id.split(':');
  switch (head) {
    case 'type':
      if (a === 'any') return t('explain.criterion.types', { list: f.list(filters.types.ids.map((x) => names.type(x, dl)), 'disjunction') });
      return isTypeId(a) ? names.type(a, dl) : a;
    case 'move':
      if (a === 'any') return t('explain.criterion.moves', { list: f.list(filters.moves.ids.map((m) => moveName(m, d)), 'disjunction') });
      return moveName(a, d);
    case 'ability':
      return t('explain.criterion.abilities', { list: f.list(filters.abilities.ids.map((x) => abilityName(x, d)), 'disjunction') });
    case 'utility':
      return packUtilityLabel(a, d.tGlossary.locale);
    case 'stat': {
      const n = a === 'bst' ? filters.stats.bst : STATS.has(a) ? filters.stats[a as StatKey] : undefined;
      if (a === 'bst') return t('explain.criterion.bst', { n: n ?? 0 });
      return STATS.has(a) ? t('explain.criterion.stat', { stat: names.stat(a as StatKey, dl, 'short'), n: n ?? 0 }) : a;
    }
    case 'def': {
      const type = isTypeId(b) ? names.type(b, dl) : b;
      if (a === 'resists') return t('explain.criterion.resists', { type });
      if (a === 'immune') return t('explain.criterion.immune', { type });
      if (a === 'weak') return t('explain.criterion.weak', { type });
      return id;
    }
    default:
      return id;
  }
}

/** What satisfied a criterion: the move, ability, type or stat; "by typing"; the price. */
export function viaText(via: MatchVia, d: CriterionTextDeps): string {
  const subject = d.ix ? viaSubject(via, d.ix, d.names, d.dl) : null;
  switch (via.kind) {
    case 'typing':
      return d.t('explain.viaTyping');
    case 'price':
      return d.t('explain.viaPrice', { n: via.price });
    case 'stat':
      return via.stat === 'bst'
        ? d.t('explain.viaBst', { n: via.value })
        : d.t('explain.viaStat', { stat: subject ?? via.stat, n: via.value });
    default:
      return subject ?? '';
  }
}

/** "Regenerator, from Stage 3" for a satisfied result; null otherwise. */
export function resultReason(result: CriterionResult, d: CriterionTextDeps): string | null {
  if (!result.satisfied || result.via === null || result.firstStage === null) return null;
  const what = viaText(result.via, d);
  return what ? d.t('explain.via', { what, stage: result.firstStage }) : null;
}
