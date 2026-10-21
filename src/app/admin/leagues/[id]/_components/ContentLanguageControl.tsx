'use client';

import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Select from '@/components/ui/Select';
import { useT } from '@/i18n/client';
import { LOCALES, isLocale, type Locale } from '@/i18n/config';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { languageMessages } from '@/i18n/messages/language';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import { leagueAdminSeasonPageMessages } from '@/i18n/messages/league-admin/season-page';
import { useServerSyncedState } from '@/hooks/useServerSyncedState';
import { patchContentLanguage } from './content-language';

interface ContentLanguageControlProps {
  seasonId: string;
  /** The league's stored `seasons.language` (default 'de'). */
  currentLanguage: Locale;
}

/**
 * Post-create content-language picker for league admins (lead addition to DF7b).
 * Saves through `patchContentLanguage` (PATCH `{ language }` only). Optimistic select with revert on failure and an
 * inline error, like `LeagueThemeControl`. A successful save refreshes the route;
 * the select follows `currentLanguage` whenever no save is in flight.
 */
export default function ContentLanguageControl({ seasonId, currentLanguage }: ContentLanguageControlProps) {
  const t = useT(leagueAdminSeasonPageMessages);
  const tForm = useT(leagueAdminMessages);
  const tLang = useT(languageMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const router = useRouter();
  const hintId = useId();
  const [saving, setSaving] = useState(false);
  const [language, setLanguage] = useServerSyncedState<Locale>(currentLanguage, saving);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const options = useMemo(() => LOCALES.map((value) => ({ value, label: tLang(`names.${value}`) })), [tLang]);

  async function handleChange(next: string) {
    if (!isLocale(next) || next === language || saving) return;

    const previous = language;
    setLanguage(next);
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const failure = await patchContentLanguage(seasonId, next);
      if (failure) {
        setLanguage(previous);
        setError(failure);
      } else {
        setSaved(true);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xs space-y-2">
      <Select
        label={tForm('form.contentLanguage')}
        value={language}
        onChange={(e) => void handleChange(e.target.value)}
        options={options}
        disabled={saving}
        aria-describedby={hintId}
      />
      <p id={hintId} className="text-xs text-poke-text-muted">
        {tForm('form.contentLanguageHint')}
      </p>
      <p className="text-xs text-poke-text-muted" role="status" aria-live="polite">
        {saving ? t('language.saving') : saved ? t('language.saved') : null}
      </p>
      {error && (
        <p className="text-xs text-poke-danger" role="alert">
          {error.error || error.code ? errorText(error) : t('language.saveFailed')}
        </p>
      )}
    </div>
  );
}
