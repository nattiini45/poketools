'use client';

import Select from '@/components/ui/Select';
import { cn } from '@/lib/utils/cn';
import { ariaOf, FieldMessage, useFieldState } from './FieldMessage';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectFieldProps {
  /** The JSON pointer of the value; it gives the control its id and finds its findings. */
  pointer: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  hint?: string;
  disabled?: boolean;
  /** Take the findings below the pointer too (a reference object whose id is the faulty part). */
  under?: boolean;
  className?: string;
}

/** A labelled select. Its findings are tied to it with `aria-describedby` and `aria-invalid`. */
export default function SelectField({
  pointer,
  label,
  value,
  options,
  onChange,
  hint,
  disabled = false,
  under = false,
  className,
}: SelectFieldProps) {
  const state = useFieldState(pointer, { hint: hint ?? null, under });
  return (
    <div className={className}>
      <Select
        id={state.id}
        label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(state.invalid && 'border-poke-danger')}
        {...ariaOf(state)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </Select>
      <FieldMessage state={state} className="mt-1" />
    </div>
  );
}

interface CheckboxFieldProps {
  pointer: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
  under?: boolean;
  className?: string;
}

/** A labelled checkbox with the same finding wiring as the other fields. */
export function CheckboxField({ pointer, label, checked, onChange, hint, disabled = false, under = false, className }: CheckboxFieldProps) {
  const state = useFieldState(pointer, { hint: hint ?? null, under });
  return (
    <div className={className}>
      <div className="flex min-h-11 items-center gap-2 sm:min-h-0">
        <input
          id={state.id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-poke-border accent-poke-accent"
          {...ariaOf(state)}
        />
        <label htmlFor={state.id} className="min-w-0 break-words text-sm text-poke-text-primary">
          {label}
        </label>
      </div>
      <FieldMessage state={state} className="mt-1" />
    </div>
  );
}
