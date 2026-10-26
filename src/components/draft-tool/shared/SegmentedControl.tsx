'use client';

/**
 * The draft room's segmented switch: a row of mutually exclusive options as one radio group (the stage mode
 * and the Base/Final sort stage of the finder bar, "Any / Require all" and the defensive relation of the
 * filter sheet).
 *
 * Markup: `role="radiogroup"` with one `role="radio"` button per option, `aria-checked` on the selected one and
 * a roving tab stop (only the selected option is tabbable). The arrow keys move the selection and the focus
 * together (Left/Up back, Right/Down forward, wrapping at both ends), Home and End jump to the first and last
 * option; options marked `disabled` are skipped. The selected option is filled with the accent colour, the
 * others use the surface. `disabled` mutes the whole control (`aria-disabled`, disabled buttons) while it keeps
 * its place, for a switch that does not apply to the current state.
 *
 * Phones get a 44 px touch target; from `md` up the control is as tall as its text.
 */
import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils/cn';
import { FOCUS_RING } from '../right/filters/types';

export interface SegmentedOption<V extends string> {
  value: V;
  /** Already translated. */
  label: string;
  /** This option cannot be selected (skipped by the keyboard). */
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string> {
  value: V;
  onChange(value: V): void;
  options: readonly SegmentedOption<V>[];
  /** The programmatic name of the group (what the switch decides). */
  ariaLabel: string;
  /** The whole control does not apply right now: muted, not operable, but still rendered. */
  disabled?: boolean;
  className?: string;
}

/**
 * The option a key press selects, or null when the key is not a navigation key or no option can be selected.
 * Pure, so the keyboard contract is unit-tested without a DOM.
 */
export function stepSegment<V extends string>(options: readonly SegmentedOption<V>[], current: V, key: string): V | null {
  const enabled = options.filter((o) => !o.disabled);
  if (enabled.length === 0) return null;
  if (key === 'Home') return enabled[0].value;
  if (key === 'End') return enabled[enabled.length - 1].value;
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (step === 0) return null;
  const at = enabled.findIndex((o) => o.value === current);
  // A current value outside the enabled options starts from the matching end.
  if (at < 0) return enabled[step > 0 ? 0 : enabled.length - 1].value;
  return enabled[(at + step + enabled.length) % enabled.length].value;
}

export default function SegmentedControl<V extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled = false,
  className,
}: SegmentedControlProps<V>) {
  const buttons = useRef(new Map<V, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = stepSegment(options, value, event.key);
    if (next === null) return;
    event.preventDefault();
    if (next !== value) onChange(next);
    buttons.current.get(next)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex shrink-0 overflow-hidden rounded-poke-md border border-[var(--draft-border,var(--poke-border))]',
        disabled && 'opacity-60',
        className,
      )}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              if (el) buttons.current.set(option.value, el);
              else buttons.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-[44px] px-3 text-xs font-semibold md:min-h-0 md:py-1.5',
              checked
                ? 'bg-[var(--draft-accent,var(--poke-accent))] text-[var(--poke-surface)]'
                : 'bg-[var(--draft-surface,var(--poke-surface))] text-[var(--draft-ink-2,var(--poke-text-secondary))]',
              (disabled || option.disabled) && 'cursor-not-allowed',
              FOCUS_RING,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
