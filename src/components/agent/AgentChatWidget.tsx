'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import DiscordLoginButton from '@/components/shared/DiscordLoginButton';
import { streamAgentText } from '@/lib/ai/agent/client-stream';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useDataLocale, useT } from '@/i18n/client';
import { agentMessages } from '@/i18n/messages/agent';
import AgentChatThread from './AgentChatThread';
import {
  buildChatBody,
  chatErrorKeyForStatus,
  type AgentChatErrorKey,
  type ChatMessage,
} from './agentChat';

const PROF_IMAGE = '/characters/professor-linden.png';
const MAX_INPUT = 1000;
/** The species the composer placeholder suggests (canonical English name; shown localized). */
const PLACEHOLDER_SPECIES = 'Garchomp';

/** A key of `agent.errors`, or the stream's own error text. Never our translated text. */
type ChatError = { kind: 'key'; key: AgentChatErrorKey } | { kind: 'stream'; text: string };

const subscribe = () => () => {};

interface AgentChatWidgetProps {
  /** Server-derived initial auth state — only ever a boolean, never the session. */
  isAuthenticated: boolean;
}

/** Branding header reused across collapsed / expanded states. */
function ProfHeader() {
  const t = useT(agentMessages);
  return (
    <div className="flex items-center gap-3">
      <Image
        src={PROF_IMAGE}
        alt={t('name')}
        width={44}
        height={44}
        className="rounded-full shrink-0"
        unoptimized
      />
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-heading font-semibold text-poke-text-primary">
            {t('name')}
          </span>
          <Badge variant="accent" size="sm">
            {t('badge')}
          </Badge>
        </div>
        <p className="text-xs text-poke-text-muted mt-0.5">
          {t('tagline')}
        </p>
      </div>
    </div>
  );
}

export default function AgentChatWidget({ isAuthenticated }: AgentChatWidgetProps) {
  const { data: session } = useSession();
  const t = useT(agentMessages);
  const dataLocale = useDataLocale();
  // Match DiscordLoginButton's hydration-safe pattern: render the server-derived
  // value until mounted, then track the live client session (updates after sign-in).
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const authed = mounted ? Boolean(session) : isAuthenticated;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<ChatError | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const partialRef = useRef('');
  // Captured from the first turn's response header; resent so the server keeps
  // appending to the same conversation row instead of forking each turn.
  const conversationIdRef = useRef<string | null>(null);

  const expanded = messages.length > 0 || streaming;

  async function send() {
    const content = input.trim();
    if (!content || streaming || !authed) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setError(null);
    setStreaming(true);
    setStreamingText('');
    partialRef.current = '';

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/ai/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildChatBody(next, { conversationId: conversationIdRef.current }),
        ),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setStreaming(false);
        setError({ kind: 'key', key: chatErrorKeyForStatus(response.status) });
        return;
      }

      const { text, error: streamError, conversationId } = await streamAgentText(
        response,
        (full) => {
          partialRef.current = full;
          setStreamingText(full);
        },
      );
      setStreaming(false);
      if (conversationId) conversationIdRef.current = conversationId;

      if (streamError || !text) {
        setError(streamError ? { kind: 'stream', text: streamError } : { kind: 'key', key: 'unavailable' });
        setStreamingText('');
        return;
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: text }]);
      setStreamingText('');
    } catch (err) {
      setStreaming(false);
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Commit whatever streamed before the user stopped it.
        const partial = partialRef.current.trim();
        if (partial) {
          setMessages((prev) => [...prev, { role: 'assistant', content: partial }]);
        }
      } else {
        setError({ kind: 'key', key: 'unreachable' });
      }
      setStreamingText('');
    } finally {
      abortRef.current = null;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <Card variant="outlined" padding="lg" className="border-poke-blue/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ProfHeader />
        {!authed && mounted && <DiscordLoginButton />}
      </div>

      <p className="text-sm text-poke-text-secondary mt-3 max-w-xl">
        {t('intro')}
      </p>

      {/* Conversation thread (appears once a turn exists) */}
      {expanded && (
        <div
          className="mt-4 max-h-80 overflow-y-auto space-y-3 rounded-poke-md bg-poke-base/40 p-3 border border-poke-border"
          aria-live="polite"
        >
          <AgentChatThread
            messages={messages}
            streaming={streaming}
            streamingText={streamingText}
            thinkingLabel={t('thinking')}
          />
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-poke-danger" role="alert">
          {error.kind === 'key' ? t(`errors.${error.key}`) : error.text}
        </p>
      )}

      {/* Composer */}
      {authed ? (
        <div className="mt-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={MAX_INPUT}
            rows={2}
            disabled={streaming}
            placeholder={t('placeholder', { pokemon: localizeSpecies(PLACEHOLDER_SPECIES, dataLocale) })}
            className="w-full resize-none px-3 py-2 text-sm bg-poke-surface text-poke-text-primary border border-poke-border rounded-poke-md placeholder:text-poke-text-muted transition-colors duration-200 focus:outline-none focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20 disabled:opacity-60"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-poke-text-muted italic">
              {t('disclaimer')}
            </span>
            {streaming ? (
              <Button variant="secondary" size="sm" onClick={() => abortRef.current?.abort()}>
                {t('stop')}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void send()}
                disabled={input.trim().length === 0}
              >
                {t('send')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <textarea
            rows={2}
            disabled
            placeholder={t('signedOutPlaceholder')}
            className="w-full resize-none px-3 py-2 text-sm bg-poke-muted text-poke-text-muted border border-poke-border rounded-poke-md placeholder:text-poke-text-muted cursor-not-allowed"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <DiscordLoginButton />
            <span className="text-xs text-poke-text-muted">
              {t('signInHint')}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
