'use client';

import { useId, useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import SettingsSection from '@/components/player/SettingsSection';
import { LOCALES, type Locale, type PkmnTermsPreference } from '@/i18n/config';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { applyLanguagePreference } from '@/i18n/switch-language';
import { useApiErrorText } from '@/i18n/use-api-error';
import { languageMessages } from '@/i18n/messages/language';

/**
 * Site language picker (i18n-core §2.1, D14). `LanguageOptions` is the ONLY
 * "Keep Pokémon terms in English" control in the app; it is rendered by the
 * account menu, the signed-out drawer and the settings card.
 *
 * - `LanguageOptions`: two radios ("English", "Deutsch", each in its own
 *   language) and, while Deutsch is selected, the Pokémon-terms checkbox.
 * - `LanguagePickerSection`: the group in the site menus (the account menu, the signed-out drawer).
 * - `LanguageSettingsSection`: the settings-page card.
 *
 * Every change goes through `applyLanguagePreference` (`POST /api/locale`,
 * then a server refresh, or a full reload on a route-world page). Theme
 * tokens only, no dark slab.
 */

export interface LanguageChange {
  locale?: Locale;
  pkmnTerms?: PkmnTermsPreference;
}

const ROW =
  'flex items-center gap-3 rounded-poke-md px-2 py-2 cursor-pointer text-sm text-fg ' +
  'hover:bg-elevated has-[:checked]:bg-accent-subtle ' +
  'has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ' +
  'has-[:focus-visible]:outline-poke-focus';

function CheckMark({ checked }: { checked: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={checked ? 'h-4 w-4 shrink-0 text-accent-ink' : 'h-4 w-4 shrink-0 invisible'}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function LanguageOptions({
  name,
  value,
  pkmnTerms,
  onChange,
  legendClassName,
  disabled = false,
}: {
  /** Radio group name; unique per mounted instance. */
  name: string;
  value: Locale;
  pkmnTerms: PkmnTermsPreference;
  onChange: (change: LanguageChange) => void;
  legendClassName?: string;
  disabled?: boolean;
}) {
  const t = useT(languageMessages);
  const hintId = useId();
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className={legendClassName}>{t('legend')}</legend>
      <div className="space-y-1">
        {LOCALES.map((locale) => {
          const checked = value === locale;
          return (
            <label key={locale} className={ROW} lang={locale}>
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={locale}
                checked={checked}
                onChange={() => onChange({ locale })}
              />
              <span className="flex-1 font-[550] leading-tight">{t(`names.${locale}`)}</span>
              <CheckMark checked={checked} />
            </label>
          );
        })}
      </div>
      {value === 'de' && (
        <label className="mt-2 flex items-start gap-3 rounded-poke-md px-2 py-2 cursor-pointer text-sm text-fg hover:bg-elevated">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent-fill focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus"
            checked={pkmnTerms === 'en'}
            aria-describedby={hintId}
            onChange={(event) => onChange({ pkmnTerms: event.target.checked ? 'en' : 'follow' })}
          />
          <span className="flex min-w-0 flex-col">
            <span className="font-[550] leading-tight">{t('keepPkmnEnglish')}</span>
            <span id={hintId} className="text-xs leading-tight text-fg-muted">
              {t('keepPkmnEnglishHint')}
            </span>
          </span>
        </label>
      )}
    </fieldset>
  );
}

interface LanguageState {
  locale: Locale;
  pkmnTerms: PkmnTermsPreference;
}

/** Current preference (optimistic while a switch is in flight) and the switch action. */
function useLanguagePreference() {
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const router = useRouter();
  const current: LanguageState = { locale, pkmnTerms: locale === 'de' && dataLocale === 'en' ? 'en' : 'follow' };
  const [shown, setShown] = useOptimistic<LanguageState, LanguageChange>(current, (state, change) => ({
    locale: change.locale ?? state.locale,
    pkmnTerms: change.pkmnTerms ?? state.pkmnTerms,
  }));
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<ApiErrorLike | null>(null);

  const change = (next: LanguageChange) => {
    setFailed(null);
    startTransition(async () => {
      setShown(next);
      const result = await applyLanguagePreference(next, router);
      if (!result.ok) setFailed(result.error);
    });
  };

  return { shown, pending, failed, change };
}

/** The refusal in the viewer's language from its `code`; the generic line when there is no code. */
function SaveFailed({ error }: { error: ApiErrorLike | null }) {
  const t = useT(languageMessages);
  const errorText = useApiErrorText();
  if (!error) return null;
  return (
    <p role="alert" className="px-2 pt-2 text-xs text-loss">
      {error.code ? errorText(error) : t('saveFailed')}
    </p>
  );
}

/** The language group of the site menus: the account menu and the signed-out drawer. */
export function LanguagePickerSection({ name, legendClassName }: { name: string; legendClassName?: string }) {
  const { shown, failed, change } = useLanguagePreference();
  return (
    <div>
      <LanguageOptions name={name} legendClassName={legendClassName} value={shown.locale} pkmnTerms={shown.pkmnTerms} onChange={change} />
      <SaveFailed error={failed} />
    </div>
  );
}

/** The settings-page "Language" card. */
export function LanguageSettingsSection() {
  const t = useT(languageMessages);
  const { shown, pending, failed, change } = useLanguagePreference();
  return (
    <SettingsSection icon="poke-flute" title={t('settings.heading')} description={t('settings.description')}>
      <LanguageOptions
        name="site-language-settings"
        legendClassName="sr-only"
        value={shown.locale}
        pkmnTerms={shown.pkmnTerms}
        onChange={change}
      />
      {pending && (
        <p aria-live="polite" className="px-2 pt-2 text-caption text-fg-muted">
          {t('saving')}
        </p>
      )}
      <SaveFailed error={failed} />
    </SettingsSection>
  );
}
