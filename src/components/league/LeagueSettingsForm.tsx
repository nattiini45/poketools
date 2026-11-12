'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import SkewChip from '@/components/ui/SkewChip';
import SettingsSection from '@/components/admin/SettingsSection';
import { LeagueDateFields, LeagueRulesetField, LeagueTypeField } from '@/components/league/league-form-fields';
import { patchLeagueSettings } from '@/components/league/league-settings-requests';
import { useFormatter, useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import { adoptStoredLeagueSettings, leagueSettingsDirty } from '@/lib/league-admin/form-dirty';
import { buildLeagueSettingsPatch, type LeagueSettingsValues } from '@/lib/league-admin/settings-patch';
import { unsavedMarker } from '@/lib/league-admin/unsaved';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { cn } from '@/lib/utils/cn';
import { editableFormatTypes, isSeasonDateRangeValid, type FormatLockReason } from '@/lib/season/settings-guards';

interface LeagueSettingsFormProps {
  seasonId: string;
  /** The stored values; the form's baseline until a save succeeds. */
  initial: LeagueSettingsValues;
  rulesets: readonly RulesetOption[];
  /** Why the league type cannot change (the league started, or a point-buy boundary); null while it can. */
  formatLock: FormatLockReason | null;
  /**
   * The league has started and has a ruleset, so the select is read-only and the hint points to the ruleset card: the server
   * refuses a swap then (`ruleset_pin_started`) and only moves the pin to another version of the same ruleset
   * (`isRulesetPinLocked`).
   */
  rulesetLocked: boolean;
  /** The title and the sentence of the details section, which this form renders as the first section of the sheet. */
  title: string;
  subtitle: string;
  /** The section index, shown beside the sheet from `lg` up. */
  aside?: ReactNode;
  /** The pin card of the league's ruleset, under the fields of the details section. */
  pinCard?: ReactNode;
  /** The sections after the details (each saves on its own); the save bar sticks below them. */
  children?: ReactNode;
}

/** The fields the save bar names, in form order. */
const SETTINGS_FIELDS = ['name', 'formatType', 'rulesetId', 'startDate', 'endDate'] as const;

/**
 * The league details form on the Settings tab: name, league type, battle ruleset and season dates.
 * Description, 3D theme and content language have their own editors. Sends only the changed fields
 * (`buildLeagueSettingsPatch`), marks unsaved input for the tab guard and, after a save, takes the
 * submitted values as the new baseline and refreshes the route. The form stays mounted across the
 * refresh: new stored values become the baseline during render (`adoptStoredLeagueSettings`), and
 * unsaved input is kept, so the "saved" notice stays and typing is not lost.
 *
 * It is also the frame of the Settings tab (redesign A6): one sheet with the details as its first section and
 * the other sections (`children`) below, the section index beside it, and one save bar under the sheet. The bar
 * belongs to the details form (its buttons carry the form's id): it names the fields that changed, saves or
 * discards them and sticks to the bottom of the viewport while something is unsaved. The other sections save on change and say so.
 */
export default function LeagueSettingsForm({
  seasonId,
  initial,
  rulesets,
  formatLock,
  rulesetLocked,
  title,
  subtitle,
  aside,
  pinCard,
  children,
}: LeagueSettingsFormProps) {
  const t = useT(leagueAdminMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const router = useRouter();
  const formatter = useFormatter();
  const formId = useId();
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
  const changed = SETTINGS_FIELDS.filter((field) =>
    field === 'name' ? baseline.name.trim() !== values.name.trim() : baseline[field] !== values[field],
  );
  /** Why unsaved input cannot be saved yet; the field itself shows the date error too. */
  const blocked = !dirty ? null : values.name.trim() === '' ? t('settingsBar.nameMissing') : datesValid ? null : t('form.datesInvalid');

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

  function discard() {
    setValues(baseline);
    setSaved(false);
    setError(null);
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
    <div className="group/settings flex flex-col gap-6" data-league-settings>
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[13rem_minmax(0,46rem)] lg:items-start">
        {aside && <div className="hidden lg:sticky lg:top-[4.5rem] lg:block">{aside}</div>}
        <div className="min-w-0 divide-y divide-hairline rounded-poke-lg border border-hairline bg-surface shadow-poke-card" data-league-settings-sheet>
          <SettingsSection id="settings-details" icon="everstone" title={title} subtitle={subtitle}>
            <form id={formId} onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-4" {...unsavedMarker(dirty)}>
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
                hint={{ id: rulesetHintId, text: t(rulesetLocked ? 'form.rulesetLockedHint' : 'form.rulesetEditHint') }}
                disabled={rulesetLocked}
              />

              <LeagueDateFields
                start={values.startDate}
                end={values.endDate}
                onStart={(startDate) => update({ startDate })}
                onEnd={(endDate) => update({ endDate })}
                error={datesValid ? undefined : t('form.datesInvalid')}
              />
            </form>
            {pinCard && <div className="mt-5 max-w-lg">{pinCard}</div>}
          </SettingsSection>
          {children}
        </div>
      </div>

      {/* The save bar of the details form: the foot of the sheet while nothing changed, stuck to the bottom of the
          viewport while there is something to save (on a phone it then covers the page's primary-action bar). */}
      <div
        className={cn(
          'z-30 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline bg-page px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8',
          dirty && 'sticky bottom-0',
        )}
        data-league-settings-savebar
      >
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5 text-body">
          <p role="status" aria-live="polite" className={cn('flex items-center gap-2', dirty ? 'text-fg' : saved ? 'text-win' : 'text-fg-muted')}>
            {dirty && <SkewChip tone="accent">{changed.length}</SkewChip>}
            <span className="min-w-0">
              {dirty
                ? t('settingsBar.unsaved', { fields: formatter.list(changed.map((field) => t(`settingsBar.fields.${field}`))) })
                : saved
                  ? t('form.saved')
                  : t('settingsBar.clean')}
            </span>
          </p>
          {(error || blocked) && (
            <p role="alert" className="text-caption text-loss">
              {error ? (error.error || error.code ? errorText(error) : t('form.saveFailed')) : blocked}
            </p>
          )}
        </div>
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-0" onClick={discard} disabled={!dirty || submitting}>
          {t('settingsBar.discard')}
        </Button>
        <Button type="submit" form={formId} variant="primary" className="min-h-11 sm:min-h-0" loading={submitting} disabled={!canSave}>
          {t('form.saveChanges')}
        </Button>
      </div>
    </div>
  );
}
