'use client';

import { useState, type ReactNode } from 'react';
import TypeBadge from '@/components/shared/TypeBadge';
import { useT } from '@/i18n/client';
import { rulesetStudioPickerMessages } from '@/i18n/messages/ruleset-studio/picker';
import { wikiMessages } from '@/i18n/messages/wiki';
import { MOVE_CATEGORY_NAMES, type CatalogKind } from '@/lib/pkmn/catalog-index';
import { localizeMoveCategory } from '@/lib/pkmn/i18n/names/misc';
import { TYPES } from '@/lib/pkmn/type-chart';
import { WIKI_ITEM_CATEGORIES, WIKI_ITEM_CATEGORY_KEYS } from '@/lib/wiki/item-category';
import type { EntryState } from '@/lib/ruleset-kit/entry-state';
import { useDataLocale } from '@/i18n/client';
import type { FormeFacet, PickerFilters, RangeFacet, StageFacet } from '@/lib/ruleset-studio/editor/picker/view';
import { cn } from '@/lib/utils/cn';

interface FacetPanelProps {
  kind: CatalogKind;
  filters: PickerFilters;
  onChange: (next: PickerFilters) => void;
  /** The states this list can be in (a block list or an allowlist). */
  states: readonly EntryState[];
  /** Tier groups present in the catalog, best first (species only). */
  tiers: readonly string[];
  /** Generations that introduced something in the catalog, ascending. */
  gens: readonly number[];
  /** Item categories present in the catalog. */
  itemCategories: readonly string[];
}

const CHIP = 'inline-flex min-h-9 items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus sm:min-h-7';

function Chip({ pressed, onClick, children, className }: { pressed: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        CHIP,
        pressed ? 'border-poke-accent bg-poke-accent-light text-poke-text-primary' : 'border-poke-border bg-poke-surface text-poke-text-secondary hover:border-poke-border-strong hover:bg-poke-muted',
        className,
      )}
    >
      {children}
    </button>
  );
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-1.5">
      <legend className="mb-1 text-xs font-semibold text-poke-text-secondary">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

const RANGE_LIMIT = 9999;

/** Two number boxes for an inclusive range; either side may stay empty (open), both empty means no filter. */
function RangeFields({ legend, range, onChange, idPrefix }: { legend: string; range: RangeFacet | null; onChange: (next: RangeFacet | null) => void; idPrefix: string }) {
  const t = useT(rulesetStudioPickerMessages);
  const [min, setMin] = useState(range === null || range[0] === 0 ? '' : String(range[0]));
  const [max, setMax] = useState(range === null || range[1] >= RANGE_LIMIT ? '' : String(range[1]));
  const commit = (nextMin: string, nextMax: string) => {
    const low = nextMin.trim() === '' ? null : Number(nextMin);
    const high = nextMax.trim() === '' ? null : Number(nextMax);
    if ((low !== null && !Number.isFinite(low)) || (high !== null && !Number.isFinite(high)) || (low === null && high === null)) {
      onChange(null);
      return;
    }
    onChange([Math.max(0, low ?? 0), Math.min(RANGE_LIMIT, high ?? RANGE_LIMIT)]);
  };
  const box = 'h-9 w-20 rounded-poke-md border border-poke-border bg-poke-surface px-2 text-sm text-poke-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus';
  return (
    <fieldset className="min-w-0 space-y-1.5">
      <legend className="mb-1 text-xs font-semibold text-poke-text-secondary">{legend}</legend>
      <div className="flex items-center gap-2">
        <input
          id={`${idPrefix}-min`}
          type="number"
          inputMode="numeric"
          min={0}
          className={box}
          aria-label={`${legend}: ${t('filters.min')}`}
          value={min}
          onChange={(event) => {
            setMin(event.target.value);
            commit(event.target.value, max);
          }}
        />
        <span aria-hidden="true" className="text-poke-text-muted">–</span>
        <input
          id={`${idPrefix}-max`}
          type="number"
          inputMode="numeric"
          min={0}
          className={box}
          aria-label={`${legend}: ${t('filters.max')}`}
          value={max}
          onChange={(event) => {
            setMax(event.target.value);
            commit(min, event.target.value);
          }}
        />
      </div>
    </fieldset>
  );
}

/**
 * The facet filters of the picker, as groups of toggle chips (`aria-pressed`) and range boxes. What a kind offers follows
 * `view.ts`: Pokémon have type, tier, stage, forme and base stat total; moves type, category, power and accuracy; items a
 * category; every kind has the state facets and the generation it was introduced in.
 */
