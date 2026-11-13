'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { FOCUS_RING } from '@/components/ui/panel';
import { useLocale, useT } from '@/i18n/client';
import { RelativeTime } from '@/i18n/LocalTime';
import { notificationsMessages } from '@/i18n/messages/notifications';
import { useVisiblePoll, type PollOutcome } from '@/lib/draft/use-visible-poll';
import { loadInbox, loadUnreadCount, markRead } from '@/lib/format-engine/notifications/client-api';
import type { ChallengeNoticeView, NotificationView } from '@/lib/format-engine/notifications/types';
import { resolveLText } from '@/lib/studio-core/ltext';

/** The unread count is cheap but not free: a visible tab asks every two minutes, a hidden one never. */
const UNREAD_POLL_MS = 120_000;
const BADGE_MAX = 99;

type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

function challengeSentence(item: ChallengeNoticeView) {
  switch (item.kind) {
    case 'challenge_created':
      return 'created' as const;
    case 'challenge_accepted':
      return 'accepted' as const;
    case 'challenge_declined':
      return 'declined' as const;
    case 'challenge_expired':
      return item.side === 'defender' ? ('expired_defender' as const) : ('expired_challenger' as const);
    case 'challenge_cancelled':
      return item.side === 'defender' ? ('cancelled_defender' as const) : ('cancelled_challenger' as const);
  }
}

function NotificationRow({ item, onFollow }: { item: NotificationView; onFollow: (item: NotificationView) => void }) {
  const t = useT(notificationsMessages);
  const locale = useLocale();
  let body: string;
  if (item.kind === 'rule_notice') body = resolveLText(item.message, { viewer: locale })?.value ?? '';
  else if (item.counterparty.name === null) body = t(`challengeFormer.${challengeSentence(item)}`);
  else body = t(`challenge.${challengeSentence(item)}`, { player: item.counterparty.name });
  return (
    <li>
      <Link
        href={item.href}
        onClick={() => onFollow(item)}
        className={`flex gap-2 rounded-poke-md px-2 py-2 transition-colors hover:bg-poke-elevated ${FOCUS_RING}`}
      >
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.read ? 'invisible' : 'bg-poke-accent'}`}
        />
        <span className="min-w-0 flex-1">
          {!item.read && <span className="sr-only">{t('panel.unread')}: </span>}
          <span className={`block break-words text-sm ${item.read ? 'text-poke-text-secondary' : 'font-semibold text-poke-text-primary'}`}>
            {body}
          </span>
          <span className="mt-0.5 block text-xs text-poke-text-muted">
            {item.league.name !== null && <span>{item.league.name} · </span>}
            <RelativeTime value={item.created_at} />
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The bell of the signed-in player in the NavBar: the unread count and a panel with their format-league notifications.
 * A disclosure inside `#site-nav`, like the language and palette pickers (the panel must stay inside the bar for its reveal
 * over the 3D world). Theme tokens only. Reading a notification is explicit: following it, or "mark all as read".
 */
