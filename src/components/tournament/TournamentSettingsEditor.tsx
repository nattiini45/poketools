'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TournamentForm from './TournamentForm';
import type { Tournament, TournamentFormData } from '@/types/tournament';
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';
import type { ApiResult } from '@/types/api';
import { useT } from '@/i18n/client';
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
 * Sends only the changed settings to PATCH /api/tournaments/[id]. Resolves
 * `false` without a request when nothing changed. A refusal throws the API
 * failure (English `error` + `code` + `params`) so the form renders it by code.
 */
export async function saveTournamentSettings(
  tournament: EditableTournament,
  data: TournamentFormData,
  locks: TournamentSettingsLocks,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const patch = buildTournamentPatch(tournament, data, locks);
  if (Object.keys(patch).length === 0) return false;

  const res = await fetchImpl(`/api/tournaments/${encodeURIComponent(tournament.id)}`, {
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
  return true;
}

export default function TournamentSettingsEditor({
  tournament,
  rulesets,
  started,
  lockReason,
}: TournamentSettingsEditorProps) {
  const router = useRouter();
  const t = useT(tournamentsAdminMessages);
  const [saved, setSaved] = useState(false);
  const locks = started ? LOCKED : UNLOCKED;

  async function handleSubmit(data: TournamentFormData) {
    setSaved(false);
    const sent = await saveTournamentSettings(tournament, data, locks);
    if (!sent) return;
    setSaved(true);
    router.refresh();
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
        }}
        submitLabel={t('form.saveChanges')}
        lockedFields={{ bracketType: locks.bracketType, ruleset: locks.ruleset, doubles: locks.doubles }}
        lockedReason={lockReason ?? 'started'}
        onSubmit={handleSubmit}
      />
      {saved && (
        <p role="status" className="text-sm text-poke-green">
          {t('form.saved')}
        </p>
      )}
    </div>
  );
}
