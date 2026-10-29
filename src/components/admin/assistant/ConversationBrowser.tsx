'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquarePlus } from 'lucide-react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { PANEL, PANEL_HOVER } from '@/components/ui/panel';
import Skeleton from '@/components/ui/Skeleton';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useFormatter, useRequestTime, useT } from '@/i18n/client';
import { adminAssistantMessages } from '@/i18n/messages/admin-assistant';
import { errorsAdminAssistant } from '@/i18n/messages/errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { createConversation, listConversations } from './api';
import type { ConversationSeed, ConversationSummary } from './types';

export interface ConversationBrowserProps {
  /** Open a conversation as a link (the full page). */
  hrefFor?: (id: string) => string;
  /** Open a conversation in place (the drawer). */
  onOpen?: (id: string) => void;
  /** A new conversation was created. */
  onCreated: (id: string) => void;
  /** The page context the new conversation starts from: a whitelisted key plus ids, never free text. */
  seed?: ConversationSeed;
}

/** The admin's own conversations, newest first, and the button for a new one. */
export default function ConversationBrowser({ hrefFor, onOpen, onCreated, seed }: ConversationBrowserProps) {
  const t = useT(adminAssistantMessages);
  const f = useFormatter();
  const now = useRequestTime();
  const errorText = useApiErrorText(errorsAdminAssistant);
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [creating, setCreating] = useState(false);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void listConversations({ status: 'active', limit: 50 }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setItems(result.data.items);
        setError(null);
      } else {
        setError(result.error);
      }
    });
    return () => controller.abort();
  }, [attempt]);

  const create = async () => {
    setCreating(true);
    const result = await createConversation(seed);
    setCreating(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated(result.data.id);
  };

  const row = (item: ConversationSummary) => {
    const inner = (
      <>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-heading text-sm font-semibold text-poke-text-primary">{item.title ?? t('page.untitled')}</span>
          <span className="block text-xs text-poke-text-muted">{t('list.updated', { time: f.relative(item.lastMessageAt, now) })}</span>
        </span>
        {item.busy && <Badge variant="blue" size="xs">{t('transcript.working')}</Badge>}
        {item.readOnly && <Badge variant="gray" size="xs">{t('list.readOnly')}</Badge>}
      </>
    );
    const className = `${PANEL} ${PANEL_HOVER} flex w-full items-center gap-2 p-3 text-left`;
    return (
      <li key={item.id}>
        {hrefFor !== undefined ? (
          <Link href={hrefFor(item.id)} className={className}>
            {inner}
          </Link>
        ) : (
          <button type="button" className={className} onClick={() => onOpen?.(item.id)}>
            {inner}
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-base font-bold text-poke-text-primary">{t('page.conversations')}</h2>
        <Button size="sm" onClick={() => void create()} loading={creating}>
          <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
          {t('page.newConversation')}
        </Button>
      </div>
      {error !== null && (
        <Alert variant="error">
          {errorText(error)}{' '}
          <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
            {t('errors.retry')}
          </button>
        </Alert>
      )}
      {items === null && error === null && (
        <div className="space-y-2" aria-busy="true">
          <p className="text-sm text-poke-text-muted">{t('states.loading')}</p>
          <Skeleton height="3.5rem" />
          <Skeleton height="3.5rem" />
        </div>
      )}
      {items !== null && items.length === 0 && <p className="rounded-poke-md border border-dashed border-poke-border p-4 text-sm text-poke-text-secondary">{t('page.emptyList')}</p>}
      {items !== null && items.length > 0 && <ul className="space-y-2">{items.map(row)}</ul>}
    </div>
  );
}
