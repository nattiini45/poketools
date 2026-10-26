'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { movePinsRequest } from '@/lib/ruleset-studio/editor/api';
import { pinTargetCompleted, pinTargetStarted, type RulesetPinInfo } from '@/lib/ruleset-studio/pin-info';
import { rulesetReadOnlyHref } from '@/components/ruleset-studio/hrefs';
import PinConfirmDialog from './PinConfirmDialog';
import { describeChange } from './pin-change-text';
import { usePinImpact } from './use-pin-impact';

/** What the card is for: wording only (a league, a phase of a league, a standalone tournament). */
export type PinCardKind = 'season' | 'tournament' | 'standalone';

interface RulesetPinCardProps {
  kind: PinCardKind;
  /** The league (`season`) or phase / standalone tournament (`tournament`) whose pin this is. */
  target: { kind: 'season' | 'tournament'; id: string; name: string; status: string };
  pin: RulesetPinInfo;
  /** Defaults to refreshing the page; a test passes its own. */
  onMoved?: () => void;
}

/**
 * The ruleset a league, phase or tournament enforces, and the explicit way to move it to a newer version. Publishing a new
 * version of a ruleset never changes a running league; this card does, on purpose:
 *
 *  - before the target has started: one click ("Update to version 3"), with what changes written next to it;
 *  - after it has started: a dialog that names the league or phase and says how many of its submitted teams would stop being
 *    valid under the new version (counted by the server when the dialog opens, `pins/impact`), and the request carries the
 *    target's id as `confirm_started` (the server compares it with the real state, so a race cannot slip a different
 *    league in);
 *  - once it is finished: read-only, with the reason.
 *
 * The move is `POST /api/ruleset-definitions/[id]/pins`, which re-checks the caller's right to administer the target.
 */
export default function RulesetPinCard({ kind, target, pin, onMoved }: RulesetPinCardProps) {
  const t = useT(rulesetMessages);
  const errorText = useApiErrorText(errorsAdmin);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [asking, setAsking] = useState(false);
  const [movedTo, setMovedTo] = useState<number | null>(null);
  const impact = usePinImpact();

  const completed = pinTargetCompleted(target.status);
  const started = pinTargetStarted(target.status);
  const update = completed ? null : pin.update;

  async function move(confirmed: boolean) {
    if (update === null) return;
    setBusy(true);
    setError(null);
    const outcome = await movePinsRequest(pin.definition_id, update.version_no, [{ kind: target.kind, id: target.id }], confirmed ? [target.id] : []);
    setBusy(false);
    if (!outcome.ok) {
      closeDialog();
      setError(outcome.error);
      return;
    }
    closeDialog();
    setMovedTo(outcome.data.version_no);
    if (onMoved) onMoved();
    else router.refresh();
  }

  /** Opens the confirmation of a running target and starts counting the teams the update would invalidate. */
  function askToMove() {
    if (update === null) return;
    setAsking(true);
    void impact.load(pin.definition_id, update.version_no, [{ kind: target.kind, id: target.id }]);
  }

  function closeDialog() {
    setAsking(false);
    impact.reset();
  }

  const changeText = update === null ? null : describeChange(update.change, t);

  return (
    <section className="space-y-2 rounded-poke-lg border border-poke-border bg-poke-surface p-4" aria-labelledby={`pin-${target.id}`}>
      <h3 id={`pin-${target.id}`} className="font-heading text-sm font-semibold text-poke-text-primary">
        {t('pin.heading')}
      </h3>
      <p className="text-sm text-poke-text-primary">
        <span className="font-semibold">{t('pin.current', { name: pin.name, version: pin.version_no })}</span>{' '}
        {pin.can_view && (
          <Link href={rulesetReadOnlyHref(pin.definition_id)} className="font-medium text-poke-blue hover:underline">
            {t('pin.open')}
          </Link>
        )}
      </p>

      {completed ? (
        <p className="text-sm text-poke-text-muted">{t(`pin.locked.${kind}`)}</p>
      ) : update === null ? (
        <p className="text-sm text-poke-text-muted">{t('pin.latest')}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-poke-text-secondary">
            {t('pin.available', { version: update.version_no })}{' '}
            {changeText === null ? t('pin.sameRules') : t('pin.changeJoin', { changes: changeText })}
          </p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="min-h-11 sm:min-h-0"
            disabled={busy}
            onClick={() => (started ? askToMove() : void move(false))}
          >
            {busy ? t('pin.updating') : t('pin.update', { version: update.version_no })}
          </Button>
        </div>
      )}

      <div role="status" aria-live="polite">
        {movedTo !== null && <p className="text-sm text-poke-green">{t('pin.updated', { version: movedTo })}</p>}
      </div>
      {error !== null && (
        <Alert variant="error" role="alert">
          {errorText(error)}
        </Alert>
      )}

      {update !== null && (
        <PinConfirmDialog
          open={asking}
          title={t('pin.confirm.title', { target: t(`pin.confirm.${kind}`) })}
          version={update.version_no}
          impact={impact.state}
          busy={busy}
          confirmLabel={t('pin.confirm.confirm', { version: update.version_no })}
          cancelLabel={t('pin.confirm.cancel')}
          onConfirm={() => void move(true)}
          onCancel={closeDialog}
        >
          <p className="text-sm text-poke-text-secondary">{t('pin.confirm.body', { name: target.name })}</p>
          {changeText !== null && <p className="text-sm text-poke-text-secondary">{t('pin.changeJoin', { changes: changeText })}</p>}
        </PinConfirmDialog>
      )}
    </section>
  );
}
