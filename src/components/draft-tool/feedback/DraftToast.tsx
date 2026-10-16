'use client';

/**
 * In-house toast stack for the pick screen (FR-12: no toast library).
 * Bottom-centre, auto-hides after 4 s, `role="status"`, tokens only. A toast
 * holds a message kind and its data (or an `ApiErrorLike`), never text: it is
 * translated while rendering, so a language switch re-renders it correctly.
 */
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useDataLocale, useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import styles from '../draft-tool.module.css';

export const TOAST_MS = 4000;

/** A line by its canonical English stage names (localized at render). */
export interface ToastLine {
  base: string;
  stage3: string | null;
}

export type ToastMessage =
  | { kind: 'added'; line: ToastLine }
  | { kind: 'addedFor'; line: ToastLine; player: string }
  | { kind: 'yourTurn' }
  | { kind: 'error'; error: ApiErrorLike };

export interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: ToastMessage;
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss(id: number): void }) {
  const t = useT(draftScreenMessages);
  const dl = useDataLocale();
  const errorText = useApiErrorText(errorsDraft);
  const tGlossary = useT(glossaryMessages);

  useEffect(() => {
    const id = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast.id, onDismiss]);

  const m = toast.message;
  let text: string;
  if (m.kind === 'error') text = errorText(m.error);
  else if (m.kind === 'yourTurn') text = tGlossary('draft.youOnClock');
  else {
    const line = pkmnNameResolver.lineLabel(m.line.base, m.line.stage3, dl);
    text = m.kind === 'added' ? t('toast.added', { line }) : t('toast.addedFor', { line, player: m.player });
  }

  const tone = toast.tone === 'success' ? styles.toastSuccess : toast.tone === 'error' ? styles.toastError : styles.toastInfo;
  return (
    <div className={`${styles.toast} ${tone}`}>
      <p className="min-w-0 flex-1 text-sm">{text}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className={`${styles.focusable} -m-1 shrink-0 rounded p-1 text-[var(--draft-ink-2)] hover:text-[var(--draft-ink)]`}
        aria-label={t('toast.dismiss')}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function DraftToast({ toasts, onDismiss }: { toasts: Toast[]; onDismiss(id: number): void }) {
  const t = useT(draftScreenMessages);
  return (
    // Rendered beside the screen root, so it brings the `--draft-*` tokens along (`.tokens`, no position).
    <div className={`${styles.tokens} ${styles.toastStack}`} role="status" aria-label={t('toast.region')}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
