'use client';

import { useEffect } from 'react';
import { hasUnsavedInput, shouldConfirmTabSwitch } from '@/lib/league-admin/unsaved';

interface UnsavedTabGuardProps {
  /** The tab panel region whose forms may hold unsaved input (`LEAGUE_ADMIN_PANEL_ID`). */
  panelId: string;
  /** Translated question of the native confirm (`tabs.unsavedConfirm`). */
  message: string;
}

/**
 * Asks before a league admin tab switch (and before a reload or close) while a form in the open panel marks
 * unsaved input with `data-unsaved="true"` (`src/lib/league-admin/unsaved.ts`). Renders nothing.
 *
 * The tab links stay plain `<Link>`s rendered on the server: one capture-phase click listener on the
 * document sees a click on `a[data-admin-tab]` before Next's link handler, and a declined confirm stops it
 * (`preventDefault` + `stopPropagation`), so the panel and its input stay. A click that opens a new tab or
 * window, or on the tab that is already open, is never interrupted. The prompt is the browser's own
 * confirm dialog: keyboard and screen-reader accessible, in the page language through `message`.
 */
export default function UnsavedTabGuard({ panelId, message }: UnsavedTabGuardProps) {
  useEffect(() => {
    const unsaved = () => hasUnsavedInput(document.getElementById(panelId));

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest('a[data-admin-tab]');
      if (!link) return;
      const ask = shouldConfirmTabSwitch({
        unsaved: unsaved(),
        activeTab: link.getAttribute('aria-current') === 'page',
        newContext: event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
      });
      if (!ask || window.confirm(message)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!unsaved()) return;
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
  }, [panelId, message]);

  return null;
}
