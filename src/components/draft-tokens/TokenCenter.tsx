'use client';

/**
 * The token centre (draft-frontend §6.2, page §3.3): loads the player's
 * `TokenOverviewDTO` client-side (BE #25) and renders the Draft Kill Token,
 * Comeback Token and (with a participation line) participation token cards plus the
 * progress-by-source table.
 *
 * With `playerId` it is the admin view of another player: read only, no
 * buttons. Every write answers with the fresh overview, which replaces the
 * state at once (the "reload"), followed by a short confirmation notice.
 * State holds the DTO, `ApiErrorLike` and notice data, never translated text.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftTokensMessages } from '@/i18n/messages/draft/tokens';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { LineId, TokenOverviewDTO } from '@/types/draft-queue';
import Button from '@/components/ui/Button';
import ComebackTokenCard from './ComebackTokenCard';
import CosmoTokenCard from './CosmoTokenCard';
import DraftKillTokenCard from './DraftKillTokenCard';
import ProgressSourcesTable from './ProgressSourcesTable';
import { createHttpTokenSource, type TokenSource } from './token-source';
import type { ComebackAllocation } from './token-view';
import { useLineText } from './use-line-text';
import { NOTE } from './styles';

export interface TokenCenterProps {
  seasonId: string;
  catalog: DraftLineCatalog;
  /** Preview injection; default `createHttpTokenSource(seasonId)`. */
  source?: TokenSource;
  /** Admin view of another player (read only). */
  playerId?: string;
}

/** How long the confirmation notice stays (same as the draft toasts). */
export const NOTICE_MS = 4000;

type LoadState = { kind: 'loading' } | { kind: 'ready'; data: TokenOverviewDTO } | { kind: 'error'; error: ApiErrorLike };

type Notice = { id: number; kind: 'bought'; lineId: LineId } | { id: number; kind: 'spent'; count: number };

function NoticeBar({ notice, catalog, onDismiss }: { notice: Notice; catalog: DraftLineCatalog; onDismiss(): void }) {
  const t = useT(draftTokensMessages);
  const text = useLineText(catalog);

  useEffect(() => {
    const id = setTimeout(onDismiss, NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice.id, onDismiss]);

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-poke-accent bg-poke-elevated px-3 py-2 text-sm text-poke-text-primary">
      <span>
        {notice.kind === 'bought'
          ? t('center.bought', { line: text.label(notice.lineId) })
          : t('center.spent', { count: notice.count })}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded p-1 text-poke-text-muted hover:text-poke-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus"
        aria-label={t('center.dismiss')}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function TokenCenter({ seasonId, catalog, source: injected, playerId }: TokenCenterProps) {
  const t = useT(draftTokensMessages);
  const errorText = useApiErrorText(errorsDraft);
  const source = useMemo(() => injected ?? createHttpTokenSource(seasonId), [injected, seasonId]);
  const readOnly = playerId !== undefined;

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let live = true;
    void source.overview(playerId).then((result) => {
      if (!live) return;
      setState(result.ok ? { kind: 'ready', data: result.data } : { kind: 'error', error: result.error });
    });
    return () => {
      live = false;
    };
  }, [source, playerId, attempt]);

  const dismiss = useCallback(() => setNotice(null), []);

  const buy = useCallback(
    async (lineId: LineId, requestId: string): Promise<ApiErrorLike | null> => {
      const result = await source.buyDraftKill(lineId, requestId);
      if (!result.ok) return result.error;
      setState({ kind: 'ready', data: result.data });
      setNotice({ id: Date.now(), kind: 'bought', lineId });
      return null;
    },
    [source],
  );

  const spend = useCallback(
    async (allocs: ComebackAllocation[], requestId: string): Promise<ApiErrorLike | null> => {
      const result = await source.spendComeback(allocs, requestId);
      if (!result.ok) return result.error;
      setState({ kind: 'ready', data: result.data });
      setNotice({ id: Date.now(), kind: 'spent', count: allocs.reduce((sum, a) => sum + a.tokens, 0) });
      return null;
    },
    [source],
  );

  if (state.kind === 'loading') {
    return (
      <p role="status" className="text-sm text-poke-text-secondary">
        {t('center.loading')}
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <div role="alert" className={NOTE}>
        <p>{t('center.loadFailed')}</p>
        <p className="text-xs">{errorText(state.error)}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() => {
            setState({ kind: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          {t('center.retry')}
        </Button>
      </div>
    );
  }

  const data = state.data;
  const cosmoLine = data.cosmo ? (data.lines.find((l) => l.line_id === data.cosmo?.line_id) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      {readOnly ? <p className={NOTE}>{t('center.adminView')}</p> : null}
      <div role="status" aria-live="polite">
        {notice ? <NoticeBar notice={notice} catalog={catalog} onDismiss={dismiss} /> : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DraftKillTokenCard data={data.draft_kill} catalog={catalog} readOnly={readOnly} onBuy={buy} />
        <ComebackTokenCard
          data={data.comeback}
          lines={data.lines}
          catalog={catalog}
          readOnly={readOnly}
          onSpend={spend}
        />
        {data.cosmo ? <CosmoTokenCard data={data.cosmo} line={cosmoLine} catalog={catalog} /> : null}
      </div>
      <ProgressSourcesTable lines={data.lines} catalog={catalog} />
    </div>
  );
}
