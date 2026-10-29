'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorOf, getConversation, postMessage, type MessageBody } from './api';
import { emptyLive, reduceLive, type LiveError, type LiveTurn, type LiveUsage } from './live-turn';
import { readAgentStream } from './sse';
import type { ConversationDetail } from './types';

export interface AssistantConversation {
  status: 'loading' | 'ready' | 'error';
  detail: ConversationDetail | null;
  loadError: ApiErrorLike | null;
  /** The turn that is streaming right now (cleared once the stored messages have been re-read). */
  live: LiveTurn | null;
  /** The admin's message shown while the server stores it. */
  pendingText: string | null;
  sending: boolean;
  /** A refusal before the stream started (busy, rate limit, too long). */
  sendError: ApiErrorLike | null;
  /** The errors the last turn reported on its stream (a budget stop, a model failure). */
  turnErrors: LiveError[];
  usage: LiveUsage | null;
  /** Sends a message. `onAccepted` runs as soon as the server has taken it (before the answer streams), so the composer can clear. */
  send(text: string, onAccepted?: () => void): Promise<boolean>;
  continueTurn(): Promise<void>;
  /** Asks the server to start a turn in which the assistant stages the undo of an executed proposal. */
  requestUndo(proposalId: string): Promise<void>;
  refresh(): Promise<void>;
  dismissErrors(): void;
}

/** How often a conversation that is busy elsewhere (another tab, a reload mid-turn) is re-read. */
const BUSY_POLL_MS = 3000;

function newMessageId(): string {
  const cryptoApi = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * One conversation's client state: the stored detail, the streaming turn and the sends. The turn runs on the server and
 * persists every step (spike S7), so this hook never stops it: leaving the page ends the stream, the turn finishes, and
 * the next load shows the result.
 */
export function useAssistantConversation(conversationId: string): AssistantConversation {
  const [status, setStatus] = useState<AssistantConversation['status']>('loading');
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiErrorLike | null>(null);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<ApiErrorLike | null>(null);
  const [turnErrors, setTurnErrors] = useState<LiveError[]>([]);
  const [usage, setUsage] = useState<LiveUsage | null>(null);

  const mounted = useRef(true);
  const inFlight = useRef(false);
  const liveRef = useRef<LiveTurn | null>(null);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await getConversation(conversationId);
    if (!mounted.current) return;
    if (result.ok) {
      setDetail(result.data);
      setLoadError(null);
      setStatus('ready');
    } else {
      setLoadError(result.error);
      setStatus((current) => (current === 'ready' ? current : 'error'));
    }
  }, [conversationId]);

  useEffect(() => {
    mounted.current = true;
    setStatus('loading');
    setDetail(null);
    setLive(null);
    setPendingText(null);
    setSendError(null);
    setTurnErrors([]);
    setUsage(null);
    void load();
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, [conversationId, load]);

  const run = useCallback(
    async (body: MessageBody, pending: string | null, onAccepted?: () => void): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setSending(true);
      setSendError(null);
      setTurnErrors([]);
      setPendingText(pending);
      liveRef.current = emptyLive();
      setLive(liveRef.current);
      const controller = new AbortController();
      abort.current = controller;
      let accepted = false;
      try {
        const response = await postMessage(conversationId, body, controller.signal);
        if (!response.ok) {
          const error = await errorOf(response);
          if (mounted.current) setSendError(error);
          return false;
        }
        accepted = true;
        onAccepted?.();
        await readAgentStream(response, (event) => {
          liveRef.current = reduceLive(liveRef.current ?? emptyLive(), event);
          if (mounted.current) setLive(liveRef.current);
        });
      } catch (error) {
        // The connection broke mid-stream. The turn goes on server-side; the re-read below shows how far it got.
        if (mounted.current && !(error instanceof DOMException && error.name === 'AbortError')) setSendError(toApiErrorLike(error));
      } finally {
        const last = liveRef.current;
        inFlight.current = false;
        if (mounted.current) {
          if (last?.errors.length) setTurnErrors(last.errors);
          if (last?.usage) setUsage(last.usage);
          await load();
        }
        liveRef.current = null;
        if (mounted.current) {
          setLive(null);
          setPendingText(null);
          setSending(false);
        }
      }
      return accepted;
    },
    [conversationId, load],
  );

  const send = useCallback((text: string, onAccepted?: () => void) => run({ text, client_msg_id: newMessageId() }, text, onAccepted), [run]);
  const continueTurn = useCallback(async () => {
    await run({ continue: true }, null);
  }, [run]);

  const requestUndo = useCallback(
    async (proposalId: string) => {
      await run({ undo: { proposal_id: proposalId } }, null);
    },
    [run],
  );

  // A turn that runs in another tab (or before a reload) is followed by re-reading while the lease is held.
  const busyElsewhere = detail?.conversation.busy === true && !sending;
  useEffect(() => {
    if (!busyElsewhere) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (typeof document === 'undefined' || !document.hidden) await load();
      if (mounted.current) timer = setTimeout(() => void tick(), BUSY_POLL_MS);
    };
    timer = setTimeout(() => void tick(), BUSY_POLL_MS);
    return () => clearTimeout(timer);
  }, [busyElsewhere, load]);

  const dismissErrors = useCallback(() => {
    setSendError(null);
    setTurnErrors([]);
  }, []);

  return { status, detail, loadError, live, pendingText, sending, sendError, turnErrors, usage, send, continueTurn, requestUndo, refresh: load, dismissErrors };
}
