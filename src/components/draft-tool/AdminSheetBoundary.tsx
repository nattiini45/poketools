'use client';

/**
 * Guards the lazy admin sheet in the draft room (pool admins only).
 *
 * `RoomAdminSheet` is a separate chunk (`admin-sheet-loader`). When that
 * chunk cannot load (a stale chunk after a deploy, a dropped connection), the
 * lazy component throws during render. Without a boundary that error would
 * take down the whole room, the live pick screen, for that admin. This
 * boundary keeps the room and shows a small notice with Retry instead.
 *
 * It catches every render error of the sheet, not only a failed chunk. The
 * notice says which: "could not be loaded" for a chunk failure (Retry requests
 * the chunk again), "ran into an error" for anything else (Retry mounts the
 * sheet afresh). Both are logged with `console.error`.
 *
 * The strings live in the room's own namespace (`draft/screen`, `clock.*`):
 * the admin namespace is part of the admin chunk, which players never load.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { uiMessages } from '@/i18n/messages/ui';
import styles from './draft-tool.module.css';

const NOTICE =
  'fixed inset-x-4 bottom-4 z-50 flex flex-wrap items-center gap-2 rounded-lg border bg-[var(--draft-surface,var(--poke-surface))] p-3 text-sm text-[var(--draft-ink,var(--poke-text-primary))] shadow-poke-lg sm:left-auto sm:max-w-sm';
const BUTTON = `${styles.focusable} inline-flex min-h-[44px] items-center rounded-lg border border-[var(--draft-border,var(--poke-border))] px-3 text-sm hover:bg-[var(--draft-elevated,var(--poke-elevated))] md:min-h-[36px]`;

/** Suspense fallback while the admin chunk loads (after the first click on Admin). */
export function AdminSheetLoading() {
  const t = useT(draftScreenMessages);
  return (
    <p role="status" className={`${NOTICE} border-[var(--draft-border,var(--poke-border))] text-[var(--draft-ink-2,var(--poke-text-secondary))]`}>
      {t('clock.adminLoading')}
    </p>
  );
}

/** What went wrong: the chunk did not load, or the loaded sheet threw while rendering. */
export type AdminSheetFailure = 'load' | 'crash';

/**
 * A failed dynamic import: webpack's `ChunkLoadError`, or the browser's own messages for a failed
 * `import()` / CSS chunk (Chrome, Firefox, Safari). Everything else is a runtime error of the sheet.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'ChunkLoadError') return true;
  return /Loading (?:CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    error.message,
  );
}

/** The notice after a failure: Retry requests the chunk again (or remounts the sheet), Close dismisses it. */
export function AdminSheetLoadFailed({
  onRetry,
  onDismiss,
  failure = 'load',
}: {
  onRetry(): void;
  onDismiss(): void;
  failure?: AdminSheetFailure;
}) {
  const t = useT(draftScreenMessages);
  const tUi = useT(uiMessages);
  return (
    <div role="alert" className={`${NOTICE} border-[var(--draft-warn-ink,var(--poke-amber-ink))]`}>
      <p className="min-w-0 flex-1">{failure === 'load' ? t('clock.adminLoadFailed') : t('clock.adminCrashed')}</p>
      <button type="button" onClick={onRetry} className={BUTTON}>
        {t('clock.adminRetry')}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={tUi('modal.close')}
        className={`${styles.focusable} inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[var(--draft-ink-2,var(--poke-text-secondary))] hover:text-[var(--draft-ink,var(--poke-text-primary))] md:min-h-[36px] md:min-w-[36px]`}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

interface AdminSheetBoundaryProps {
  /** Request the chunk again (the caller swaps in a fresh `lazy` component). */
  onRetry(): void;
  /** Close the sheet without retrying. */
  onDismiss(): void;
  children: ReactNode;
}

interface AdminSheetBoundaryState {
  failed: AdminSheetFailure | null;
}

export default class AdminSheetBoundary extends Component<AdminSheetBoundaryProps, AdminSheetBoundaryState> {
  state: AdminSheetBoundaryState = { failed: null };

  static getDerivedStateFromError(error: unknown): AdminSheetBoundaryState {
    return { failed: isChunkLoadError(error) ? 'load' : 'crash' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Reported, not swallowed: the room survives, the failure stays visible in the console and to the admin.
    const what = isChunkLoadError(error) ? 'failed to load' : 'failed while rendering';
    console.error(`[draft-room] admin sheet ${what}`, error, info.componentStack);
  }

  private retry = () => {
    this.setState({ failed: null });
    this.props.onRetry();
  };

  private dismiss = () => {
    this.setState({ failed: null });
    this.props.onDismiss();
  };

  render() {
    const { failed } = this.state;
    if (failed) return <AdminSheetLoadFailed failure={failed} onRetry={this.retry} onDismiss={this.dismiss} />;
    return this.props.children;
  }
}
