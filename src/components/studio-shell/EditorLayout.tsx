'use client';

import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { uiMessages } from '@/i18n/messages/ui';
import { useApiErrorText } from '@/i18n/use-api-error';
import { cn } from '@/lib/utils/cn';
import { unsavedMarker } from '@/lib/league-admin/unsaved';
import type { SaveState } from '@/lib/studio-core/editor-state';
import type { ShellText } from './text';

/** Width (px) from which the outline sits beside the inspector instead of above it (Tailwind `lg`). */
const OUTLINE_BESIDE_QUERY = '(min-width: 1024px)';

/**
 * Below `lg` the outline sits above the inspector: bring the reader to the heading of what they chose. Call it after a
 * selection; on wider screens both are visible and nothing moves.
 */
export function revealInspector(headingId: string): void {
  if (typeof window === 'undefined' || window.matchMedia(OUTLINE_BESIDE_QUERY).matches) return;
  window.requestAnimationFrame(() => document.getElementById(headingId)?.focus());
}

/** What the toolbar needs to open the preview drawer: its label, its id and state, and the id of the toggle button, so focus can return to it. */
interface PreviewDrawerControl {
  label: string;
  drawerId: string;
  open: boolean;
  toggle: () => void;
  toggleId: string;
}

const PreviewDrawerContext = createContext<PreviewDrawerControl | null>(null);

/** The drawer control of the surrounding `EditorLayout`, or null when the toolbar is rendered on its own. */
export function usePreviewDrawer(): PreviewDrawerControl | null {
  return useContext(PreviewDrawerContext);
}

interface EditorLayoutProps {
  /** The attribute that marks the editor root for the studio (`data-format-editor`). */
  rootAttribute: string;
  dirty: boolean;
  /** Ctrl/Cmd+S saves. */
  onSave: () => void;
  toolbar: ReactNode;
  /** Alerts between the toolbar and the grid (a failed save, a failed action). */
  banners?: ReactNode;
  /** The outline column. */
  outline: ReactNode;
  /** The inspector, or in the ruleset studio the active section. It gets all the width the outline leaves. */
  main: ReactNode;
  /** The preview. It lives in a drawer: a sticky side panel from `sm`, a sheet that rises from the bottom on a phone. */
  side: ReactNode;
  /** The drawer's title and the label of the button that opens it, in the studio's words. */
  previewLabel: string;
  /**
   * A wide editor: the outline column is a little narrower so the center column gets the room. The ruleset studio's
   * pickers are grids of cards; the format studio's inspectors are forms and keep the default.
   */
  wide?: boolean;
  /** Dialogs and other portals. */
  children?: ReactNode;
}

/**
 * The frame of a studio editor: a sticky toolbar, banners, the outline beside the full-width inspector (stacked below
 * `lg`), the preview in a drawer, the Ctrl/Cmd+S shortcut and the unsaved marker the tab guard reads. The drawer's
 * content stays mounted while it is closed, so the preview never loses its tab or its scroll. It owns no state of the
 * document and no text.
 */
export default function EditorLayout({ rootAttribute, dirty, onSave, toolbar, banners, outline, main, side, previewLabel, wide = false, children }: EditorLayoutProps) {
  const t = useT(uiMessages);
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const toggleId = `${drawerId}-toggle`;
  const closeRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (open) {
      opened.current = true;
      closeRef.current?.focus();
    } else if (opened.current) {
      document.getElementById(toggleId)?.focus();
    }
  }, [open, toggleId]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      onSave();
      return;
    }
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
    }
  };
  const root = { [rootAttribute]: '' };

  return (
    <PreviewDrawerContext.Provider value={{ label: previewLabel, drawerId, open, toggle: () => setOpen((value) => !value), toggleId }}>
    <div className="min-w-0 space-y-4" {...root} {...unsavedMarker(dirty)} onKeyDown={onKeyDown}>
      {toolbar}
      {banners}
      <div className={wide ? 'grid min-w-0 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]' : 'grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]'}>
        <aside className="min-w-0">{outline}</aside>
        <div className="min-w-0">{main}</div>
      </div>

      {open && <div aria-hidden="true" className="fixed inset-0 z-40 bg-scrim" onClick={() => setOpen(false)} />}
      <div
        id={drawerId}
        role="complementary"
        aria-label={previewLabel}
        hidden={!open}
        className={cn(
          open ? 'flex' : 'hidden',
          'fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] min-w-0 flex-col rounded-t-poke-lg border border-hairline bg-surface shadow-poke-lg sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-[26rem] sm:max-w-full sm:rounded-none sm:border-y-0 sm:border-r-0 2xl:w-[30rem]',
        )}
      >
        <div className="flex shrink-0 items-center justify-end border-b border-hairline px-4 py-1">
          <button
            ref={closeRef}
            type="button"
            aria-label={t('modal.close')}
            className="inline-flex h-11 w-11 items-center justify-center rounded-poke-sm text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-poke-focus sm:h-9 sm:w-9"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">{side}</div>
      </div>
      {children}
    </div>
    </PreviewDrawerContext.Provider>
  );
}

interface SaveErrorAlertProps {
  text: ShellText;
  save: SaveState;
  onRetry: () => void;
}

/** "Saving failed" with the reason in the viewer's language and a Try again button; nothing for any other save state. */
export function SaveErrorAlert({ text, save, onRetry }: SaveErrorAlertProps) {
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);
  if (save.status !== 'error') return null;
  return (
    <Alert variant="error" className="flex flex-wrap items-center justify-between gap-2">
      <span>
        {text('save.failed')} {errorText(save.error)}
      </span>
      <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={onRetry}>
        {text('save.retry')}
      </Button>
    </Alert>
  );
}

/** A request error of a toolbar action (delete, fork) as an alert. */
export function ActionErrorAlert({ error }: { error: ApiErrorLike | null }) {
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);
  return error === null ? null : <Alert variant="error">{errorText(error)}</Alert>;
}
