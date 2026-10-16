'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFocusState } from '@/components/world/route/focus/focus-store';
import { nextReleaseLatch, startDockedExit } from '@/components/world/route/focus/docked-exit';
import { useT } from '@/i18n/client';
import { worldClientMessages } from '@/i18n/messages/world/client';

interface ContextOverlayProps {
  /** Search-param name that opens the overlay when set to a trigger value. */
  paramName: string;
  /** Values of `paramName` that open this overlay (e.g. ['1', 'open']). */
  triggerValues: readonly string[];
  /** Accessible dialog title. */
  title: string;
  /**
   * Route tier: dock beside the focused Subject as a ZA-glass panel instead of
   * a centered modal — the plaza stays visible and orbitable behind it.
   */
  docked?: boolean;
  /**
   * Accessible label for the close button. Defaults to "Close" in the
   * viewer's language (i18n D11: worlds follow the viewer).
   */
  closeLabel?: string;
  /**
   * Called once a DOCKED overlay has finished its exit animation and the
   * dialog has closed — the parent may unmount it only then (OverlaySwitch
   * keeps rendering the last content until this fires).
   */
  onExited?: () => void;
  children: ReactNode;
}

/**
 * Upper bound for the docked exit animation (globals.css W6 block: 240 ms).
 * The dialog closes on `animationend`; this fallback closes it anyway if the
 * animation never runs (animations disabled, element hidden), so a close can
 * never hang.
 */
const DOCKED_EXIT_FALLBACK_MS = 400;

/**
 * Native `<dialog>` overlay driven by a search param. Opens via
 * `showModal()` when the param holds a trigger value (focus-trapped by the
 * browser), closes on ESC (native `cancel`) or backdrop click, restores
 * focus to the previously focused element on close, and syncs the param
 * through the App Router router (shallow — no full reload).
 *
 * Docked variant (Route tier, ADR-0003): opens non-modal with `show()`, so
 * the canvas keeps its pointer events for orbit and dolly; ESC is handled by
 * hand because non-modal dialogs do not fire `cancel`. W6: a docked panel
 * enters from the edge it docks to and EXITS to that same edge — on close it
 * gets `data-closing`, stays open while the exit animation plays, then
 * closes (the `close` event, and so the focus restore, fires only then).
 * Re-opening mid-exit cancels the exit. The modal (Lite) variant closes
 * immediately, exactly as before.
 *
 * Next.js 16 note: `useSearchParams()` in a client component requires a
 * `<Suspense>` boundary when the page is statically prerendered. This
 * component is exported un-wrapped so the consuming page can wrap it:
 * `<Suspense><ContextOverlay ... /></Suspense>`.
 */
