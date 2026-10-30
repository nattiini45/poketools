'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import { useFormatter, useT } from '@/i18n/client';
import { adminAssistantMessages } from '@/i18n/messages/admin-assistant';
import { errorsAdminAssistant } from '@/i18n/messages/errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import Composer from './Composer';
import PlanPanel from './PlanPanel';
import Transcript from './Transcript';
import { useAssistantConversation } from './useAssistantConversation';

export interface AssistantWorkspaceProps {
  conversationId: string;
  /** `drawer`: one column, the Plan folds into a header chip. `page`: transcript beside the Plan panel. */
  variant: 'drawer' | 'page';
}

/** A message is "near the bottom" within this many pixels: the view then follows the stream. */
const FOLLOW_PX = 80;

/**
 * One conversation, whole (plan 5.3): header, transcript, Plan and composer, shared by the drawer and the full page. The
 * turn runs on the server and persists every step; this component only follows it, so closing the drawer mid-turn loses
 * nothing and reopening shows the finished turn.
 */
export default function AssistantWorkspace({ conversationId, variant }: AssistantWorkspaceProps) {
  const t = useT(adminAssistantMessages);
  const f = useFormatter();
  const errorText = useApiErrorText(errorsAdminAssistant);
  const conv = useAssistantConversation(conversationId);
  const { detail } = conv;

  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [planOpen, setPlanOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const ask = (text: string) => setPrefill((current) => ({ text, nonce: (current?.nonce ?? 0) + 1 }));

  const onScroll = () => {
    const el = scroller.current;
    if (el) setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_PX);
  };
  useEffect(() => {
    const el = scroller.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [detail, conv.live, conv.pendingText, following]);

  if (conv.status === 'loading' || (detail === null && conv.status !== 'error')) {
    return (
      <div className="space-y-3 p-1" aria-busy="true">
        <p className="text-sm text-poke-text-muted">{t('states.loading')}</p>
        <Skeleton height="3rem" />
        <Skeleton height="5rem" />
      </div>
    );
  }
  if (detail === null) {
    return (
      <div className="space-y-2 p-1">
        <Alert variant="error">{conv.loadError === null ? t('errors.loadFailed') : errorText(conv.loadError)}</Alert>
        <Button size="sm" variant="secondary" onClick={() => void conv.refresh()}>
          {t('errors.retry')}
        </Button>
      </div>
    );
  }

  const { conversation, plan } = detail;
  const busyElsewhere = conversation.busy && !conv.sending;
  const composerDisabled = conversation.readOnly || conversation.status !== 'active' || busyElsewhere;
  const money = (micro: number) => f.number(micro / 1_000_000, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const spent = conv.usage?.conversationMicro ?? null;

  const header = (
    <header className="flex flex-wrap items-center gap-2">
      <h2 className="min-w-0 flex-1 truncate font-heading text-base font-bold text-poke-text-primary">{conversation.title ?? t('page.untitled')}</h2>
      {conversation.readOnly && <Badge variant="gray">{t('list.readOnly')}</Badge>}
      {variant === 'drawer' && (
        <>
          {plan !== null && (
            <Button size="sm" variant="secondary" aria-expanded={planOpen} onClick={() => setPlanOpen((open) => !open)}>
              {t('plan.title')} · {t(`plan.status.${plan.status}`)}
            </Button>
          )}
          <Link
            href={`/admin/assistant/${conversation.id}`}
            className="inline-flex items-center gap-1 text-xs font-heading font-semibold text-poke-focus underline-offset-2 hover:underline"
          >
            {t('drawer.openFullView')}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Link>
        </>
      )}
    </header>
  );

  const body = (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="h-full space-y-3 overflow-y-auto pr-1" role="log" aria-live="polite" aria-relevant="additions text" aria-label={t('page.transcript')}>
        <p className="text-xs text-poke-text-muted">{t('transcript.notice')}</p>
        {!detail.capabilities.approve && <p className="text-xs text-poke-text-muted">{t('states.phaseOnly')}</p>}
        {detail.items.length === 0 && conv.live === null && conv.pendingText === null && detail.proposals.length === 0 && (
          <p className="rounded-poke-md border border-dashed border-poke-border p-3 text-sm text-poke-text-secondary">{t('page.intro')}</p>
        )}
        <Transcript
          items={detail.items}
          proposals={detail.proposals}
          live={conv.live}
          pendingText={conv.pendingText}
          truncated={detail.truncated}
          approveEnabled={detail.capabilities.approve}
          onChanged={() => void conv.refresh()}
          onAnswer={composerDisabled || conv.sending ? undefined : (text) => void conv.send(text)}
          onUndo={composerDisabled || conv.sending ? undefined : (proposalId) => void conv.requestUndo(proposalId)}
        />
        {busyElsewhere && (
          <p className="text-xs text-poke-text-muted" role="status">
            {t('transcript.working')}
          </p>
        )}
      </div>
      {!following && (
        <Button className="absolute bottom-2 left-1/2 -translate-x-1/2 shadow-poke-md" size="sm" variant="secondary" onClick={() => setFollowing(true)}>
          {t('transcript.jumpToLatest')}
        </Button>
      )}
    </div>
  );

  const footer = (
    <div className="space-y-2">
      {conversation.readOnly && <Alert variant="warning">{t('states.readOnlyRole')}</Alert>}
      {conv.sendError !== null && (
        <Alert variant="error">
          <span>{errorText(conv.sendError)}</span>{' '}
          <button type="button" className="underline" onClick={conv.dismissErrors}>
            {t('errors.retry')}
          </button>
        </Alert>
      )}
      {conv.turnErrors.map((error, index) => (
        <Alert key={`${error.code}-${index}`} variant="error">
          {errorText({ code: error.code, params: error.params })}
        </Alert>
      ))}
      {conv.usage?.warn === true && spent !== null && (
        <Alert variant="warning">{t('states.budgetWarning', { spent: money(spent), cap: money(detail.limits.conversationCapMicro) })}</Alert>
      )}
      {detail.proposals.some((proposal) => proposal.effectiveStatus === 'proposed') && <p className="text-xs text-poke-text-muted">{t('states.waitingForConfirm')}</p>}
      <Composer
        disabled={composerDisabled}
        sending={conv.sending}
        maxChars={detail.limits.maxTextChars}
        canContinue={detail.awaitingContinue && !composerDisabled}
        onSend={conv.send}
        onContinue={() => void conv.continueTurn()}
        prefill={prefill}
      />
    </div>
  );

  if (variant === 'page') {
    return (
      <div className="grid min-h-0 gap-4 lg:grid-cols-12">
        <section className="flex min-h-[28rem] flex-col gap-3 lg:col-span-7" aria-label={t('page.transcript')}>
          {header}
          <div className="flex h-[60vh] min-h-0 flex-col gap-3">
            {body}
            {footer}
          </div>
        </section>
        <div className="lg:col-span-5">
          <PlanPanel plan={plan} unreadable={detail.planUnreadable === true} className="lg:sticky lg:top-20" onAsk={ask} canAsk={!composerDisabled && !conv.sending} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {header}
      {planOpen && <PlanPanel plan={plan} unreadable={detail.planUnreadable === true} className="max-h-[45%] overflow-y-auto" onAsk={ask} canAsk={!composerDisabled && !conv.sending} />}
      {body}
      {footer}
    </div>
  );
}
