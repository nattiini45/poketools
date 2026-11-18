'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LeaguePhase } from '@/types/season';
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';
import type { ApiResult } from '@/types/api';
import PhaseForm, { PhaseSaveError } from '@/components/league/PhaseForm';
import type { PhaseFormData } from '@/components/league/PhaseForm';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { toApiErrorLike } from '@/i18n/api-errors';
import { leaguePhasesMessages } from '@/i18n/messages/league-phases';
import { INFO_CALLOUT } from '@/components/admin/match-styles';

interface PhaseOverviewEditorProps {
  seasonId: string;
  phase: LeaguePhase;
  rulesets: readonly RulesetOption[];
  native?: { formatManaged: boolean };
}

export default function PhaseOverviewEditor({
  seasonId,
  phase,
  rulesets,
  native,
}: PhaseOverviewEditorProps) {
  const router = useRouter();
  const t = useT(leaguePhasesMessages);
  const [saved, setSaved] = useState(false);

  /** A refusal is thrown as `PhaseSaveError`: `PhaseForm` shows it, the editor shows no error of its own. */
  async function handleSave(data: PhaseFormData) {
    setSaved(false);
    const body: Partial<PhaseFormData> = native ? { ...data, description: data.description ?? '' } : data;
    if (native?.formatManaged) {
      delete body.bracket_type;
      delete body.best_of_default;
      delete body.bo_overrides;
      delete body.is_doubles;
    }
    const res = await fetch(`/api/seasons/${seasonId}/phases/${phase.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result: ApiResult<LeaguePhase> = await res.json();
    if (!result.success) {
      throw new PhaseSaveError(toApiErrorLike(result));
    }
    setSaved(true);
    router.refresh();
  }

  const completed = phase.status === 'completed';
  const archived = native !== undefined && phase.archived;

  return (
    <div className="space-y-3">
      {archived ? <Alert variant="info" className={INFO_CALLOUT}>{t('overview.lockedArchived')}</Alert>
        : completed && !native?.formatManaged && <Alert variant="info" className={INFO_CALLOUT}>{t('overview.lockedCompleted')}</Alert>}
      {native?.formatManaged && <Alert variant="info" className={INFO_CALLOUT}>{t('overview.formatManaged')}</Alert>}
      {saved && (
        <p className="text-caption text-win">{t('overview.saved')}</p>
      )}
      <PhaseForm
        key={native ? phase.updated_at : undefined}
        rulesets={rulesets}
        initialData={{
          name: phase.name,
          description: phase.description,
          bracket_type: phase.bracket_type,
          ruleset_id: phase.ruleset_id,
          best_of_default: phase.best_of_default,
          bo_overrides: phase.bo_overrides,
          is_doubles: phase.is_doubles,
          team_visibility: phase.team_visibility,
          advancement_rule: phase.advancement_rule,
        }}
        onSubmit={handleSave}
        submitLabel={t('overview.saveChanges')}
        lockBracketType={phase.status === 'active' || native?.formatManaged}
        lockStructure={native?.formatManaged}
        lockRuleset={native !== undefined && phase.status !== 'upcoming'}
        locked={completed || archived}
      />
    </div>
  );
}
