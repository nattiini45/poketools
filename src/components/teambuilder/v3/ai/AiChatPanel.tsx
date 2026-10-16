'use client';

import { useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import AgentChatThread from '@/components/agent/AgentChatThread';
import {
  buildChatBody,
  chatErrorKeyForStatus,
  extractShowdownBlocks,
  type AgentChatErrorKey,
  type ChatMessage,
} from '@/components/agent/agentChat';
import { streamAgentText } from '@/lib/ai/agent/client-stream';
import { useDataLocale, useT } from '@/i18n/client';
import { agentMessages } from '@/i18n/messages/agent';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import { errorsTeams } from '@/i18n/messages/errors';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import {
  apiFailure,
  errorKey,
  useTeambuilderErrorText,
  type TeambuilderError,
} from '../hooks/useTeambuilderErrorText';
import type { PokemonSet, ImportTeamResponse } from '@/types/team';
import type { ApiResult } from '@/types/api';
import type { EditorCommandApi, EditorCommandErrorCode } from './commands';

const MAX_INPUT = 1000;

interface AiChatPanelProps {
  /** The editor command seam — the panel never touches state/dispatch directly. */
  commandApi: EditorCommandApi;
  /** Current editor format, forwarded as agent context. */
  format: string;
  /** Open team id (null for an unsaved draft), forwarded as agent context. */
  teamId: string | null;
  /** Active league ruleset id (plan mode), forwarded so the agent builds within league rules. */
  rulesetId: string | null;
  /** Upcoming match id (plan mode), forwarded so the agent can resolve the player's assigned core. */
  matchId: string | null;
}

/** What happened on the last click; translated at render, never stored as text. */
type ApplyNotice =
  | { kind: 'applied'; species: string; slot: number }
  | { kind: 'failed'; error: TeambuilderError }
  | { kind: 'refused'; code: EditorCommandErrorCode | undefined }
  | null;

/** A chat failure: an `agent.errors` key, the stream's own error text, or our own key. */
type ChatError =
  | { kind: 'agent'; key: AgentChatErrorKey }
  | { kind: 'stream'; text: string }
  | { kind: 'unreachable' };

/**
 * "Apply to slot" affordance for a single Showdown block inside an assistant
 * reply. The parse into typed sets is delegated to `/api/import-team` (the same
 * server path the importer uses) so `@pkmn/sets` stays out of the client; each
 * parsed set then gets its own user-clicked Apply button. Application is always
 * conservative: snapshot first, then a single `execute` per click — never
 * automatic, never batched across the whole team.
 */
function ApplyShowdownBlock({
  block,
  commandApi,
}: {
  block: string;
  commandApi: EditorCommandApi;
}) {
  const t = useT(teambuilderMessages);
  const dl = useDataLocale();
  const errorText = useTeambuilderErrorText(errorsTeams);
  const [sets, setSets] = useState<PokemonSet[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<ApplyNotice>(null);

  async function parse() {
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch('/api/import-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: block }),
      });
      const json = (await res.json()) as ApiResult<ImportTeamResponse>;
      if (!res.ok || !json.success) {
        setNotice({ kind: 'failed', error: apiFailure(json, 'readSetFailed') });
        return;
      }
      setSets(json.data.pokemon);
    } catch {
      setNotice({ kind: 'failed', error: errorKey('readSetNetwork') });
    } finally {
      setLoading(false);
    }
  }

  function applySet(set: PokemonSet) {
    // Snapshot first (read), then a single execute (write) — the documented seam.
    const snap = commandApi.snapshot();
    const active = snap.activeSlot;
    let result;
    let slot: number;
    if (active !== null && snap.team[active]) {
      result = commandApi.execute({ kind: 'apply_set', slot: active, set });
      slot = active + 1;
    } else {
      const emptyIdx = snap.team.findIndex((s) => s == null);
      if (emptyIdx < 0) {
        setNotice({ kind: 'failed', error: errorKey('teamFull') });
        return;
      }
      result = commandApi.execute({ kind: 'propose_team', team: [set], mode: 'fill' });
      slot = emptyIdx + 1;
    }
    setNotice(
      result.ok
        ? { kind: 'applied', species: set.species, slot }
        : { kind: 'refused', code: result.code },
    );
  }

  function noticeText(n: NonNullable<ApplyNotice>): string {
    if (n.kind === 'applied') return t('ai.chat.applied', { species: localizeSpecies(n.species, dl), slot: n.slot });
    if (n.kind === 'failed') return errorText(n.error);
    return n.code ? t(`commandErrors.${n.code}`) : t('errors.applyFailed');
  }

  return (
    <div className="mt-2 border-t border-poke-border pt-2">
      {sets === null ? (
        <Button variant="secondary" size="sm" onClick={() => void parse()} loading={loading}>
          {t('ai.chat.applyToSlot')}
        </Button>
      ) : (
        <div className="space-y-1">
          <p className="text-[11px] text-poke-text-muted">
            {t('ai.chat.appliesHint')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sets.map((set, i) => (
              <Button
                key={`${set.species}-${i}`}
                variant="secondary"
                size="sm"
                onClick={() => applySet(set)}
              >
                {set.species
                  ? t('ai.chat.applySpecies', { species: localizeSpecies(set.species, dl) })
                  : t('ai.chat.applySetN', { n: i + 1 })}
              </Button>
            ))}
          </div>
        </div>
      )}
      {notice && (
        <p
          className={`mt-1 text-xs ${notice.kind === 'applied' ? 'text-poke-green' : 'text-poke-danger'}`}
        >
          {noticeText(notice)}
        </p>
      )}
    </div>
  );
}

