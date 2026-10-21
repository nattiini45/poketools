'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ApiResult } from '@/types/api';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { deleteRebuildWarning } from '@/components/shared/DeleteResourceButton';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import { useServerSyncedState } from '@/hooks/useServerSyncedState';

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
 *
 * Every save rebuilds the league players' ratings for the stored flag,
 * changed or not (test leagues stay out of ratings), so saving it again
 * finishes a rebuild that was cut off. Resolves to that rebuild's
 * `data.rebuild_warning` when the flag was saved but the rebuild failed or did
 * not settle (the same shape and catalogue codes as an entity delete's
 * warning), otherwise null.
 */
export async function saveTestFlag(
  seasonId: string,
  isTestSeason: boolean,
  fetchImpl: FetchLike = fetch,
): Promise<ApiErrorLike | null> {
  const res = await fetchImpl(`/api/seasons/${seasonId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_test_season: isTestSeason }),
  });
  const data: ApiResult<unknown> = await res.json();
  if (!data.success) throw new TestFlagSaveError(data);
  return deleteRebuildWarning(data);
}

/**
 * What one save of the checkbox ended in: `saved` (with the rebuild warning,
 * if any), `failed` (the route answered with an error) or `unconfirmed` (no
 * answer from the route: a network error, a timeout, a non-JSON 504; the flag
 * may already be saved).
 */
export type TestFlagSaveOutcome =
  | { status: 'saved'; warning: ApiErrorLike | null }
  | { status: 'failed'; error: ApiErrorLike }
  | { status: 'unconfirmed' };

/**
 * Saves the flag and refreshes the route whatever happened, so the checkbox
 * shows the STORED flag afterwards (a request that died may have saved it).
 */
export async function runTestFlagSave(
  seasonId: string,
  isTestSeason: boolean,
  refresh: () => void,
  save: typeof saveTestFlag = saveTestFlag,
): Promise<TestFlagSaveOutcome> {
  try {
    return { status: 'saved', warning: await save(seasonId, isTestSeason) };
  } catch (err) {
    return err instanceof TestFlagSaveError ? { status: 'failed', error: err.result } : { status: 'unconfirmed' };
  } finally {
    refresh();
  }
}

interface LeagueTestFlagControlProps {
  seasonId: string;
  isTestSeason: boolean;
}

/**
 * Site-admin checkbox for `seasons.is_test_season`. A test league is listed
 * after the real leagues with a test badge (`/leagues`, the home teaser, My
 * Leagues, `GET /api/seasons`) so the community can test together; only the
 * insights scope picker and the home spotlight leave it out. Its matches
 * never count toward player ratings (by the current flag: every save
 * rebuilds the league players' ratings, src/lib/rating/test-league-rebuild.ts),
 * and the games recorded while it is set stay out of the all-time stats
 * (`games.exclude_all_time`, frozen per game). Optimistic, with an inline
 * error on failure (LeagueThemeControl's pattern); a saved flag whose rating
 * rebuild failed or did not settle keeps the checkbox and shows the rebuild
 * warning. Every
 * save, failed or not, refreshes the route, so the header badge, the checkbox
 * and every other reader of the flag show the STORED value: a failed save
 * reverts to the last known value, and the refreshed prop replaces it when
 * the flag was saved after all. Without an answer from the route the control
 * says the save is unconfirmed (`testFlag.saveUnconfirmed`). The checkbox
 * follows the `isTestSeason` prop whenever no save is in flight.
 */
export default function LeagueTestFlagControl({ seasonId, isTestSeason }: LeagueTestFlagControlProps) {
  const router = useRouter();
  const t = useT(leagueAdminMessages);
  const errorText = useApiErrorText(errorsSeasons, errorsAdmin);
  const [saving, setSaving] = useState(false);
  const [checked, setChecked] = useServerSyncedState(isTestSeason, saving);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [warning, setWarning] = useState<ApiErrorLike | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);

  async function handleChange(next: boolean) {
    if (saving || next === checked) return;
    const previous = checked;
    setChecked(next);
    setSaving(true);
    setError(null);
    setWarning(null);
    setUnconfirmed(false);
    const outcome = await runTestFlagSave(seasonId, next, () => router.refresh());
    if (outcome.status === 'saved') {
      setWarning(outcome.warning);
    } else {
      setChecked(previous);
      if (outcome.status === 'failed') setError(outcome.error);
      else setUnconfirmed(true);
    }
    setSaving(false);
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
      {unconfirmed && (
        <p role="status" className="text-xs text-poke-danger">
          {t('testFlag.saveUnconfirmed')}
        </p>
      )}
      {warning && (
        <p role="status" className="text-xs text-poke-amber-ink">
          {t('testFlag.ratingRebuildWarning', { warning: errorText(warning) })}
        </p>
      )}
    </div>
  );
}
