/** A `FinderLabelContext` without a provider, for the DF2b tests (stub names from the DF1 fixtures). */
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { stubNames } from '@/lib/draft-finder/__tests__/fixture-index';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import type { FinderLabelContext } from '../finder-labels';

/** The DF1 stub resolver plus German type and stat names, so locale effects are visible. */
export const testNames: NameResolver = {
  ...stubNames,
  type: (t, l) => (l === 'de' ? ({ Ground: 'Boden', Water: 'Wasser', Fire: 'Feuer' } as Record<string, string>)[t] ?? t : t),
  stat: (s, l, form) => {
    const en = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' }[s];
    const de = { hp: 'KP', atk: 'Angr.', def: 'Vert.', spa: 'Sp.-Angr.', spd: 'Sp.-Vert.', spe: 'Init.' }[s];
    const long = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' }[s];
    if (l === 'de') return de;
    return form === 'long' ? long : en;
  },
};

export function labelContext(locale: Locale, names: NameResolver = testNames): FinderLabelContext {
  return {
    t: createTranslator(draftFinderMessages, locale),
    tg: createTranslator(glossaryMessages, locale),
    ts: createTranslator(draftSharedMessages, locale),
    names,
    dl: locale,
  };
}
