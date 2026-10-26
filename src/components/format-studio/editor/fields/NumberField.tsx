'use client';

import { useEffect, useRef, useState } from 'react';
import Input from '@/components/ui/Input';
import { useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { ariaOf, FieldMessage, useFieldState } from './FieldMessage';

export interface NumberRules {
  /** Whole numbers only. */
  integer: boolean;
  min: number;
  max: number;
}

export type ParsedNumber =
  | { ok: true; value: number }
  | { ok: false; reason: 'empty' | 'syntax' | 'integer' | 'range' };

const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;
/** One comma between digits and no point: how a German reader writes `0,5`. */
const COMMA_DECIMAL = /^-?\d+,\d+$/;

/**
 * Reads what a person typed into a number field. Plain ASCII digits only, with an optional minus sign and one
 * decimal separator: no exponent, no hex, no thousands separator, no full-width digits. The separator is a point,
 * or, in a field that takes decimals, a single comma (`0,5` is `0.5`). A whole-number field refuses the comma,
 * because `1,500` is a thousands group in English and a decimal in German. Spaces at either end are ignored and
 * `-0` is `0`. A number outside the range is refused, so the document never holds a value that was typed by
 * mistake while the field still shows what is wrong.
 */
export function parseNumberInput(text: string, rules: NumberRules): ParsedNumber {
  const typed = text.trim();
  if (typed === '') return { ok: false, reason: 'empty' };
  const trimmed = !rules.integer && COMMA_DECIMAL.test(typed) ? typed.replace(',', '.') : typed;
  if (!PLAIN_NUMBER.test(trimmed)) return { ok: false, reason: 'syntax' };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, reason: 'syntax' };
  if (rules.integer && !Number.isInteger(value)) return { ok: false, reason: 'integer' };
  if (value < rules.min || value > rules.max) return { ok: false, reason: 'range' };
  return { ok: true, value: value === 0 ? 0 : value };
}

interface NumberFieldProps extends Omit<NumberRules, 'integer'> {
  /** Whole numbers only (default); false allows one decimal separator (a point or a comma). */
  integer?: boolean;
  /** The JSON pointer of the value; it gives the control its id and finds its findings. */
  pointer: string;
  label: string;
  value: number | undefined;
  /** Called with a valid number, or with `undefined` when an optional field is emptied. */
  onCommit: (value: number | undefined) => void;
  /** An empty field means "not set". */
  optional?: boolean;
  disabled?: boolean;
  hint?: string;
  className?: string;
}

const show = (value: number | undefined): string => (value === undefined ? '' : String(value));

/**
 * The on-screen keyboard for a field. The numeric and decimal pads of phones have no minus key, so a field that
 * accepts a negative number gets the full keyboard.
 */
export function keyboardFor(rules: NumberRules): 'numeric' | 'decimal' | 'text' {
  if (rules.min < 0) return 'text';
  return rules.integer ? 'numeric' : 'decimal';
}

/**
 * A number input that keeps its own text while typing and writes to the document only when the text is a valid
 * number. The text follows the document when it changes from outside (a one-click fix, a reload).
 */
export default function NumberField({
  pointer,
  label,
  value,
  onCommit,
  integer = true,
  min,
  max,
  optional = false,
  disabled = false,
  hint,
  className,
}: NumberFieldProps) {
  const t = useT(formatStudioEditorMessages);
  const rules: NumberRules = { integer, min, max };
  const [text, setText] = useState(show(value));
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  });

  useEffect(() => {
    const typed = textRef.current;
    const parsed = parseNumberInput(typed, { integer, min, max });
    const same = parsed.ok ? parsed.value === value : optional && typed.trim() === '' && value === undefined;
    if (!same) setText(show(value));
    // Only an outside change of the value may replace what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const parsed = parseNumberInput(text, rules);
  let problem: string | null = null;
  if (!parsed.ok) {
    if (parsed.reason === 'empty') problem = optional ? null : t('fields.rangeHint', { min, max });
    else if (parsed.reason === 'range') problem = t('fields.rangeHint', { min, max });
    else problem = integer ? t('fields.integerHint') : t('fields.numberHint');
  }
  const state = useFieldState(pointer, { hint: hint ?? null, localError: problem });

  const onChange = (next: string) => {
    setText(next);
    const result = parseNumberInput(next, rules);
    if (result.ok) {
      if (result.value !== value) onCommit(result.value);
    } else if (result.reason === 'empty' && optional && value !== undefined) {
      onCommit(undefined);
    }
  };

  return (
    <div className={className}>
      <Input
        id={state.id}
        label={label}
        type="text"
        inputMode={keyboardFor(rules)}
        autoComplete="off"
        value={text}
        placeholder={optional ? t('fields.notSet') : undefined}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          // Leaving the field with a text the document does not hold shows the document's value again.
          const result = parseNumberInput(text, rules);
          const held = result.ok ? result.value : undefined;
          if (!result.ok || held !== value) setText(show(value));
        }}
        {...ariaOf(state)}
      />
      <FieldMessage state={state} className="mt-1" />
    </div>
  );
}
