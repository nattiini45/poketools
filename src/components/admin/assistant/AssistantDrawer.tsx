'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowLeft, MessageSquare, X } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { FOCUS_RING } from '@/components/ui/panel';
import { useT } from '@/i18n/client';
import { adminAssistantMessages } from '@/i18n/messages/admin-assistant';
import AssistantWorkspace from './AssistantWorkspace';
import ConversationBrowser from './ConversationBrowser';
import { seedForPath } from './seed-for-path';

/** Panel width in pixels: 420 by default, resizable to 720 (plan 5.1). */
export const DRAWER_MIN_WIDTH = 420;
export const DRAWER_MAX_WIDTH = 720;
const RESIZE_STEP = 24;

const STORAGE_WIDTH = 'plc.admin-assistant.width';
const STORAGE_CONVERSATION = 'plc.admin-assistant.conversation';

/** Browser storage can be missing, blocked or throw (private windows, cleared site data): it is only a convenience. */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // not remembered; nothing else depends on it
  }
}

const clampWidth = (value: number): number => Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, Math.round(value)));

/** Whether a key press belongs to a text field, where `.` is just a character. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * The assistant drawer (plan 5.1), mounted once in the admin layout outside the page transition, so a conversation goes on
 * while the admin clicks around. It opens from the floating button and the `.` key, closes with Esc, is resizable from 420 to
 * 720 px and is a full-screen sheet on a phone. The panel is not modal: the page behind it stays usable.
 */
export default function AssistantDrawer() {
  const t = useT(adminAssistantMessages);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DRAWER_MIN_WIDTH);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  // What the browser remembered (the width, the last conversation) is read when the drawer opens, never during render, so
  // the server render and the first client render agree.
  const openDrawer = useCallback(() => {
    const storedWidth = Number(readStored(STORAGE_WIDTH));
    if (Number.isFinite(storedWidth) && storedWidth > 0) setWidth(clampWidth(storedWidth));
    setConversationId(readStored(STORAGE_CONVERSATION));
    setOpen(true);
  }, []);
  const closeDrawer = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        closeDrawer();
        return;
      }
      if (event.key === '.' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && !isTyping(event.target)) {
        event.preventDefault();
        if (open) closeDrawer();
        else openDrawer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeDrawer, openDrawer]);

  // Focus moves into the panel when it opens and back to the launcher when it closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) panel.current?.focus();
    else if (wasOpen.current) launcher.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const show = (id: string | null) => {
    setConversationId(id);
    writeStored(STORAGE_CONVERSATION, id);
  };

  const resizeTo = (next: number) => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    writeStored(STORAGE_WIDTH, String(clamped));
  };
  const onResizeDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizeMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) resizeTo(drag.current.startWidth + (drag.current.startX - event.clientX));
  };
  const onResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') resizeTo(width + RESIZE_STEP);
    else if (event.key === 'ArrowRight') resizeTo(width - RESIZE_STEP);
    else return;
    event.preventDefault();
  };

  // The full page has everything the drawer has; a second copy beside it would only get in the way.
  if (pathname?.startsWith('/admin/assistant')) return null;

  return (
    <>
      {!open && (
        <button
          ref={launcher}
          type="button"
          onClick={openDrawer}
          title={t('drawer.shortcutHint')}
          aria-label={t('drawer.open')}
          className={`fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full border border-poke-accent bg-poke-accent px-4 py-2.5 font-heading text-sm font-semibold text-poke-surface shadow-poke-lg hover:bg-poke-accent-strong ${FOCUS_RING}`}
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          {t('name')}
        </button>
      )}

      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-label={t('drawer.title')}
          tabIndex={-1}
          style={{ ['--assistant-w' as string]: `${width}px` }}
          className="fixed inset-0 z-40 flex w-full flex-col border-l border-poke-border bg-poke-base shadow-poke-lg outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[var(--assistant-w)]"
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('drawer.resize')}
            aria-valuemin={DRAWER_MIN_WIDTH}
            aria-valuemax={DRAWER_MAX_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={() => (drag.current = null)}
            onKeyDown={onResizeKey}
            className={`absolute inset-y-0 left-0 hidden w-1.5 cursor-col-resize hover:bg-poke-accent/40 sm:block ${FOCUS_RING}`}
          />

          <header className="flex items-center gap-2 border-b border-poke-border px-3 py-2">
            {conversationId !== null && (
              <Button size="sm" variant="ghost" onClick={() => show(null)} aria-label={t('page.back')}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
            <h1 className="font-heading text-base font-bold text-poke-text-primary">{t('drawer.title')}</h1>
            <Badge variant="accent" size="xs">
              {t('badge')}
            </Badge>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={closeDrawer} aria-label={t('drawer.close')}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </header>

          <div className="min-h-0 flex-1 p-3">
            {conversationId === null ? (
              <div className="h-full overflow-y-auto">
                <ConversationBrowser onOpen={show} onCreated={show} seed={seedForPath(pathname)} />
              </div>
            ) : (
              <AssistantWorkspace key={conversationId} conversationId={conversationId} variant="drawer" />
            )}
          </div>
        </div>
      )}
    </>
  );
}
