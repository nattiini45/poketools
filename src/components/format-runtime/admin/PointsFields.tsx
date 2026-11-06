'use client';

import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useLocale, useT } from '@/i18n/client';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import type { AdjustmentTargets } from '@/lib/format-engine/runtime/view-types';
import { SCORE_ABS_MAX } from '@/lib/format-kit/limits';
import { labelText } from './admin-shared';
import type { PointsDraft } from './adjust-form';

interface PointsFieldsProps {
  targets: AdjustmentTargets;
  value: PointsDraft;
  onChange: (next: PointsDraft) => void;
  disabled: boolean;
}

/** Points for one player in one stage: the stage, a player of that stage, and a signed amount with up to 2 decimals. */
export default function PointsFields({ targets, value, onChange, disabled }: PointsFieldsProps) {
  const t = useT(formatRuntimeAdminMessages);
  const locale = useLocale();
  const stage = targets.stages.find((candidate) => candidate.key === value.stage);
  const players = stage?.players ?? [];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Select
        label={t('adjust.fields.stage')}
        value={value.stage}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, stage: event.target.value, player: '' })}
      >
        <option value="">{t('adjust.fields.choose')}</option>
        {targets.stages.map((candidate) => (
          <option key={candidate.key} value={candidate.key}>
            {labelText(candidate.label, locale, candidate.key)}
          </option>
        ))}
      </Select>
      <Select
        label={t('adjust.fields.player')}
        value={value.player}
        disabled={disabled || value.stage === ''}
        onChange={(event) => onChange({ ...value, player: event.target.value })}
      >
        <option value="">{t('adjust.fields.choose')}</option>
        {players.map((player) => (
          <option key={player.id} value={player.id}>
            {player.name ?? t('formerPlayer')}
          </option>
        ))}
      </Select>
      <Input
        label={t('adjust.fields.points')}
        hint={t('adjust.fields.pointsHint', { max: SCORE_ABS_MAX })}
        inputMode="decimal"
        autoComplete="off"
        value={value.points}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, points: event.target.value })}
      />
    </div>
  );
}