/**
 * Teambuilder agent chat (PRD Phase 5). Mounts inside `AiPanel`, talks to the
 * `linden_teambuilding` persona via `/api/ai/agent/chat`, and forwards the open
 * team's format + id as context. Multi-turn continuity rides the
 * `X-Agent-Conversation-Id` header captured from the first reply. When a reply
 * contains a Showdown paste, an "Apply to slot" affordance drives the editor
 * command seam (see {@link ApplyShowdownBlock}).
 */
export default function AiChatPanel({ commandApi, format, teamId, rulesetId, matchId }: AiChatPanelProps) {
  const t = useT(teambuilderMessages);
  const tAgent = useT(agentMessages);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<ChatError | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const partialRef = useRef('');
  const conversationIdRef = useRef<string | null>(null);

  async function send() {
    const content = input.trim();
    if (!content || streaming) return;

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
          buildChatBody(next, {
            conversationId: conversationIdRef.current,
            context: {
              format,
              team_id: teamId ?? undefined,
              ruleset_id: rulesetId ?? undefined,
              upcoming_match_id: matchId ?? undefined,
            },
          }),
        ),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setStreaming(false);
        setError({ kind: 'agent', key: chatErrorKeyForStatus(response.status) });
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
        setError(streamError ? { kind: 'stream', text: streamError } : { kind: 'agent', key: 'unavailable' });
        setStreamingText('');
        return;
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: text }]);
      setStreamingText('');
    } catch (err) {
      setStreaming(false);
      if (err instanceof DOMException && err.name === 'AbortError') {
        const partial = partialRef.current.trim();
        if (partial) setMessages((prev) => [...prev, { role: 'assistant', content: partial }]);
      } else {
        setError({ kind: 'unreachable' });
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

  const expanded = messages.length > 0 || streaming;
  const errorMessage =
    error === null
      ? null
      : error.kind === 'agent'
        ? tAgent(`errors.${error.key}`)
        : error.kind === 'stream'
          ? error.text
          : t('errors.assistantUnreachable');

  return (
    <div className="flex flex-col">
      <p className="text-xs text-poke-text-muted">{t('ai.chat.intro')}</p>

      {expanded && (
        <div
          className="mt-3 max-h-80 overflow-y-auto space-y-3 rounded-poke-md bg-poke-base/40 p-3 border border-poke-border"
          aria-live="polite"
        >
          <AgentChatThread
            messages={messages}
            streaming={streaming}
            streamingText={streamingText}
            thinkingLabel={tAgent('thinking')}
            renderAssistantActions={(m) => {
              const blocks = extractShowdownBlocks(m.content);
              if (blocks.length === 0) return null;
              return blocks.map((block, i) => (
                <ApplyShowdownBlock key={i} block={block} commandApi={commandApi} />
              ));
            }}
          />
        </div>
      )}

      {errorMessage && (
        <p className="mt-3 text-sm text-poke-danger" role="alert">
          {errorMessage}
        </p>
      )}

      <div className="mt-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={MAX_INPUT}
          rows={2}
          disabled={streaming}
          placeholder={t('ai.chat.placeholder')}
          className="w-full resize-none px-3 py-2 text-sm bg-poke-surface text-poke-text-primary border border-poke-border rounded-poke-md placeholder:text-poke-text-muted transition-colors duration-200 focus:outline-none focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20 disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-poke-text-muted italic">
            {t('ai.chat.disclaimer')}
          </span>
          {streaming ? (
            <Button variant="secondary" size="sm" onClick={() => abortRef.current?.abort()}>
              {tAgent('stop')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => void send()}
              disabled={input.trim().length === 0}
            >
              {tAgent('send')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
