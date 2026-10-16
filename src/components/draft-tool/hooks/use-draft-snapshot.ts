'use client';

/**
 * The pick screen's snapshot poll (draft-frontend §5.1). Wraps `useVisiblePoll`
 * (3 s while the tab is visible, paused while hidden, stopped on 401/403) and
 * keeps the newest `DraftSnapshotDTO`.
 *
 * - Every tick sends `since=state_version`; an unchanged answer only moves the
 *   server clock offset.
 * - 401/403 stops the poll and switches to the spectator view (`authBlocked`).
 * - A failed read keeps the last state and sets `stale`.
 * - `applySnapshot(dto)` takes a snapshot from a write response (the pick's
 *   `snapshot`) unless the current one is newer.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useVisiblePoll, type PollOutcome } from '@/lib/draft/use-visible-poll';
import { SNAPSHOT_POLL_MS } from '@/lib/draft-ui/constants';
import { toDraftViewModel, type CatalogOrderLike, type DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';
import type { DraftDataSource, SnapshotResult } from '../data-source';

export interface SnapshotState {
  dto: DraftSnapshotDTO | null;
  /** `Date.parse(server_now) - Date.now()` at receipt. */
  serverOffsetMs: number;
  stale: boolean;
  authBlocked: boolean;
}

export interface DraftSnapshotHook {
  dto: DraftSnapshotDTO | null;
  vm: DraftViewModel | null;
  stale: boolean;
  authBlocked: boolean;
  serverOffsetMs: number;
  refresh(): Promise<void>;
  applySnapshot(dto: DraftSnapshotDTO): void;
}

function offsetOf(serverNow: string, receivedAt: number): number {
  const parsed = Date.parse(serverNow);
  return Number.isFinite(parsed) ? parsed - receivedAt : 0;
}

function outcomeOf(dto: DraftSnapshotDTO | null): PollOutcome {
  return dto?.pool.status === 'complete' ? 'complete' : 'live';
}

export function initialSnapshotState(initial: DraftSnapshotDTO | null, now: number): SnapshotState {
  return { dto: initial, serverOffsetMs: initial ? offsetOf(initial.server_now, now) : 0, stale: false, authBlocked: false };
}

/** Pure transition for one snapshot answer (unit-tested). An older full snapshot never replaces a newer one. */
export function reduceSnapshotResult(
  state: SnapshotState,
  result: SnapshotResult,
  receivedAt: number,
): { state: SnapshotState; outcome: PollOutcome } {
  switch (result.kind) {
    case 'full': {
      const keep = state.dto !== null && state.dto.state_version > result.dto.state_version;
      const dto = keep ? (state.dto as DraftSnapshotDTO) : result.dto;
      return {
        state: { dto, serverOffsetMs: offsetOf(result.dto.server_now, receivedAt), stale: false, authBlocked: false },
        outcome: outcomeOf(dto),
      };
    }
    case 'unchanged':
      return {
        state: { ...state, serverOffsetMs: offsetOf(result.serverNow, receivedAt), stale: false },
        outcome: outcomeOf(state.dto),
      };
    case 'auth':
      return { state: { ...state, authBlocked: true }, outcome: 'stop' };
    case 'error':
      return { state: { ...state, stale: true }, outcome: outcomeOf(state.dto) };
  }
}

export function useDraftSnapshot<Index>(
  source: DraftDataSource<Index>,
  initial: DraftSnapshotDTO | null,
  options: { poolId: string; catalog?: CatalogOrderLike },
): DraftSnapshotHook {
  const [state, setState] = useState<SnapshotState>(() => initialSnapshotState(initial, Date.now()));
  // The source of truth for ticks (a tick must read the latest version, not a render's closure).
  const stateRef = useRef(state);

  const commit = useCallback((next: SnapshotState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const tick = useCallback(
    async (signal: AbortSignal): Promise<PollOutcome> => {
      const since = stateRef.current.dto?.state_version ?? null;
      const result = await source.fetchSnapshot(since, signal);
      if (signal.aborted) return 'live';
      const next = reduceSnapshotResult(stateRef.current, result, Date.now());
      commit(next.state);
      return next.outcome;
    },
    [source, commit],
  );

  const { refresh } = useVisiblePoll(tick, {
    liveIntervalMs: SNAPSHOT_POLL_MS,
    completeIntervalMs: null,
    resetKey: options.poolId,
  });

  const applySnapshot = useCallback(
    (dto: DraftSnapshotDTO) => {
      commit(reduceSnapshotResult(stateRef.current, { kind: 'full', dto }, Date.now()).state);
    },
    [commit],
  );

  const catalog = options.catalog;
  const vm = useMemo(() => (state.dto ? toDraftViewModel(state.dto, catalog) : null), [state.dto, catalog]);

  return {
    dto: state.dto,
    vm,
    stale: state.stale,
    authBlocked: state.authBlocked,
    serverOffsetMs: state.serverOffsetMs,
    refresh,
    applySnapshot,
  };
}
