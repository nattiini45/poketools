'use client';

import { useMemo, useState } from 'react';
import type { SeasonFormData, SeasonFormatType, RouteThemeId } from '@/types/season';
import type { Ruleset } from '@/types/ruleset';
import Input from '@/components/ui/Input';
import { LeagueDateFields, LeagueRulesetField, LeagueTypeField } from '@/components/league/league-form-fields';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { getRouteThemeOptions } from '@/lib/worlds/route-theme-options';
import { useT } from '@/i18n/client';
import { LOCALES, isLocale, type Locale } from '@/i18n/config';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { languageMessages } from '@/i18n/messages/language';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import type { LeagueFormIdentity } from '@/lib/league-admin/clone-source';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

interface LeagueFormProps {
  rulesets: Ruleset[];
  /**
   * Saves the league. Resolves with the failed API body (`{ error, code, params }`)
   * to show it inline; resolves with nothing on success. A throw is shown too.
   */
  onSubmit: (data: SeasonFormData) => Promise<ApiErrorLike | null | void>;
  initialData?: Partial<SeasonFormData>;
  /**
   * Called with the name and dates after each edit of them, so a parent that remounts the form
   * (a new "start from" league) can hand them back as `initialData`.
   */
  onIdentityChange?: (identity: LeagueFormIdentity) => void;
}

/**
 * The league type (`seasons.format_type`). Point-buy leagues battle in singles under the active
 * format pack's battle ruleset, which the server sets as the league default on creation.
 */
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

/** The form's field values, as the inputs hold them (empty string = unset). */
export interface LeagueFormValues {
  name: string;
  description: string;
  formatType: SeasonFormatType;
  rulesetId: string;
  startDate: string;
  endDate: string;
  routeTheme: RouteThemeId;
  language: Locale;
}

/**
 * The save payload for the form's values. A point-buy league never sends a ruleset, even one
 * picked before switching the league type: the server sets the pack's battle ruleset
 * (`POST /api/seasons`).
 */
export function buildLeagueFormPayload(values: LeagueFormValues): SeasonFormData {
  return {
    name: values.name,
    description: values.description || undefined,
    format_type: values.formatType,
    ruleset_id: isEvolutionPointBuy(values.formatType) ? null : values.rulesetId || null,
    start_date: values.startDate || null,
    end_date: values.endDate || null,
    route_theme: values.routeTheme,
    language: values.language,
  };
}

export default function LeagueForm({ rulesets, onSubmit, initialData, onIdentityChange }: LeagueFormProps) {
  const t = useT(leagueAdminMessages);
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
    () => FORMAT_TYPES.map((value) => ({ value, label: t(`form.leagueTypeOption.${value}`) })),
    [t],
  );
  const isPointBuy = isEvolutionPointBuy(formatType);
  const themeOptions = useMemo(
    () => ROUTE_THEME_OPTIONS.map((o) => (o.value === 'auto' ? { ...o, label: t('theme.auto') } : o)),
    [t],
  );
  const languageOptions = useMemo(
    () => LOCALES.map((value) => ({ value, label: tLang(`names.${value}`) })),
    [tLang],
  );

  function changeIdentity(next: Partial<LeagueFormIdentity>) {
    onIdentityChange?.({ name, start_date: startDate, end_date: endDate, ...next });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const failure = await onSubmit(
        buildLeagueFormPayload({
          name,
          description,
          formatType,
          rulesetId,
          startDate,
          endDate,
          routeTheme,
          language,
        }),
      );
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
        onChange={(e) => {
          setName(e.target.value);
          changeIdentity({ name: e.target.value });
        }}
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

      <LeagueTypeField
        id="league-type"
        label={t('form.leagueType')}
        value={formatType}
        onChange={setFormatType}
        options={formatOptions}
        note={isPointBuy ? { id: 'league-battle-format', text: t('form.battleFormatFixed') } : null}
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

      <LeagueRulesetField isPointBuy={isPointBuy} rulesets={rulesets} value={rulesetId} onChange={setRulesetId} />

      <LeagueDateFields
        start={startDate}
        end={endDate}
        onStart={(value) => {
          setStartDate(value);
          changeIdentity({ start_date: value });
        }}
        onEnd={(value) => {
          setEndDate(value);
          changeIdentity({ end_date: value });
        }}
      />

      <Button
        type="submit"
        variant="secondary"
        loading={submitting}
        disabled={!name.trim()}
      >
        {t('form.submit')}
      </Button>
    </form>
  );
}
