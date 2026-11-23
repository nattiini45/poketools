'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TournamentForm from './TournamentForm';
import type { Tournament, TournamentFormData } from '@/types/tournament';
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';
import type { ApiResponse, ApiResult, ApiWarning } from '@/types/api';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsTournaments } from '@/i18n/messages/errors';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import type { TournamentLockReason } from '@/lib/tournament/standalone-lock';
import {
  buildTournamentPatch,
  type TournamentSettingsLocks,
  type TournamentSettingsSource,
} from '@/lib/tournament/settings-patch';

type EditableTournament = TournamentSettingsSource & Pick<Tournament, 'id'>;

interface TournamentSettingsEditorProps {
  tournament: EditableTournament;
  rulesets: readonly RulesetOption[];
  /** The tournament has started (not upcoming, or it has rounds): bracket type, ruleset and doubles are frozen. */
  started: boolean;
  /** Why it is frozen, for the hint under the locked controls; defaults to "the tournament has started". */
  lockReason?: TournamentLockReason | null;
}

const LOCKED: TournamentSettingsLocks = { bracketType: true, ruleset: true, doubles: true };
const UNLOCKED: TournamentSettingsLocks = { bracketType: false, ruleset: false, doubles: false };

/**
 * Sends only the changed settings to PATCH /api/tournaments/[id]. `sent: false`
 * without a request when nothing changed. A refusal throws the API
 * failure (English `error` + `code` + `params`) so the form renders it by code.
 */
export interface SaveTournamentSettingsResult {
  /** False when nothing changed and no request went out. */
  sent: boolean;
  /** Warnings the saved write carried (for example a failed bracket sync, issue #152). */
  warnings: ApiWarning[];
}

export async function saveTournamentSettings(
  tournament: EditableTournament,
  data: TournamentFormData,
  locks: TournamentSettingsLocks,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveTournamentSettingsResult> {
  const patch = buildTournamentPatch(tournament, data, locks);
  if (Object.keys(patch).length === 0) return { sent: false, warnings: [] };

  const result = await patchTournament(tournament.id, patch, fetchImpl);
  return { sent: true, warnings: result.warnings ?? [] };
}

/** The PATCH field that retries the bracket sync of a saved setting after its *_sync_failed warning (issue #152). */
const SYNC_RETRY_FIELD: Record<string, string> = {
  bracket_reset_sync_failed: 'bracket_reset_sync_retry',
  third_place_sync_failed: 'third_place_sync_retry',
};

/** The retry field for a sync warning, or null for a warning that does not name a retry. */
function syncRetryField(warning: ApiWarning): string | null {
  return warning.code !== undefined ? (SYNC_RETRY_FIELD[warning.code] ?? null) : null;
}

async function patchTournament(id: string, patch: object, fetchImpl: typeof fetch): Promise<ApiResponse<Tournament>> {
  const res = await fetchImpl(`/api/tournaments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const result: ApiResult<Tournament> | null = await res.json().catch(() => null);
  if (!result?.success) {
    throw Object.assign(new Error(result?.error ?? ''), {
      error: result?.error,
      code: result?.code,
      params: result?.params,
    });
  }
  return result;
}

/**
 * Re-runs one bracket sync through its explicit retry field (issue #152). Resolves to the warnings of
 * the retry (empty when the sync succeeded); a refusal throws the API failure like a save does.
 */
export async function retryTournamentSync(
  tournamentId: string,
  retryField: 'bracket_reset_sync_retry' | 'third_place_sync_retry',
  fetchImpl: typeof fetch = fetch,
): Promise<ApiWarning[]> {
  const result = await patchTournament(tournamentId, { [retryField]: true }, fetchImpl);
  return result.warnings ?? [];
}

export default function TournamentSettingsEditor({
  tournament,
  rulesets,
  started,
  lockReason,
}: TournamentSettingsEditorProps) {
  const router = useRouter();
  const t = useT(tournamentsAdminMessages);
  const errorText = useApiErrorText(errorsTournaments);
  const [saved, setSaved] = useState(false);
  const [syncWarnings, setSyncWarnings] = useState<ApiWarning[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const locks = started ? LOCKED : UNLOCKED;

  async function handleSubmit(data: TournamentFormData) {
    setSaved(false);
    const { sent, warnings } = await saveTournamentSettings(tournament, data, locks);
    if (!sent) return;
    setSaved(true);
    setSyncWarnings(warnings);
    router.refresh();
  }

  async function handleSyncRetry(warning: ApiWarning) {
    const field = syncRetryField(warning);
    if (field === null) return;
    setRetrying(field);
    try {
      const warnings = await retryTournamentSync(tournament.id, field as 'bracket_reset_sync_retry' | 'third_place_sync_retry');
      setSyncWarnings(warnings);
      router.refresh();
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="space-y-3">
      <TournamentForm
        // A refresh brings new server values: remount for a fresh baseline.
        key={JSON.stringify(tournament)}
        mode="edit"
        rulesets={rulesets}
        initialData={{
          name: tournament.name,
          bracket_type: tournament.bracket_type,
          ruleset_id: tournament.ruleset_id,
          best_of_default: tournament.best_of_default,
          bo_overrides: tournament.bo_overrides,
          is_doubles: tournament.is_doubles,
          team_visibility: tournament.team_visibility,
          bracket_reset_enabled: tournament.bracket_reset_enabled,
          third_place_enabled: tournament.third_place_enabled,
        }}
        submitLabel={t('form.saveChanges')}
        lockedFields={{ bracketType: locks.bracketType, ruleset: locks.ruleset, doubles: locks.doubles }}
        lockedReason={lockReason ?? 'started'}
        onSubmit={handleSubmit}
      />
      {saved && (
        <p role="status" className="text-body text-win">
          {t('form.saved')}
        </p>
      )}
      {syncWarnings.map((warning) => {
        const field = syncRetryField(warning);
        return (
          <Alert key={warning.code} variant="warning">
            <div className="flex items-center justify-between gap-3">
              <p>{errorText(warning)}</p>
              {field !== null && (
                <Button variant="secondary" size="sm" loading={retrying === field} onClick={() => handleSyncRetry(warning)}>
                  {t('form.retrySync')}
                </Button>
              )}
            </div>
          </Alert>
        );
      })}
    </div>
  );
}