export default function FacetPanel({ kind, filters, onChange, states, tiers, gens, itemCategories }: FacetPanelProps) {
  const t = useT(rulesetStudioPickerMessages);
  const tWiki = useT(wikiMessages);
  const dataLocale = useDataLocale();
  const set = (patch: Partial<PickerFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="grid gap-4 rounded-poke-md border border-poke-border bg-poke-surface p-3 sm:grid-cols-2 xl:grid-cols-3">
      <Group legend={t('filters.quick')}>
        <Chip pressed={filters.changedByMe} onClick={() => set({ changedByMe: !filters.changedByMe })}>{t('filters.changedByMe')}</Chip>
        <Chip pressed={filters.fromPreset} onClick={() => set({ fromPreset: !filters.fromPreset })}>{t('filters.fromPreset')}</Chip>
        <Chip pressed={filters.legal === true} onClick={() => set({ legal: filters.legal === true ? null : true })}>{t('filters.legalOnly')}</Chip>
        <Chip pressed={filters.legal === false} onClick={() => set({ legal: filters.legal === false ? null : false })}>{t('filters.illegalOnly')}</Chip>
      </Group>

      <Group legend={t('filters.state')}>
        {states.map((state) => (
          <Chip key={state} pressed={filters.states.includes(state)} onClick={() => set({ states: toggle(filters.states, state) })}>
            {t(`state.${state}`)}
          </Chip>
        ))}
      </Group>

      {gens.length > 1 && (
        <Group legend={t('filters.generation')}>
          {gens.map((gen) => (
            <Chip key={gen} pressed={filters.gens.includes(gen)} onClick={() => set({ gens: toggle(filters.gens, gen) })}>{gen}</Chip>
          ))}
        </Group>
      )}

      {(kind === 'species' || kind === 'moves') && (
        <div className="min-w-0 space-y-2 sm:col-span-2 xl:col-span-3">
          <Group legend={t('filters.type')}>
            {TYPES.map((type) => (
              <Chip key={type} pressed={filters.types.includes(type)} onClick={() => set({ types: toggle(filters.types, type) })} className="p-0.5 pr-0.5">
                <TypeBadge type={type} className={filters.types.includes(type) ? 'ring-2 ring-poke-accent' : 'opacity-80'} />
              </Chip>
            ))}
          </Group>
          {kind === 'species' && (
            <Group legend={t('filters.typeMatch')}>
              <Chip pressed={filters.typeMatch === 'any'} onClick={() => set({ typeMatch: 'any' })}>{t('filters.typeAny')}</Chip>
              <Chip pressed={filters.typeMatch === 'all'} onClick={() => set({ typeMatch: 'all' })}>{t('filters.typeAll')}</Chip>
            </Group>
          )}
        </div>
      )}

      {kind === 'species' && (
        <>
          {tiers.length > 0 && (
            <Group legend={t('filters.tier')}>
              {tiers.map((tier) => (
                <Chip key={tier} pressed={filters.tiers.includes(tier)} onClick={() => set({ tiers: toggle(filters.tiers, tier) })}>
                  {tier === 'Untiered' ? t('list.tierUntiered') : tier}
                </Chip>
              ))}
            </Group>
          )}
          <Group legend={t('filters.stage')}>
            {(['fully_evolved', 'not_fully_evolved'] as const satisfies readonly StageFacet[]).map((stage) => (
              <Chip key={stage} pressed={filters.stages.includes(stage)} onClick={() => set({ stages: toggle(filters.stages, stage) })}>
                {stage === 'fully_evolved' ? t('filters.stageFully') : t('filters.stageNot')}
              </Chip>
            ))}
          </Group>
          <Group legend={t('filters.forme')}>
            {(['base', 'forme', 'mega'] as const satisfies readonly FormeFacet[]).map((forme) => (
              <Chip key={forme} pressed={filters.formes.includes(forme)} onClick={() => set({ formes: toggle(filters.formes, forme) })}>
                {forme === 'base' ? t('filters.formeBase') : forme === 'forme' ? t('filters.formeForme') : t('filters.formeMega')}
              </Chip>
            ))}
          </Group>
          <RangeFields key={filters.bst === null ? 'off' : 'on'} idPrefix="rp-bst" legend={t('filters.bst')} range={filters.bst} onChange={(bst) => set({ bst })} />
        </>
      )}

      {kind === 'moves' && (
        <>
          <Group legend={t('filters.category')}>
            {MOVE_CATEGORY_NAMES.map((category) => (
              <Chip key={category} pressed={filters.categories.includes(category)} onClick={() => set({ categories: toggle(filters.categories, category) })}>
                {localizeMoveCategory(category, dataLocale)}
              </Chip>
            ))}
          </Group>
          <RangeFields key={`p-${filters.power === null ? 'off' : 'on'}`} idPrefix="rp-power" legend={t('filters.power')} range={filters.power} onChange={(power) => set({ power })} />
          <RangeFields key={`a-${filters.accuracy === null ? 'off' : 'on'}`} idPrefix="rp-acc" legend={t('filters.accuracy')} range={filters.accuracy} onChange={(accuracy) => set({ accuracy })} />
        </>
      )}

      {kind === 'items' && itemCategories.length > 0 && (
        <Group legend={t('filters.category')}>
          {WIKI_ITEM_CATEGORIES.filter((category) => itemCategories.includes(category)).map((category) => (
            <Chip key={category} pressed={filters.categories.includes(category)} onClick={() => set({ categories: toggle(filters.categories, category) })}>
              {tWiki.dynamic(`itemCategory.${WIKI_ITEM_CATEGORY_KEYS[category]}`)}
            </Chip>
          ))}
        </Group>
      )}
    </div>
  );
}
