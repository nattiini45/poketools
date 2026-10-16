'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useDataLocale, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsDraftLegacy, errorsSeasons } from '@/i18n/messages/errors';
import { tradesMessages } from '@/i18n/messages/trades';
import { buildTradeConsentRequest } from '@/lib/draft/trade-consent-urls';
import { localizeLineLabel } from '@/lib/pkmn/i18n/names/species';

/**
 * One pending trade for the admin status view, resolved server-side. Each side
 * carries the player display name, the line they give, and their consent flag.
 */
export interface AdminPendingTradeView {
  requestId: string;
  playerAName: string;
  playerBName: string;
  /** Canonical English base names; localized on render. */
  lineA: string;
  lineB: string;
  consentA: boolean;
  consentB: boolean;
  createdAt: string;
}

interface AdminPendingTradesProps {
  seasonId: string;
  requests: AdminPendingTradeView[];
}

/**
 * Admin status view for pending EPB trades: a list with per-side consent badges
 * (A/B ✓/✗) and a Cancel button. An admin (site or season resource admin) may
 * cancel any pending trade via the cancel endpoint. Empty list renders a
 * muted "none pending" note (unlike the player prompt, admins see a status
 * panel, so an explicit empty state is useful here).
 */
export default function AdminPendingTrades({
  seasonId,
  requests,
}: AdminPendingTradesProps) {
  const t = useT(tradesMessages);
  const dataLocale = useDataLocale();
  const errorText = useApiErrorText(errorsDraftLegacy, errorsSeasons);
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Stored untranslated: the API body when it said why, else the fallback key.
  const [error, setError] = useState<
    { api: ApiErrorLike | null; fallback: 'errorCancel' | 'errorNetwork' } | null
  >(null);

  async function cancel(view: AdminPendingTradeView) {
    if (busyId !== null) return;
    setBusyId(view.requestId);
    setError(null);
    const { url, method } = buildTradeConsentRequest('cancel', seasonId, view.requestId);
    try {
      const res = await fetch(url, { method });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string; code?: string }
        | null;
      if (!res.ok || !json?.success) {
        setError({ api: json && (json.error || json.code) ? toApiErrorLike(json) : null, fallback: 'errorCancel' });
        return;
      }
      router.refresh();
    } catch {
      setError({ api: null, fallback: 'errorNetwork' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-poke-text-secondary">{t('admin.intro')}</p>
      {error && (
        <Alert variant="error">{error.api ? errorText(error.api) : t(`admin.${error.fallback}`)}</Alert>
      )}
      {requests.length === 0 ? (
        <p className="text-sm text-poke-text-muted">{t('admin.empty')}</p>
      ) : (
        requests.map((view) => (
          <div
            key={view.requestId}
            className="flex flex-wrap items-center gap-2 border border-poke-border rounded-poke-md bg-poke-elevated p-3 text-sm"
          >
            <span className="text-poke-text-primary">
              <strong>{view.playerAName}</strong> ({localizeLineLabel(view.lineA, null, dataLocale)})
              {' ↔ '}
              <strong>{view.playerBName}</strong> ({localizeLineLabel(view.lineB, null, dataLocale)})
            </span>
            <Badge variant={view.consentA ? 'green' : 'gray'} size="sm">
              A {view.consentA ? '✓' : '✗'}
            </Badge>
            <Badge variant={view.consentB ? 'green' : 'gray'} size="sm">
              B {view.consentB ? '✓' : '✗'}
            </Badge>
            <Button
              variant="danger"
              size="sm"
              loading={busyId === view.requestId}
              disabled={busyId !== null}
              onClick={() => cancel(view)}
            >
              {t('admin.cancel')}
            </Button>
          </div>
        ))
      )}
    </div>
  );
}