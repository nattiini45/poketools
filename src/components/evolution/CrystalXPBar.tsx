'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useT } from '@/i18n/client';
import { draftLegacyEvolutionMessages } from '@/i18n/messages/draft/legacy/evolution';
import SpriteImg from '@/components/shared/SpriteImg';

interface CrystalXPBarProps {
  /** Current progress (e.g. 7) */
  current: number;
  /** Maximum progress for current stage (e.g. 10) */
  max: number;
  /** Label shown above the bar, already localized (e.g. "Haunter") */
  label?: string;
  /** New progress to animate from (triggers animation when different from current) */
  previousValue?: number;
  /** Whether this is an evolution event (stronger animation) */
  isEvolution?: boolean;
  /** Shorter animation (e.g. the second step of an instant-final-stage line) */
  isCompact?: boolean;
  /** Source of new progress for the +N display, already translated */
  progressSource?: string;
  /** Progress carried to the next stage after evolution (overflow) */
  overflowAfter?: number;
  /** Max for the post-evolution bar segment */
  nextMax?: number;
  /** Callback when animation completes */
  onAnimationComplete?: () => void;
  /**
   * Canonical English species name of the current form. The sprite renders in
   * the viewer's style through `SpriteImg`, which steps down the fallback chain
   * on a load error (docs/pkmn.md, "Sprite styles").
   */
  spriteSpecies?: string;
  /** Species name of the next form (shown after evolution climax) */
  nextSpriteSpecies?: string;
  /** Display name after evolution, already localized */
  nextLabel?: string;
}

type AnimationPhase =
  | 'idle'
  | 'filling'
  | 'crystal-pop'
  | 'particles'
  | 'evolved'
  | 'overflow-fill'
  | 'done';

/**
 * Crystal XP Bar — Pokémon Crystal inspired pixel-art progress bar.
 */
