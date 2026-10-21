'use client';

import Link from 'next/link';
import Alert from '@/components/ui/Alert';
import Button, { getButtonClasses } from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin, errorsMatches } from '@/i18n/messages/errors';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { gameChangeFailureHints } from '@/lib/match/game-change-outcome';

interface GameChangeAlertsProps {
  /** A failed game edit/delete/reset (rendered by code), or null. */
  error?: ApiErrorLike | null;
  /** Warnings of a saved change (`gameChangeWarnings`), rendered by code. */
  warnings?: readonly ApiErrorLike[];
  /**
   * The viewer is a site admin. The data tools' actions (aggregate rebuild,
   * Record Reconciliation) are site-admin APIs, so a tournament or league
   * admin gets a "ask a site admin" note instead of a link to a page whose
   * tools would refuse them.
   */
  isSiteAdmin: boolean;
}

/**
 * The result notices of an admin game change, with the recovery each one
 * needs: a reload when the page's data is stale (a concurrent change, a stale
 * editor version), a link to the admin data tools when the fix is a rebuild or
 * a Record Reconciliation repair. A full reload (not `router.refresh()`): the
 * edit form seeds its fields from the server props once, so only a reload
 * shows the current game.
 */
export default function GameChangeAlerts({ error, warnings = [], isSiteAdmin }: GameChangeAlertsProps) {
  const t = useT(adminCoreMessages);
  const errorText = useApiErrorText(errorsMatches, errorsAdmin);
  if (!error && warnings.length === 0) return null;

  const hints = gameChangeFailureHints(error);
  const dataTools = hints.dataTools || warnings.length > 0;

  return (
    <div className="space-y-2">
      {error && <Alert variant="error">{errorText(error)}</Alert>}
      {warnings.map((warning) => (
        <Alert key={warning.code ?? warning.error ?? ''} variant="warning">
          {errorText(warning)}
        </Alert>
      ))}
      {dataTools && !isSiteAdmin && (
        <p className="text-sm text-poke-text-secondary">{t('gameChange.askSiteAdmin')}</p>
      )}
      {(hints.reload || (dataTools && isSiteAdmin)) && (
        <div className="flex flex-wrap gap-3">
          {hints.reload && (
            <Button type="button" variant="secondary" size="sm" onClick={() => window.location.reload()}>
              {t('gameChange.reload')}
            </Button>
          )}
          {dataTools && isSiteAdmin && (
            <Link href="/admin/data" className={getButtonClasses('ghost', 'sm')}>
              {t('gameChange.openDataTools')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
