'use client';

import { useState } from 'react';
import type { TournamentFormData, BracketType, TeamVisibility, BoOverrides } from '@/types/tournament';
import type { AdvancementRule } from '@/types/season';
import type { Ruleset } from '@/types/ruleset';
import BoOverrideEditor from '@/components/tournament/BoOverrideEditor';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leaguePhasesMessages } from '@/i18n/messages/league-phases';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { enumLabel } from '@/i18n/content/enum-label';
import { unsavedMarker } from '@/lib/league-admin/unsaved';
import { phaseFormDirty, type PhaseFormValues } from '@/lib/league-admin/form-dirty';

export interface PhaseFormData extends TournamentFormData {
  advancement_rule?: AdvancementRule | null;
  insert_at?: number;
}

interface PhaseFormProps {
  rulesets: Ruleset[];
  onSubmit: (data: PhaseFormData) => Promise<void>;
  initialData?: Partial<PhaseFormData>;
  submitLabel?: string;
  lockBracketType?: boolean;
  /**
   * The league's default ruleset (`seasons.ruleset_id`), preselected for a new phase when
   * `initialData` names none and the id is one of `rulesets` (a point-buy league gets the
   * pack's battle ruleset here on creation).
   */
  defaultRulesetId?: string | null;
}

/**
 * Thrown by a parent's `onSubmit` when the API refused the phase: the form
 * shows the server's error by its code, in the viewer's language.
 */
export class PhaseSaveError extends Error {
  constructor(readonly api: ApiErrorLike) {
    super(api.error ?? api.code ?? 'Phase save failed');
    this.name = 'PhaseSaveError';
  }
}

const BRACKET_TYPES: readonly BracketType[] = ['single_elim', 'double_elim', 'round_robin', 'swiss'];

const VISIBILITY_OPTIONS: readonly TeamVisibility[] = ['hidden_until_match', 'always_public'];

const BEST_OF_VALUES: readonly number[] = [1, 3, 5, 7];

/**
 * The doubles flag the form shows and sends. An admin's own choice (or the
 * stored value of a phase being edited) always wins; before that, a new phase
 * follows the selected ruleset, so a doubles ruleset gives a doubles phase.
 */
export function resolveIsDoubles(
  pinned: boolean,
  choice: boolean,
  rulesetId: string,
  rulesets: readonly Pick<Ruleset, 'id' | 'is_doubles'>[]
): boolean {
  if (pinned) return choice;
  return rulesets.find((r) => r.id === rulesetId)?.is_doubles ?? false;
}

