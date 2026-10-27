'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';
import { shouldConfirmTabSwitch } from '@/lib/league-admin/unsaved';

/** The part of `window` the back-button guard uses; the real `window` fits, a test passes a fake. */
export interface BackGuardWindow {
  history: {
    readonly state: unknown;
    pushState: (data: unknown, unused: string, url?: string | URL | null) => void;
    go: (delta: number) => void;
    back: () => void;
  };
  location: { readonly href: string };
  addEventListener: (type: 'popstate', listener: () => void) => void;
  removeEventListener: (type: 'popstate', listener: () => void) => void;
  confirm: (message: string) => boolean;
}

export interface BackGuard {
  /** Call whenever the unsaved state may have changed: the first time it is dirty, one history entry is added. */
  sync: () => void;
  dispose: () => void;
}

/**
 * Back, forward and swipe-back are history moves inside the page, so neither `beforeunload` nor a click sees them.
 * While the editor is dirty one extra history entry for the same address sits on top of the stack. Stepping back
 * from it lands on the entry the editor was opened on, which looks like nothing happened: there the guard asks
 * `confirm` with the message. "Stay" sends the user forward onto the extra entry again; "Leave" (or a clean editor, or the
 * editor's own way out) goes back once more, to where the user was heading. The entry is added once and stays
 * after a save; the first Back from it then simply continues to the previous page.
 */
export function installBackGuard(
  win: BackGuardWindow,
  options: { isDirty: () => boolean; skip: () => boolean; message: () => string },
): BackGuard {
  let armed = false;
  let returning = false;

  const onPopState = () => {
    if (returning) {
      returning = false;
      return;
    }
    if (!armed) return;
    if (options.skip()) {
      armed = false;
      return;
    }
    if (!options.isDirty() || win.confirm(options.message())) {
      armed = false;
      win.history.back();
      return;
    }
    returning = true;
    win.history.go(1);
  };

  win.addEventListener('popstate', onPopState);
  return {
    sync: () => {
      if (armed || options.skip() || !options.isDirty()) return;
      // The same state object keeps Next's own bookkeeping on the new entry.
      win.history.pushState(win.history.state, '', win.location.href);
      armed = true;
    },
    dispose: () => win.removeEventListener('popstate', onPopState),
  };
}

/**
 * Asks before the page is left while the editor holds unsaved changes: the browser's own prompt on reload,
 * close and address-bar navigation (`beforeunload`), `window.confirm(message)` on a click on a link
 * (`a[href]`), before Next's link handler sees it, and the same question on browser back (see
 * `installBackGuard`). A click that opens a new tab or window, or that does not leave the page, is never
 * interrupted.
 *
 * The returned ref is the editor's own way out: set `current` to true right before it navigates itself (after a
 * delete or a fork) so the guard stays quiet for that one move.
 */
export function useUnsavedGuard(dirty: boolean, message: string): MutableRefObject<boolean> {
  const skipGuard = useRef(false);
  const dirtyRef = useRef(dirty);
  const messageRef = useRef(message);
  const backGuard = useRef<BackGuard | null>(null);
  useEffect(() => {
    dirtyRef.current = dirty;
    messageRef.current = message;
    backGuard.current?.sync();
  }, [dirty, message]);

  // Once per mount: a new history entry must not be added again because the language changed.
  useEffect(() => {
    const back = installBackGuard(window, {
      isDirty: () => dirtyRef.current,
      skip: () => skipGuard.current,
      message: () => messageRef.current,
    });
    backGuard.current = back;
    back.sync();
    return () => {
      back.dispose();
      backGuard.current = null;
    };
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (skipGuard.current || !dirtyRef.current) return;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href') ?? '';
      // A link that stays on this page (a fragment, a script, a mail link) does not leave the editor.
      if (href === '' || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) return;
      if (link.getAttribute('target') === '_blank') return;
      const ask = shouldConfirmTabSwitch({
        unsaved: true,
        activeTab: false,
        newContext: event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
      });
      if (!ask || window.confirm(message)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (skipGuard.current || !dirtyRef.current) return;
      // The browser shows its own generic text; a custom message is ignored by every current browser.
      event.preventDefault();
      // Older engines only prompt when returnValue is set as well.
      event.returnValue = '';
    };

    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [message]);

  return skipGuard;
}
