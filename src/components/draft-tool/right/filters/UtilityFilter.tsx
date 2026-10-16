'use client';

/**
 * Utility categories (draft-frontend §4.5, FR-5, SPEC:276-304). Each category of the active format pack
 * (`epb.utility.order`) is a checkbox that selects the whole category, plus an expander listing its moves
 * and abilities:
 * - categories AND each other; the members picked inside one category OR (the engine compiles it);
 * - a member that matches only on its own (`inParentMatch: false`) carries a note;
 * - banned members (the season's ban list) stay listed with a "banned" pill and a disabled checkbox: they
 *   never match, neither through the category nor alone.
 * Category names come from the pack (`utilityLabel`); member names from the index through the name layer.
 * A member no line of the list can learn is not listed (it could never match).
 */
import { useState } from 'react';
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { utilityLabel } from '@/lib/format-pack';
import type { UtilityKey } from '@/types/draft-queue';
import { UTILITY_CATEGORIES, UTILITY_ORDER, type UtilityMember } from '@/lib/draft/utility-categories';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import { cn } from '@/lib/utils/cn';
import { FOCUS_RING, SECTION_HEADING, type FilterSectionProps } from './types';

export interface UtilityFilterProps extends FilterSectionProps {
  /** The season's banned move ids (`catalog.bannedMoves`). */
  banned: ReadonlySet<string>;
}

export interface UtilityMemberView {
  member: UtilityMember;
  /** English name from the index. */
  englishName: string;
  banned: boolean;
}

/** The members of a category that some line of the index has, in authored order. Pure. */
export function listedMembers(key: UtilityKey, ix: PreparedIndex, banned: ReadonlySet<string>): UtilityMemberView[] {
  const def = UTILITY_CATEGORIES.find((c) => c.key === key);
  if (!def) return [];
  const out: UtilityMemberView[] = [];
  for (const member of def.members) {
    const idx = member.kind === 'move' ? ix.moveIdToIdx.get(member.id) : ix.abilityIdToIdx.get(member.id);
    if (idx === undefined) continue;
    const englishName =
      member.kind === 'move' ? (ix.raw.moveNames[idx] ?? member.id) : (ix.raw.abilityNames[idx] ?? member.id);
    out.push({ member, englishName, banned: member.kind === 'move' && banned.has(member.id) });
  }
  return out;
}

export default function UtilityFilter({ view, dispatch, ix, names, dl, banned }: UtilityFilterProps) {
  const t = useT(draftFinderMessages);
  const heading = t('filters.utility');
  const [expanded, setExpanded] = useState<ReadonlySet<UtilityKey>>(
    () => new Set(view.filters.utility.filter((u) => u.members.length > 0).map((u) => u.key)),
  );
  const toggleExpanded = (key: UtilityKey) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section aria-label={heading}>
      <h3 className={SECTION_HEADING}>{heading}</h3>
      <ul className="flex flex-col gap-1">
        {UTILITY_ORDER.map((key) => {
          const category = utilityLabel(key, t.locale);
          const selection = view.filters.utility.find((u) => u.key === key);
          const isOpen = expanded.has(key);
          const members = listedMembers(key, ix, banned);
          const membersId = `draft-utility-${key}`;
          return (
            <li key={key} className="rounded-poke-md border border-[var(--draft-border,var(--poke-border))]">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <label className="flex min-h-[44px] flex-1 cursor-pointer md:min-h-[32px] items-center gap-2 text-sm font-semibold text-[var(--draft-ink,var(--poke-text-primary))]">
                  <input
                    type="checkbox"
                    checked={selection !== undefined}
                    onChange={() => dispatch({ type: 'toggleUtilityCategory', key })}
                    className="h-4 w-4 accent-[var(--draft-accent,var(--poke-accent))]"
                  />
                  <span>{category}</span>
                  {selection && selection.members.length > 0 && (
                    <span className="text-xs font-normal text-[var(--draft-ink-2,var(--poke-text-secondary))]">
                      ({selection.members.length})
                    </span>
                  )}
                </label>
                {members.length > 0 && (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={membersId}
                    aria-label={
                      isOpen ? t('utility.hideMembers', { category }) : t('utility.showMembers', { category })
                    }
                    onClick={() => toggleExpanded(key)}
                    className={cn(
                      'flex h-11 w-11 items-center md:h-8 md:w-8 justify-center rounded text-[var(--draft-ink-2,var(--poke-text-secondary))]',
                      FOCUS_RING,
                    )}
                  >
                    <span aria-hidden="true" className={cn('inline-block transition-transform', isOpen && 'rotate-180')}>
                      ▾
                    </span>
                  </button>
                )}
              </div>
              {isOpen && (
                <ul id={membersId} className="flex flex-col gap-0.5 border-t border-[var(--draft-border,var(--poke-border))] px-2 py-1.5">
                  {members.map(({ member, englishName, banned: isBanned }) => {
                    const name =
                      member.kind === 'move' ? names.move(englishName, dl) : names.ability(englishName, dl);
                    const checked = !isBanned && (selection?.members.includes(member.id) ?? false);
                    return (
                      <li key={member.id} className="text-sm">
                        <label
                          className={cn(
                            'flex min-h-[44px] items-center gap-2 md:min-h-[28px]',
                            isBanned ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isBanned}
                            onChange={() => dispatch({ type: 'toggleUtilityMember', key, id: member.id })}
                            className="h-4 w-4 accent-[var(--draft-accent,var(--poke-accent))]"
                          />
                          <span className={cn(isBanned && 'line-through')}>{name}</span>
                          {isBanned && (
                            <span className="rounded-full border border-[var(--draft-warn-ink,var(--poke-amber-ink))] px-1.5 text-[10px] font-semibold text-[var(--draft-warn-ink,var(--poke-amber-ink))]">
                              {t('utility.banned')}
                            </span>
                          )}
                        </label>
                        {!member.inParentMatch && !isBanned && (
                          <p className="ml-6 text-xs text-[var(--draft-ink-2,var(--poke-text-secondary))]">
                            {t('utility.restNote', { move: name })}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
