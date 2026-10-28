'use client';

/**
 * The 60 s my-turn watch and the push control (draft-frontend §5.8, docs/push.md).
 *
 * - The watch is its own poller: `createVisiblePoller(tick, { liveIntervalMs: 60_000,
 *   completeIntervalMs: null }, { visibility: null })`, so it keeps running in
 *   hidden tabs. This is the single sanctioned D37 exception (AGENTS.md "Live
 *   draft screens"); it lives in the draft room only (FR-15).
 * - The tick skips the request while the tab is visible: the 3 s snapshot
 *   poll covers that case. Only hidden tabs call `GET /my-turn`, and the
 *   server resolves a due timeout there (which claims and sends the next
 *   slot's alerts). The watch no longer raises notifications itself: turn
 *   alerts and reminders are Web Push messages sent by the server to every
 *   device the player enabled (`src/lib/push/draft-alerts.ts`), so they
 *   arrive with no page open and never twice.
 * - A `stop` answer (401/403/404/409) halts the watch; network errors and
 *   5xx keep it alive for the next tick.
 * - `usePushAlerts` drives the bell: it reads this browser's push state and
 *   subscribes or unsubscribes it on a click. It never prompts on its own.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { createVisiblePoller, type PollOutcome, type PollTick } from '@/lib/draft/use-visible-poll';
import { TURN_WATCH_INTERVAL_MS } from '@/lib/draft-ui/constants';
import type { MyTurnDTO } from '@/lib/draft-ui/snapshot-types';
import type { MyTurnResult } from '@/components/draft-tool/data-source';
import { clearLegacyNotifyKeys } from '@/lib/draft-ui/storage';
import { disablePush, enablePush, readPushState } from '@/lib/push/client';

export type NotifySupport = 'unsupported' | 'install-required' | 'default' | 'granted' | 'denied';

export interface NotifyState {
  /**
   * `unsupported` hides the control; `install-required` (iOS/iPadOS in a browser tab) shows the Home Screen hint;
   * `denied` shows the browser-settings hint; `default` can ask for permission; `granted` can switch this device on/off.
   */
  support: NotifySupport;
  /** This device holds a push subscription. */
  optedIn: boolean;
  /** A subscribe or unsubscribe is running. */
  busy?: boolean;
  /** The last switch failed (shown next to the control). */
  error?: ApiErrorLike | null;
}

export const NOTIFY_UNSUPPORTED: NotifyState = Object.freeze({ support: 'unsupported', optedIn: false });

export interface TurnWatchTickDeps {
  fetchMyTurn(signal: AbortSignal): Promise<MyTurnResult>;
  /** true while the page is visible (the snapshot poll is active then). */
  isVisible(): boolean;
  onResult?(dto: MyTurnDTO): void;
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
    deps.onResult?.(dto);
    return dto.status === 'complete' ? 'complete' : 'live';
  };
}

export interface UseTurnWatchOptions {
  fetchMyTurn(signal: AbortSignal): Promise<MyTurnResult>;
  /** A participant with open slots in a pending or running pool. */
  enabled: boolean;
}

/** Runs the hidden-tab watch while `enabled` (the server resolves due timeouts and sends the push alerts). */
export function useTurnWatch({ fetchMyTurn, enabled }: UseTurnWatchOptions): void {
  const fetchRef = useRef(fetchMyTurn);
  useEffect(() => {
    fetchRef.current = fetchMyTurn;
  }, [fetchMyTurn]);

  useEffect(() => {
    if (!enabled) return;
    const tick = createTurnWatchTick({
      fetchMyTurn: (signal) => fetchRef.current(signal),
      isVisible: () => typeof document !== 'undefined' && document.visibilityState === 'visible',
    });
    const poller = createVisiblePoller(
      tick,
      { liveIntervalMs: TURN_WATCH_INTERVAL_MS, completeIntervalMs: null },
      { visibility: null },
    );
    poller.start();
    return () => poller.stop();
  }, [enabled]);
}

/** The bell's state and its click (never prompts on its own, §5.8): subscribes or unsubscribes THIS browser. */
export function usePushAlerts(): { state: NotifyState; toggle(): void } {
  const locale = useLocale();
  const [state, setState] = useState<NotifyState>(NOTIFY_UNSUPPORTED);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Push support, permission and the subscription are browser-only: read after mount so server and client markup agree.
  useEffect(() => {
    let cancelled = false;
    clearLegacyNotifyKeys();
    void readPushState(locale)
      .then((push) => {
        if (cancelled) return;
        const support: NotifySupport =
          push.support === 'available' ? (push.askable ? 'default' : 'granted') : push.support;
        setState({ support, optedIn: push.subscribed });
      })
      .catch((err: unknown) => {
        console.error('[draft-tool] reading the push state failed:', err);
        if (!cancelled) setState(NOTIFY_UNSUPPORTED);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const toggle = useCallback(() => {
    const current = stateRef.current;
    if (current.busy || current.support === 'unsupported' || current.support === 'denied' || current.support === 'install-required') return;
    setState({ ...current, busy: true, error: null });

    if (current.optedIn) {
      void disablePush().then((result) => {
        setState(
          result.ok
            ? { support: 'granted', optedIn: false }
            : { ...current, busy: false, error: result.failure?.error ?? { code: 'push_unsubscribe_failed' } },
        );
      });
      return;
    }

    void enablePush(locale)
      .then((result) => {
        if (result.ok) {
          setState({ support: 'granted', optedIn: true });
        } else if (result.reason === 'denied') {
          setState({ support: 'denied', optedIn: false });
        } else if (result.reason === 'dismissed') {
          setState({ support: 'default', optedIn: false });
        } else if (result.reason === 'failed') {
          setState({
            ...current,
            busy: false,
            // `push_disabled` hides the control (NotifyToggle); any other failure stays retryable.
            error: result.failure?.error ?? { code: 'push_subscribe_failed' },
          });
        } else {
          setState(NOTIFY_UNSUPPORTED);
        }
      })
      .catch((err: unknown) => {
        console.error('[draft-tool] turning push alerts on failed:', err);
        setState({ ...current, busy: false, error: toApiErrorLike(err) });
      });
  }, [locale]);

  return { state, toggle };
}
