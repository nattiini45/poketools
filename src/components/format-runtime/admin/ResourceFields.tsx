'use client';

import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import type { AdjustmentTargets } from '@/lib/format-engine/runtime/view-types';
import { speciesDisplayName } from '../player/entry-names';
import { labelText } from './admin-shared';
import type { ResourceDraft } from './adjust-form';

interface ResourceFieldsProps {
  targets: AdjustmentTargets;
  value: ResourceDraft;
  onChange: (next: ResourceDraft) => void;
  disabled: boolean;
}

/**
 * Give a player something a resource holds, or take it away. A resource that holds entries of a list needs the entry
 * (a `Select` over the list as it is now); a counter needs only the amount. The server refuses taking away more than the
 * player holds, so a revoke lists the whole list and the refusal is shown in words.
 */
export default function ResourceFields({ targets, value, onChange, disabled }: ResourceFieldsProps) {
  const t = useT(formatRuntimeAdminMessages);
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const resource = targets.resources.find((candidate) => candidate.key === value.resource);
  const holdsDomain = resource?.holds_domain !== null && resource?.holds_domain !== undefined;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Select
        label={t('adjust.fields.resource')}
        value={value.resource}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, resource: event.target.value, item: '' })}
      >
        <option value="">{t('adjust.fields.choose')}</option>
        {targets.resources.map((candidate) => (
          <option key={candidate.key} value={candidate.key}>
            {labelText(candidate.label, locale, candidate.key)}
          </option>
        ))}
      </Select>
      <Select
        label={t('adjust.fields.player')}
        value={value.player}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, player: event.target.value })}
      >
        <option value="">{t('adjust.fields.choose')}</option>
        {targets.players.map((player) => (
          <option key={player.id} value={player.id}>
            {player.name ?? t('formerPlayer')}
          </option>
        ))}
      </Select>
      {holdsDomain && (
        <Select
          label={t('adjust.fields.item')}
          value={value.item}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, item: event.target.value })}
        >
          <option value="">{t('adjust.fields.choose')}</option>
          {(resource?.items ?? []).map((id) => (
            <option key={id} value={id}>
              {speciesDisplayName(id, dataLocale)}
            </option>
          ))}
        </Select>
      )}
      <Select
        label={t('adjust.fields.direction')}
        value={value.direction}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, direction: event.target.value === 'revoke' ? 'revoke' : 'grant' })}
      >
        <option value="grant">{t('adjust.fields.grant')}</option>
        <option value="revoke">{t('adjust.fields.revoke')}</option>
      </Select>
      <Input
        label={t('adjust.fields.amount')}
        inputMode="numeric"
        autoComplete="off"
        value={value.amount}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, amount: event.target.value })}
      />
    </div>
  );
}