export default function PhaseForm({
  rulesets,
  onSubmit,
  initialData,
  submitLabel,
  lockBracketType = false,
  defaultRulesetId = null,
}: PhaseFormProps) {
  const t = useT(leaguePhasesMessages);
  const tCommon = useT(commonMessages);
  const tEnum = useT(enumMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const [name, setName] = useState(initialData?.name ?? '');
  const [description, setDescription] = useState(initialData?.description ?? '');
  const [bracketType, setBracketType] = useState<BracketType>(
    initialData?.bracket_type ?? 'round_robin'
  );
  const [rulesetId, setRulesetId] = useState(() => {
    if (initialData?.ruleset_id) return initialData.ruleset_id;
    if (defaultRulesetId && rulesets.some((r) => r.id === defaultRulesetId)) return defaultRulesetId;
    return '';
  });
  const [bestOf, setBestOf] = useState(initialData?.best_of_default ?? 3);
  const [boOverrides, setBoOverrides] = useState<BoOverrides>(initialData?.bo_overrides ?? {});
  // Edit mode (a stored value) is pinned from the start; a new phase follows
  // the ruleset until the admin touches the checkbox.
  const [doublesChoice, setDoublesChoice] = useState(initialData?.is_doubles ?? false);
  const [doublesPinned, setDoublesPinned] = useState(initialData?.is_doubles !== undefined);
  const isDoubles = resolveIsDoubles(doublesPinned, doublesChoice, rulesetId, rulesets);
  const [teamVisibility, setTeamVisibility] = useState<TeamVisibility>(
    initialData?.team_visibility ?? 'hidden_until_match'
  );
  const [advCount, setAdvCount] = useState(initialData?.advancement_rule?.count ?? 0);
  const [advPerGroup, setAdvPerGroup] = useState(
    initialData?.advancement_rule?.per_group ?? false
  );
  const [submitting, setSubmitting] = useState(false);
  const values: PhaseFormValues = {
    name,
    description,
    bracketType,
    rulesetId,
    bestOf,
    boOverrides,
    teamVisibility,
    advCount,
    advPerGroup,
  };
  /** The values last loaded (on mount) or saved: input that differs is unsaved (league admin tab guard). */
  const [savedValues, setSavedValues] = useState<PhaseFormValues>(values);
  // The doubles flag is not part of `PhaseFormValues` (src/lib/league-admin/form-dirty.ts), so it is tracked here.
  const [savedIsDoubles, setSavedIsDoubles] = useState(isDoubles);
  const dirty = phaseFormDirty(savedValues, values) || savedIsDoubles !== isDoubles;
  /** The API's refusal, or `true` for a failure without an answer (shown as "Failed to save"). */
  const [error, setError] = useState<ApiErrorLike | true | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const submitted = values;

    try {
      const overrides = Object.fromEntries(
        Object.entries(boOverrides).filter(([, v]) => v > 0)
      );
      const advancement_rule: AdvancementRule | null =
        advCount > 0
          ? { type: 'top_n', count: advCount, per_group: advPerGroup }
          : null;

      await onSubmit({
        name,
        description: description || undefined,
        bracket_type: bracketType,
        ruleset_id: rulesetId,
        best_of_default: bestOf,
        bo_overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        is_doubles: isDoubles,
        team_visibility: teamVisibility,
        advancement_rule,
      });
      setSavedValues(submitted);
      setSavedIsDoubles(isDoubles);
    } catch (err) {
      setError(err instanceof PhaseSaveError ? err.api : true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg" {...unsavedMarker(dirty)}>
      {error && <Alert variant="error">{error === true ? t('form.saveFailed') : errorText(error)}</Alert>}

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
          htmlFor="phase-description"
          className="block text-sm font-heading font-semibold text-poke-text-primary"
        >
          {t('form.description')}
        </label>
        <textarea
          id="phase-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 bg-poke-surface text-poke-text-primary border border-poke-border rounded-poke-md text-sm resize-y"
        />
      </div>

      <Select
        label={t('form.bracketType')}
        value={bracketType}
        onChange={(e) => setBracketType(e.target.value as BracketType)}
        options={BRACKET_TYPES.map((value) => ({ value, label: enumLabel(tEnum, 'bracketType', value) }))}
        disabled={lockBracketType}
      />

      <Select
        label={t('form.ruleset')}
        value={rulesetId}
        onChange={(e) => setRulesetId(e.target.value)}
        required
      >
        <option value="">{t('form.selectRuleset')}</option>
        {rulesets.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </Select>

      <Select
        label={t('form.bestOf')}
        value={String(bestOf)}
        onChange={(e) => setBestOf(Number(e.target.value))}
        options={BEST_OF_VALUES.map((count) => ({ value: String(count), label: tCommon('bestOf', { count }) }))}
      />

      <BoOverrideEditor
        bracketType={bracketType}
        defaultBo={bestOf}
        overrides={boOverrides}
        onChange={setBoOverrides}
      />

      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm text-poke-text-primary">
          <input
            type="checkbox"
            checked={isDoubles}
            onChange={(e) => {
              setDoublesChoice(e.target.checked);
              setDoublesPinned(true);
            }}
            className="rounded accent-poke-accent"
          />
          {t('form.isDoubles')}
        </label>
        <p className="text-xs text-poke-text-muted">{t('form.isDoublesHint')}</p>
      </div>

      <Select
        label={t('form.teamVisibility')}
        value={teamVisibility}
        onChange={(e) => setTeamVisibility(e.target.value as TeamVisibility)}
        options={VISIBILITY_OPTIONS.map((value) => ({ value, label: enumLabel(tEnum, 'teamVisibility', value) }))}
      />

      <div className="border-t border-poke-border pt-3">
        <label className="block text-sm font-heading font-semibold text-poke-text-primary mb-1.5">
          {t('form.advancement')}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            value={advCount}
            onChange={(e) => setAdvCount(Number(e.target.value))}
            className="w-20 border border-poke-border bg-poke-surface rounded-poke-md px-3 py-1.5 text-sm"
            placeholder="0"
          />
          <span className="text-xs text-poke-text-secondary">{t('form.advancementPlayers')}</span>
          <label className="flex items-center gap-1 text-xs text-poke-text-primary">
            <input
              type="checkbox"
              checked={advPerGroup}
              onChange={(e) => setAdvPerGroup(e.target.checked)}
              className="rounded accent-poke-accent"
            />
            {t('form.perGroup')}
          </label>
        </div>
        <p className="text-xs text-poke-text-muted mt-1">
          {t('form.advancementHint')}
        </p>
      </div>

      <Button
        type="submit"
        variant="secondary"
        loading={submitting}
        disabled={!name || !rulesetId}
      >
        {submitLabel ?? t('form.submit')}
      </Button>
    </form>
  );
}
