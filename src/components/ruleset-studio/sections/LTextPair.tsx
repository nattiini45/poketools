'use client';

import { LOCALES, type Locale } from '@/i18n/config';
import { useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import { editLText } from '@/lib/ruleset-studio/editor/document';
import { fieldId } from '@/lib/ruleset-studio/editor/targets';
import { LTEXT_MAX_CHARS, missingLocales, type LText } from '@/lib/studio-core/ltext';

interface LTextPairProps {
  /** The JSON pointer of the text; the English control gets its field id, the German one `<pointer>/de`. */
  pointer: string;
  label: string;
  value: LText | undefined;
  /** The author's language: it becomes the base of a text that is created. */
  base: Locale;
  /** The text may not be removed entirely (a name): clearing the last language keeps an empty base text. */
  required?: boolean;
  multiline?: boolean;
  onChange: (next: LText | undefined) => void;
}

const entryValue = (text: LText | undefined, locale: Locale): string => (typeof text?.[locale]?.v === 'string' ? text[locale].v : '');

/**
 * A bilingual text as a labelled pair of inputs (English, Deutsch). Edits go through `editLText`, so a language left empty
 * is dropped, the base language switches when its own text is emptied, and an edited language is marked as written by a
 * person. A status line names the language that has no text yet.
 */
export default function LTextPair({ pointer, label, value, base, required = false, multiline = false, onChange }: LTextPairProps) {
  const t = useT(rulesetStudioSectionsMessages);
  const missing = value === undefined ? [] : missingLocales(value);
  const languageName = (locale: Locale) => (locale === 'en' ? t('fields.english') : t('fields.german'));

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="font-heading text-sm font-semibold text-poke-text-primary">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {LOCALES.map((locale) => {
          const id = locale === 'en' ? fieldId(pointer) : fieldId(`${pointer}/${locale}`);
          const common = { id, label: languageName(locale), lang: locale, maxLength: LTEXT_MAX_CHARS, value: entryValue(value, locale) };
          const change = (next: string) => {
            const edited = editLText(value, locale, next, base);
            // A name never disappears: the base language keeps an empty text, which the compile flags.
            onChange(edited === undefined && required ? { base, [base]: { v: '', s: 'human' } } : edited);
          };
          return multiline ? (
            <Textarea key={locale} {...common} rows={3} onChange={(event) => change(event.target.value)} />
          ) : (
            <Input key={locale} {...common} onChange={(event) => change(event.target.value)} />
          );
        })}
      </div>
      {missing.length > 0 && <p className="text-xs text-poke-text-muted">{missing.map((locale) => t('fields.missingIn', { language: languageName(locale) })).join(' ')}</p>}
    </fieldset>
  );
}
