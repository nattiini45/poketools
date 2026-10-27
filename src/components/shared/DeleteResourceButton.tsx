'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { uiMessages } from '@/i18n/messages/ui';
import { errorsAdmin, errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';
import { LEAGUE_TRASH_RETENTION_DAYS } from '@/lib/league-trash/constants';

interface DeleteResourceButtonProps {
  resourceType: 'season' | 'tournament';
  resourceId: string;
  resourceName: string;
  redirectTo: string;
  /** Button text; the localized "Delete" by default. */
  label?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The `data.rebuild_warning` of a successful season/tournament DELETE
 * (`EntityDeleteResult`, src/lib/api/delete-rebuild-warning.ts): the delete
 * committed, but the derived-data rebuild after it failed or refused (e.g.
 * `rating_history_incomplete`, `derived_data_rebuild_failed`). Null when the
 * rebuild succeeded or the body carries no warning.
 */
export function deleteRebuildWarning(body: unknown): ApiErrorLike | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const warning = body.data.rebuild_warning;
  if (!isRecord(warning) || typeof warning.code !== 'string') return null;
  const params = isRecord(warning.params)
    ? Object.fromEntries(
        Object.entries(warning.params).filter(
          (entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number',
        ),
      )
    : undefined;
  return {
    code: warning.code,
    ...(typeof warning.error === 'string' ? { error: warning.error } : {}),
    ...(params ? { params } : {}),
  };
}

/**
 * The outcome of a season/tournament DELETE:
 *   - `deleted`: committed (a league moved to the trash, a tournament removed);
 *     `warning` is the derived-data rebuild problem to tell the admin about
 *     (`deleteRebuildWarning`), or null;
 *   - `refused`: nothing deleted (e.g. 409 `LEAGUE_TRASH_BUSY`); `error` is the
 *     API's catalogued error, or null when the body carried none.
 * A network failure rejects.
 */
export type ResourceDeleteOutcome =
  | { kind: 'deleted'; warning: ApiErrorLike | null }
  | { kind: 'refused'; error: ApiErrorLike | null };

export async function requestResourceDelete(
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResourceDeleteOutcome> {
  const res = await fetchImpl(endpoint, { method: 'DELETE' });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch (parseError) {
    // The status still decides the outcome; the unreadable body is logged, not hidden.
    console.error(`[DeleteResourceButton] DELETE ${endpoint} answered ${res.status} with a body that is not JSON`, parseError);
  }

  if (!res.ok) {
    const error = toApiErrorLike(body);
    return { kind: 'refused', error: error.error || error.code ? error : null };
  }
  return { kind: 'deleted', warning: deleteRebuildWarning(body) };
}

/**
 * Delete button of a league (Danger tab) or a tournament. It asks the browser's confirm first. A league is not
 * destroyed: the confirm says it moves to the trash and for how long the superadmin can restore it
 * (`LEAGUE_TRASH_RETENTION_DAYS`); a tournament delete is final.
 */
export default function DeleteResourceButton({
  resourceType,
  resourceId,
  resourceName,
  redirectTo,
  label,
}: DeleteResourceButtonProps) {
  const router = useRouter();
  const t = useT(uiMessages);
  const errorText = useApiErrorText(errorsSeasons, errorsTournaments, errorsAdmin);
  const [loading, setLoading] = useState(false);

  const endpoint = resourceType === 'season'
    ? `/api/seasons/${resourceId}`
    : `/api/tournaments/${resourceId}`;

  async function handleDelete() {
    const confirmed = window.confirm(
      t(`deleteResource.confirm.${resourceType}`, { name: resourceName, days: LEAGUE_TRASH_RETENTION_DAYS }),
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const outcome = await requestResourceDelete(endpoint);

      if (outcome.kind === 'refused') {
        // e.g. 409 LEAGUE_TRASH_BUSY (nothing deleted), rendered from the catalogue by code.
        window.alert(outcome.error ? errorText(outcome.error) : t(`deleteResource.failed.${resourceType}`));
        return;
      }

      // Deleted, but the rebuild after it did not finish (the superadmin runs it
      // from the trash page, a tournament's from the data tools): say so before
      // leaving the page instead of an empty success.
      if (outcome.warning) {
        window.alert(
          t(`deleteResource.deletedWithWarning.${resourceType}`, { name: resourceName, warning: errorText(outcome.warning) }),
        );
      }

      router.push(redirectTo);
      router.refresh();
    } catch (requestError) {
      console.error(`[DeleteResourceButton] DELETE ${endpoint} failed`, requestError);
      window.alert(t(`deleteResource.failed.${resourceType}`));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="danger" size="sm" className="min-h-11 sm:min-h-0" onClick={handleDelete} loading={loading}>
      {label ?? t('deleteResource.label')}
    </Button>
  );
}