export default function ContextOverlay({
  paramName,
  triggerValues,
  title,
  docked = false,
  closeLabel,
  onExited,
  children,
}: ContextOverlayProps) {
  const router = useRouter();
  const t = useT(worldClientMessages);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  /** Presentation mode the dialog was opened in — `show()` vs `showModal()`. */
  const openModeRef = useRef<'docked' | 'modal' | null>(null);
  /**
   * Count of `close()` calls issued by a mode flip rather than by the overlay
   * actually closing. Each queues a `close` event that must NOT run the real
   * close's focus restore.
   */
  const pendingFlipCloses = useRef(0);
  /** Cancels the running docked exit (listener + fallback timer), if any. */
  const cancelExitRef = useRef<(() => void) | null>(null);
  const onExitedRef = useRef(onExited);
  useEffect(() => {
    onExitedRef.current = onExited;
  }, [onExited]);

  const paramOpen =
    searchParams.get(paramName) !== null &&
    triggerValues.includes(searchParams.get(paramName) as string);

  // W6 round 3: a docked panel leaves on the focus store's `releasing` edge —
  // the frame the camera starts home — not when the param clears a router
  // round trip later (docked-exit.ts). Derived state, adjusted while
  // rendering so the latch and the param never disagree for a commit.
  const focusPhase = useFocusState().phase;
  const [releaseLatched, setReleaseLatched] = useState(false);
  const latch = nextReleaseLatch(releaseLatched, { docked, isOpen: paramOpen, phase: focusPhase });
  if (latch !== releaseLatched) setReleaseLatched(latch);
  const isOpen = paramOpen && !latch;

  /** Shallow-remove the param (preserves all other params). */
  const clearParam = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (!params.has(paramName)) return;
    params.delete(paramName);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [paramName, pathname, router, searchParams]);

  // Open/close the native dialog in response to the param. A native dialog
  // keeps the presentation mode it was opened with, so a `docked` flip while
  // open (a tier degrade mid-session) must close and reopen it: a still-modal
  // dialog would wear the docked styling and keep blocking the canvas, and a
  // still-non-modal one loses both ESC paths (no `cancel` event, docked
  // listener gone) — the overlay could only be closed by its button
  // (PR #63 review).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const mode = docked ? 'docked' : 'modal';
    if (!isOpen) {
      if (!dialog.open) {
        openModeRef.current = null;
        return;
      }
      if (openModeRef.current !== 'docked') {
        dialog.close();
        openModeRef.current = null;
        return;
      }
      if (cancelExitRef.current) return; // already leaving
      // Docked exit (W6): play the exit to the dock edge, then close.
      const cancel = startDockedExit(dialog, DOCKED_EXIT_FALLBACK_MS, () => {
        cancelExitRef.current = null;
        openModeRef.current = null;
        onExitedRef.current?.();
      });
      cancelExitRef.current = () => {
        cancel();
        cancelExitRef.current = null;
      };
      return;
    }
    // Re-opened while the exit was still playing: stay open.
    cancelExitRef.current?.();
    if (dialog.open && openModeRef.current === mode) return;
    if (dialog.open) {
      // A mode flip reopens the SAME overlay, so the focus target captured
      // when it first opened still stands — re-capturing here would read
      // whatever `close()` just left behind: the trigger for a modal (which
      // restores focus synchronously) but `<body>` for a docked one, throwing
      // away the keyboard visitor's place. The flip's own queued `close` event
      // is accounted for so the handler below skips its restore.
      pendingFlipCloses.current += 1;
      dialog.close();
    } else if (document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement;
    }
    if (docked) dialog.show();
    else dialog.showModal();
    openModeRef.current = mode;
  }, [isOpen, docked]);

  // An unmount mid-exit must not leave the fallback timer running.
  useEffect(() => () => cancelExitRef.current?.(), []);

  // ESC (native cancel) → clear the param; the effect above then closes.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      clearParam();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [clearParam]);

  // Non-modal dialogs get no `cancel`, so ESC is a window listener while docked.
  useEffect(() => {
    if (!docked || !isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearParam();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [docked, isOpen, clearParam]);

  // Restore focus to the trigger element after the dialog closes.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      // A mode flip's close is not a close: the overlay is still open and its
      // focus target must survive for the real one.
      if (pendingFlipCloses.current > 0) {
        pendingFlipCloses.current -= 1;
        return;
      }
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, []);

  // Backdrop click (clicks on the dialog element itself) → clear the param.
  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      clearParam();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      onClick={handleBackdropClick}
      className={
        docked
          ? 'world-focus-panel'
          : 'w-full max-w-lg rounded-xl border border-arena-border bg-arena-surface p-0 shadow-poke-lg backdrop:bg-poke-inverse/40 backdrop:backdrop-blur-sm'
      }
    >
      <div
        className={
          docked
            ? 'world-focus-panel-head'
            : 'flex items-start justify-between gap-3 border-b border-arena-border px-6 py-4'
        }
      >
        <h2
          className={
            docked
              ? 'world-focus-panel-title'
              : 'font-heading text-lg font-bold tracking-tight text-arena-ink'
          }
        >
          {title}
        </h2>
        <button
          type="button"
          onClick={clearParam}
          aria-label={closeLabel ?? t('overlay.close')}
          className={
            docked
              ? 'world-focus-panel-close'
              : 'rounded-md p-1 text-arena-ink-secondary transition-colors hover:text-arena-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-arena-focus'
          }
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>
      {/* Keyed by title on the docked panel: tapping subject B while A is
          focused swaps the body with a short cross-fade (W6) instead of a
          hard content cut; the panel itself stays docked. */}
      <div key={docked ? title : undefined} className={docked ? 'world-focus-panel-body' : 'px-6 py-5'}>
        {children}
      </div>
    </dialog>
  );
}
