'use client';

import ShowdownFormatSelect from '../../ShowdownFormatSelect';
import { FieldMessage, useFieldState } from './FieldMessage';

interface ShowdownFormatFieldProps {
  /** The JSON pointer of the format id; it gives the control its id and finds its findings. */
  pointer: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  className?: string;
}

/** The Showdown format picker as an editor field: its findings are tied to the select with ARIA. */
export default function ShowdownFormatField({ pointer, label, value, onChange, hint, className }: ShowdownFormatFieldProps) {
  const state = useFieldState(pointer, { hint: hint ?? null });
  return (
    <div className={className}>
      <ShowdownFormatSelect
        id={state.id}
        label={label}
        value={value}
        onChange={onChange}
        invalid={state.invalid}
        describedBy={state.describedBy}
      />
      <FieldMessage state={state} className="mt-1" />
    </div>
  );
}
