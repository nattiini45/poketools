'use client';

/**
 * One line on the roster wall (draft-frontend §5.5 `RosterCard`, SPEC:200-215). Presentational: it shows
 * state the snapshot decided (FR-3) and never picks. A click pins the line; the wall handles the keys.
 *
 * - Skewed frame (−6° on phones, −8° from lg) with counter-skewed content; price badge top-right; favourite
 *   star top-left (a pointer-only shortcut, no nested control inside the option; the `f` key toggles it); stage-1 sprite; base display name in the strip.
 * - Branch marker when the base species starts more than one line: the final stage's mini sprite and name.
 * - Drafted: red wash plus the owner's name (colour is never the only signal). Mine: green wash.
 *   Blocked (line-level reasons only, FR-10): dimmed, greyscale, lock glyph, the reason in the label.
 * Colours are theme tokens with `--poke-*` fallbacks (no fixed dark fill).
 */
import type { Ref } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import type { CardState } from '@/lib/draft-ui/snapshot-adapter';
import { cn } from '@/lib/utils/cn';

export interface RosterCardProps {
  entry: DraftLineCatalogEntry;
  state: CardState;
  /** The owner's display name for a drafted line; null when unknown. */
  ownerName: string | null;
  isPinned: boolean;
  isFavorite: boolean;
  inCompare: boolean;
  /** The translated line-level reason of a blocked card. */
  reasonText: string | null;
  names: NameResolver;
  dl: Locale;
  /** Roving tab stop of the wall (0 or −1). */
  tabIndex?: number;
  cardRef?: Ref<HTMLDivElement>;
  /** DOM id (the wall's `aria-activedescendant`-free roving focus does not need it; tests and anchors do). */
  id?: string;
  onSelect?(): void;
  onToggleFavorite?(): void;
  onFocus?(el: HTMLElement): void;
  onHoverStart?(el: HTMLElement): void;
  onHoverEnd?(): void;
}

const STATE_FRAME: Record<CardState, string> = {
  available: 'border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-surface,var(--poke-surface))]',
  drafted:
    'border-[var(--draft-taken-border,var(--poke-danger))] bg-[var(--draft-taken-bg,var(--poke-danger-light))]',
  mine: 'border-[var(--poke-green)] bg-[var(--poke-green-light)]',
  blocked:
    'border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-surface,var(--poke-surface))] opacity-[var(--draft-blocked-opacity,0.45)] grayscale',
};

const STRIP_INK: Record<CardState, string> = {
  available: 'text-[var(--draft-ink,var(--poke-text-primary))]',
  drafted: 'text-[var(--draft-taken-ink,var(--poke-danger-ink))]',
  mine: 'text-[var(--poke-green)]',
  blocked: 'text-[var(--draft-ink-2,var(--poke-text-secondary))]',
};

function LockGlyph() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <path d="M3 5V3.5a3 3 0 0 1 6 0V5h.5a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1H3Zm1.5 0h3V3.5a1.5 1.5 0 0 0-3 0V5Z" />
    </svg>
  );
}

