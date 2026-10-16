'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LeaguePhase } from '@/types/season';
import type { Ruleset } from '@/types/ruleset';
import type { ApiResult } from '@/types/api';
import PhaseForm, { PhaseSaveError } from '@/components/league/PhaseForm';
import type { PhaseFormData } from '@/components/league/PhaseForm';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leaguePhasesMessages } from '@/i18n/messages/league-phases';

interface PhaseOverviewEditorProps {
  seasonId: string;
  phase: LeaguePhase;
  rulesets: Ruleset[];
}

export default function PhaseOverviewEditor({
  seasonId,
  phase,
  rulesets,
}: PhaseOverviewEditorProps) {
  const router = useRouter();
  const t = useT(leaguePhasesMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave(data: PhaseFormData) {
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/seasons/${seasonId}/phases/${phase.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result: ApiResult<LeaguePhase> = await res.json();
    if (!result.success) {
      const failure = toApiErrorLike(result);
      setError(failure);
      throw new PhaseSaveError(failure);
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && <Alert variant="error">{errorText(error)}</Alert>}
      {saved && (
        <p className="text-xs text-poke-green">{t('overview.saved')}</p>
      )}
      <PhaseForm
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
        lockBracketType={phase.status === 'active'}
      />
    </div>
  );
}
