'use client';

import type { ReactNode } from 'react';
import type { SeasonFormatType } from '@/types/season';
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';
import Input from '@/components/ui/Input';
import RulesetSelect from '@/components/ruleset/RulesetSelect';
import Select from '@/components/ui/Select';
import { useT } from '@/i18n/client';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

/**
 * The field pieces the league create form (`LeagueForm`) and the league details form
 * (`LeagueSettingsForm`) share, so both render the same controls and labels.
 */

interface LeagueTypeFieldProps {
  id: string;
  label: string;
  value: SeasonFormatType;
  options: { value: string; label: string }[];
  onChange: (value: SeasonFormatType) => void;
  disabled?: boolean;
  /** A note under the select; the select is described by it. */
  note?: { id: string; text: ReactNode } | null;
}

/** The league type (`seasons.format_type`) select with an optional note under it. */
export function LeagueTypeField({ id, label, value, options, onChange, disabled, note }: LeagueTypeFieldProps) {
  return (
    <div className="space-y-1.5">
      <Select
        id={id}
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as SeasonFormatType)}
        options={options}
        disabled={disabled}
        aria-describedby={note?.id}
      />
      {note && (
        <p id={note.id} className="text-xs text-poke-text-muted">
          {note.text}
        </p>
      )}
    </div>
  );
}

interface LeagueRulesetFieldProps {
  /** A point-buy league has no ruleset choice: the server sets the pack's battle ruleset. */
  isPointBuy: boolean;
  rulesets: readonly RulesetOption[];
  value: string;
  onChange: (rulesetId: string) => void;
  /** A hint under the ruleset select (not shown for a point-buy league). */
  hint?: { id: string; text: ReactNode } | null;
  /** The select cannot be changed (a started league keeps its ruleset; `hint` says where its version moves). */
  disabled?: boolean;
}

/** The battle ruleset select, or the note that a point-buy league's ruleset is set automatically. */
export function LeagueRulesetField({ isPointBuy, rulesets, value, onChange, hint, disabled = false }: LeagueRulesetFieldProps) {
  const t = useT(leagueAdminMessages);

  if (isPointBuy) {
    return (
      <div className="space-y-1.5" data-testid="league-auto-ruleset">
        <p className="text-sm font-heading font-semibold text-poke-text-primary">
          {t('form.autoRuleset', { ruleset: t('form.autoRulesetName') })}
        </p>
        <p className="text-xs text-poke-text-muted">{t('form.autoRulesetHint')}</p>
      </div>
    );
  }

  const select = (
    <RulesetSelect
      id="league-ruleset"
      label={t('form.ruleset')}
      value={value}
      onChange={onChange}
      options={rulesets}
      placeholder={t('form.noRuleset')}
      aria-describedby={hint?.id}
      disabled={disabled}
      studioLink={!disabled}
    />
  );
  if (!hint) return select;
  return (
    <div className="space-y-1.5">
      {select}
      <p id={hint.id} className="text-xs text-poke-text-muted">
        {hint.text}
      </p>
    </div>
  );
}

interface LeagueDateFieldsProps {
  start: string;
  end: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  /** Shown under the end date (for example an end before the start). */
  error?: string;
}

/** The start and end date inputs (`YYYY-MM-DD`; empty = unset). */
export function LeagueDateFields({ start, end, onStart, onEnd, error }: LeagueDateFieldsProps) {
  const t = useT(leagueAdminMessages);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Input
        label={t('form.startDate')}
        type="date"
        value={start}
        onChange={(e) => onStart(e.target.value)}
      />
      <Input
        label={t('form.endDate')}
        type="date"
        value={end}
        onChange={(e) => onEnd(e.target.value)}
        error={error}
      />
    </div>
  );
}
