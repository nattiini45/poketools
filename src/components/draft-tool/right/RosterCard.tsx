'use client';

/**
 * One line on the roster wall (draft-frontend §5.5 `RosterCard`, SPEC:200-215). Presentational: it shows
 * state the snapshot decided (FR-3) and never picks. A click pins the line; the wall handles the keys.
 *
 * - Construction (`draft-tool.module.css` "Roster card"): the option itself is an unskewed grid cell; ONE
 *   decorative frame layer (`.cardFrame`) carries the slant (`--draft-card-skew`, −6° on phones, −8° from
 *   lg), the state colours, the pinned ring and the keyboard focus ring. The content is ordinary unskewed
 *   content above it: no counter-skewed child, so the card's overflow is just the frame's corner overhang,
 *   which the wall grid pads for.
 * - Rows, the same on every card: head (favourite star and the comparison glyph on the left, lock and price
 *   pill on the right, one centre line), stage-1 sprite, base display name, owner line, footer. The star is
 *   a pointer-only shortcut (a non-focusable span: no nested control inside the option; the `f` key toggles).
 * - Footer: when the base species starts more than one line (`entry.branch.count > 1`) a plate slanted like
 *   the frame (a layer inside it) shows the final stage: its sprite in a soft round blob, an arrow icon and
 *   its name (two lines at most, broken at hyphens). The slot is reserved, empty, on every other card.
 * - Drafted: red wash plus the owner's name (colour is never the only signal). Mine: green wash.
 *   Blocked (line-level reasons only, FR-10): dimmed, greyscale, lock glyph, the reason in the label.
 * - One size for every card (the `--draft-card-*` row tokens), text rows are one line with an ellipsis and a
 *   `title`, so cards with and without a branch line up. The pinned ring is a box-shadow, not a thicker
 *   border, so it does not change the card's inner size either.
 * Colours are theme tokens with `--poke-*` fallbacks (no fixed dark fill).
 */
import { ArrowRight, GitCompareArrows } from 'lucide-react';
import type { Ref } from 'react';
import FavoriteStar from '@/components/draft-tool/shared/FavoriteStar';
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
import styles from '../draft-tool.module.css';

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

/**
 * The sprites' pixel sizes (the `size` the image asks for); the boxes they fill are the CSS tokens
 * `--draft-card-sprite` (5.5rem) and `--draft-card-footer-sprite` (2.5rem). `wall-layout.test.tsx` keeps both
 * pairs in step.
 */
export const CARD_SPRITE_PX = 88;
export const FOOTER_SPRITE_PX = 40;

/** The frame layer's colours per state (its border width and slant are CSS). */
const STATE_FRAME: Record<CardState, string> = {
  available: 'border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-surface,var(--poke-surface))]',
  drafted:
    'border-[var(--draft-taken-border,var(--poke-danger))] bg-[var(--draft-taken-bg,var(--poke-danger-light))]',
  mine: 'border-[var(--poke-green)] bg-[var(--poke-green-light)]',
  blocked: 'border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-surface,var(--poke-surface))]',
};

/** A blocked line dims the whole card, content included. */
const BLOCKED_DIM = 'opacity-[var(--draft-blocked-opacity,0.45)] grayscale';

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
  const branched = entry.branch.count > 1;
  const finalName = names.species(final.name, dl);
  const branchText = branched ? t('card.branchTag', { final: finalName }) : null;

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
        styles.card,
        'group relative cursor-pointer select-none outline-none',
        'motion-safe:transition-transform motion-safe:[transition-duration:120ms] motion-safe:hover:-translate-y-0.5',
        state === 'blocked' && BLOCKED_DIM,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          styles.cardFrame,
          'motion-safe:transition-[border-color,box-shadow] motion-safe:[transition-duration:120ms]',
          STATE_FRAME[state],
          isPinned &&
            'border-[var(--draft-accent,var(--poke-accent))] shadow-[0_0_0_1px_var(--draft-accent,var(--poke-accent)),0_0_0_var(--draft-card-ring)_var(--draft-glow,var(--poke-accent-light))]',
        )}
      >
        {branched && <span className={styles.cardFooterPlate} />}
      </span>
      <span className={styles.cardHead} data-card-row="head" aria-hidden="true">
        <span className={styles.cardHeadGroup}>
          {/* A pointer shortcut only: no focusable control inside role="option" (keyboard: the wall's `f` key). */}
          <span
            data-favorite={isFavorite ? 'true' : 'false'}
            title={isFavorite ? t('card.favoriteRemove', { line: lineLabel }) : t('card.favoriteAdd', { line: lineLabel })}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite?.();
            }}
            className="inline-flex cursor-pointer"
          >
            <FavoriteStar filled={isFavorite} className="h-4 w-4" />
          </span>
          {inCompare && (
            <span className="inline-flex text-[var(--draft-accent,var(--poke-accent))]" title={t('card.inCompare')}>
              <GitCompareArrows className="h-3 w-3" aria-hidden="true" />
            </span>
          )}
        </span>
        <span className={styles.cardHeadGroup}>
          {state === 'blocked' && (
            <span className="inline-flex text-[var(--draft-ink-2,var(--poke-text-secondary))]">
              <LockGlyph />
            </span>
          )}
          <span className="rounded-full bg-[var(--draft-accent-fill,var(--poke-accent))] px-2 text-[11px] font-bold leading-5 text-[var(--poke-surface)]">
            {ts('points', { n: entry.price })}
          </span>
        </span>
      </span>
      <span className={styles.cardSprite} data-card-row="sprite">
        <PokemonSprite name={base.name} size={CARD_SPRITE_PX} className="h-full w-full" />
      </span>
      <span
        className={cn(styles.cardName, 'text-xs font-semibold text-[var(--draft-ink,var(--poke-text-primary))]')}
        data-card-row="name"
        title={baseName}
        aria-hidden="true"
      >
        {baseName}
      </span>
      {/* Always rendered (empty when available or blocked), so every card keeps the same rows. */}
      <span
        className={cn(styles.cardMeta, 'text-[10px] font-semibold', STRIP_INK[state])}
        data-card-row="meta"
        title={ownerText ?? undefined}
        aria-hidden="true"
      >
        {ownerText}
      </span>
      {/* Always reserved: empty when the line has no branch, so names align across the wall. */}
      <span
        className={cn(styles.cardFooter, 'text-xs font-semibold leading-4 text-[var(--draft-ink,var(--poke-text-primary))]')}
        data-card-row="footer"
        data-branch={branchText ? 'true' : 'false'}
        title={branchText ?? undefined}
        aria-hidden="true"
      >
        {branchText ? (
          <>
            <span className={styles.cardFooterBlob}>
              <PokemonSprite name={final.name} size={FOOTER_SPRITE_PX} className="h-full w-full" />
            </span>
            <ArrowRight className={cn(styles.cardFooterArrow, 'text-[var(--draft-ink-2,var(--poke-text-secondary))]')} strokeWidth={2.5} aria-hidden="true" />
            <span className={styles.cardFooterName}>{finalName}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}
