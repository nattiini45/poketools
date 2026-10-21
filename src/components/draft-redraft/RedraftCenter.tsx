'use client';

/**
 * The redraft page's client (draft-frontend §3.2, §6.1). Polls the redraft
 * pool's snapshot (`useDraftSnapshot`, 3 s while visible) and switches on
 * `vm.redraft.phase`:
 *
 * - `submissions` / `locked`: a participant gets the secret drop panel; the
 *   own submission is fetched here from the owner-guarded route (BE #18),
 *   never server-rendered. Everyone else sees that drops are secret.
 * - `drafting` / `complete`: the public reveal, plus the room link while
 *   picking runs.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftRedraftMessages } from '@/i18n/messages/draft/redraft';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { DraftSnapshotDTO, RedraftSubmissionDTO } from '@/types/draft-queue';
import { createHttpDataSource, type DraftDataSource } from '@/components/draft-tool/data-source';
import { useDraftSnapshot } from '@/components/draft-tool/hooks/use-draft-snapshot';
import RedraftReveal from './RedraftReveal';
import RedraftSubmissionPanel from './RedraftSubmissionPanel';
import { createHttpRedraftSource, type RedraftSource } from './redraft-source';

export interface RedraftCenterLinks {
  /** The draft room on the redraft pool (`?pool=`). */
  room: string;
}

export interface RedraftCenterProps {
  seasonId: string;
  poolId: string;
  catalog: DraftLineCatalog;
  /** null only if the backend read failed (then the client polls). */
  initialSnapshot: DraftSnapshotDTO | null;
  /** Display only; the server re-checks every read and write. */
  viewer: { playerId: string | null };
  links: RedraftCenterLinks;
  /** Preview injection; default `createHttpDataSource(poolId, seasonId)`. */
  dataSource?: DraftDataSource;
  /** Preview injection; default `createHttpRedraftSource(poolId)`. */
  redraftSource?: RedraftSource;
}

const NOTE = 'rounded-lg border border-poke-border bg-poke-card p-3 text-sm';

type SubmissionState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: RedraftSubmissionDTO }
  | { kind: 'error'; error: ApiErrorLike };

function SubmissionLoader({
  vm,
  catalog,
  source,
  serverOffsetMs,
}: {
  vm: DraftViewModel;
  catalog: DraftLineCatalog;
  source: RedraftSource;
  serverOffsetMs: number;
}) {
  const t = useT(draftRedraftMessages);
  const errorText = useApiErrorText(errorsDraft);
  const [state, setState] = useState<SubmissionState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const phase = vm.redraft?.phase ?? null;

  // Re-read when the phase moves (submissions → locked) so `locked` is fresh.
  useEffect(() => {
    let live = true;
    void source.getSubmission().then((result) => {
      if (!live) return;
      setState(result.ok ? { kind: 'ready', data: result.data } : { kind: 'error', error: result.error });
    });
    return () => {
      live = false;
    };
  }, [source, phase, attempt]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  if (state.kind === 'loading') return <p className="text-sm text-poke-text-secondary">{t('center.loading')}</p>;
  if (state.kind === 'error') {
    return (
      <div role="alert" className={NOTE}>
        <p>{t('center.submissionLoadFailed')}</p>
        <p className="text-poke-text-secondary">{errorText(state.error)}</p>
        <button type="button" onClick={retry} className="mt-2 min-h-[44px] text-poke-blue hover:underline">
          {t('center.retry')}
        </button>
      </div>
    );
  }
  return (
    <RedraftSubmissionPanel
      key={`${state.data.updated_at ?? 'none'}:${phase ?? ''}`}
      vm={vm}
      catalog={catalog}
      submission={state.data}
      source={source}
      serverOffsetMs={serverOffsetMs}
    />
  );
}

export default function RedraftCenter({
  seasonId,
  poolId,
  catalog,
  initialSnapshot,
  viewer,
  links,
  dataSource,
  redraftSource,
}: RedraftCenterProps) {
  const t = useT(draftRedraftMessages);
  const source = useMemo<DraftDataSource>(
    () => dataSource ?? createHttpDataSource(poolId, seasonId),
    [dataSource, poolId, seasonId],
  );
  const submissions = useMemo<RedraftSource>(() => redraftSource ?? createHttpRedraftSource(poolId), [redraftSource, poolId]);
  const snap = useDraftSnapshot(source, initialSnapshot, { poolId, catalog });
  const vm = snap.vm;

  if (!vm) {
    return (
      <p role="status" className="text-sm text-poke-text-secondary">
        {snap.stale ? t('center.loadFailed') : t('center.loading')}
      </p>
    );
  }

  const redraft = vm.redraft;
  if (!redraft) return <p className={NOTE}>{t('center.notOpen')}</p>;

  if (redraft.phase === 'submissions' || redraft.phase === 'locked') {
    // A signed-in participant only; the server re-checks (403 NOT_PARTICIPANT).
    if (viewer.playerId !== null && vm.viewer.isParticipant && !snap.authBlocked) {
      return <SubmissionLoader vm={vm} catalog={catalog} source={submissions} serverOffsetMs={snap.serverOffsetMs} />;
    }
    return <p className={NOTE}>{redraft.phase === 'submissions' ? t('center.secretPhase') : t('center.lockedPublic')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {redraft.phase === 'drafting' ? (
        <Link
          href={links.room}
          className="inline-flex min-h-[44px] w-fit items-center rounded-lg bg-poke-accent px-4 py-2 text-sm font-semibold text-poke-surface hover:bg-poke-accent-strong"
        >
          {t('goToRoom')}
        </Link>
      ) : (
        <p className={NOTE}>{t('reveal.complete')}</p>
      )}
      <RedraftReveal vm={vm} catalog={catalog} />
    </div>
  );
}