export default function CrystalXPBar({
  current,
  max,
  label,
  previousValue,
  isEvolution = false,
  isCompact = false,
  progressSource,
  overflowAfter = 0,
  nextMax,
  onAnimationComplete,
  spriteSpecies,
  nextSpriteSpecies,
  nextLabel,
}: CrystalXPBarProps) {
  const t = useT(draftLegacyEvolutionMessages);
  const [phase, setPhase] = useState<AnimationPhase>('idle');
  const [displayValue, setDisplayValue] = useState(previousValue ?? current);
  const [displayMax, setDisplayMax] = useState(max);
  const [displayLabel, setDisplayLabel] = useState(label);
  const [displaySprite, setDisplaySprite] = useState(spriteSpecies);
  const [showBonus, setShowBonus] = useState<string | null>(null);
  const hasAnimatedRef = useRef(false);
  const animationRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const handler = (e: MediaQueryListEvent) => { reducedMotionRef.current = e.matches; };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const clearTimers = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const finish = useCallback(() => {
    setPhase('done');
    onAnimationComplete?.();
  }, [onAnimationComplete]);

  const skipAnimation = useCallback(() => {
    clearTimers();
    if (isEvolution && nextLabel) {
      setDisplayLabel(nextLabel);
      setDisplaySprite(nextSpriteSpecies ?? spriteSpecies);
    }
    setDisplayValue(overflowAfter > 0 ? overflowAfter : (isEvolution ? 0 : current));
    setDisplayMax(nextMax ?? max);
    setPhase('done');
    setShowBonus(null);
    onAnimationComplete?.();
  }, [clearTimers, isEvolution, nextLabel, nextSpriteSpecies, spriteSpecies, overflowAfter, nextMax, max, current, onAnimationComplete]);

  useEffect(() => {
    if (previousValue === undefined || previousValue === current || hasAnimatedRef.current) return;
    hasAnimatedRef.current = true;

    if (reducedMotionRef.current) {
      const t = setTimeout(() => {
        if (isEvolution && nextLabel) {
          setDisplayLabel(nextLabel);
          setDisplaySprite(nextSpriteSpecies ?? spriteSpecies);
        }
        setDisplayValue(overflowAfter > 0 ? overflowAfter : current);
        setDisplayMax(nextMax ?? max);
        setPhase('done');
        onAnimationComplete?.();
      }, 0);
      return () => clearTimeout(t);
    }

    const bonus = current - previousValue;
    const fillTarget = isEvolution ? max : current;
    const fillDuration = isCompact ? 400 : isEvolution ? 1200 : 600;

    const initTimeout = setTimeout(() => {
      setShowBonus(progressSource ?? `+${bonus}`);
      setPhase('filling');
    }, 0);

    const startTime = performance.now();
    const startVal = previousValue;

    const animateFill = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / fillDuration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(startVal + (fillTarget - startVal) * eased));

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animateFill);
      } else {
        setShowBonus(null);
        setDisplayValue(fillTarget);
        if (isEvolution) {
          setPhase('crystal-pop');
          const popMs = isCompact ? 200 : 400;
          const particleMs = isCompact ? 350 : 600;
          const evolveMs = isCompact ? 400 : 800;
          timeoutRef.current = setTimeout(() => {
            setPhase('particles');
            timeoutRef.current = setTimeout(() => {
              setPhase('evolved');
              if (nextLabel) setDisplayLabel(nextLabel);
              if (nextSpriteSpecies) setDisplaySprite(nextSpriteSpecies);
              setDisplayValue(0);
              if (nextMax) setDisplayMax(nextMax);
              timeoutRef.current = setTimeout(() => {
                if (overflowAfter > 0) {
                  setPhase('overflow-fill');
                  const oStart = performance.now();
                  const oDur = isCompact ? 300 : 500;
                  const animateOverflow = (t: number) => {
                    const p = Math.min((t - oStart) / oDur, 1);
                    setDisplayValue(Math.round(overflowAfter * p));
                    if (p < 1) animationRef.current = requestAnimationFrame(animateOverflow);
                    else finish();
                  };
                  animationRef.current = requestAnimationFrame(animateOverflow);
                } else {
                  finish();
                }
              }, evolveMs);
            }, particleMs);
          }, popMs);
        } else {
          setPhase('crystal-pop');
          timeoutRef.current = setTimeout(finish, 300);
        }
      }
    };

    animationRef.current = requestAnimationFrame(animateFill);

    return () => {
      clearTimeout(initTimeout);
      clearTimers();
    };
  }, [
    previousValue, current, isEvolution, isCompact, progressSource,
    max, overflowAfter, nextMax, nextLabel, nextSpriteSpecies, spriteSpecies,
    clearTimers, finish, onAnimationComplete,
  ]);

  const percent = displayMax > 0 ? (displayValue / displayMax) * 100 : 0;
  const isAnimating = phase !== 'idle' && phase !== 'done';

  return (
    <div
      className="relative select-none"
      role="progressbar"
      aria-valuenow={displayValue}
      aria-valuemin={0}
      aria-valuemax={displayMax}
      aria-label={
        displayLabel
          ? t('xpBar.ariaNamed', { name: displayLabel, value: displayValue, max: displayMax })
          : t('xpBar.aria', { value: displayValue, max: displayMax })
      }
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {displaySprite && (
            <SpriteImg
              name={displaySprite}
              alt=""
              width={32}
              height={32}
              className={`h-8 w-8 pixelated motion-safe:transition-transform motion-safe:duration-300 ${
                phase === 'evolved' ? 'scale-110' : ''
              }`}
              style={{ imageRendering: 'pixelated' }}
            />
          )}
          {displayLabel && <span className="text-sm font-medium">{displayLabel}</span>}
        </div>
        <span className="font-mono text-xs text-poke-text-secondary">
          {displayValue} / {displayMax}
        </span>
      </div>

      <div className="relative h-4 overflow-visible rounded-sm border-2 border-blue-900/60 bg-gray-900">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-600 to-cyan-400"
          style={{ width: `${percent}%` }}
        >
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(0,0,0,0.3) 3px, rgba(0,0,0,0.3) 4px)',
            }}
          />
        </div>

        <div
          className={`absolute top-1/2 -translate-y-1/2 motion-safe:transition-transform motion-safe:duration-200 ${
            phase === 'crystal-pop' ? 'scale-150' : 'scale-100'
          } ${phase === 'particles' || phase === 'evolved' ? 'opacity-0 scale-0' : 'opacity-100'}`}
          style={{ left: `calc(${Math.min(percent, 100)}% - 6px)` }}
        >
          <div className="h-3 w-3 rotate-45 rounded-[2px] bg-cyan-300 shadow-[0_0_6px_rgba(103,232,249,0.8)]" />
        </div>

        {/* Arc particles (bottom sweep, not radial burst) */}
        {(phase === 'particles' || phase === 'evolved') && (
          <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-6 overflow-visible">
            {Array.from({ length: isCompact ? 5 : 8 }).map((_, i) => (
              <div
                key={i}
                className="absolute h-1.5 w-1.5 rounded-[1px] bg-cyan-300"
                style={{
                  left: `calc(${percent}% + ${(i - 4) * 4}px)`,
                  bottom: 0,
                  animation: 'crystal-arc-particle 0.7s ease-out forwards',
                  animationDelay: `${i * 35}ms`,
                  ['--arc-offset' as string]: `${(i % 2 === 0 ? 1 : -1) * (8 + i * 3)}px`,
                  ['--arc-rise' as string]: `${6 + (i % 3) * 4}px`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {showBonus && (
        <div className="absolute -top-1 right-0 motion-safe:animate-bounce text-xs font-bold text-cyan-400">
          {showBonus}
        </div>
      )}

      {phase === 'evolved' && (
        <div className="absolute inset-0 motion-safe:animate-pulse rounded bg-white/15" aria-hidden />
      )}

      {isAnimating && (
        <button
          type="button"
          onClick={skipAnimation}
          className="absolute -bottom-5 right-0 text-xs text-poke-text-secondary underline hover:text-poke-text"
          aria-label={t('xpBar.skipAria')}
        >
          {t('xpBar.skip')}
        </button>
      )}

      <style jsx>{`
        @keyframes crystal-arc-particle {
          0% {
            transform: translate(0, 0) scale(1);
            opacity: 1;
          }
          50% {
            transform: translate(var(--arc-offset), calc(-1 * var(--arc-rise))) scale(0.9);
            opacity: 0.85;
          }
          100% {
            transform: translate(calc(var(--arc-offset) * 1.6), calc(var(--arc-rise) * 0.3)) scale(0.2);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
