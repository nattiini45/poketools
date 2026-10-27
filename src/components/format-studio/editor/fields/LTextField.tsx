'use client';

import { LOCALES, type Locale } from '@/i18n/config';
import { useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { LTEXT_MAX_CHARS, missingLocales, type LText } from '@/lib/studio-core/ltext';
import { editLText } from '@/lib/format-studio/editor/document';
import { fieldId } from '@/lib/format-studio/editor/targets';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import { cn } from '@/lib/utils/cn';
import { ariaOf, FieldMessage, useFieldState } from './FieldMessage';

interface LTextFieldProps {
  /** The JSON pointer of the text; the English control gets its field id, the German one `<pointer>/de`. */
  pointer: string;
  label: string;
  value: LText | undefined;
  /** The author's language: it becomes the text's base when the text is created. */
  base: Locale;
  onChange: (next: LText | undefined) => void;
  multiline?: boolean;
  /** Shows a remove button that clears the whole text. */
  removeLabel?: string;
  onRemove?: () => void;
  className?: string;
}

const entryValue = (text: LText | undefined, locale: Locale): string => {
  const entry = text?.[locale];
  return typeof entry?.v === 'string' ? entry.v : '';
};

/**
 * A bilingual text as a labelled pair of inputs (English, Deutsch). Edits go through `editLText`, so a language
 * left empty is dropped, the base language switches when its own text is emptied, and an edited language is
 * marked as written by a person. A status line names the language that has no text yet.
 */
export default function LTextField({ pointer, label, value, base, onChange, multiline = false, removeLabel, onRemove, className }: LTextFieldProps) {
  const t = useT(formatStudioEditorMessages);
  const state = useFieldState(pointer, { under: true });
  const missing = value === undefined ? [] : missingLocales(value);
  const languageName = (locale: Locale) => (locale === 'en' ? t('fields.english') : t('fields.german'));

  return (
    <fieldset className={cn('min-w-0 space-y-2', className)}>
      <legend className="font-heading text-sm font-semibold text-poke-text-primary">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {LOCALES.map((locale) => {
          const id = locale === 'en' ? fieldId(pointer) : fieldId(`${pointer}/${locale}`);
          const common = {
            id,
            label: languageName(locale),
            lang: locale,
            maxLength: LTEXT_MAX_CHARS,
            value: entryValue(value, locale),
            ...ariaOf(state),
          };
          const change = (next: string) => onChange(editLText(value, locale, next, base));
          return multiline ? (
            <Textarea key={locale} {...common} rows={3} onChange={(event) => change(event.target.value)} />
          ) : (
            <Input key={locale} {...common} onChange={(event) => change(event.target.value)} />
          );
        })}
      </div>
      {missing.length > 0 && (
        <p className="text-xs text-poke-text-muted">
          {missing.map((locale) => t('fields.missingIn', { language: languageName(locale) })).join(' ')}
        </p>
      )}
      <FieldMessage state={state} />
      {onRemove !== undefined && removeLabel !== undefined && value !== undefined && (
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={onRemove}>
          {removeLabel}
        </Button>
      )}
    </fieldset>
  );
}