export default function NotificationBell() {
  const t = useT(notificationsMessages);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [load, setLoad] = useState<LoadState>('idle');
  const [markFailed, setMarkFailed] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** The offset of the last list read, for its retry. */
  const lastOffsetRef = useRef(0);
  /** The row to focus once a page has landed: the button that asked for it is gone by then. */
  const focusRowRef = useRef<number | null>(null);
  /** Bumped by every list read and every mark: an answer that started before the latest of them is out of date. */
  const listGeneration = useRef(0);
  const countGeneration = useRef(0);

  const { refresh } = useVisiblePoll(
    async (): Promise<PollOutcome> => {
      const started = countGeneration.current;
      const outcome = await loadUnreadCount();
      if (outcome.ok) {
        if (started === countGeneration.current) setUnread(outcome.data.unread);
        return 'live';
      }
      // Signed out or banned meanwhile: asking again cannot help.
      return outcome.status === 401 || outcome.status === 403 ? 'stop' : 'live';
    },
    { liveIntervalMs: UNREAD_POLL_MS },
  );

  const fetchPage = useCallback(async (offset: number) => {
    setLoad('loading');
    lastOffsetRef.current = offset;
    listGeneration.current += 1;
    const started = listGeneration.current;
    const outcome = await loadInbox(offset);
    if (started !== listGeneration.current) return;
    if (!outcome.ok) {
      setLoad('failed');
      return;
    }
    // A notification that arrived between two pages shifts the offset, so a row can come twice.
    setItems((current) => {
      if (offset === 0) return outcome.data.items;
      const known = new Set(current.map((row) => row.id));
      return [...current, ...outcome.data.items.filter((row) => !known.has(row.id))];
    });
    setNextOffset(outcome.data.next_offset);
    // This count is newer than the answer of a poll still on its way.
    countGeneration.current += 1;
    setUnread(outcome.data.unread);
    setLoad('ready');
  }, []);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (focusRowRef.current === null) return;
    listRef.current?.querySelectorAll('a')[focusRowRef.current]?.focus();
    focusRowRef.current = null;
  }, [items]);

  const toggle = () => {
    if (!open) {
      setMarkFailed(false);
      void fetchPage(0);
    }
    setOpen(!open);
  };

  // Close paths, attached only while open (the PalettePicker pattern).
  useEffect(() => {
    if (!open) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Native listener: this Escape must not also close the revealed bar over the 3D world.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !wrapper.contains(next)) setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapper.contains(event.target)) return;
      setOpen(false);
    };
    wrapper.addEventListener('keydown', onKeyDown);
    wrapper.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      wrapper.removeEventListener('keydown', onKeyDown);
      wrapper.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  /**
   * Applies a mark the server confirmed. A list or count read still on its way describes the state before it. `sentAt` is the
   * list generation when the mark was sent: a list read begun since may have seen either state, so it is asked for again.
   */
  const settleMark = (unreadNow: number, marked: (row: NotificationView) => boolean, sentAt: number) => {
    const readSince = listGeneration.current !== sentAt;
    listGeneration.current += 1;
    countGeneration.current += 1;
    setLoad((current) => (current === 'loading' ? 'ready' : current));
    setItems((current) => current.map((row) => (marked(row) ? { ...row, read: true } : row)));
    setUnread(unreadNow);
    if (readSince) void fetchPage(lastOffsetRef.current);
  };

  const follow = (item: NotificationView) => {
    setOpen(false);
    if (item.read) return;
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, read: true } : row)));
    setUnread((count) => Math.max(0, count - 1));
    listGeneration.current += 1;
    countGeneration.current += 1;
    const sentAt = listGeneration.current;
    void markRead([item.id]).then((outcome) => {
      if (outcome.ok) settleMark(outcome.data.unread, (row) => row.id === item.id, sentAt);
      // The row stays unread on the server, and the next read says so.
      else void refresh();
    });
  };

  const markAll = async () => {
    setMarkFailed(false);
    const sentAt = listGeneration.current;
    const outcome = await markRead('all');
    if (!outcome.ok) {
      setMarkFailed(true);
      return;
    }
    settleMark(outcome.data.unread, () => true, sentAt);
    // The button that was just pressed goes away with the last unread notification.
    titleRef.current?.focus();
  };

  const retry = () => {
    titleRef.current?.focus();
    void fetchPage(lastOffsetRef.current);
  };

  const showOlder = (offset: number) => {
    titleRef.current?.focus();
    focusRowRef.current = items.length;
    void fetchPage(offset);
  };

  const badge = unread > BADGE_MAX ? t('bell.overflow') : String(unread);

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread > 0 ? t('bell.labelUnread', { count: unread }) : t('bell.label')}
        onClick={toggle}
        className={`relative block rounded-poke-md p-2 text-poke-text-secondary transition-colors hover:bg-poke-elevated hover:text-poke-text-primary ${FOCUS_RING}`}
      >
        <Bell aria-hidden="true" className="h-5 w-5" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 min-w-[1.125rem] rounded-full bg-poke-danger px-1 text-center text-micro font-bold leading-[1.125rem] text-poke-on-danger"
          >
            {badge}
          </span>
        )}
      </button>
      <span role="status" className="sr-only">
        {unread > 0 ? t('bell.announceUnread', { count: unread }) : ''}
      </span>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className="fixed inset-x-2 top-16 z-50 flex max-h-[min(32rem,calc(100dvh-5rem))] flex-col rounded-poke-lg border border-poke-border bg-poke-surface shadow-poke-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
        >
          <div className="flex items-center justify-between gap-3 border-b border-poke-border px-3 py-2">
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="font-heading text-sm font-bold text-poke-text-primary outline-2 outline-offset-2 outline-transparent">
              {t('panel.title')}
            </h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAll()}
                className={`rounded-poke-sm text-xs font-semibold text-poke-accent-strong hover:underline ${FOCUS_RING}`}
              >
                {t('panel.markAllRead')}
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {markFailed && (
              <p role="alert" className="px-2 py-1 text-xs text-poke-danger-ink">
                {t('panel.markFailed')}
              </p>
            )}
            {items.length > 0 && (
              <ul ref={listRef} className="space-y-0.5">
                {items.map((item) => (
                  <NotificationRow key={item.id} item={item} onFollow={follow} />
                ))}
              </ul>
            )}
            {load === 'loading' && <p className="px-2 py-3 text-sm text-poke-text-muted">{t('panel.loading')}</p>}
            {load === 'ready' && items.length === 0 && <p className="px-2 py-3 text-sm text-poke-text-muted">{t('panel.empty')}</p>}
            {load === 'failed' && (
              <div role="alert" className="px-2 py-3 text-sm text-poke-danger-ink">
                <p>{t('panel.loadFailed')}</p>
                <button
                  type="button"
                  onClick={retry}
                  className={`mt-1 rounded-poke-sm text-xs font-semibold underline ${FOCUS_RING}`}
                >
                  {t('panel.retry')}
                </button>
              </div>
            )}
            {load === 'ready' && nextOffset !== null && (
              <button
                type="button"
                onClick={() => showOlder(nextOffset)}
                className={`mt-1 w-full rounded-poke-md px-2 py-2 text-center text-xs font-semibold text-poke-text-secondary hover:bg-poke-elevated ${FOCUS_RING}`}
              >
                {t('panel.loadMore')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
