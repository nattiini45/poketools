'use client';

import { useState } from 'react';
import type { TournamentFormData, BracketType, TeamVisibility, BoOverrides } from '@/types/tournament';
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';
import BoOverrideEditor from './BoOverrideEditor';
import Input from '@/components/ui/Input';
import RulesetSelect from '@/components/ruleset/RulesetSelect';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { toApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { commonMessages } from '@/i18n/messages/common';
import { errorsTournaments } from '@/i18n/messages/errors';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import { bestOfChoices } from '@/lib/tournament/best-of';
import type { UiError } from './ui-error';

interface TournamentFormProps {
  rulesets: readonly RulesetOption[];
  onSubmit: (data: TournamentFormData) => Promise<void>;
  initialData?: Partial<TournamentFormData>;
  /** `edit` hides the description (the page has its own editor) and is used with `initialData`. */
  mode?: 'create' | 'edit';
  /** Overrides the submit button label (default: the create label). */
  submitLabel?: string;
  /** Controls frozen once the tournament has started; each shows a short reason. */
  lockedFields?: { bracketType?: boolean; ruleset?: boolean; doubles?: boolean };
  /** Why the locked controls are frozen; picks the wording of their hint (default: the tournament has started). */
  lockedReason?: 'started' | 'rounds';
}

const BRACKET_TYPES = ['single_elim', 'double_elim', 'round_robin', 'swiss'] as const satisfies readonly BracketType[];

const VISIBILITY_OPTIONS = ['hidden_until_match', 'always_public'] as const satisfies readonly TeamVisibility[];

function LockedHint({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="-mt-2 text-xs text-poke-text-muted">
      {children}
    </p>
  );
}

export default function TournamentForm({
  rulesets,
  onSubmit,
  initialData,
  mode = 'create',
  submitLabel,
  lockedFields,
  lockedReason = 'started',
}: TournamentFormProps) {
  const [name, setName] = useState(initialData?.name ?? '');
  const [description, setDescription] = useState(initialData?.description ?? '');
  const [bracketType, setBracketType] = useState<BracketType>(
    initialData?.bracket_type ?? 'single_elim'
  );
  const [rulesetId, setRulesetId] = useState(initialData?.ruleset_id ?? '');
  const [bestOf, setBestOf] = useState(initialData?.best_of_default ?? 3);
  const [boOverrides, setBoOverrides] = useState<BoOverrides>(initialData?.bo_overrides ?? {});
  const [isDoubles, setIsDoubles] = useState(initialData?.is_doubles ?? false);
  const [bracketResetEnabled, setBracketResetEnabled] = useState(
    initialData?.bracket_reset_enabled ?? true
  );
  const [teamVisibility, setTeamVisibility] = useState<TeamVisibility>(
    initialData?.team_visibility ?? 'hidden_until_match'
  );
  const [submitting, setSubmitting] = useState(false);
  const t = useT(tournamentsAdminMessages);
  const tCommon = useT(commonMessages);
  const errorText = useApiErrorText(errorsTournaments);
  const [error, setError] = useState<UiError<'form.saveFailed'> | null>(null);
  const lockedText = lockedReason === 'rounds' ? t('form.lockedRounds') : t('form.lockedStarted');
  const bracketTypeOptions = BRACKET_TYPES.map((value) => ({ value, label: t(`form.bracketTypes.${value}`) }));
  const visibilityOptions = VISIBILITY_OPTIONS.map((value) => ({ value, label: t(`form.visibility.${value}`) }));
  const isEdit = mode === 'edit';
  const bestOfOptions = bestOfChoices(initialData?.best_of_default).map((bo) => ({ value: String(bo), label: tCommon('bestOf', { count: bo }) }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const overrides = Object.fromEntries(
        Object.entries(boOverrides).filter(([, v]) => v > 0)
      );
      await onSubmit({
        name,
        description: description || undefined,
        bracket_type: bracketType,
        ruleset_id: rulesetId,
        best_of_default: bestOf,
        bo_overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        is_doubles: isDoubles,
        team_visibility: teamVisibility,
        bracket_reset_enabled:
          bracketType === 'double_elim' ? bracketResetEnabled : undefined,
      });
    } catch (err) {
      // The creator throws the API failure (English `error` + `code`); anything else is generic.
      setError(err instanceof Error && err.message ? { api: toApiErrorLike(err) } : { key: 'form.saveFailed' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      {error && <Alert variant="error">{'api' in error ? errorText(error.api) : t(error.key)}</Alert>}

      <Input
        label={t('form.name')}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        placeholder={t('form.namePlaceholder')}
      />

      {!isEdit && (
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
            rows={2}
            className="w-full px-3 py-2 bg-poke-surface text-poke-text-primary border border-poke-border rounded-poke-md placeholder:text-poke-text-muted transition-colors duration-200 focus:border-poke-focus focus:ring-1 focus:ring-poke-focus outline-none text-sm resize-y"
          />
        </div>
      )}

      <Select
        label={t('form.bracketType')}
        value={bracketType}
        onChange={(e) => setBracketType(e.target.value as BracketType)}
        options={bracketTypeOptions}
        disabled={lockedFields?.bracketType}
        aria-describedby={lockedFields?.bracketType ? 'bracket-type-locked' : undefined}
      />
      {lockedFields?.bracketType && <LockedHint id="bracket-type-locked">{lockedText}</LockedHint>}

      <RulesetSelect
        id="tournament-ruleset"
        label={t('form.ruleset')}
        value={rulesetId}
        onChange={setRulesetId}
        options={rulesets}
        placeholder={t('form.selectRuleset')}
        required
        disabled={lockedFields?.ruleset}
        studioLink={!lockedFields?.ruleset}
        aria-describedby={lockedFields?.ruleset ? 'ruleset-locked' : undefined}
      />
      {lockedFields?.ruleset && <LockedHint id="ruleset-locked">{lockedText}</LockedHint>}

      <Select
        label={t('form.bestOfDefault')}
        value={String(bestOf)}
        onChange={(e) => setBestOf(Number(e.target.value))}
        options={bestOfOptions}
      />

      <BoOverrideEditor
        bracketType={bracketType}
        defaultBo={bestOf}
        overrides={boOverrides}
        onChange={setBoOverrides}
      />

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isDoubles"
          checked={isDoubles}
          onChange={(e) => setIsDoubles(e.target.checked)}
          disabled={lockedFields?.doubles}
          aria-describedby={lockedFields?.doubles ? 'doubles-locked' : undefined}
          className="rounded accent-poke-accent"
        />
        <label htmlFor="isDoubles" className="text-sm text-poke-text-primary">
          {t('form.doubles')}
        </label>
      </div>
      {lockedFields?.doubles && <LockedHint id="doubles-locked">{lockedText}</LockedHint>}

      {bracketType === 'double_elim' && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="bracketReset"
            checked={bracketResetEnabled}
            onChange={(e) => setBracketResetEnabled(e.target.checked)}
            className="rounded accent-poke-accent"
          />
          <label htmlFor="bracketReset" className="text-sm text-poke-text-primary">
            {t('form.bracketReset')}
          </label>
        </div>
      )}

      <Select
        label={t('form.teamVisibility')}
        value={teamVisibility}
        onChange={(e) => setTeamVisibility(e.target.value as TeamVisibility)}
        options={visibilityOptions}
      />

      <Button
        type="submit"
        variant="secondary"
        loading={submitting}
        disabled={!name.trim() || !rulesetId}
      >
        {submitLabel ?? t('form.submit')}
      </Button>
    </form>
  );
}
