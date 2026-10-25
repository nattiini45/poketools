'use client';

import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Ruleset } from '@/types/ruleset';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { LeagueDateFields, LeagueRulesetField, LeagueTypeField } from '@/components/league/league-form-fields';
import { patchLeagueSettings } from '@/components/league/league-settings-requests';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import { adoptStoredLeagueSettings, leagueSettingsDirty } from '@/lib/league-admin/form-dirty';
import { buildLeagueSettingsPatch, type LeagueSettingsValues } from '@/lib/league-admin/settings-patch';
import { unsavedMarker } from '@/lib/league-admin/unsaved';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { editableFormatTypes, isSeasonDateRangeValid, type FormatLockReason } from '@/lib/season/settings-guards';

interface LeagueSettingsFormProps {
  seasonId: string;
  /** The stored values; the form's baseline until a save succeeds. */
  initial: LeagueSettingsValues;
  rulesets: Ruleset[];
  /** Why the league type cannot change (the league started, or a point-buy boundary); null while it can. */
  formatLock: FormatLockReason | null;
}

/**
 * The league details form on the Settings tab: name, league type, battle ruleset and season dates.
 * Description, 3D theme and content language have their own editors. Sends only the changed fields
 * (`buildLeagueSettingsPatch`), marks unsaved input for the tab guard and, after a save, takes the
 * submitted values as the new baseline and refreshes the route. The form stays mounted across the
 * refresh: new stored values become the baseline during render (`adoptStoredLeagueSettings`), and
 * unsaved input is kept, so the "saved" notice stays and typing is not lost.
 */
export default function LeagueSettingsForm({ seasonId, initial, rulesets, formatLock }: LeagueSettingsFormProps) {
  const t = useT(leagueAdminMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const router = useRouter();
  const lockHintId = useId();
  const rulesetHintId = useId();

  const [values, setValues] = useState<LeagueSettingsValues>(initial);
  /** The values last loaded or saved: input that differs is unsaved. */
  const [baseline, setBaseline] = useState<LeagueSettingsValues>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  /** The stored values last taken over, to tell a refresh with new values from one without. */
  const [seen, setSeen] = useState<LeagueSettingsValues>(initial);

  // Stored values that changed (after a save, or an edit elsewhere): adjust state while rendering.
  const adopted = adoptStoredLeagueSettings({ seen, baseline, values }, initial);
  if (adopted.seen !== seen) {
    setSeen(adopted.seen);
    setBaseline(adopted.baseline);
    setValues(adopted.values);
  }

  const isPointBuy = isEvolutionPointBuy(values.formatType);
  const dirty = leagueSettingsDirty(baseline, values);
  const datesValid = isSeasonDateRangeValid(values.startDate, values.endDate);
  const canSave = dirty && values.name.trim() !== '' && datesValid && !submitting;

  const formatOptions = useMemo(
    () =>
      editableFormatTypes(initial.formatType).map((value) => ({
        value,
        label: t(`form.leagueTypeOption.${value}`),
      })),
    [initial.formatType, t],
  );

  function update(change: Partial<LeagueSettingsValues>) {
    setValues((prev) => ({ ...prev, ...change }));
    setSaved(false);
  }

  const typeNote =
    formatLock === null
      ? isPointBuy
        ? { id: lockHintId, text: t('form.battleFormatFixed') }
        : null
      : {
          id: lockHintId,
          text: t(formatLock === 'started' ? 'form.leagueTypeLockedStarted' : 'form.leagueTypeLockedPointBuy'),
        };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    const patch = buildLeagueSettingsPatch(baseline, values, formatLock);
    if (Object.keys(patch).length === 0) return;

    setSubmitting(true);
    setSaved(false);
    setError(null);
    const submitted: LeagueSettingsValues = { ...values, name: values.name.trim() };
    try {
      const failure = await patchLeagueSettings(seasonId, patch);
      if (failure) {
        setError(failure);
        return;
      }
      setValues(submitted);
      setBaseline(submitted);
      setSaved(true);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg" {...unsavedMarker(dirty)}>
      {error && (
        <Alert variant="error">{error.error || error.code ? errorText(error) : t('form.saveFailed')}</Alert>
      )}

      <Input
        label={t('form.name')}
        type="text"
        value={values.name}
        onChange={(e) => update({ name: e.target.value })}
        required
        placeholder={t('form.namePlaceholder')}
      />

      <LeagueTypeField
        id="league-type"
        label={t('form.leagueType')}
        value={values.formatType}
        onChange={(formatType) => update({ formatType })}
        options={formatOptions}
        disabled={formatLock !== null}
        note={typeNote}
      />

      <LeagueRulesetField
        isPointBuy={isPointBuy}
        rulesets={rulesets}
        value={values.rulesetId}
        onChange={(rulesetId) => update({ rulesetId })}
        hint={{ id: rulesetHintId, text: t('form.rulesetEditHint') }}
      />

      <LeagueDateFields
        start={values.startDate}
        end={values.endDate}
        onStart={(startDate) => update({ startDate })}
        onEnd={(endDate) => update({ endDate })}
        error={datesValid ? undefined : t('form.datesInvalid')}
      />

      <Button type="submit" variant="secondary" loading={submitting} disabled={!canSave}>
        {t('form.saveChanges')}
      </Button>

      <p className="text-xs text-poke-green" role="status" aria-live="polite">
        {saved ? t('form.saved') : null}
      </p>
    </form>
  );
}
