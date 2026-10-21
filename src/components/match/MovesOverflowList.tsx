'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from '@/components/shared/motion';
import { useDataLocale, useT } from '@/i18n/client';
import { matchMessages } from '@/i18n/messages/match';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';

interface MovesOverflowListProps {
  /** Canonical English move names; shown in the viewer's Pokémon-name language. */
  moves: string[];
  /** Extra classes applied to the inline container span. */
  className?: string;
}

/**
 * Renders a list of move names on a single line, fitting as many as possible
 * and collapsing the rest into a `+N` trigger. The trigger opens a popover
 * (hover/focus on desktop, click/tap on touch) listing every move.
 *
 * The component measures each move via a hidden sibling and a `ResizeObserver`,
 * so it reacts to container width changes. Server render shows every move
 * (no flash of empty content); the chip-fit calculation runs after mount.
 */
export default function MovesOverflowList({ moves: englishMoves, className }: MovesOverflowListProps) {
  const t = useT(matchMessages);
  const dataLocale = useDataLocale();
  const moves = useMemo(
    () => englishMoves.map((m) => localizeMove(m, dataLocale)),
    [englishMoves, dataLocale],
  );
  const containerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(moves.length);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const m = measureRef.current;
    if (!container || !m) return;
    if (moves.length === 0) {
      setVisibleCount(0);
      return;
    }

    const width = container.clientWidth;
    if (width <= 0) return;

    const tokens = Array.from(m.querySelectorAll<HTMLElement>('[data-token]'));
    const moreEl = m.querySelector<HTMLElement>('[data-more]');
    const moreWidth = moreEl?.offsetWidth ?? 0;

    if (tokens.length === 0) {
      setVisibleCount(0);
      return;
    }

    const startLeft = tokens[0].offsetLeft;
    let count = 0;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const right = tok.offsetLeft + tok.offsetWidth;
      const stillMoreLeft = i < tokens.length - 1;
      // Reserve room for the +N trigger (plus a small gap) when there are
      // more tokens after this one.
      const reserve = stillMoreLeft ? moreWidth + 6 : 0;
      if (right - startLeft + reserve > width) break;
      count = i + 1;
    }
    setVisibleCount(count);
  }, [moves]);

  useLayoutEffect(() => {
    // Defer measurement to the next frame so the layout (and the hidden
    // measure span) has settled. Setting visibleCount synchronously inside
    // the effect body would cause a cascading render; rAF lets us mutate
    // state from outside React's render phase.
    const id = requestAnimationFrame(() => measure());
    const node = containerRef.current;
    if (!node) return () => cancelAnimationFrame(id);
    const obs = new ResizeObserver(() => measure());
    obs.observe(node);
    return () => {
      cancelAnimationFrame(id);
      obs.disconnect();
    };
  }, [measure, moves]);

  useEffect(() => {
    if (!open || !triggerRef.current || !popoverRef.current) return;
    const tr = triggerRef.current.getBoundingClientRect();
    const pr = popoverRef.current.getBoundingClientRect();
    let top = tr.bottom + 6;
    if (top + pr.height > window.innerHeight - 4) {
      top = Math.max(4, tr.top - pr.height - 6);
    }
    let left = tr.left + tr.width / 2 - pr.width / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - pr.width - 4));
    setCoords({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: Event) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('touchstart', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  if (moves.length === 0) return null;

  const safeVisible = Math.max(0, Math.min(visibleCount, moves.length));
  // If we measured zero visible but there are moves, force the first one so
  // the row never collapses to bare `+N`.
  const renderVisibleCount = safeVisible === 0 && moves.length > 0 ? 1 : safeVisible;
  const visibleMoves = moves.slice(0, renderVisibleCount);
  const hiddenCount = moves.length - renderVisibleCount;

  return (
    <span
      ref={containerRef}
      className={`relative flex items-baseline gap-1 min-w-0 overflow-hidden whitespace-nowrap ${className ?? ''}`}
    >
      <span
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none absolute -top-[9999px] -left-[9999px] flex items-baseline gap-1 whitespace-nowrap invisible"
      >
        {moves.map((m, i) => (
          <span key={i} data-token>
            {m}
            {i < moves.length - 1 ? ',' : ''}
          </span>
        ))}
        <span data-more>+{moves.length}</span>
      </span>

      <span className="truncate">
        {visibleMoves.join(', ')}
        {hiddenCount > 0 ? ' ' : ''}
      </span>

      {hiddenCount > 0 && (
        <button
          ref={triggerRef}
          type="button"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((p) => !p);
          }}
          aria-label={t('moves.showMore', { count: hiddenCount })}
          aria-expanded={open}
          className="shrink-0 inline-flex items-baseline rounded px-1 -mx-0.5 text-poke-blue hover:text-poke-blue/80 underline decoration-dotted underline-offset-2 cursor-pointer"
        >
          +{hiddenCount}
        </button>
      )}

      {typeof window !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={popoverRef}
                role="dialog"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.12 }}
                className="fixed z-[9999] max-w-xs px-3 py-2 rounded-poke-md bg-poke-inverse text-poke-text-inverse text-xs font-medium shadow-poke-md"
                style={
                  coords
                    ? { top: coords.top, left: coords.left }
                    : { top: -9999, left: -9999 }
                }
              >
                <ul className="space-y-0.5">
                  {moves.map((m, i) => (
                    <li
                      key={i}
                      className={`whitespace-nowrap ${i < renderVisibleCount ? 'opacity-60' : ''}`}
                    >
                      {m}
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}
