'use client';

import { useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/i18n/client';
import { homeMessages } from '@/i18n/messages/home';
import styles from './HeroBall.module.css';

/**
 * The home hero's Pokéball. It stays closed — no splitting animation — and advances one design on each
 * new pointer entry: Poké Ball → Great Ball → Ultra Ball → Master Ball → repeat. A hovering pointer (mouse, pen)
 * cycles on entry and its click does not step again; a touch tap and keyboard activation (Enter/Space) cycle
 * through the click, so no one is stuck. Focus alone does not cycle, so tabbing past never changes the design.
 * The design swap is instant; a short scale pop is the only flourish and is opted into only under
 * `prefers-reduced-motion: no-preference` (HeroBall.module.css), so reduced motion switches with no motion.
 *
 * Pure inline vector art, no asset fetch. The shared inks reuse the static `art.ball-*` tokens (palette- and
 * theme-independent, like `shared/Pokeball`); the variant-specific inks below are static art constants, never
 * palette tokens, so the ball looks the same in every site palette and both themes.
 */
const VARIANTS = ['poke', 'great', 'ultra', 'master'] as const;
type Variant = (typeof VARIANTS)[number];

const INK = 'var(--color-art-ball-ink)';
const SHELL = 'var(--color-art-ball-shell)';
const RED = 'var(--color-art-ball-red)';
const GREAT_BLUE = '#2563EB';
const ULTRA_DARK = '#1F2937';
const ULTRA_YELLOW = '#FACC15';
const MASTER_PURPLE = '#7C3AED';
const MASTER_PINK = '#EC4899';

const TOP: Record<Variant, string> = {
  poke: RED,
  great: GREAT_BLUE,
  ultra: ULTRA_DARK,
  master: MASTER_PURPLE,
};

function Markings({ variant }: { variant: Variant }) {
  switch (variant) {
    case 'great':
      return (
        <g fill={RED}>
          <rect x="26" y="14" width="7" height="26" rx="3.5" transform="rotate(-22 29.5 27)" />
          <rect x="67" y="14" width="7" height="26" rx="3.5" transform="rotate(22 70.5 27)" />
        </g>
      );
    case 'ultra':
      return (
        <g fill={ULTRA_YELLOW}>
          <rect x="22" y="15" width="56" height="6" rx="3" />
          <rect x="24" y="15" width="6" height="24" rx="3" />
          <rect x="70" y="15" width="6" height="24" rx="3" />
        </g>
      );
    case 'master':
      return (
        <g>
          <circle cx="30" cy="22" r="7" fill={MASTER_PINK} />
          <circle cx="70" cy="22" r="7" fill={MASTER_PINK} />
          <path d="M42 37 V25 L50 33 L58 25 V37" fill="none" stroke={SHELL} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    default:
      return null;
  }
}

export default function HeroBall({ className }: { className?: string }) {
  const t = useT(homeMessages);
  const [index, setIndex] = useState(0);
  const clipId = `heroball-${useId().replace(/:/g, '')}`;
  const variant = VARIANTS[index];
  const lastPointer = useRef('');
  const cycle = () => setIndex((i) => (i + 1) % VARIANTS.length);
  const hovering = (pointerType: string) => pointerType === 'mouse' || pointerType === 'pen';
  const names: Record<Variant, string> = {
    poke: t('hero.ball.names.poke'),
    great: t('hero.ball.names.great'),
    ultra: t('hero.ball.names.ultra'),
    master: t('hero.ball.names.master'),
  };

  return (
    <button
      type="button"
      aria-label={t('hero.ball.label', { name: names[variant] })}
      title={t('hero.ball.hint')}
      className={cn(
        'relative block rounded-full focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink',
        className,
      )}
      onPointerEnter={(e) => {
        lastPointer.current = e.pointerType;
        if (hovering(e.pointerType)) cycle();
      }}
      onPointerDown={(e) => {
        lastPointer.current = e.pointerType;
      }}
      onClick={(e) => {
        if (e.detail > 0 && hovering(lastPointer.current)) return;
        cycle();
      }}
    >
      <svg key={variant} viewBox="0 0 100 100" aria-hidden="true" focusable="false" className={cn(styles.ball, styles.pop)}>
        <defs>
          <clipPath id={clipId}>
            <circle cx="50" cy="50" r="44" />
          </clipPath>
        </defs>
        <circle cx="50" cy="50" r="48" fill={INK} />
        <g clipPath={`url(#${clipId})`}>
          <rect x="6" y="6" width="88" height="44" fill={TOP[variant]} />
          <rect x="6" y="50" width="88" height="44" fill={SHELL} />
          <Markings variant={variant} />
          {(variant === 'poke' || variant === 'great') && (
            <ellipse cx="33" cy="17" rx="8" ry="5" fill={SHELL} opacity="0.3" />
          )}
          <rect x="6" y="45" width="88" height="10" fill={INK} />
          <circle cx="50" cy="50" r="13" fill={INK} />
          <circle cx="50" cy="50" r="8" fill={SHELL} />
        </g>
      </svg>
    </button>
  );
}