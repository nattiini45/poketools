'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { useDataLocale, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsDraftLegacy, errorsSeasons } from '@/i18n/messages/errors';
import { tradesMessages } from '@/i18n/messages/trades';
import { buildTradeConsentRequest } from '@/lib/draft/trade-consent-urls';
import { localizeLineLabel } from '@/lib/pkmn/i18n/names/species';
import type { TradeConsentAction } from '@/lib/draft/trade-consent-urls';

/**
 * One pending trade request, pre-resolved into the display data the current
 * player needs. The server component (league page) computes this so the client
 * only renders + issues requests — no player identity, no DB calls here.
 *
 * `role` is which side the viewer is on; `youConsented`/`otherConsented` are
 * derived from consent_a/consent_b against the viewer's role.
 */
export interface PendingTradeView {
  requestId: string;
  /** Which side the viewer is on. */
  role: 'a' | 'b';
  /** The line the viewer gives up (canonical English base name; localized on render). */
  yourLine: string;
  /** The line the viewer receives (canonical English base name; localized on render). */
  receivedLine: string;
  /** Display name of the trade partner (the other player). */
  partnerName: string;
  /** Display name of the other player (same as partner for the viewer). */
  otherName: string;
  /** True once the viewer has already consented. */
  youConsented: boolean;
  /** True once the other player has already consented. */
  otherConsented: boolean;
}

interface TradeConsentPromptProps {
  seasonId: string;
  /** Pending trades involving the viewer. Empty list = render nothing. */
  requests: PendingTradeView[];
}

type SuccessKey = 'successDeclined' | 'successExecuted' | 'successPending';
type FallbackKey = 'errorConsent' | 'errorDecline' | 'errorNetwork';

/**
 * A failed action, stored untranslated (i18n-core §1.7): the API body when it
 * said why, otherwise the prompt's own fallback sentence.
 */
interface PromptError {
  api: ApiErrorLike | null;
  fallback: FallbackKey;
}

/**
 * Player-facing consent prompt for pending EPB trades. Renders one card per
 * pending trade the viewer is a side of. Shows consent/decline buttons until
 * the viewer has consented, then a "waiting for the other player" state. A
 * consent that completes the trade (both sides) is surfaced as a success.
 *
 * Renders nothing when `requests` is empty (spec §15 state-awareness: never show
 * an empty box). Errors are surfaced inline via Alert (no toast library).
 */
export default function TradeConsentPrompt({ seasonId, requests }: TradeConsentPromptProps) {
  const t = useT(tradesMessages);
  const dataLocale = useDataLocale();
  const errorText = useApiErrorText(errorsDraftLegacy, errorsSeasons);
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Per-request outcomes keyed by requestId: message keys, never translated text.
  const [success, setSuccess] = useState<Record<string, SuccessKey | undefined>>({});
  const [errors, setErrors] = useState<Record<string, PromptError | undefined>>({});

  if (requests.length === 0) return null;

  async function act(action: TradeConsentAction, view: PendingTradeView) {
    // Prevent double-submit: one in-flight request at a time.
    if (busyId !== null) return;
    setBusyId(view.requestId);
    // Clear any prior message for this request.
    setErrors((prev) => ({ ...prev, [view.requestId]: undefined }));
    setSuccess((prev) => ({ ...prev, [view.requestId]: undefined }));

    const { url, method } = buildTradeConsentRequest(action, seasonId, view.requestId);
    try {
      const res = await fetch(url, { method });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { status?: string }; error?: string; code?: string }
        | null;

      if (!res.ok || !json?.success) {
        const api = json && (json.error || json.code) ? toApiErrorLike(json) : null;
        const fallback: FallbackKey = action === 'consent' ? 'errorConsent' : 'errorDecline';
        setErrors((prev) => ({ ...prev, [view.requestId]: { api, fallback } }));
        return;
      }

      if (action === 'cancel') {
        setSuccess((prev) => ({
          ...prev,
          [view.requestId]: 'successDeclined',
        }));
      } else {
        // Consent recorded. If the server executed the swap, the data carries
        // status='executed'; otherwise it is still pending the other player.
        if (json.data?.status === 'executed') {
          setSuccess((prev) => ({
            ...prev,
            [view.requestId]: 'successExecuted',
          }));
        } else {
          setSuccess((prev) => ({
            ...prev,
            [view.requestId]: 'successPending',
          }));
        }
      }
      // Refresh server data so the list re-resolves (completed/cancelled drop off).
      router.refresh();
    } catch {
      setErrors((prev) => ({
        ...prev,
        [view.requestId]: { api: null, fallback: 'errorNetwork' },
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-poke-text-primary">{t('prompt.header')}</p>
      {requests.map((view) => {
        const successKey = success[view.requestId];
        const message = successKey ? t(`prompt.${successKey}`) : null;
        const failure = errors[view.requestId];
        const error = failure ? (failure.api ? errorText(failure.api) : t(`prompt.${failure.fallback}`)) : null;
        return (
          <div
            key={view.requestId}
            className="border border-poke-border rounded-poke-md bg-poke-elevated p-4 space-y-2"
          >
            <p className="text-sm text-poke-text-primary">
              {t.rich('prompt.proposal', {
                yourLine: localizeLineLabel(view.yourLine, null, dataLocale),
                receivedLine: localizeLineLabel(view.receivedLine, null, dataLocale),
                partnerName: view.partnerName,
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>

            {/* Consent state line */}
            <p className="text-xs text-poke-text-secondary">
              {view.youConsented
                ? view.otherConsented
                  ? t('prompt.bothConsented')
                  : t('prompt.waitingOther', { otherName: view.otherName })
                : t('prompt.waitingBoth', { otherName: view.otherName })}
            </p>

            {message && <Alert variant="success">{message}</Alert>}
            {error && <Alert variant="error">{error}</Alert>}

            {/* Action buttons only while the viewer still needs to consent. */}
            {!view.youConsented && !message && (
              <div className="flex gap-2">
                <Button
                  variant="success"
                  size="sm"
                  loading={busyId === view.requestId}
                  disabled={busyId !== null}
                  onClick={() => act('consent', view)}
                >
                  {t('prompt.consentButton')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busyId !== null}
                  onClick={() => act('cancel', view)}
                >
                  {t('prompt.declineButton')}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
