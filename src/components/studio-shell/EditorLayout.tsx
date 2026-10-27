'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { useApiErrorText } from '@/i18n/use-api-error';
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
  /** The inspector, or in the ruleset studio the active section. */
  main: ReactNode;
  /** The preview column: beside the inspector from `xl`, below both from `lg` down. */
  side: ReactNode;
  /**
   * A wide editor: the center column gets the room (a narrower outline and preview column, and a wider preview from `2xl`).
   * The ruleset studio's pickers are grids of cards; the format studio's inspectors are forms and keep the default.
   */
  wide?: boolean;
  /** Dialogs and other portals. */
  children?: ReactNode;
}

/**
 * The frame of a studio editor: toolbar, banners and the three-column grid (`lg`: outline | main, `xl`: outline | main |
 * preview, narrower: stacked), the Ctrl/Cmd+S shortcut and the unsaved marker the tab guard reads. It owns no state and
 * no text.
 */
export default function EditorLayout({ rootAttribute, dirty, onSave, toolbar, banners, outline, main, side, wide = false, children }: EditorLayoutProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      onSave();
    }
  };
  const root = { [rootAttribute]: '' };

  return (
    <div className="min-w-0 space-y-4" {...root} {...unsavedMarker(dirty)} onKeyDown={onKeyDown}>
      {toolbar}
      {banners}
      <div
        className={
          wide
            ? 'grid min-w-0 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_21rem] 2xl:grid-cols-[14rem_minmax(0,1fr)_26rem]'
            : 'grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_24rem]'
        }
      >
        <aside className="min-w-0">{outline}</aside>
        <div className="min-w-0">{main}</div>
        <div className="min-w-0 lg:col-span-2 xl:col-span-1">{side}</div>
      </div>
      {children}
    </div>
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
