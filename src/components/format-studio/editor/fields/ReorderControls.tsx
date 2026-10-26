'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type MoveDirection = 'up' | 'down';

interface ReorderLabels {
  up: string;
  down: string;
  remove?: string;
  duplicate?: string;
}

interface ReorderControlsProps {
  index: number;
  count: number;
  /** Already-translated names of the buttons; they include the row (its name or position). */
  labels: ReorderLabels;
  /** Called with the destination index. */
  onMove: (to: number, direction: MoveDirection) => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
  /** Disables Duplicate (the list is at its limit). */
  duplicateDisabled?: boolean;
  /**
   * After a move the list sets this on the row that was moved, so focus stays on the button that was used
   * (or on the other one when the row reached an end). `onFocusHandled` clears it.
   */
  focusDirection?: MoveDirection | null;
  onFocusHandled?: () => void;
  /** Marks the buttons of one row, for tests and for finding them again. */
  rowKey?: string;
  className?: string;
}

/**
 * Remembers which row was just moved and with which button, so the list can hand it back to that row as
 * `focusDirection`. `focusFor(index)` is non-null for the moved row only, until its button took focus.
 */
export function useMoveFocus() {
  const [pending, setPending] = useState<{ index: number; direction: MoveDirection } | null>(null);
  const clear = useCallback(() => setPending(null), []);
  const mark = useCallback((index: number, direction: MoveDirection) => setPending({ index, direction }), []);
  const focusFor = (index: number): MoveDirection | null => (pending !== null && pending.index === index ? pending.direction : null);
  return { mark, clear, focusFor };
}

const BUTTON =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-poke-md border border-poke-border bg-poke-elevated text-poke-text-primary transition-colors hover:border-poke-accent hover:bg-poke-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:w-8';

/**
 * Up, down, duplicate and remove for one row of a list. Icon-only buttons, each with an accessible name that
 * says which row it acts on. Moving is by destination index; the first row cannot go up and the last cannot go
 * down (those buttons are disabled, not hidden, so the row looks the same everywhere).
 */
export default function ReorderControls({
  index,
  count,
  labels,
  onMove,
  onRemove,
  onDuplicate,
  duplicateDisabled = false,
  focusDirection = null,
  onFocusHandled,
  rowKey,
  className,
}: ReorderControlsProps) {
  const up = useRef<HTMLButtonElement>(null);
  const down = useRef<HTMLButtonElement>(null);
  const atStart = index <= 0;
  const atEnd = index >= count - 1;

  useEffect(() => {
    if (focusDirection === null) return;
    const wanted = focusDirection === 'up' ? up.current : down.current;
    const other = focusDirection === 'up' ? down.current : up.current;
    const target = wanted !== null && !wanted.disabled ? wanted : other;
    target?.focus();
    onFocusHandled?.();
  }, [focusDirection, onFocusHandled]);

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} role="group" data-row-key={rowKey}>
      <button
        ref={up}
        type="button"
        className={BUTTON}
        aria-label={labels.up}
        title={labels.up}
        disabled={atStart}
        onClick={() => onMove(index - 1, 'up')}
      >
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        ref={down}
        type="button"
        className={BUTTON}
        aria-label={labels.down}
        title={labels.down}
        disabled={atEnd}
        onClick={() => onMove(index + 1, 'down')}
      >
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
      </button>
      {onDuplicate !== undefined && labels.duplicate !== undefined && (
        <button type="button" className={BUTTON} aria-label={labels.duplicate} title={labels.duplicate} disabled={duplicateDisabled} onClick={onDuplicate}>
          <Copy className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {onRemove !== undefined && labels.remove !== undefined && (
        <button type="button" className={cn(BUTTON, 'hover:border-poke-danger hover:text-poke-danger')} aria-label={labels.remove} title={labels.remove} onClick={onRemove}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
