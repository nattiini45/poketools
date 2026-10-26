'use client';

import RulesetPresetSelect from '@/components/ruleset/RulesetPresetSelect';
import { FieldMessage, useFieldState } from './FieldMessage';

interface RulesetPresetFieldProps {
  /** The JSON pointer of the preset id; it gives the control its id and finds its findings. */
  pointer: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  className?: string;
}

/** The rule preset picker as an editor field: its findings are tied to the select with ARIA. */
export default function RulesetPresetField({ pointer, label, value, onChange, hint, className }: RulesetPresetFieldProps) {
  const state = useFieldState(pointer, { hint: hint ?? null });
  return (
    <div className={className}>
      <RulesetPresetSelect
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
