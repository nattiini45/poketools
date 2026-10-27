'use client';

import { Fragment } from 'react';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { adminAssistantMessages } from '@/i18n/messages/admin-assistant';
import { errorsAdminAssistant } from '@/i18n/messages/errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import ClarificationCard from './ClarificationCard';
import type { LiveTurn } from './live-turn';
import ProposalCard from './ProposalCard';
import SafeMarkdown from './SafeMarkdown';
import { toolGroup } from './tool-group';
import type { ProposalSummaryView, ToolStatus, TranscriptItem } from './types';

type LineStatus = ToolStatus | 'running';

function ToolLine({ name, status, code }: { name: string; status: LineStatus; code: string | null }) {
  const t = useT(adminAssistantMessages);
  const errorText = useApiErrorText(errorsAdminAssistant);
  const what = t.dynamic(`tools.what.${toolGroup(name)}`, undefined, t('tools.what.lookup'));
  const pending = status === 'pending' || status === 'running';
  return (
    <li className="flex items-start gap-1.5 pl-2 text-xs text-poke-text-muted" data-tool-status={status}>
      {pending ? (
        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : status === 'ok' ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-poke-green" aria-hidden="true" />
      ) : (
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-poke-danger-ink" aria-hidden="true" />
      )}
      <span>
        {t(pending ? 'tools.pending' : status === 'ok' ? 'tools.ok' : 'tools.failed', { what })}
        {status === 'failed' && code !== null && <span className="text-poke-danger-ink"> ({errorText({ code })})</span>}
      </span>
    </li>
  );
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }) {
  const t = useT(adminAssistantMessages);
  const user = role === 'user';
  return (
    <li className={`flex flex-col ${user ? 'items-end' : 'items-start'}`} data-role={role}>
      <span className="mb-0.5 px-1 text-[11px] font-heading font-semibold uppercase tracking-wide text-poke-text-muted">
        {user ? t('transcript.you') : t('transcript.assistant')}
      </span>
      <div
        className={`max-w-full rounded-poke-lg border px-3 py-2 text-poke-text-primary ${
          user ? 'border-poke-accent/30 bg-poke-accent-light' : 'border-poke-border bg-poke-surface'
        }`}
      >
        {children}
      </div>
    </li>
  );
}

export interface TranscriptProps {
  items: readonly TranscriptItem[];
  proposals: readonly ProposalSummaryView[];
  live: LiveTurn | null;
  pendingText: string | null;
  /** The older part of the history was not loaded. */
  truncated: boolean;
  approveEnabled: boolean;
  /** A card was approved or declined: re-read the conversation. */
  onChanged: () => void;
  /** Sends an answer to a question of the assistant as the admin's next message; absent while no message can be sent. */
  onAnswer?: (text: string) => void;
}

/**
 * The transcript (plan 5.3): the admin's words and the assistant's prose, one compact status line per tool call, the
 * proposal cards inline where the assistant staged them, and the turn that is streaming right now under them. Cards that
 * are not tied to a tool result (a reload mid-turn) come after the messages, oldest first.
 */
export default function Transcript({ items, proposals, live, pendingText, truncated, approveEnabled, onChanged, onAnswer }: TranscriptProps) {
  const t = useT(adminAssistantMessages);

  const placed = new Set<string>();
  for (const item of items) if (item.type === 'tool' && item.proposalId !== null) placed.add(item.proposalId);
  for (const id of live?.proposalIds ?? []) placed.add(id);
  const loose = [...proposals].reverse().filter((proposal) => !placed.has(proposal.id));
  // Cards the stream announced; the re-read after the turn lists them with the others.
  const announced = live?.proposalIds ?? [];

  const card = (id: string) => <ProposalCard key={`card-${id}`} proposalId={id} approveEnabled={approveEnabled} onChanged={onChanged} />;

  return (
    <ol className="space-y-3" aria-label={t('page.transcript')}>
      {truncated && <li className="text-center text-xs text-poke-text-muted">{t('transcript.earlier')}</li>}
      {items.map((item, index) => {
        const key = `${item.type}-${item.seq}-${item.type === 'tool' ? item.id : ''}`;
        switch (item.type) {
          case 'user':
            return (
              <Bubble key={key} role="user">
                <p className="whitespace-pre-wrap break-words text-sm">{item.text ?? t('transcript.purged')}</p>
              </Bubble>
            );
          case 'assistant':
            return (
              <Bubble key={key} role="assistant">
                {item.text === null ? <p className="text-sm text-poke-text-muted">{t('transcript.purged')}</p> : <SafeMarkdown text={item.text} />}
              </Bubble>
            );
          case 'tool':
            return (
              <Fragment key={key}>
                <ToolLine name={item.name} status={item.status} code={item.code} />
                {item.proposalId !== null && <li>{card(item.proposalId)}</li>}
                {item.clarification !== undefined && (
                  <li>
                    <ClarificationCard clarification={item.clarification} answered={items.slice(index + 1).some((later) => later.type === 'user')} onAnswer={onAnswer} />
                  </li>
                )}
              </Fragment>
            );
          case 'event':
            return (
              <li key={key} className="text-center text-xs text-poke-text-muted" data-event={item.event}>
                {t.dynamic(`events.${item.event}`, undefined, t('events.generic'))}
              </li>
            );
        }
      })}

      {pendingText !== null && (
        <Bubble role="user">
          <p className="whitespace-pre-wrap break-words text-sm">{pendingText}</p>
        </Bubble>
      )}

      {live?.blocks.map((block, index) =>
        block.kind === 'text' ? (
          <Bubble key={`live-text-${block.step}-${index}`} role="assistant">
            <SafeMarkdown text={block.text} />
          </Bubble>
        ) : (
          <ToolLine key={`live-tool-${block.id}`} name={block.name} status={block.status} code={block.code} />
        ),
      )}
      {live !== null && live.blocks.length === 0 && live.done === null && (
        <li className="flex items-center gap-2 pl-2 text-xs text-poke-text-muted" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {t('transcript.working')}
        </li>
      )}

      {announced.map((id) => (
        <li key={`live-card-${id}`}>{card(id)}</li>
      ))}
      {loose.map((proposal) => (
        <li key={`loose-${proposal.id}`}>{card(proposal.id)}</li>
      ))}
    </ol>
  );
}
