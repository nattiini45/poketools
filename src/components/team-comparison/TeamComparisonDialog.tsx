'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@ui-sdk/react/dialog';
import { Button } from '@ui-sdk/react/button';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { teamComparisonMessages } from '@/i18n/messages/team-comparison';
import type { TeamComparisonData } from '@/lib/team-comparison';
import type { ApiResult } from '@/types/api';
import TeamComparison from './TeamComparison';
import styles from './team-comparison.module.css';

const ComparisonContext = createContext(false);

export type ComparisonSource = (playerId: string, leagueId: string | undefined, signal: AbortSignal) => Promise<TeamComparisonData>;

const fetchComparison: ComparisonSource = async (playerId, leagueId, signal) => {
  const query = leagueId ? `?season_id=${encodeURIComponent(leagueId)}` : '';
  const response = await fetch(`/api/players/${encodeURIComponent(playerId)}/team-comparison${query}`, { signal, cache: 'no-store' });
  const result: ApiResult<TeamComparisonData> = await response.json();
  if (!result.success) throw result;
  if (!response.ok) throw new Error('Comparison request failed');
  return result.data;
};

export function ComparisonTrainer({ playerId, name, children, className, disabled = false }: { playerId: string; name: string; children: ReactNode; className?: string; disabled?: boolean }) {
  const available = useContext(ComparisonContext);
  const t = useT(teamComparisonMessages);
  if (!available || disabled) return <span className={className}>{children}</span>;
  return <DialogTrigger payload={{ playerId, name }} aria-label={t('compareTrainer', { name })} className={className}>{children}</DialogTrigger>;
}

export function TeamComparisonProvider({ children, seasonId, enabled = true, dataSource = fetchComparison }: { children: ReactNode; seasonId?: string; enabled?: boolean; dataSource?: ComparisonSource }) {
  const t = useT(teamComparisonMessages);
  const apiErrorText = useApiErrorText();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<{ playerId: string; name: string } | null>(null);
  const [leagueId, setLeagueId] = useState(seasonId);
  const [data, setData] = useState<TeamComparisonData | null>(null);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open || !target) return;
    const abort = new AbortController();
    void dataSource(target.playerId, leagueId, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setData(result);
      }).catch((cause: unknown) => { if (!abort.signal.aborted) setError(toApiErrorLike(cause)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [open, target, leagueId, retry, dataSource]);

  return <ComparisonContext value={enabled}>
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) { setLoading(true); setError(null); setData(null); }
    }} onPayloadChange={(payload) => {
      if (typeof payload === 'object' && payload !== null && 'playerId' in payload && typeof payload.playerId === 'string' && 'name' in payload && typeof payload.name === 'string') {
        setTarget({ playerId: payload.playerId, name: payload.name });
        setLeagueId(seasonId);
      }
    }}>
      {children}
      <DialogContent className={styles.dialog} initialFocus="content">
        <div className="mb-3 flex items-start justify-between gap-4">
          <DialogTitle className="font-heading text-2xl font-bold">{t('title')}</DialogTitle>
          <DialogClose className={styles.control}>{t('close')}</DialogClose>
        </div>
        <DialogDescription className="mb-5 text-sm text-fg-muted">{t('description')}</DialogDescription>
        <div aria-busy={loading}>
          {loading && <p role="status">{t('loading')}</p>}
          {error && <div role="alert"><p>{error.code ? apiErrorText(error) : t('error')}</p><Button className={styles.control} onClick={() => { setLoading(true); setError(null); setRetry((value) => value + 1); }}>{t('retry')}</Button></div>}
          {data && target && <TeamComparison data={data} opponentName={target.name} onLeagueChange={(id) => { if (id !== data.leagueId) { setLoading(true); setError(null); setLeagueId(id); } }} />}
        </div>
      </DialogContent>
    </Dialog>
  </ComparisonContext>;
}

export function ComparePlayerButton({ playerId, name, dataSource }: { playerId: string; name: string; dataSource?: ComparisonSource }) {
  const t = useT(teamComparisonMessages);
  return <TeamComparisonProvider dataSource={dataSource}><ComparisonTrainer playerId={playerId} name={name} className={styles.control}>{t('open')}</ComparisonTrainer></TeamComparisonProvider>;
}
