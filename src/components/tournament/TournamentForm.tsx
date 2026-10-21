'use client';

import { useState } from 'react';
import type { TournamentFormData, BracketType, TeamVisibility, BoOverrides } from '@/types/tournament';
import type { Ruleset } from '@/types/ruleset';
import BoOverrideEditor from './BoOverrideEditor';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { toApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { commonMessages } from '@/i18n/messages/common';
import { errorsTournaments } from '@/i18n/messages/errors';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import type { UiError } from './ui-error';

interface TournamentFormProps {
  rulesets: Ruleset[];
  onSubmit: (data: TournamentFormData) => Promise<void>;
  initialData?: Partial<TournamentFormData>;
}

const BRACKET_TYPES = ['single_elim', 'double_elim', 'round_robin', 'swiss'] as const satisfies readonly BracketType[];

const VISIBILITY_OPTIONS = ['hidden_until_match', 'always_public'] as const satisfies readonly TeamVisibility[];

const BO_OPTIONS = [1, 3, 5, 7] as const;

export default function TournamentForm({
  rulesets,
  onSubmit,
  initialData,
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
  const bracketTypeOptions = BRACKET_TYPES.map((value) => ({ value, label: t(`form.bracketTypes.${value}`) }));
  const visibilityOptions = VISIBILITY_OPTIONS.map((value) => ({ value, label: t(`form.visibility.${value}`) }));
  const bestOfOptions = BO_OPTIONS.map((bo) => ({ value: String(bo), label: tCommon('bestOf', { count: bo }) }));

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

      <Select
        label={t('form.bracketType')}
        value={bracketType}
        onChange={(e) => setBracketType(e.target.value as BracketType)}
        options={bracketTypeOptions}
      />

      <Select
        label={t('form.ruleset')}
        value={rulesetId}
        onChange={(e) => setRulesetId(e.target.value)}
        required
      >
        <option value="">{t('form.selectRuleset')}</option>
        {rulesets.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>

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
          className="rounded accent-poke-accent"
        />
        <label htmlFor="isDoubles" className="text-sm text-poke-text-primary">
          {t('form.doubles')}
        </label>
      </div>

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
        disabled={!name || !rulesetId}
      >
        {t('form.submit')}
      </Button>
    </form>
  );
}
