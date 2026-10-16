'use client';

import { useState } from 'react';
import type { ApiResult } from '@/types/api';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

/** The checkbox label in English (the `league-admin` source text). */
export const TEST_LEAGUE_LABEL = leagueAdminMessages.en.testFlag.label;

type FetchLike = (input: string, init: RequestInit) => Promise<Pick<Response, 'json'>>;

/**
 * A failed test-flag save. `message` is the route's own English text; `result`
 * keeps its `code` / `params` so the control can show it in the viewer's language.
 */
export class TestFlagSaveError extends Error {
  readonly result: ApiErrorLike;

  constructor(result: ApiErrorLike) {
    super(result.error || 'Failed to update the test-league flag');
    this.name = 'TestFlagSaveError';
    this.result = result;
  }
}

/**
 * PATCH `{ is_test_season }` to /api/seasons/[id] (site admin only, audited
 * as `season.set_test_flag`). Throws with the route's own message on failure,
 * so a 403 or a 400 stays distinguishable in the inline error.
 */
export async function saveTestFlag(
  seasonId: string,
  isTestSeason: boolean,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const res = await fetchImpl(`/api/seasons/${seasonId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_test_season: isTestSeason }),
  });
  const data: ApiResult<unknown> = await res.json();
  if (!data.success) throw new TestFlagSaveError(data);
}

interface LeagueTestFlagControlProps {
  seasonId: string;
  isTestSeason: boolean;
}

/**
 * Site-admin checkbox for `seasons.is_test_season`. A test league is left out
 * of every public league list (`/leagues`, the home page, the insights scope
 * picker, `GET /api/seasons`) but stays reachable by its URL, and the games
 * recorded while it is set stay out of the all-time stats. Optimistic, with
 * revert and an inline error on failure (LeagueThemeControl's pattern).
 */
export default function LeagueTestFlagControl({ seasonId, isTestSeason }: LeagueTestFlagControlProps) {
  const t = useT(leagueAdminMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const [checked, setChecked] = useState(isTestSeason);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  async function handleChange(next: boolean) {
    if (saving || next === checked) return;
    const previous = checked;
    setChecked(next);
    setSaving(true);
    setError(null);
    try {
      await saveTestFlag(seasonId, next);
    } catch (err) {
      setChecked(previous);
      setError(err instanceof TestFlagSaveError ? err.result : toApiErrorLike(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm text-poke-text-primary">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          disabled={saving}
          onChange={(e) => handleChange(e.target.checked)}
        />
        <span>{t('testFlag.label')}</span>
      </label>
      <p className="text-xs text-poke-text-muted">{t('testFlag.hint')}</p>
      {saving && <p className="text-xs text-poke-text-muted">{t('testFlag.saving')}</p>}
      {error && (
        <p className="text-xs text-poke-danger">
          {error.error || error.code ? errorText(error) : t('testFlag.saveFailed')}
        </p>
      )}
    </div>
  );
}
