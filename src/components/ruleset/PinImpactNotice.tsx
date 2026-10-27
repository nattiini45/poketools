'use client';

import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import type { PinImpactState } from './use-pin-impact';

interface PinImpactNoticeProps {
  state: PinImpactState;
  /** The version the move goes to (the sentences name it). */
  version: number;
}

/**
 * The answer to "what does this update do to the teams already submitted?" in the confirmation dialog of a pin move: how many
 * of the checked teams would stop being valid under the new version, which league or phase they belong to when several move
 * at once, and the two honest limits (the check stopped at its bound; the check could not run, with the reason). It is a live
 * region, so the number is announced when it arrives. Pure display of a `PinImpactState`; `usePinImpact` owns the request.
 */
export default function PinImpactNotice({ state, version }: PinImpactNoticeProps) {
  const t = useT(rulesetMessages);
  const errorText = useApiErrorText(errorsAdmin);

  if (state.status === 'idle') return null;

  return (
    <div role="status" aria-live="polite" className="space-y-1">
      {state.status === 'loading' && <p className="text-sm text-poke-text-muted">{t('pin.impact.loading', { version })}</p>}

      {state.status === 'failed' && (
        <Alert variant="warning" role="status">
          {t('pin.impact.failed', { version })} {errorText(state.error)}
        </Alert>
      )}

      {state.status === 'ready' && <ReadyNotice impact={state.impact} version={version} />}
    </div>
  );
}

function ReadyNotice({ impact, version }: { impact: Extract<PinImpactState, { status: 'ready' }>['impact']; version: number }) {
  const t = useT(rulesetMessages);
  const named = impact.targets.filter((target) => target.would_break > 0);

  return (
    <>
      {impact.checked === 0 ? (
        <p className="text-sm text-poke-text-secondary">{t('pin.impact.none')}</p>
      ) : impact.would_break === 0 ? (
        <p className="text-sm text-poke-green">{t('pin.impact.allValid', { count: impact.checked, version })}</p>
      ) : (
        <Alert variant="warning" role="status">
          {t('pin.impact.someInvalid', { count: impact.would_break, total: impact.checked, version })}
        </Alert>
      )}
      {named.length > 1 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-poke-text-secondary">
          {named.map((target) => (
            <li key={`${target.kind}:${target.id}`}>{t('pin.impact.target', { name: target.name, broken: target.would_break, total: target.checked })}</li>
          ))}
        </ul>
      )}
      {impact.truncated && <p className="text-sm text-poke-text-muted">{t('pin.impact.truncated', { checked: impact.checked })}</p>}
    </>
  );
}
