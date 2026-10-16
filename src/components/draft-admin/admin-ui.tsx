'use client';

/**
 * Small shared pieces of the admin panel: the panel card, the reason field
 * used by every audited action, and the inline notice / error lines.
 * Theme tokens only (no fixed dark fills).
 */
import { useId, type ReactNode } from 'react';
import { useT } from '@/i18n/client';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { cn } from '@/lib/utils/cn';
import { REASON_MAX } from './admin-view';

export const LABEL = 'block text-sm font-heading font-semibold text-poke-text-primary';
export const HINT = 'text-xs text-poke-text-secondary';
export const FIELD =
  'w-full rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2 text-sm text-poke-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
export const TABLE = 'w-full text-left text-sm';
export const TH = 'px-2 py-1.5 text-xs font-semibold text-poke-text-secondary';
export const TD = 'px-2 py-1.5 align-top text-poke-text-primary';

export function PanelCard({
  title,
  id,
  children,
  className,
}: {
  title: string;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn('rounded-poke-lg border border-poke-border bg-poke-elevated p-4 space-y-3', className)}
    >
      <h2 id={headingId} className="font-heading text-lg font-semibold text-poke-text-primary">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Required (or optional) reason textarea; the length hint shows for required fields. */
export function ReasonField({
  value,
  onChange,
  label,
  required = true,
  disabled = false,
}: {
  value: string;
  onChange(next: string): void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const t = useT(draftAdminMessages);
  const id = useId();
  const hintId = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={LABEL}>
        {label ?? t('live.reason')}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={REASON_MAX}
        rows={2}
        required={required}
        disabled={disabled}
        aria-describedby={required ? hintId : undefined}
        className={FIELD}
      />
      {required ? (
        <p id={hintId} className={HINT}>
          {t('live.reasonHint')}
        </p>
      ) : null}
    </div>
  );
}

export function InlineError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-sm text-[var(--draft-warn-ink,var(--poke-amber-ink))]">
      {text}
    </p>
  );
}

export function InlineNotice({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="status" className="text-sm text-poke-text-secondary">
      {text}
    </p>
  );
}
