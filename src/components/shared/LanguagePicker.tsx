'use client';

import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FOCUS_RING } from '@/components/ui/panel';
import Card from '@/components/ui/Card';
import { LOCALES, type Locale, type PkmnTermsPreference } from '@/i18n/config';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { applyLanguagePreference } from '@/i18n/switch-language';
import { useApiErrorText } from '@/i18n/use-api-error';
import { languageMessages } from '@/i18n/messages/language';
import { SpriteStyleMenuGroup } from './SpriteStyleMenuGroup';

/**
 * Site language picker (i18n-core §2.1, D14). `LanguageOptions` is the ONLY
 * "Keep Pokémon terms in English" control in the app; it is rendered by the
 * NavBar disclosure, the mobile drawer section and the settings card.
 *
 * - `LanguageOptions`: two radios ("English", "Deutsch", each in its own
 *   language) and, while Deutsch is selected, the Pokémon-terms checkbox.
 * - `LanguagePicker` (default): the desktop NavBar disclosure, the same
 *   pattern as `PalettePicker` (not portalled: the panel stays inside
 *   `#site-nav` for the D33 reveal over the 3D world).
 * - `LanguagePickerSection`: the inline group in the mobile drawer.
 * - `LanguageSettingsSection`: the settings-page card.
 *
 * The NavBar panel and the drawer section also carry the sprite-style choice
 * (`SpriteStyleMenuGroup`, docs/pkmn.md "Sprite styles"), so anonymous viewers
 * can switch sprites next to the language.
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
  'flex items-center gap-3 rounded-poke-md px-2 py-2 cursor-pointer text-sm text-poke-text-primary ' +
  'hover:bg-poke-elevated has-[:checked]:bg-poke-accent-light ' +
  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ' +
  'has-[:focus-visible]:outline-poke-focus';

const LEGEND_PANEL =
  'px-2 pb-1 text-xs font-heading font-semibold uppercase tracking-wide text-poke-text-secondary';
const LEGEND_DRAWER =
  'pb-2 text-xs font-heading font-semibold uppercase tracking-wide text-poke-text-secondary';

function CheckMark({ checked }: { checked: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={checked ? 'h-4 w-4 shrink-0 text-poke-accent-strong' : 'h-4 w-4 shrink-0 invisible'}
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
              <span className="flex-1 font-heading font-semibold leading-tight">{t(`names.${locale}`)}</span>
              <CheckMark checked={checked} />
            </label>
          );
        })}
      </div>
      {value === 'de' && (
        <label className="mt-2 flex items-start gap-3 rounded-poke-md px-2 py-2 cursor-pointer text-sm text-poke-text-primary hover:bg-poke-elevated">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-poke-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus"
            checked={pkmnTerms === 'en'}
            aria-describedby={hintId}
            onChange={(event) => onChange({ pkmnTerms: event.target.checked ? 'en' : 'follow' })}
          />
          <span className="flex min-w-0 flex-col">
            <span className="font-heading font-semibold leading-tight">{t('keepPkmnEnglish')}</span>
            <span id={hintId} className="text-xs leading-tight text-poke-text-secondary">
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
    <p role="alert" className="px-2 pt-2 text-xs text-poke-danger-ink">
      {error.code ? errorText(error) : t('saveFailed')}
    </p>
  );
}

/** The desktop NavBar disclosure (hidden below `md`; the drawer has the section). */
export default function LanguagePicker() {
  const t = useT(languageMessages);
  const { shown, pending, failed, change } = useLanguagePreference();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Opening moves focus to the checked radio (or the first one).
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const target =
      panel.querySelector<HTMLInputElement>('input[type="radio"]:checked') ??
      panel.querySelector<HTMLInputElement>('input[type="radio"]');
    target?.focus();
  }, [open]);

  // Close paths, attached only while open (the PalettePicker pattern).
  useEffect(() => {
    if (!open) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const closeToTrigger = () => {
      setOpen(false);
      triggerRef.current?.focus();
    };
    // Native listener: the Escape that closes this panel must not also close
    // the revealed bar over the 3D world (RouteNavReveal listens on document, D33).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeToTrigger();
        return;
      }
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type === 'radio') {
        event.preventDefault();
        closeToTrigger();
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !wrapper.contains(next)) setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapper.contains(event.target)) return;
      setOpen(false);
    };
    wrapper.addEventListener('keydown', onKeyDown);
    wrapper.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      wrapper.removeEventListener('keydown', onKeyDown);
      wrapper.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative hidden md:block">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('trigger', { language: t(`names.${shown.locale}`) })}
        aria-busy={pending || undefined}
        onClick={() => setOpen((current) => !current)}
        className={`px-2 py-1.5 rounded-poke-md font-heading text-sm font-semibold uppercase text-poke-text-secondary hover:bg-poke-elevated hover:text-poke-text-primary transition-colors ${FOCUS_RING}`}
      >
        {shown.locale}
      </button>
      {open && (
        <div
          id={panelId}
          ref={panelRef}
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-poke-lg border border-poke-border bg-poke-surface p-2 shadow-poke-lg"
        >
          <LanguageOptions
            name="site-language"
            legendClassName={LEGEND_PANEL}
            value={shown.locale}
            pkmnTerms={shown.pkmnTerms}
            onChange={change}
          />
          <SaveFailed error={failed} />
          <div className="mt-2 border-t border-poke-border pt-2">
            <SpriteStyleMenuGroup name="site-sprite-style" legendClassName={LEGEND_PANEL} />
          </div>
        </div>
      )}
    </div>
  );
}

/** The mobile drawer's inline language group (inside the drawer's scroll region). */
export function LanguagePickerSection() {
  const { shown, failed, change } = useLanguagePreference();
  return (
    <div className="px-4 py-3 border-t border-poke-border">
      <LanguageOptions
        name="site-language-mobile"
        legendClassName={LEGEND_DRAWER}
        value={shown.locale}
        pkmnTerms={shown.pkmnTerms}
        onChange={change}
      />
      <SaveFailed error={failed} />
      <div className="mt-3 border-t border-poke-border pt-3">
        <SpriteStyleMenuGroup name="site-sprite-style-mobile" legendClassName={LEGEND_DRAWER} />
      </div>
    </div>
  );
}

/** The settings-page "Language" card. */
export function LanguageSettingsSection() {
  const t = useT(languageMessages);
  const { shown, pending, failed, change } = useLanguagePreference();
  return (
    <Card padding="lg">
      <h2 className="text-lg font-heading font-bold text-poke-text-primary mb-1">{t('settings.heading')}</h2>
      <p className="text-sm text-poke-text-secondary mb-4">{t('settings.description')}</p>
      <LanguageOptions
        name="site-language-settings"
        legendClassName="sr-only"
        value={shown.locale}
        pkmnTerms={shown.pkmnTerms}
        onChange={change}
      />
      {pending && (
        <p aria-live="polite" className="px-2 pt-2 text-xs text-poke-text-muted">
          {t('saving')}
        </p>
      )}
      <SaveFailed error={failed} />
    </Card>
  );
}
