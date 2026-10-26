'use client';

/**
 * Defensive matchups (draft-frontend §4.5, §4.7, FR-9; the group was called "Advanced"): pick a relation
 * (resists / immune / weak), then the attacking types. Each picked pair is its own criterion. "Count
 * abilities" (default on) lets abilities such as Levitate count for resist/immune; weaknesses always count
 * the typing only. The picked relation is finder view state (`filterSheet.defenseRelation`), so it survives
 * closing the sheet.
 */
import SegmentedControl from '@/components/draft-tool/shared/SegmentedControl';
import TypeBadge from '@/components/shared/TypeBadge';
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import type { DefenseRelation } from '@/lib/draft-finder/filter-types';
import { cn } from '@/lib/utils/cn';
import { ALL_TYPES } from './TypeFilter';
import { FOCUS_RING, type FilterSectionProps } from './types';

const RELATIONS: readonly DefenseRelation[] = ['resists', 'immune', 'weak'];

export default function DefenseFilter({ view, dispatch, names, dl }: FilterSectionProps) {
  const t = useT(draftFinderMessages);
  const heading = t('filters.groups.defense');
  const relation = view.filterSheet.defenseRelation;
  const setRelation = (next: DefenseRelation) => dispatch({ type: 'setDefenseRelation', relation: next });
  const picked = view.filters.defense;

  return (
    <section aria-label={heading}>
      <SegmentedControl<DefenseRelation>
        value={relation}
        onChange={setRelation}
        ariaLabel={t('defense.relationLabel')}
        className="mb-2"
        options={RELATIONS.map((r) => {
          const count = picked.filter((d) => d.relation === r).length;
          return { value: r, label: count > 0 ? `${t(`defense.relation.${r}`)} (${count})` : t(`defense.relation.${r}`) };
        })}
      />

      <div role="group" aria-label={t('defense.typesLabel')} className="flex flex-wrap gap-1.5">
        {ALL_TYPES.map((type) => {
          const pressed = picked.some((d) => d.relation === relation && d.type === type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={pressed}
              aria-label={t(`defense.${relation}`, { type: names.type(type, dl) })}
              onClick={() => dispatch({ type: 'toggleDefense', relation, t: type })}
              className={cn(
                'rounded-full',
                pressed ? 'ring-2 ring-[var(--draft-accent,var(--poke-accent))] ring-offset-1' : 'opacity-60 hover:opacity-100',
                FOCUS_RING,
              )}
            >
              <TypeBadge type={type} />
            </button>
          );
        })}
      </div>

      {relation === 'weak' ? (
        <p className="mt-2 text-xs text-[var(--draft-ink-2,var(--poke-text-secondary))]">{t('defense.weakTypingOnly')}</p>
      ) : (
        <label className="mt-2 flex min-h-[44px] cursor-pointer items-start gap-2 py-1 text-sm md:min-h-0 text-[var(--draft-ink,var(--poke-text-primary))]">
          <input
            type="checkbox"
            checked={view.filters.abilityDefense}
            onChange={(e) => dispatch({ type: 'setAbilityDefense', on: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-[var(--draft-accent,var(--poke-accent))]"
          />
          <span>
            {t('defense.abilities')}
            <span className="block text-xs text-[var(--draft-ink-2,var(--poke-text-secondary))]">
              {t('defense.abilitiesHint')}
            </span>
          </span>
        </label>
      )}
    </section>
  );
}
