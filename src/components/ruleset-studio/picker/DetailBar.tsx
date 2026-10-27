'use client';

import { Ban, LockOpen, Minus, Plus, RotateCcw } from 'lucide-react';
import DescFallbackTag from '@/components/teambuilder/v3/workspace/DescFallbackTag';
import SpriteImg from '@/components/shared/SpriteImg';
import TypeBadge from '@/components/shared/TypeBadge';
import CategoryIcon from '@/components/shared/CategoryIcon';
import SheetIcon from '@/components/shared/SheetIcon';
import Button from '@/components/ui/Button';
import { useDataLocale, useT } from '@/i18n/client';
import { rulesetStudioPickerMessages } from '@/i18n/messages/ruleset-studio/picker';
import { wikiMessages } from '@/i18n/messages/wiki';
import type { CatalogEntry } from '@/lib/pkmn/catalog-index';
import { localizeMoveCategory, localizeStat } from '@/lib/pkmn/i18n/names/misc';
import type { StatKey } from '@/lib/pkmn/i18n/types';
import { isAuthorState, isLegalState, type EntryState } from '@/lib/ruleset-kit/entry-state';
import { WIKI_ITEM_CATEGORY_KEYS } from '@/lib/wiki/item-category';
import type { BulkAction } from '@/lib/ruleset-studio/editor/picker/bulk';
import StateChip from './StateChip';

const STAT_KEYS: readonly StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_MAX = 255;

interface DetailBarProps {
  entry: CatalogEntry | null;
  state: EntryState | null;
  name: string;
  tier: string;
  /** The entry's one-line description, when the text part has loaded. */
  description: string | undefined;
  /** The description is the English text although German was asked. */
  descriptionFallback: boolean;
  allowlist: boolean;
  /** Name of the base species of a forme, for "Forme of X". */
  baseName: string | null;
  onAct: (action: BulkAction) => void;
}

/**
 * The details and the real buttons for the active entry, below the list. Hover is never the only way to read a
 * description: whatever the keyboard or pointer rests on shows here, with the same actions as the card but as ordinary
 * buttons (which is also what a touch screen and a screen reader use).
 */
export default function DetailBar({ entry, state, name, tier, description, descriptionFallback, allowlist, baseName, onAct }: DetailBarProps) {
  const t = useT(rulesetStudioPickerMessages);
  const tWiki = useT(wikiMessages);
  const dataLocale = useDataLocale();

  if (entry === null || state === null) {
    return (
      <section aria-label={t('detail.heading')} className="rounded-poke-md border border-dashed border-poke-border bg-poke-surface p-3 text-sm text-poke-text-muted">
        {t('detail.none')}
      </section>
    );
  }
  const legal = isLegalState(state);
  const button = 'min-h-11 sm:min-h-0';

  return (
    <section aria-label={t('detail.heading')} className="flex flex-wrap items-start gap-x-5 gap-y-3 rounded-poke-md border border-poke-border bg-poke-surface p-3">
      {entry.kind === 'species' && (
        <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-poke-md bg-poke-muted">
          <SpriteImg name={entry.name} alt="" loading="lazy" decoding="async" width={72} height={72} className="h-[72px] w-[72px]" />
        </div>
      )}
      {entry.kind === 'items' && entry.ic !== null && (
        <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-poke-md bg-poke-muted">
          <SheetIcon sheet="item" cell={entry.ic} scale={2} />
        </div>
      )}

      <div className="min-w-0 flex-1 basis-64 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-heading text-base font-bold text-poke-text-primary">{name}</h3>
          <StateChip state={state} label={t(`state.${state}`)} />
        </div>

        {entry.kind === 'species' && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {entry.types.map((type) => (
                <TypeBadge key={type} type={type} />
              ))}
              <span className="text-xs text-poke-text-secondary">
                {t('detail.tier')}: {tier} · {t('detail.bstTotal')}: {entry.bst}
              </span>
            </div>
            <dl className="grid max-w-md grid-cols-[auto_2.5rem_1fr] items-center gap-x-2 gap-y-0.5 text-xs" aria-label={t('detail.bst')}>
              {STAT_KEYS.map((stat, i) => (
                <div key={stat} className="contents">
                  <dt className="text-poke-text-secondary">{localizeStat(stat, dataLocale, 'short')}</dt>
                  <dd className="text-right font-semibold tabular-nums text-poke-text-primary">{entry.stats[i]}</dd>
                  <dd aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-poke-muted">
                    <span className="block h-full rounded-full bg-poke-accent" style={{ width: `${Math.min(100, (entry.stats[i] / STAT_MAX) * 100)}%` }} />
                  </dd>
                </div>
              ))}
            </dl>
            {entry.mega ? (
              <p className="text-xs text-poke-text-muted">{t('detail.mega')}</p>
            ) : (
              baseName !== null && <p className="text-xs text-poke-text-muted">{t('detail.forme', { name: baseName })}</p>
            )}
          </>
        )}

        {entry.kind === 'moves' && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-poke-text-secondary">
            <TypeBadge type={entry.type} />
            <span className="inline-flex items-center gap-1">
              <CategoryIcon category={entry.category} size={14} />
              {localizeMoveCategory(entry.category, dataLocale)}
            </span>
            <span>
              {t('detail.power')}: {entry.power > 0 ? entry.power : '–'}
            </span>
            <span>
              {t('detail.accuracy')}: {entry.accuracy === null ? t('detail.neverMisses') : entry.accuracy}
            </span>
            <span>
              {t('detail.pp')}: {entry.pp}
            </span>
          </p>
        )}

        {entry.kind === 'items' && <p className="text-xs text-poke-text-secondary">{tWiki.dynamic(`itemCategory.${WIKI_ITEM_CATEGORY_KEYS[entry.category]}`)}</p>}

        {entry.kind !== 'species' && (
          <p className="max-w-prose text-sm text-poke-text-secondary">
            {description ?? t('detail.descLoading')}
            {descriptionFallback && <DescFallbackTag descLang="en" />}
          </p>
        )}

        <p className="text-xs text-poke-text-muted">
          {t('detail.introduced', { gen: entry.gen })}
          {entry.past && ` · ${t('detail.past')}`}
          {entry.kind === 'species' && entry.future && ` · ${t('detail.future')}`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={name}>
        {allowlist ? (
          <Button type="button" variant={legal ? 'secondary' : 'primary'} size="sm" className={button} onClick={() => onAct('toggle')}>
            {legal ? <Minus className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {legal ? t('action.disallowShort') : t('action.allowShort')}
          </Button>
        ) : (
          <Button type="button" variant={legal ? 'danger' : 'success'} size="sm" className={button} onClick={() => onAct('toggle')}>
            {legal ? <Ban className="h-4 w-4" aria-hidden="true" /> : <LockOpen className="h-4 w-4" aria-hidden="true" />}
            {legal ? t('action.banShort') : t('action.unbanShort')}
          </Button>
        )}
        {!allowlist && isAuthorState(state) && (
          <Button type="button" variant="ghost" size="sm" className={button} onClick={() => onAct('reset')} aria-label={t('action.resetName', { name })}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('action.reset')}
          </Button>
        )}
      </div>
    </section>
  );
}
