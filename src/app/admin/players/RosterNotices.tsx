'use client';

import { useEffect, useRef } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin, errorsPlayers } from '@/i18n/messages/errors';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { revealNotice } from './roster-helpers';

type LocalError = 'loadFailed' | 'suspendFailed' | 'banFailed' | 'linkFailed' | 'actionFailed';
/** An API failure (translated by its code) or a local message key; never translated text. */
export type RosterError = { api: ApiErrorLike } | { local: LocalError };

export function apiError(json: unknown): RosterError {
  return { api: toApiErrorLike(json) };
}

/** A failed row action or add, kept apart from the roster itself until the admin dismisses it. */
export interface RosterActionNotice {
  kind: 'action' | 'add';
  /** The player the action was for. */
  name: string;
  error: RosterError;
}

/** Turns a `RosterError` into the viewer's language at render time. */
export function useRosterErrorText(): (error: RosterError) => string {
  const t = useT(adminCoreMessages);
  const errorText = useApiErrorText(errorsPlayers, errorsAdmin);
  return (error) => ('api' in error ? errorText(error.api) : t(`players.${error.local}`));
}

/** The failure of a row action or an add: says which player, and goes away on Dismiss. */
export function RosterActionAlert({
  notice,
  onDismiss,
}: {
  notice: RosterActionNotice;
  onDismiss: () => void;
}) {
  const t = useT(adminCoreMessages);
  const errorMessage = useRosterErrorText();
  const anchor = useRef<HTMLDivElement>(null);
  // The roster can run to 200 rows, so a failure above the table would otherwise go unseen.
  useEffect(() => {
    revealNotice(anchor.current);
  }, [notice]);
  return (
    <div ref={anchor}>
      <Alert variant="error" className="mb-4 flex items-start justify-between gap-3">
        <span>
          {t(notice.kind === 'add' ? 'players.addError' : 'players.actionError', {
            name: notice.name,
            message: errorMessage(notice.error),
          })}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('players.dismiss')}
          className="shrink-0 text-sm font-semibold underline hover:no-underline"
        >
          {t('players.dismiss')}
        </button>
      </Alert>
    </div>
  );
}

/** The roster could not be loaded: the reason and a way to try again. */
export function RosterLoadError({ error, onRetry }: { error: RosterError; onRetry: () => void }) {
  const t = useT(adminCoreMessages);
  const errorMessage = useRosterErrorText();
  return (
    <Alert variant="error" className="mb-4 flex items-start justify-between gap-3">
      <span>{errorMessage(error)}</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t('players.retry')}
      </Button>
    </Alert>
  );
}
