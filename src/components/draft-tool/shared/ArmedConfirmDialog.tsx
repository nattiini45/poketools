'use client';

/**
 * A confirmation dialog that cannot be confirmed by accident
 * (draft-frontend §5.5–§5.6; shared by the pick screen, the token centre and
 * the admin panel).
 *
 * - Cancel has focus on open, so Enter on open cancels (SPEC:497).
 * - Confirm stays disabled for `armMs` (default `CONFIRM_ARM_MS`) after every
 *   open and again after every failed submission (SPEC:494-496). No hold, no
 *   typing.
 * - While `submitting`, Confirm and Cancel are disabled and the dialog cannot
 *   be dismissed (SPEC:1011).
 *
 * Callers always pass `submitting` (true while the request runs) and close
 * the dialog when the action succeeds; a failure is reported by `submitting`
 * going back to false (plus an `error`), which re-arms.
 * `@radix-ui/react-dialog` is used directly because `Modal` exposes no
 * `onOpenAutoFocus` (`Modal.tsx`).
 */
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { ButtonVariant } from '@/components/ui/buttonStyles';
import { useT } from '@/i18n/client';
import { commonMessages } from '@/i18n/messages/common';
import { uiMessages } from '@/i18n/messages/ui';
import {
  armedConfirmReducer,
  canConfirm,
  INITIAL_ARMED_CONFIRM,
  scheduleArm,
  type ArmedConfirmState,
} from '@/lib/draft-ui/armed-confirm';
import { CONFIRM_ARM_MS } from '@/lib/draft-ui/constants';

export interface ArmedConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
  armMs?: number;
  /**
   * True while the request runs. Required: the busy → idle edge is what re-arms Confirm after a failure,
   * so the same error text twice still unlocks the dialog.
   */
  submitting: boolean;
  /** Already translated (e.g. `useApiErrorText(errorsDraft)(err)`); shown inline. */
  error?: string | null;
  /** Extra controls between the body and the buttons (slot chooser, reason field). */
  children?: ReactNode;
  /** Blocks Confirm independently of arming (e.g. a required field is empty). */
  confirmDisabled?: boolean;
  confirmVariant?: ButtonVariant;
  /**
   * Extra classes for the confirm button, merged over the variant's (tailwind-merge), e.g. the pick
   * dialog's violet CTA. Disabled styling stays the caller's job when it overrides the colours.
   */
  confirmClassName?: string;
  /** Defaults to the common "Cancel". */
  cancelLabel?: string;
}

const OPENED: ArmedConfirmState = armedConfirmReducer(INITIAL_ARMED_CONFIRM, { type: 'open' });

/** Mounted once per open (Radix unmounts the portal content when closed), so arming restarts on every open. */
function ArmedConfirmContent({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  armMs = CONFIRM_ARM_MS,
  submitting,
  error = null,
  children,
  confirmDisabled = false,
  confirmVariant = 'primary',
  confirmClassName,
  cancelLabel,
}: Omit<ArmedConfirmDialogProps, 'open'>) {
  const tCommon = useT(commonMessages);
  const tUi = useT(uiMessages);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [state, dispatch] = useReducer(armedConfirmReducer, OPENED);

  // Derive phase changes from the caller's props during render (no effect round-trip).
  const [seenSubmitting, setSeenSubmitting] = useState(submitting);
  const [seenError, setSeenError] = useState(error);
  if (submitting !== seenSubmitting) {
    setSeenSubmitting(submitting);
    dispatch(submitting ? { type: 'busy' } : { type: 'failed' });
  }
  if (error !== seenError) {
    setSeenError(error);
    if (error && !submitting) dispatch({ type: 'failed' });
  }

  useEffect(() => scheduleArm(state, dispatch, armMs), [state, armMs]);

  const busy = submitting || state.phase === 'submitting';
  const confirmEnabled = canConfirm(state) && !submitting && !confirmDisabled;

  const handleConfirm = () => {
    if (!confirmEnabled) return;
    dispatch({ type: 'submit' });
    onConfirm();
  };

  return (
    <Dialog.Content
      className="fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-poke-xl border border-poke-border bg-poke-surface p-6 shadow-poke-lg"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        cancelRef.current?.focus();
      }}
      onEscapeKeyDown={(e) => {
        if (busy) e.preventDefault();
      }}
      onPointerDownOutside={(e) => {
        if (busy) e.preventDefault();
      }}
      onInteractOutside={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <Dialog.Title className="text-lg font-heading font-bold text-poke-text-primary">{title}</Dialog.Title>
        <Dialog.Close
          className="ml-auto inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-poke-sm p-1 text-poke-text-muted motion-safe:transition-colors md:min-h-0 md:min-w-0 hover:text-poke-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={tUi('modal.close')}
          disabled={busy}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Dialog.Close>
      </div>
      <Dialog.Description asChild>
        <div className="text-sm text-poke-text-secondary">{body}</div>
      </Dialog.Description>
      {children}
      {error ? (
        // Amber, not red: red only ever means "drafted" in the draft tool (design rule).
        <p role="alert" className="text-sm text-poke-amber-ink">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button ref={cancelRef} type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel ?? tCommon('actions.cancel')}
        </Button>
        <Button
          type="button"
          variant={confirmVariant}
          className={confirmClassName}
          onClick={handleConfirm}
          disabled={!confirmEnabled}
          loading={busy}
          aria-busy={busy || undefined}
          data-armed={state.phase === 'armed' ? 'true' : 'false'}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog.Content>
  );
}

export default function ArmedConfirmDialog({ open, ...rest }: ArmedConfirmDialogProps) {
  const { submitting, onCancel } = rest;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-poke-inverse/40 backdrop-blur-sm" />
        <ArmedConfirmContent {...rest} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}