export default function RosterCard({
  entry,
  state,
  ownerName,
  isPinned,
  isFavorite,
  inCompare,
  reasonText,
  names,
  dl,
  tabIndex = -1,
  cardRef,
  id,
  onSelect,
  onToggleFavorite,
  onFocus,
  onHoverStart,
  onHoverEnd,
}: RosterCardProps) {
  const t = useT(draftFinderMessages);
  const ts = useT(draftSharedMessages);
  const tg = useT(glossaryMessages);

  const base = entry.stages[0];
  const final = entry.stages[entry.stages.length - 1];
  const stage3 = entry.stages.find((s) => s.stage === 3)?.name ?? null;
  const baseName = names.species(base.name, dl);
  const lineLabel = names.lineLabel(base.name, stage3, dl);
  const branched = entry.branch.count > 1 && final !== base;
  const branchText = branched ? t('card.branchTag', { stage3: names.species(final.name, dl) }) : null;

  const ownerText =
    state === 'drafted'
      ? ownerName
        ? t('card.drafted', { player: ownerName })
        : t('card.draftedUnknown')
      : state === 'mine'
        ? t('card.mine')
        : null;
  const stateText =
    state === 'available'
      ? t('card.available')
      : state === 'blocked'
        ? t('card.blocked', { reason: reasonText ?? tg('state.notDraftable') })
        : (ownerText ?? '');
  const ariaLabel = t('card.aria', { line: lineLabel, price: entry.price, state: stateText });

  return (
    <div
      ref={cardRef}
      id={id}
      role="option"
      aria-selected={isPinned}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      title={state === 'blocked' && reasonText ? reasonText : undefined}
      data-line-id={entry.lineId}
      data-state={state}
      onClick={() => onSelect?.()}
      onFocus={(e) => onFocus?.(e.currentTarget)}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') onHoverStart?.(e.currentTarget);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') onHoverEnd?.();
      }}
      className={cn(
        'group relative min-h-[84px] cursor-pointer select-none rounded-md border-2 -skew-x-6 lg:-skew-x-[8deg]',
        'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--poke-focus)]',
        'motion-safe:transition-[transform,border-color,box-shadow] motion-safe:duration-[120ms] motion-safe:hover:-translate-y-0.5',
        STATE_FRAME[state],
        isPinned &&
          'border-[3px] border-[var(--draft-accent,var(--poke-accent))] shadow-[0_0_0_4px_var(--draft-glow,var(--poke-accent-light))]',
      )}
    >
      <div className="flex h-full flex-col items-center skew-x-6 px-1 pb-1 pt-4 lg:skew-x-[8deg]">
        {/* A pointer shortcut only: no focusable control inside role="option" (keyboard: the wall's `f` key). */}
        <span
          aria-hidden="true"
          data-favorite={isFavorite ? 'true' : 'false'}
          title={isFavorite ? t('card.favoriteRemove', { line: lineLabel }) : t('card.favoriteAdd', { line: lineLabel })}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite?.();
          }}
          className={cn(
            'absolute left-1 top-0.5 cursor-pointer text-sm leading-none',
            isFavorite
              ? 'text-[var(--draft-accent,var(--poke-accent))]'
              : 'text-[var(--draft-ink-2,var(--poke-text-muted))] opacity-60 group-hover:opacity-100',
          )}
        >
          {isFavorite ? '★' : '☆'}
        </span>
        <span
          className="absolute right-1 top-0.5 rounded-full bg-[var(--draft-accent,var(--poke-accent))] px-1.5 text-[11px] font-bold leading-4 text-[var(--poke-surface)]"
          aria-hidden="true"
        >
          {ts('points', { n: entry.price })}
        </span>
        {inCompare && (
          <span
            className="absolute bottom-6 left-1 text-[10px] text-[var(--draft-accent,var(--poke-accent))]"
            title={t('card.inCompare')}
            aria-hidden="true"
          >
            ⧉
          </span>
        )}
        {state === 'blocked' && (
          <span className="absolute bottom-6 right-1 text-[var(--draft-ink-2,var(--poke-text-secondary))]">
            <LockGlyph />
          </span>
        )}
        <PokemonSprite name={base.name} size={56} />
        <span
          className="mt-auto block w-full truncate text-center text-xs font-semibold text-[var(--draft-ink,var(--poke-text-primary))]"
          title={baseName}
          aria-hidden="true"
        >
          {baseName}
        </span>
        {ownerText && (
          <span
            className={cn('block w-full truncate text-center text-[10px] font-semibold', STRIP_INK[state])}
            title={ownerText}
            aria-hidden="true"
          >
            {ownerText}
          </span>
        )}
        {branchText && (
          <span
            className="mt-0.5 flex w-full items-center justify-center gap-0.5 text-[10px] text-[var(--draft-ink-2,var(--poke-text-secondary))]"
            title={branchText}
            aria-hidden="true"
          >
            <PokemonSprite name={final.name} size={24} />
            <span className="truncate">{branchText}</span>
          </span>
        )}
      </div>
    </div>
  );
}
