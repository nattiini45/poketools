'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { movePinsRequest } from '@/lib/ruleset-studio/editor/api';
import type { RulesetPinTarget, RulesetUsage } from '@/lib/ruleset-studio/library-types';
import { pinTargetCompleted, pinTargetStarted } from '@/lib/ruleset-studio/pin-info';
import PinConfirmDialog from './PinConfirmDialog';
import { usePinImpact } from './use-pin-impact';

interface UsagePanelProps {
  definitionId: string;
  usage: RulesetUsage;
  /** The newest published version: where "update" moves the selected leagues and phases. Null without a published version. */
  latestVersionNo: number | null;
}

const keyOf = (target: Pick<RulesetPinTarget, 'kind' | 'id'>): string => `${target.kind}:${target.id}`;

/**
 * Who pins which version of a ruleset: the reverse view of the pin card. Everyone who may see the ruleset gets the counts per
 * version; site admins and the admins of a league-owned ruleset also get the named leagues and phases, each with a checkbox,
 * and can move the selected ones to the newest version in one go. A finished league or phase, and one that is already on the
 * newest version, cannot be selected. Running ones ask for one confirmation that names them (`confirm_started`) and says how
 * many of the submitted teams of the selection would stop being valid under the new version (`pins/impact`).
 */
export default function UsagePanel({ definitionId, usage, latestVersionNo }: UsagePanelProps) {
  const t = useT(rulesetMessages);
  const errorText = useApiErrorText(errorsAdmin);
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [asking, setAsking] = useState(false);
  const [moved, setMoved] = useState<number | null>(null);
  const impact = usePinImpact();

  const targets = usage.targets ?? [];
  const movable = (target: RulesetPinTarget): boolean =>
    latestVersionNo !== null && target.version_no !== latestVersionNo && !pinTargetCompleted(target.status);
  const chosen = targets.filter((target) => selected.has(keyOf(target)));
  const running = chosen.filter((target) => pinTargetStarted(target.status));

  function toggle(target: RulesetPinTarget, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(keyOf(target));
    else next.delete(keyOf(target));
    setSelected(next);
  }

  async function move() {
    if (latestVersionNo === null || chosen.length === 0) return;
    setBusy(true);
    setError(null);
    const outcome = await movePinsRequest(
      definitionId,
      latestVersionNo,
      chosen.map((target) => ({ kind: target.kind, id: target.id })),
      running.map((target) => target.id),
    );
    setBusy(false);
    closeDialog();
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setMoved(outcome.data.moved.length);
    setSelected(new Set());
    router.refresh();
  }

  /** Opens the confirmation of a selection that includes running targets and starts counting the teams it would invalidate. */
  function askToMove() {
    if (latestVersionNo === null) return;
    setAsking(true);
    void impact.load(
      definitionId,
      latestVersionNo,
      chosen.map((target) => ({ kind: target.kind, id: target.id })),
    );
  }

  function closeDialog() {
    setAsking(false);
    impact.reset();
  }

  const canUpdate = latestVersionNo !== null && targets.some(movable);

  return (
    <section className="space-y-3" aria-labelledby="ruleset-usage">
      <h2 id="ruleset-usage" className="font-heading text-lg font-bold text-poke-text-primary">
        {t('usage.heading')}
      </h2>
      <p className="max-w-prose text-sm text-poke-text-secondary">{t('usage.intro')}</p>

      {usage.counts.length === 0 ? (
        <p className="text-sm text-poke-text-muted">{t('usage.none')}</p>
      ) : (
        <ul className="space-y-1 text-sm text-poke-text-secondary">
          {usage.counts.map((row) => (
            <li key={row.version_no}>
              <span className="font-semibold text-poke-text-primary">{t('usage.version', { version: row.version_no })}</span>
              {': '}
              {[
                row.seasons > 0 ? t('usage.seasons', { count: row.seasons }) : null,
                row.tournaments > 0 ? t('usage.tournaments', { count: row.tournaments }) : null,
              ]
                .filter((part): part is string => part !== null)
                .join(', ')}
            </li>
          ))}
        </ul>
      )}

      {usage.targets === null && usage.counts.length > 0 && <p className="text-sm text-poke-text-muted">{t('usage.countsOnly')}</p>}

      {targets.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-poke-text-primary">{t('usage.targetsLegend')}</legend>
          <ul className="space-y-1">
            {targets.map((target) => {
              const id = `usage-${target.kind}-${target.id}`;
              const name = target.name ?? '';
              return (
                <li key={keyOf(target)}>
                  {/* The whole row is the label, so a tap anywhere on it toggles the 16px box. */}
                  <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm has-[:disabled]:cursor-default sm:min-h-0">
                    <input
                      id={id}
                      type="checkbox"
                      className="h-4 w-4 shrink-0"
                      checked={selected.has(keyOf(target))}
                      disabled={!movable(target) || busy}
                      onChange={(event) => toggle(target, event.target.checked)}
                    />
                    <span className="min-w-0 break-words text-poke-text-primary">
                      <span className="font-semibold">{name}</span>{' '}
                      <span className="text-poke-text-muted">
                        ({t(target.kind === 'season' ? 'usage.season' : 'usage.tournament')}, {t('usage.onVersion', { version: target.version_no })}
                        {pinTargetCompleted(target.status)
                          ? `, ${t('usage.finished')}`
                          : pinTargetStarted(target.status)
                            ? `, ${t('usage.started')}`
                            : ''}
                        )
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {latestVersionNo !== null && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="min-h-11 sm:min-h-0"
                disabled={busy || chosen.length === 0}
                onClick={() => (running.length > 0 ? askToMove() : void move())}
              >
                {t('usage.updateSelected', { version: latestVersionNo })}
              </Button>
              <span className="text-sm text-poke-text-muted">
                {chosen.length === 0 && canUpdate ? t('usage.nothingSelected') : !canUpdate ? t('usage.upToDate') : ''}
              </span>
            </div>
          )}
        </fieldset>
      )}

      <div role="status" aria-live="polite">
        {moved !== null && <p className="text-sm text-poke-green">{t('usage.moved', { count: moved })}</p>}
      </div>
      {error !== null && (
        <Alert variant="error" role="alert">
          {errorText(error)}
        </Alert>
      )}

      {latestVersionNo !== null && (
        <PinConfirmDialog
          open={asking}
          title={t('usage.confirm.title')}
          version={latestVersionNo}
          impact={impact.state}
          busy={busy}
          confirmLabel={t('usage.confirm.confirm', { version: latestVersionNo })}
          cancelLabel={t('usage.confirm.cancel')}
          onConfirm={() => void move()}
          onCancel={closeDialog}
        >
          <p className="text-sm text-poke-text-secondary">{t('usage.confirm.body', { names: running.map((target) => target.name ?? '').join(', ') })}</p>
        </PinConfirmDialog>
      )}
    </section>
  );
}
