'use client';

import { useMemo, useState } from 'react';
import type { SeasonFormData, SeasonFormatType, RouteThemeId } from '@/types/season';
import type { Ruleset } from '@/types/ruleset';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { getRouteThemeOptions } from '@/lib/worlds/route-theme-options';
import { useT } from '@/i18n/client';
import { LOCALES, isLocale, type Locale } from '@/i18n/config';
import { enumLabel } from '@/i18n/content/enum-label';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { enumMessages } from '@/i18n/messages/enums';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { languageMessages } from '@/i18n/messages/language';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

interface LeagueFormProps {
  rulesets: Ruleset[];
  /**
   * Saves the league. Resolves with the failed API body (`{ error, code, params }`)
   * to show it inline; resolves with nothing on success. A throw is shown too.
   */
  onSubmit: (data: SeasonFormData) => Promise<ApiErrorLike | null | void>;
  initialData?: Partial<SeasonFormData>;
}

const FORMAT_TYPES: readonly SeasonFormatType[] = ['singles', 'doubles', 'draft', 'evolution_point_buy'];

/**
 * 3D World Theme options: Auto + every REGISTERED route theme — shared with
 * the post-create admin picker via `src/lib/worlds/route-theme-options.ts`.
 * Theme names are proper names; only the "Auto" label is translated here.
 */
const ROUTE_THEME_OPTIONS: { value: string; label: string }[] = getRouteThemeOptions();

/** New leagues default to German content (i18n-core §6.1: existing leagues are German). */
const DEFAULT_LEAGUE_LANGUAGE: Locale = 'de';

/** An API failure that carries something to show; an empty one falls back to "Failed to save". */
function hasErrorDetail(e: ApiErrorLike): boolean {
  return Boolean(e.error || e.code);
}

export default function LeagueForm({ rulesets, onSubmit, initialData }: LeagueFormProps) {
  const t = useT(leagueAdminMessages);
  const tEnum = useT(enumMessages);
  const tLang = useT(languageMessages);
  const errorText = useApiErrorText(errorsSeasons);

  const [name, setName] = useState(initialData?.name ?? '');
  const [description, setDescription] = useState(initialData?.description ?? '');
  const [formatType, setFormatType] = useState<SeasonFormatType>(
    initialData?.format_type ?? 'singles'
  );
  const [routeTheme, setRouteTheme] = useState<RouteThemeId>(
    initialData?.route_theme ?? 'auto'
  );
  const [language, setLanguage] = useState<Locale>(initialData?.language ?? DEFAULT_LEAGUE_LANGUAGE);
  const [rulesetId, setRulesetId] = useState(initialData?.ruleset_id ?? '');
  const [startDate, setStartDate] = useState(initialData?.start_date ?? '');
  const [endDate, setEndDate] = useState(initialData?.end_date ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const formatOptions = useMemo(
    () => FORMAT_TYPES.map((value) => ({ value, label: enumLabel(tEnum, 'formatType', value) })),
    [tEnum],
  );
  const themeOptions = useMemo(
    () => ROUTE_THEME_OPTIONS.map((o) => (o.value === 'auto' ? { ...o, label: t('theme.auto') } : o)),
    [t],
  );
  const languageOptions = useMemo(
    () => LOCALES.map((value) => ({ value, label: tLang(`names.${value}`) })),
    [tLang],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const failure = await onSubmit({
        name,
        description: description || undefined,
        format_type: formatType,
        ruleset_id: rulesetId || null,
        start_date: startDate || null,
        end_date: endDate || null,
        route_theme: routeTheme,
        language,
      });
      if (failure) setError(failure);
    } catch (err) {
      setError(toApiErrorLike(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      {error && (
        <Alert variant="error">{hasErrorDetail(error) ? errorText(error) : t('form.saveFailed')}</Alert>
      )}

      <Input
        label={t('form.name')}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        placeholder={t('form.namePlaceholder')}
      />

      <div className="space-y-1.5">
        <label
          htmlFor="description"
          className="block text-sm font-heading font-semibold text-poke-text-primary"
        >
          {t('form.description')}
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('form.descriptionPlaceholder')}
          rows={3}
          className="w-full px-3 py-2 bg-poke-surface text-poke-text-primary border border-poke-border rounded-poke-md placeholder:text-poke-text-muted transition-colors duration-200 focus:border-poke-focus focus:ring-1 focus:ring-poke-focus outline-none text-sm resize-y"
        />
      </div>

      <Select
        label={t('form.formatType')}
        value={formatType}
        onChange={(e) => setFormatType(e.target.value as SeasonFormatType)}
        options={formatOptions}
      />

      <Select
        label={t('form.worldTheme')}
        value={routeTheme}
        onChange={(e) => setRouteTheme(e.target.value as RouteThemeId)}
        options={themeOptions}
      />

      <div className="space-y-1.5">
        <Select
          id="league-content-language"
          label={t('form.contentLanguage')}
          value={language}
          onChange={(e) => {
            const next = e.target.value;
            if (isLocale(next)) setLanguage(next);
          }}
          options={languageOptions}
          aria-describedby="league-content-language-hint"
        />
        <p id="league-content-language-hint" className="text-xs text-poke-text-muted">
          {t('form.contentLanguageHint')}
        </p>
      </div>

      <Select
        label={t('form.ruleset')}
        value={rulesetId ?? ''}
        onChange={(e) => setRulesetId(e.target.value)}
      >
        <option value="">{t('form.noRuleset')}</option>
        {rulesets.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label={t('form.startDate')}
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          label={t('form.endDate')}
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>

      <Button
        type="submit"
        variant="secondary"
        loading={submitting}
        disabled={!name}
      >
        {t('form.submit')}
      </Button>
    </form>
  );
}
