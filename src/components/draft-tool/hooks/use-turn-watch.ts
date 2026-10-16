'use client';

/**
 * The 60 s my-turn watch and browser turn alerts (draft-frontend §5.8).
 *
 * - Its own poller: `createVisiblePoller(tick, { liveIntervalMs: 60_000,
 *   completeIntervalMs: null }, { visibility: null })`, so it keeps running in
 *   hidden tabs. This is the single sanctioned D37 exception (AGENTS.md "Live
 *   draft screens"); it lives in the draft room only (FR-15).
 * - The tick skips the request while the tab is visible: the 3 s snapshot
 *   poll covers that case. Only hidden tabs call `GET /my-turn`.
 * - A `stop` answer (401/403/404/409) halts the watch; network errors and
 *   5xx keep it alive for the next tick.
 * - Alerts are deduped across tabs through `storage.ts` and delivered only
 *   with `Notification.permission === 'granted'` and the per-pool opt-in.
 *   Visible tabs show the in-app state instead (banner, toast, title).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createVisiblePoller, type PollOutcome, type PollTick } from '@/lib/draft/use-visible-poll';
import { TURN_WATCH_INTERVAL_MS } from '@/lib/draft-ui/constants';
import { dueNotifications, type NotifyKind } from '@/lib/draft-ui/notify-schedule';
import type { MyTurnDTO } from '@/lib/draft-ui/snapshot-types';
import type { MyTurnResult } from '@/components/draft-tool/data-source';
import {
  hasNotified,
  isNotifyOptedIn,
  markNotified,
  pruneNotified,
  setNotifyOptIn,
} from '@/lib/draft-ui/storage';

export type NotifySupport = 'unsupported' | 'default' | 'granted' | 'denied';

export interface NotifyState {
  support: NotifySupport;
  /** The per-pool opt-in (`localStorage['draft:notify:<pool>']`). */
  optedIn: boolean;
}

export const NOTIFY_UNSUPPORTED: NotifyState = Object.freeze({ support: 'unsupported', optedIn: false });

/** Remaining pick time of a my-turn answer on the server clock; null without a running slot. */
export function myTurnRemainingMs(dto: MyTurnDTO): number | null {
  if (dto.remaining_ms_at_pause !== null) return Math.max(0, dto.remaining_ms_at_pause);
  if (dto.deadline_at === null) return null;
  const deadline = Date.parse(dto.deadline_at);
  const now = Date.parse(dto.server_now);
  return Number.isFinite(deadline) && Number.isFinite(now) ? Math.max(0, deadline - now) : null;
}

/** The alerts this answer makes due for `poolId`, after the cross-tab dedupe. */
export function alertsFor(dto: MyTurnDTO, poolId: string, alreadySent = (slotId: string, kind: NotifyKind) => hasNotified(poolId, slotId, kind)): NotifyKind[] {
  return dueNotifications({
    onClock: dto.on_clock && dto.status === 'in_progress',
    slotId: dto.slot_id,
    mode: dto.mode,
    paused: dto.paused,
    remainingMs: myTurnRemainingMs(dto),
    alreadySent,
  });
}

export interface TurnWatchTickDeps {
  fetchMyTurn(signal: AbortSignal): Promise<MyTurnResult>;
  /** true while the page is visible (the snapshot poll is active then). */
  isVisible(): boolean;
  onResult(dto: MyTurnDTO): void;
}

/** The watch's tick (unit-tested with fake timers). */
export function createTurnWatchTick(deps: TurnWatchTickDeps): PollTick {
  return async (signal): Promise<PollOutcome> => {
    if (deps.isVisible()) return 'live';
    const result = await deps.fetchMyTurn(signal);
    if (signal.aborted) return 'live';
    // 401/403/404/409 cannot change by asking again: stop instead of polling every 60 s forever.
    if (result.kind === 'stop') return 'stop';
    if (result.kind === 'error') return 'live';
    const dto = result.dto;
    deps.onResult(dto);
    return dto.status === 'complete' ? 'complete' : 'live';
  };
}

function permission(): NotifySupport {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'default';
}

export interface TurnAlertText {
  title: string;
  body: string;
}

export interface UseTurnWatchOptions {
  fetchMyTurn(signal: AbortSignal): Promise<MyTurnResult>;
  /** A participant with open slots in a pending or running pool. */
  enabled: boolean;
  poolId: string;
  /** Builds the notification text (translated by the caller at delivery time). */
  buildAlert(kind: NotifyKind, dto: MyTurnDTO): TurnAlertText;
}

/** Runs the watch while `enabled`; delivers due alerts as system notifications. */
export function useTurnWatch({ fetchMyTurn, enabled, poolId, buildAlert }: UseTurnWatchOptions): void {
  const fetchRef = useRef(fetchMyTurn);
  const buildRef = useRef(buildAlert);
  useEffect(() => {
    fetchRef.current = fetchMyTurn;
    buildRef.current = buildAlert;
  }, [fetchMyTurn, buildAlert]);

  useEffect(() => {
    if (!enabled) return;
    pruneNotified(Date.now());
    const tick = createTurnWatchTick({
      fetchMyTurn: (signal) => fetchRef.current(signal),
      isVisible: () => typeof document !== 'undefined' && document.visibilityState === 'visible',
      onResult: (dto) => {
        if (permission() !== 'granted' || !isNotifyOptedIn(poolId) || dto.slot_id === null) return;
        const slotId = dto.slot_id;
        for (const kind of alertsFor(dto, poolId)) {
          try {
            const { title, body } = buildRef.current(kind, dto);
            // `renotify` (§5.8) re-alerts when a reminder replaces an earlier one with the same tag. The DOM
            // lib typing lacks it, so it is declared here; browsers without it ignore the field.
            const options: NotificationOptions & { renotify: boolean } = { body, tag: `draft-${poolId}`, renotify: true };
            const n = new Notification(title, options);
            n.onclick = () => {
              window.focus();
              n.close();
            };
          } catch (err) {
            console.error('[draft-tool] turn notification failed:', err);
          }
          markNotified(poolId, slotId, kind, Date.now());
        }
      },
    });
    const poller = createVisiblePoller(
      tick,
      { liveIntervalMs: TURN_WATCH_INTERVAL_MS, completeIntervalMs: null },
      { visibility: null },
    );
    poller.start();
    return () => poller.stop();
  }, [enabled, poolId]);
}

/** The bell's state and its click (never prompts on its own, §5.8). */
export function useNotifyPermission(poolId: string): { state: NotifyState; toggle(): void } {
  const [state, setState] = useState<NotifyState>(NOTIFY_UNSUPPORTED);

  // Permission and opt-in are browser-only: read after mount so server and client markup agree.
  useEffect(() => {
    const support = permission();
    const optedIn = support === 'granted' && isNotifyOptedIn(poolId);
    const id = setTimeout(() => setState({ support, optedIn }), 0);
    return () => clearTimeout(id);
  }, [poolId]);

  const toggle = useCallback(() => {
    const support = permission();
    if (support === 'unsupported' || support === 'denied') {
      setState({ support, optedIn: false });
      return;
    }
    if (support === 'granted') {
      const optedIn = !isNotifyOptedIn(poolId);
      setNotifyOptIn(poolId, optedIn);
      setState({ support, optedIn });
      return;
    }
    void Notification.requestPermission().then((result) => {
      const granted = result === 'granted';
      if (granted) setNotifyOptIn(poolId, true);
      setState({ support: granted ? 'granted' : result === 'denied' ? 'denied' : 'default', optedIn: granted });
    });
  }, [poolId]);

  return { state, toggle };
}
